// ── Noun Pool mode: `game.pool` (PoolApi), the menu and the Game.ts hook ─
//
// Owns everything between "you stepped up to a pool table" and "you're
// back walking round the room":
//   playAt(table)   a bar's table (interiors/ calls it on E): the view draws
//                   its own table over the prop, the room stays around you;
//   arrive()        `/world?play=pool`: the pool hall, a room of its own
//                   floating over the plaza, the world hidden while you're in;
//   the menu        VS CPU (easy / normal / hard / pro), 1V1 with someone in
//                   the same room, WATCH a frame on;
//   the frame       a PoolSession (sync.ts's lockstep), the local player's
//                   aim / power / spin / ball in hand / call, pointer and
//                   keys, the CPU, results and respect;
//   leaving         puts the camera, the player and (the hall) the world
//                   back exactly as they were.
//
// Game.ts calls `idle(dt)` every normal frame and, while `active`, hands
// the whole frame to `step(dt)` (the skater's physics and camera wait).

import type { Game } from '../../Game';
import type { RespectApi } from '../../interiors/contract';
import type {
  BallId,
  Group,
  LiveFrame,
  PocketId,
  PoolApi,
  PoolConfig,
  PoolMsg,
  PoolTable,
  Seat,
  ShotInput,
  Vec2,
} from '../contract';
import type { PoolView } from '../view';

import * as THREE from 'three';

import { parseSeedKey, randomSeed, seedKey, type NounSeed } from '../../character/NounAppearance';
import { firstHit, pocketAlong } from '../sim/aim';
import { SKILL, type Difficulty } from '../sim/cpu';
import { canPlace, defaultCall, legalFirst, newFrame, onEight, remaining } from '../sim/rules';
import { HEAD_X, L, R, W } from '../sim/table';

import { PoolLobby, type LobbyResult } from './lobby';
import { PoolSession, type Role, type SessionEvent } from './session';
import { tableOf } from './tableOf';
import { NetTransport, type PoolTransport } from './transport';

export type PoolPhase = 'idle' | 'menu' | 'playing' | 'results';

export interface PoolUiState {
  phase: PoolPhase;
  online: boolean;
  hall: boolean;
  /** People in the same room / at this table (for 1V1). */
  near: { id: string; name: string }[];
  live: LiveFrame[];
  outgoing: { name: string } | null;
  incoming: { from: string; name: string; here: boolean } | null;
  waiting: string | null;
  difficulty: Difficulty;
  pro: boolean;
  // ── In a frame ──
  role: Role | null;
  names: [string, string];
  mySeat: Seat | null;
  turn: Seat;
  groups: [Group | null, Group | null];
  /** Balls left per seat (their group, or all of both while open). */
  left: [BallId[], BallId[]];
  onEight: [boolean, boolean];
  myTurn: boolean;
  rolling: boolean;
  thinking: boolean;
  inHand: 'kitchen' | 'anywhere' | null;
  calling: boolean;
  call: PocketId | null;
  power: number;
  side: number;
  top: number;
  cam: 'aim' | 'top';
  fast: boolean;
  /** One line: whose shot / what just happened. */
  line: string;
  foul: string | null;
  results: null | {
    won: boolean | null;
    winner: string;
    reason: string;
    respect: number | null;
    host: boolean;
    vsCpu: boolean;
  };
  toast: { text: string; at: number } | null;
}

const FOUL_TEXT: Record<string, string> = {
  scratch: 'SCRATCH',
  no_contact: 'NO CONTACT',
  wrong_first: 'WRONG BALL FIRST',
  no_rail: 'NO CUSHION AFTER CONTACT',
  bad_break: 'SOFT BREAK',
};

/** Respect for a win (game.respect; the rules clamp custom to ±10 and rate-limit it). */
export const WIN_RESPECT: Record<Difficulty | 'human', number> = {
  easy: 2,
  normal: 4,
  hard: 6,
  pro: 8,
  human: 8,
};

const HALL_Y = 3600;
const NEAR_R = 30;
const ANNOUNCE_S = 2.5;
const AIM_SEND_S = 0.12;

function offlineFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('offline') === '1';
}

const viewMod = () => import('../view');

/** What the table shows before a frame: a fresh rack. */
const RACKED = newFrame(8, 0).balls;

interface Saved {
  cam: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
  meVisible: boolean;
  /** The name-tag layer's visibility (its tags freeze while the room waits). */
  labels: string;
  /** The pool hall: what it changed about the world. */
  hall: null | {
    pos: THREE.Vector3;
    yaw: number;
    fog: THREE.Scene['fog'];
    background: THREE.Scene['background'];
    skyVisible: boolean;
    sunIntensity: number;
    hemiColor: THREE.Color;
    hemiGround: THREE.Color;
    hemiIntensity: number;
    hidden: THREE.Object3D[];
    statsSuspended: boolean;
  };
}

export class PoolMode implements PoolApi {
  ui: PoolUiState = {
    phase: 'idle',
    online: false,
    hall: false,
    near: [],
    live: [],
    outgoing: null,
    incoming: null,
    waiting: null,
    difficulty: 'normal',
    pro: false,
    role: null,
    names: ['', ''],
    mySeat: null,
    turn: 0,
    groups: [null, null],
    left: [[], []],
    onEight: [false, false],
    myTurn: false,
    rolling: false,
    thinking: false,
    inHand: null,
    calling: false,
    call: null,
    power: 0.45,
    side: 0,
    top: 0,
    cam: 'aim',
    fast: false,
    line: '',
    foul: null,
    results: null,
    toast: null,
  };
  readonly transport: PoolTransport;
  readonly lobby: PoolLobby;
  session: PoolSession | null = null;
  view: PoolView | null = null;
  table: PoolTable | null = null;
  /** Where the world streams round while active. */
  readonly focus = new THREE.Vector3();
  readonly focusVel = new THREE.Vector3();

  // The local player's shot being set up (sim frame)
  private aim = { dx: 1, dy: 0 };
  private place: Vec2 | null = null;
  private call: PocketId | null = null;
  private callPicked = false;
  private aimedFor = -1;
  private placing = false;
  private drag: { x: number; y: number; mode: 'aim' | 'place' | 'top' } | null = null;
  private listeners = new Set<() => void>();
  private saved: Saved | null = null;
  private announceAcc = 0;
  private aimSendAcc = 0;
  private lastAimSent = '';
  private publishAcc = 0;
  private lastKey = '';
  private escArmed = 0;
  private loading = false;
  private seeds: [NounSeed, NounSeed] | null = null;
  private vsCpuDiff: Difficulty | null = null;
  private refreshAcc = 0;
  private hidden = new Set<string>();
  private padPrev: boolean[] = [];
  private hallKeep = new Set<THREE.Object3D>();
  private padPull = 0;

  constructor(
    private game: Game,
    transport?: PoolTransport,
  ) {
    this.transport = transport ?? new NetTransport(game.net, offlineFlag());
    this.transport.onMessage = m => this.onMessage(m);
    this.lobby = new PoolLobby({
      myId: () => this.transport.id,
      myName: () => this.game.name || 'noun',
      mySeedKey: () => seedKey(this.game.seed),
      send: m => this.transport.send(m),
      now: () => performance.now(),
      busy: () => this.session !== null && this.session.ended === null,
    });
  }

  // ── Store ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(p: Partial<PoolUiState>) {
    this.ui = { ...this.ui, ...p };
    for (const l of this.listeners) l();
  }

  toast(text: string) {
    this.set({ toast: { text, at: performance.now() } });
  }

  get active(): boolean {
    return this.ui.phase !== 'idle';
  }

  // ── PoolApi: in and out ──

  playAt(table: PoolTable): boolean;
  playAt(at: { x: number; y: number; z: number }, yaw: number): boolean;
  playAt(at: PoolTable | { x: number; y: number; z: number }, yaw?: number): boolean {
    const table = tableOf(at, yaw);
    if (this.active || this.loading || this.game.me === null) return false;
    this.loading = true;
    void viewMod().then(
      m => {
        this.loading = false;
        if (this.active) return;
        this.mount(m, table, false);
        this.openMenu();
      },
      err => {
        this.loading = false;
        console.warn('[pool] view failed to load', err);
      },
    );
    return true;
  }

  /** `/world?play=pool`: into the pool hall with the menu open. False until the game's ready. */
  arrive(): boolean {
    if (this.active) return true;
    if (this.loading || this.game.me === null || this.game.level === null) return false;
    this.loading = true;
    void viewMod().then(
      m => {
        this.loading = false;
        if (this.active) return;
        const p = this.game.player.pos;
        const table: PoolTable = {
          x: Math.round(p.x),
          y: HALL_Y,
          z: Math.round(p.z),
          yaw: 0,
          length: 2.3,
          width: 1.3,
          height: 0.8,
          id: 'hall',
        };
        this.mount(m, table, true);
        this.openMenu();
      },
      err => {
        this.loading = false;
        console.warn('[pool] view failed to load', err);
      },
    );
    return false;
  }

  private mount(m: typeof import('../view'), table: PoolTable, hall: boolean) {
    const g = this.game;
    const cam = g.gfx.camera;
    this.saved = {
      cam: cam.position.clone(),
      quat: cam.quaternion.clone(),
      fov: cam.fov,
      meVisible: g.me?.root.visible ?? true,
      labels: g.labelLayerEl.style.visibility,
      hall: null,
    };
    // NPC / rider name tags stop following their owners while pool has the
    // frame (their systems wait), so they'd hang on the screen: hide them
    g.labelLayerEl.style.visibility = 'hidden';
    this.table = { ...table, id: table.id ?? `t${Math.round(table.x)},${Math.round(table.z)}` };
    const view = new m.PoolView(
      {
        scene: g.gfx.scene,
        camera: cam,
        canvas: g.gfx.renderer.domElement,
        assets: g.assets,
        toon: g.gfx.toon,
        shadows: g.gfx.quality !== 'low',
        audio: () => g.audio.ctx,
        audioOut: () => g.audio.master,
      },
      this.table,
      { hall },
    );
    this.view = view;
    if (hall) this.enterHall(view);
    if (g.me !== null) g.me.root.visible = false;
    this.focus.set(table.x, table.y, table.z);
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    view.setCam('orbit');
    view.cam.snap();
    this.seeds = [g.seed, randomSeed()];
    view.setPlayers(this.seeds);
    this.attachInput();
    g.gfx.renderer.compile(g.gfx.scene, cam);
  }

  /** The hall: hide the world round it, warm lights, the player parked inside. */
  private enterHall(view: PoolView) {
    const g = this.game;
    const gfx = g.gfx;
    const p = g.player;
    const hidden: THREE.Object3D[] = [];
    this.hallKeep = new Set<THREE.Object3D>([
      gfx.sun,
      gfx.sun.target,
      view.root,
      g.particles.group,
      gfx.sky,
    ]);
    this.hideWorld(hidden);
    this.saved!.hall = {
      pos: p.pos.clone(),
      yaw: p.mode === 'foot' ? p.footYaw : Math.atan2(p.fwd.x, p.fwd.z),
      fog: gfx.scene.fog,
      background: gfx.scene.background,
      skyVisible: gfx.sky.visible,
      sunIntensity: gfx.sun.intensity,
      hemiColor: gfx.hemi.color.clone(),
      hemiGround: gfx.hemi.groundColor.clone(),
      hemiIntensity: gfx.hemi.intensity,
      hidden,
      statsSuspended: g.stats.suspended,
    };
    gfx.scene.fog = null;
    gfx.scene.background = new THREE.Color(0x0e0b09);
    gfx.sky.visible = false;
    gfx.sun.intensity *= 0.35;
    gfx.hemi.color.set(0xffd9b0);
    gfx.hemi.groundColor.set(0x4a3020);
    gfx.hemi.intensity = Math.max(0.9, gfx.hemi.intensity * 1.6);
    g.stats.suspended = true;
    // Parked in the hall: the room sees you there (and other players in it)
    const t = this.table!;
    p.spawn(new THREE.Vector3(t.x + 2.4, t.y + 0.05, t.z + 1.6), Math.PI);
    this.set({ hall: true });
  }

  /** Hide every world object at the top of the scene (lights, the sky and the hall stay). */
  private hideWorld(into: THREE.Object3D[]) {
    for (const o of this.game.gfx.scene.children)
      if (o.visible && !this.hallKeep.has(o) && !(o as THREE.Light).isLight) {
        o.visible = false;
        into.push(o);
      }
  }

  private leaveHall() {
    const g = this.game;
    const h = this.saved?.hall;
    if (h === null || h === undefined) return;
    const gfx = g.gfx;
    for (const o of h.hidden) o.visible = true;
    gfx.scene.fog = h.fog;
    gfx.scene.background = h.background;
    gfx.sky.visible = h.skyVisible;
    gfx.sun.intensity = h.sunIntensity;
    gfx.hemi.color.copy(h.hemiColor);
    gfx.hemi.groundColor.copy(h.hemiGround);
    gfx.hemi.intensity = h.hemiIntensity;
    g.stats.suspended = h.statsSuspended;
    g.player.spawn(h.pos, h.yaw);
    g.cam.snap(g.player);
    this.set({ hall: false });
  }

  private openMenu() {
    this.refreshNear();
    this.set({ phase: 'menu', results: null, waiting: null });
    this.view?.setCam('orbit');
    this.announce();
  }

  /** ESC / LEAVE: forfeit a frame on, or step away from the table. */
  leave() {
    const s = this.session;
    if (s !== null && s.ended === null && s.role !== 'spectator') {
      s.leave();
      this.toast('you left the table: that frame counts as a loss');
    } else if (s !== null) s.leave();
    this.exit();
  }

  /** Back to the room, exactly as before. */
  exit() {
    const g = this.game;
    this.showRemotes();
    this.detachInput();
    this.session = null;
    this.view?.dispose();
    this.view = null;
    const sv = this.saved;
    if (sv !== null) {
      if (sv.hall !== null) this.leaveHall();
      const cam = g.gfx.camera;
      cam.position.copy(sv.cam);
      cam.quaternion.copy(sv.quat);
      if (cam.fov !== sv.fov) {
        cam.fov = sv.fov;
        cam.updateProjectionMatrix();
      }
      if (g.me !== null) g.me.root.visible = sv.meVisible;
      g.labelLayerEl.style.visibility = sv.labels;
    }
    this.saved = null;
    this.lobby.cancel();
    if (this.transport.online) this.lobby.announce(null);
    this.table = null;
    this.set({
      phase: 'idle',
      role: null,
      results: null,
      waiting: null,
      outgoing: null,
      mySeat: null,
    });
  }

  // ── Menu ──

  setDifficulty(d: Difficulty) {
    this.set({ difficulty: d });
  }

  setPro(on: boolean) {
    this.set({ pro: on });
  }

  vsCpu(d: Difficulty = this.ui.difficulty) {
    if (this.table === null) return;
    const me = this.transport.id;
    const cpuSeed = randomSeed();
    const config: PoolConfig = {
      gid: `c${Math.floor(Math.random() * 1e9).toString(36)}`,
      seed: Math.floor(Math.random() * 2 ** 31),
      breaker: Math.random() < 0.5 ? 0 : 1,
      players: [
        { id: me, name: this.game.name || 'you', human: true, seedKey: seedKey(this.game.seed) },
        {
          id: 'cpu',
          name: `CPU · ${d.toUpperCase()}`,
          human: false,
          skill: SKILL[d],
          seedKey: seedKey(cpuSeed),
        },
      ],
      pro: d === 'pro' || d === 'hard' || this.ui.pro,
      table: this.table.id,
      place: this.table,
    };
    this.vsCpuDiff = d;
    this.begin(config, 'host', me);
  }

  challenge(id: string) {
    const name = this.ui.near.find(n => n.id === id)?.name ?? 'noun';
    this.lobby.challenge(id, name, this.table ?? undefined);
    this.set({ outgoing: { name } });
  }

  cancelChallenge() {
    this.lobby.cancel();
    this.set({ outgoing: null });
  }

  acceptInvite() {
    const inv = this.lobby.incoming;
    if (inv === null) return;
    // Not at a table: join theirs (they're in this room, so it's right here)
    if (!this.active) {
      if (inv.place === undefined) {
        this.toast('walk up to their table to play');
        this.lobby.decline();
        this.set({ incoming: null });
        return;
      }
      if (!this.playAt(inv.place)) return;
    }
    this.lobby.accept();
    this.set({ incoming: null, waiting: `waiting for ${inv.name}…` });
  }

  declineInvite() {
    this.lobby.decline();
    this.set({ incoming: null });
  }

  watch(gid: string) {
    const l = this.lobby.live.get(gid);
    if (l === undefined || !this.lobby.watch(gid)) return;
    this.set({ waiting: `joining ${l.names[0]} v ${l.names[1]}…` });
  }

  rematch() {
    const s = this.session;
    if (s === null || s.role !== 'host') return;
    const vs = s.config.players[1];
    if (!vs.human) return this.vsCpu(this.vsCpuDiff ?? this.ui.difficulty);
    this.backToMenu();
    if (this.game.net.players.has(vs.id)) this.challenge(vs.id);
  }

  backToMenu() {
    if (this.session !== null && this.session.ended === null) this.session.leave();
    this.showRemotes();
    this.session = null;
    this.openMenu();
  }

  // ── Messages ──

  onMessage(m: PoolMsg) {
    switch (m.type) {
      case 'pool:lobby':
      case 'pool:challenge':
      case 'pool:reply': {
        const r = this.lobby.onMessage(m);
        this.lobbyResult(r);
        this.refreshNear();
        return;
      }
      case 'pool:start': {
        if (this.session !== null && this.session.ended === null) return;
        const as = this.lobby.wants(m);
        if (as === null || !m.host) return;
        this.lobby.expect = null;
        this.lobby.watching = null;
        const go = () =>
          this.begin(m.config, as === 'member' ? 'client' : 'spectator', m.host!, m.state);
        if (this.view !== null) go();
        else if (m.config.place !== undefined) {
          // Accepted while walking around: set the table up first
          if (this.playAt(m.config.place)) {
            const t = window.setInterval(() => {
              if (this.view === null) return;
              window.clearInterval(t);
              go();
            }, 50);
          }
        }
        return;
      }
      case 'pool:watch': {
        const s = this.session;
        if (s?.role !== 'host' || m.gid !== s.gid || !m.from) return;
        this.transport.send({
          type: 'pool:start',
          host: this.transport.id,
          config: s.config,
          to: m.from,
          state: s.state,
          n: s.state.shots,
        });
        return;
      }
      default:
        this.session?.onMessage(m);
    }
  }

  private lobbyResult(r: LobbyResult) {
    if (r === null) return;
    if (r.kind === 'declined') {
      this.set({ outgoing: null });
      this.toast(`${r.name} said not now`);
    } else if (r.kind === 'invite') {
      const inv = this.lobby.incoming!;
      this.set({ incoming: { from: inv.from, name: inv.name, here: this.active } });
    } else if (r.kind === 'accepted') {
      if (this.table === null) return;
      const me = this.transport.id;
      const rp = this.game.net.players.get(r.to);
      const config: PoolConfig = {
        gid: r.gid,
        seed: Math.floor(Math.random() * 2 ** 31),
        breaker: Math.random() < 0.5 ? 0 : 1,
        players: [
          { id: me, name: this.game.name || 'noun', human: true, seedKey: seedKey(this.game.seed) },
          { id: r.to, name: r.name, human: true, seedKey: rp?.seedKey },
        ],
        pro: this.ui.pro,
        table: this.table.id,
        place: this.table,
      };
      this.set({ outgoing: null });
      this.vsCpuDiff = null;
      this.transport.send({ type: 'pool:start', host: me, config });
      this.begin(config, 'host', me);
    }
  }

  // ── A frame ──

  private begin(config: PoolConfig, role: Role, hostId: string, state?: PoolSession['state']) {
    const view = this.view;
    if (view === null) return;
    const me = role === 'spectator' ? null : this.transport.id;
    this.session = new PoolSession({
      config,
      role,
      me,
      send: m => this.transport.send(m),
      state,
    });
    if (role !== 'host') this.session.setHost(hostId);
    const seedOf = (k?: string) => parseSeedKey(k) ?? randomSeed();
    const mine = config.players.findIndex(p => p.id === me);
    this.seeds = [
      mine === 0 ? this.game.seed : seedOf(config.players[0].seedKey),
      mine === 1 ? this.game.seed : seedOf(config.players[1].seedKey),
    ];
    view.setPlayers(this.seeds);
    this.aimedFor = -1;
    this.place = null;
    this.call = null;
    this.callPicked = false;
    this.escArmed = 0;
    view.setCam(view.aimMode);
    this.set({
      phase: 'playing',
      role,
      names: [config.players[0].name, config.players[1].name],
      mySeat: this.session.mySeat,
      results: null,
      waiting: null,
      outgoing: null,
      fast: false,
      foul: null,
    });
    this.announceAcc = ANNOUNCE_S;
    this.publish(true);
  }

  /** The other player's own skater stands in the room too: the view draws them at the table. */
  private hideRemotes() {
    const s = this.session;
    if (s === null) return;
    for (const p of s.config.players) {
      if (!p.human || p.id === this.transport.id) continue;
      const r = this.game.remotes.get(p.id);
      if (r === undefined) continue;
      r.character.root.visible = false;
      if (r.label instanceof HTMLElement) r.label.style.visibility = 'hidden';
      this.hidden.add(p.id);
    }
  }

  private showRemotes() {
    for (const id of this.hidden) {
      const r = this.game.remotes.get(id);
      if (r === undefined) continue;
      r.character.root.visible = true;
      if (r.label instanceof HTMLElement) r.label.style.visibility = '';
    }
    this.hidden.clear();
  }

  /** One frame while active (Game.step's pool block). */
  step(dt: number) {
    const view = this.view;
    if (view === null) return;
    const s = this.session;
    if (s !== null && s.ended === null) this.hideRemotes();
    // A free cursor at the table (no pointer lock: the mouse aims)
    this.game.input.freeCursor = true;
    let events: SessionEvent[] = [];
    if (s !== null) {
      s.speed = this.ui.fast ? 3 : 1;
      s.update(dt);
      events = s.drainEvents();
      this.handleEvents(events);
      this.setupTurn();
    }
    view.update(dt, this.frameFor(events));
    this.game.gfx.followShadow(this.focus);
    // Presence + live frames
    this.announceAcc += dt;
    if (this.announceAcc >= ANNOUNCE_S && this.transport.online) {
      this.announceAcc = 0;
      this.announce();
    }
    this.refreshAcc += dt;
    if (this.refreshAcc >= 0.5) {
      this.refreshAcc = 0;
      if (this.lobby.tick()) this.refreshNear();
      this.refreshNear();
      // The hall: anything the world finished loading since goes too
      const h = this.saved?.hall;
      if (h !== null && h !== undefined) this.hideWorld(h.hidden);
    }
    // My aim, for the others (throttled)
    this.aimSendAcc += dt;
    if (s !== null && s.canShoot() && this.transport.online && this.aimSendAcc >= AIM_SEND_S) {
      this.aimSendAcc = 0;
      const key = `${this.aim.dx.toFixed(3)},${this.aim.dy.toFixed(3)},${this.ui.power.toFixed(2)},${this.place?.x.toFixed(3)},${this.place?.y.toFixed(3)}`;
      if (key !== this.lastAimSent) {
        this.lastAimSent = key;
        s.sendAim({
          dx: this.aim.dx,
          dy: this.aim.dy,
          p: this.ui.power,
          cue: this.place ?? undefined,
        });
      }
    }
    this.pollPad(dt);
    if (this.escArmed > 0) this.escArmed -= dt;
    this.publishAcc += dt;
    if (this.publishAcc >= 1 / 15) {
      this.publishAcc = 0;
      this.publish(false);
    }
  }

  /** Walking round (Game.step's normal path): invites, presence ageing. */
  idle(dt: number) {
    this.refreshAcc += dt;
    if (this.refreshAcc >= 0.5) {
      this.refreshAcc = 0;
      if (this.lobby.tick()) {
        const inv = this.lobby.incoming;
        this.set({
          incoming: inv !== null ? { from: inv.from, name: inv.name, here: false } : null,
          outgoing: this.lobby.outgoing !== null ? { name: this.lobby.outgoing.name } : null,
        });
      }
    }
  }

  private announce() {
    if (!this.transport.online) return;
    const s = this.session;
    const live: LiveFrame | undefined =
      s !== null && s.role === 'host' && s.ended === null
        ? {
            gid: s.gid,
            host: this.transport.id,
            names: [s.config.players[0].name, s.config.players[1].name],
            table: this.table?.id,
          }
        : undefined;
    this.lobby.announce(this.table?.id ?? null, live);
  }

  private refreshNear() {
    const t = this.table;
    const near = new Map<string, { id: string; name: string }>();
    if (t !== null) {
      for (const rp of this.game.net.players.values()) {
        const p = rp.current.pos;
        const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
        if (d < NEAR_R) near.set(rp.id, { id: rp.id, name: rp.name || 'noun' });
      }
      for (const h of this.lobby.here.values())
        if (h.at === t.id && !near.has(h.id)) near.set(h.id, { id: h.id, name: h.name });
    }
    const next = {
      near: [...near.values()],
      live: [...this.lobby.live.values()].map(l => ({
        gid: l.gid,
        host: l.host,
        names: l.names,
        table: l.table,
      })),
      online: this.transport.online,
    };
    if (
      JSON.stringify(next) !==
      JSON.stringify({ near: this.ui.near, live: this.ui.live, online: this.ui.online })
    )
      this.set(next);
  }

  private handleEvents(events: SessionEvent[]) {
    const s = this.session!;
    for (const e of events) {
      if (e.e === 'settled') {
        const o = e.outcome;
        if (o !== null && o.foul !== null) {
          const who = s.config.players[o.by].name;
          const text = `FOUL · ${FOUL_TEXT[o.foul] ?? o.foul}`;
          this.set({
            foul: `${text} · ${who === this.game.name && o.by === s.mySeat ? 'YOU' : who.toUpperCase()}`,
          });
        } else this.set({ foul: null });
        if (o?.respotted === true) this.toast('the 8 went down on the break: back on the spot');
        if (o?.assigned === true) {
          const g = e.state.groups[o.by];
          this.toast(`${s.config.players[o.by].name} has ${g === 'solids' ? 'SOLIDS' : 'STRIPES'}`);
        }
        this.aimedFor = -1;
      } else if (e.e === 'end') this.showResults(e.winner, e.reason ?? '');
    }
  }

  private showResults(winner: Seat | null, reason: string) {
    const s = this.session!;
    const mine = s.mySeat;
    let respect: number | null = null;
    const won = mine === null || winner === null ? null : winner === mine;
    if (won === true && reason !== 'the other player left') {
      const vs = s.config.players[mine === 0 ? 1 : 0];
      const amount = vs.human ? WIN_RESPECT.human : WIN_RESPECT[this.vsCpuDiff ?? 'normal'];
      const r = (this.game as Game & { respect?: RespectApi }).respect;
      respect = r?.add({ kind: 'custom', label: 'won at pool', amount }) ?? null;
    }
    const wname = winner === null ? '' : s.config.players[winner].name;
    this.set({
      phase: 'results',
      results: {
        won,
        winner: wname,
        reason,
        respect,
        host: s.role === 'host',
        vsCpu: !s.config.players.every(p => p.human),
      },
    });
    this.view?.setCam('orbit');
    this.announce();
  }

  /** At the start of my turn: point the cue at a legal ball, a cue spot if in hand, a call. */
  private setupTurn() {
    const s = this.session!;
    const st = s.state;
    if (!s.canShoot() || this.aimedFor === st.shots) return;
    this.aimedFor = st.shots;
    this.callPicked = false;
    this.call = null;
    this.placing = st.inHand !== null;
    if (st.inHand !== null) {
      const p =
        st.balls[0] ?? (st.inHand === 'kitchen' ? { x: HEAD_X - 0.12, y: 0 } : { x: -L / 4, y: 0 });
      this.place = canPlace(st, p) ? { ...p } : this.freeSpot(st);
    } else this.place = null;
    const cue = this.place ?? st.balls[0];
    if (cue !== null && cue !== undefined) {
      const legal = legalFirst(st, st.turn);
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (const id of legal) {
        const b = st.balls[id];
        if (b === null || b === undefined) continue;
        const d = (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2;
        const hit = firstHit(st.balls, cue, b.x - cue.x, b.y - cue.y, 0);
        const clear = hit?.kind === 'ball' && hit.id === id;
        const score = d * (clear ? 1 : 4);
        if (score < bd) {
          bd = score;
          best = b;
        }
      }
      if (best !== null) {
        const dx = best.x - cue.x;
        const dy = best.y - cue.y;
        const n = Math.hypot(dx, dy) || 1;
        this.aim = { dx: dx / n, dy: dy / n };
      }
    }
    if (st.phase === 'break') this.set({ power: 0.95, side: 0, top: 0 });
    else if (this.ui.power > 0.9) this.set({ power: 0.45 });
    this.view?.setCam(this.placing ? 'top' : this.view.aimMode);
  }

  private freeSpot(st: PoolSession['state']): Vec2 {
    for (let k = 0; k < 200; k++) {
      const p =
        st.inHand === 'kitchen'
          ? { x: HEAD_X - 0.05 - Math.random() * 0.4, y: (Math.random() - 0.5) * (W - 0.2) }
          : { x: (Math.random() - 0.5) * (L - 0.2), y: (Math.random() - 0.5) * (W - 0.2) };
      if (canPlace(st, p)) return p;
    }
    return { x: HEAD_X - 0.2, y: 0 };
  }

  /** The view's picture of this frame. */
  private frameFor(events: SessionEvent[]): import('../view').ViewFrame {
    const s = this.session;
    if (s === null)
      return {
        balls: RACKED,
        aim: null,
        placing: null,
        call: null,
        calling: false,
        rolling: false,
        events,
        shooter: 0,
      };
    const st = s.state;
    const rolling = s.play !== null;
    const balls = s.positions();
    const mine = s.canShoot();
    let aim: import('../view').ViewFrame['aim'] = null;
    if (mine) {
      const cue = this.place ?? st.balls[0];
      if (cue !== null && cue !== undefined)
        aim = {
          seat: st.turn,
          cue,
          dx: this.aim.dx,
          dy: this.aim.dy,
          power: this.ui.power,
          guide: true,
          pro: s.config.pro === true,
        };
    } else if (!rolling && s.remoteAim !== null && st.phase !== 'over' && s.ended === null) {
      const cue = s.remoteAim.cue ?? st.balls[0];
      if (cue !== null && cue !== undefined)
        aim = {
          seat: st.turn,
          cue,
          dx: s.remoteAim.dx,
          dy: s.remoteAim.dy,
          power: s.remoteAim.p,
          guide: false,
          pro: true,
        };
    }
    const calling = mine && onEight(st, st.turn);
    if (calling && !this.callPicked) {
      // Default: where the guide says the 8 goes, else the nearest pocket
      const cue = this.place ?? st.balls[0];
      const hit =
        cue !== null && cue !== undefined
          ? firstHit(st.balls, cue, this.aim.dx, this.aim.dy, 0)
          : null;
      const eight = st.balls[8];
      const along =
        hit?.kind === 'ball' && hit.id === 8 && eight !== null && eight !== undefined
          ? pocketAlong(st.balls, eight, hit.obj, 8)
          : null;
      this.call = along ?? defaultCall(st);
    }
    return {
      balls: mine && this.place !== null ? balls.map((b, i) => (i === 0 ? this.place : b)) : balls,
      aim,
      placing:
        mine && this.placing && this.place !== null
          ? { at: this.place, ok: canPlace(st, this.place) }
          : null,
      call: calling ? this.call : null,
      calling,
      rolling,
      events,
      shooter: st.turn,
    };
  }

  /** Push the HUD's numbers (only when they changed). */
  private publish(force: boolean) {
    const s = this.session;
    if (s === null) return;
    const st = s.state;
    const left = ([0, 1] as const).map(seat => {
      const g = st.groups[seat];
      if (g === null) return [] as BallId[];
      const r = remaining(st, g);
      return r.length === 0 && st.balls[8] !== null ? [8] : r;
    }) as [BallId[], BallId[]];
    const myTurn = s.canShoot();
    const shooter = s.config.players[st.turn];
    const line =
      s.ended !== null
        ? ''
        : s.play !== null
          ? ''
          : myTurn
            ? onEight(st, st.turn)
              ? 'ON THE 8 · CALL A POCKET'
              : st.phase === 'break'
                ? 'YOUR BREAK'
                : st.inHand !== null
                  ? 'BALL IN HAND · DRAG THE CUE BALL'
                  : 'YOUR SHOT'
            : s.thinking || (!shooter.human && s.role === 'host')
              ? `${shooter.name} IS LINING UP…`
              : `${shooter.name.toUpperCase()} TO SHOOT`;
    const next: Partial<PoolUiState> = {
      turn: st.turn,
      groups: st.groups,
      left,
      onEight: [onEight(st, 0), onEight(st, 1)],
      myTurn,
      rolling: s.play !== null,
      thinking: s.thinking,
      inHand: myTurn ? st.inHand : null,
      calling: myTurn && onEight(st, st.turn),
      call: this.call,
      line,
    };
    const key = JSON.stringify(next);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.set(next);
  }

  // ── The local player's controls (HUD + pointer + keys) ──

  setPower(p: number) {
    this.set({ power: Math.max(0, Math.min(1, p)) });
  }

  setSpin(side: number, top: number) {
    const n = Math.hypot(side, top);
    const k = n > 1 ? 1 / n : 1;
    this.set({ side: side * k, top: top * k });
  }

  toggleCam() {
    const v = this.view;
    if (v === null) return;
    v.aimMode = v.aimMode === 'aim' ? 'top' : 'aim';
    if (this.session?.play == null && this.ui.phase === 'playing') v.setCam(v.aimMode);
    this.set({ cam: v.aimMode });
  }

  toggleFast() {
    this.set({ fast: !this.ui.fast });
  }

  /** Nudge the aim (radians). */
  turn(da: number) {
    const a = Math.atan2(this.aim.dy, this.aim.dx) + da;
    this.aim = { dx: Math.cos(a), dy: Math.sin(a) };
    this.placing = false;
  }

  /** Take the shot at the set power. */
  shoot(power = this.ui.power): boolean {
    const s = this.session;
    if (s === null || !s.canShoot() || power < 0.01) return false;
    const st = s.state;
    if (this.place !== null && !canPlace(st, this.place)) {
      this.toast("the cue ball can't go there");
      return false;
    }
    const input: ShotInput = {
      shot: { dx: this.aim.dx, dy: this.aim.dy, power, side: this.ui.side, top: this.ui.top },
      cue: st.inHand !== null ? (this.place ?? undefined) : undefined,
      call: onEight(st, st.turn) ? (this.call ?? defaultCall(st)) : undefined,
    };
    if (!s.shoot(input)) return false;
    this.placing = false;
    this.place = null;
    this.set({ power });
    return true;
  }

  /**
   * A gamepad: left stick aims (LB held: fine), RT pulls the cue back and
   * letting go shoots (A shoots at the set power), D-pad ↑/↓ power, right
   * stick spin, RB + left stick moves the cue ball in hand, Y the camera,
   * X fast-forward, B leave (twice mid-frame, like ESC).
   */
  private pollPad(dt: number) {
    const gp = Array.from(navigator.getGamepads?.() ?? []).find(q => q?.connected === true);
    if (gp === undefined || gp === null) return;
    const btn = (i: number) => gp.buttons[i]?.pressed === true;
    const was = this.padPrev;
    const tap = (i: number) => btn(i) && was[i] !== true;
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const lx = dz(gp.axes[0] ?? 0);
    const ly = dz(gp.axes[1] ?? 0);
    const rx = dz(gp.axes[2] ?? 0);
    const ry = dz(gp.axes[3] ?? 0);
    const rt = gp.buttons[7]?.value ?? 0;
    const s = this.session;
    const mine = s !== null && s.canShoot();
    if (mine) {
      const st = s.state;
      if (btn(5) && st.inHand !== null && (lx !== 0 || ly !== 0)) {
        // Ball in hand: the stick slides the cue ball (screen-ish: table x / y)
        const at = this.place ?? st.balls[0] ?? { x: HEAD_X - 0.2, y: 0 };
        const lim = { x: L / 2 - R - 0.003, y: W / 2 - R - 0.003 };
        let x = Math.max(-lim.x, Math.min(lim.x, at.x + lx * 0.6 * dt));
        const y = Math.max(-lim.y, Math.min(lim.y, at.y + ly * 0.6 * dt));
        if (st.inHand === 'kitchen') x = Math.min(x, HEAD_X);
        this.place = { x, y };
        this.placing = true;
      } else if (lx !== 0) this.turn(-lx * (btn(4) ? 0.12 : 1.1) * dt);
      if (rx !== 0 || ry !== 0) this.setSpin(rx, -ry);
      if (btn(12)) this.setPower(this.ui.power + 0.6 * dt);
      if (btn(13)) this.setPower(this.ui.power - 0.6 * dt);
      if (rt > 0.05) {
        this.padPull = Math.max(this.padPull, rt);
        this.setPower(rt);
      } else if (this.padPull > 0.05) {
        const k = this.padPull;
        this.padPull = 0;
        this.shoot(k);
      }
      if (tap(0)) this.shoot();
    } else this.padPull = 0;
    if (tap(3)) this.toggleCam();
    if (tap(2) && s !== null && s.play !== null) this.toggleFast();
    if (tap(1)) {
      if (this.ui.phase !== 'playing' || s === null || s.role === 'spectator') this.leave();
      else if (this.escArmed > 0) this.leave();
      else {
        this.escArmed = 2.5;
        this.toast('B again to leave the table (a forfeit)');
      }
    }
    this.padPrev = gp.buttons.map(b => b.pressed);
  }

  private onDown = (e: PointerEvent) => {
    const s = this.session;
    const v = this.view;
    if (s === null || v === null || !s.canShoot() || this.game.paused) return;
    const p = v.pick(e.clientX, e.clientY);
    const st = s.state;
    if (p !== null && onEight(st, st.turn)) {
      const pocket = v.pocketAt(p);
      if (pocket !== null) {
        this.call = pocket;
        this.callPicked = true;
        this.publish(true);
        return;
      }
    }
    const cue = this.place ?? st.balls[0];
    if (
      st.inHand !== null &&
      p !== null &&
      (cue === null || Math.hypot(p.x - cue.x, p.y - cue.y) < R * 3.2)
    ) {
      this.drag = { x: e.clientX, y: e.clientY, mode: 'place' };
      this.placing = true;
    } else
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        mode: v.aimMode === 'top' || v.cam.mode === 'top' ? 'top' : 'aim',
      };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.onMove(e);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    const s = this.session;
    const v = this.view;
    if (d === null || s === null || v === null || !s.canShoot()) return;
    const st = s.state;
    if (d.mode === 'place') {
      const p = v.pick(e.clientX, e.clientY);
      if (p === null) return;
      const lim = { x: L / 2 - R - 0.003, y: W / 2 - R - 0.003 };
      let x = Math.max(-lim.x, Math.min(lim.x, p.x));
      const y = Math.max(-lim.y, Math.min(lim.y, p.y));
      if (st.inHand === 'kitchen') x = Math.min(x, HEAD_X);
      this.place = { x, y };
    } else if (d.mode === 'top') {
      const p = v.pick(e.clientX, e.clientY);
      const cue = this.place ?? st.balls[0];
      if (p === null || !cue) return;
      const dx = p.x - cue.x;
      const dy = p.y - cue.y;
      const n = Math.hypot(dx, dy);
      if (n > R * 1.5) {
        this.aim = { dx: dx / n, dy: dy / n };
        this.placing = false;
      }
    } else {
      const fine = e.shiftKey ? 0.25 : 1;
      this.turn(-(e.clientX - d.x) * 0.0032 * fine);
      d.x = e.clientX;
      d.y = e.clientY;
    }
  };

  private onUp = () => {
    // Placed the cue ball from above: back down behind it to aim (if that's the view)
    if (this.drag?.mode === 'place' && this.view !== null && this.view.aimMode === 'aim')
      this.view.setCam('aim');
    this.drag = null;
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.active) return;
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    const s = this.session;
    const code = e.code;
    const mine = s !== null && s.canShoot();
    const eat = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    switch (code) {
      case 'Escape':
        eat();
        if (this.ui.phase === 'menu') this.exit();
        else if (this.ui.phase === 'results') this.exit();
        else if (s !== null && s.role === 'spectator') this.leave();
        else if (this.escArmed > 0) this.leave();
        else {
          this.escArmed = 2.5;
          this.toast('ESC again to leave the table (a forfeit)');
        }
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        eat();
        if (mine) this.turn((code === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 0.0015 : 0.012));
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        eat();
        if (mine) this.setPower(this.ui.power + (code === 'ArrowUp' ? 0.05 : -0.05));
        return;
      case 'Space':
        eat();
        if (mine && !e.repeat) this.shoot();
        return;
      case 'KeyT':
      case 'KeyV':
        eat();
        this.toggleCam();
        return;
      case 'KeyF':
        eat();
        if (s !== null && s.play !== null) this.toggleFast();
        return;
      default:
        // The room's own keys (E, the number keys, the board) wait while you're at the table
        if (code === 'KeyE' || /^Digit\d$/.test(code) || code === 'KeyR') eat();
    }
  };

  private attachInput() {
    const c = this.game.gfx.renderer.domElement;
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey, true);
  }

  private detachInput() {
    const c = this.game.gfx.renderer.domElement;
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey, true);
    this.drag = null;
  }

  /** Dev / browser checks. */
  get debug() {
    const s = this.session;
    return {
      phase: this.ui.phase,
      state: s?.state ?? null,
      rolling: s?.play !== null && s?.play !== undefined,
      aim: this.aim,
      place: this.place,
      call: this.call,
      table: this.table,
      setAim: (dx: number, dy: number) => {
        const n = Math.hypot(dx, dy) || 1;
        this.aim = { dx: dx / n, dy: dy / n };
      },
      setPlace: (p: Vec2 | null) => {
        this.place = p;
        this.placing = p !== null;
      },
      setCall: (c: PocketId) => {
        this.call = c;
        this.callPicked = true;
      },
      session: s,
      view: this.view,
    };
  }

  dispose() {
    if (this.active) this.exit();
    if (this.game.net.onPool !== undefined) this.game.net.onPool = undefined;
  }
}

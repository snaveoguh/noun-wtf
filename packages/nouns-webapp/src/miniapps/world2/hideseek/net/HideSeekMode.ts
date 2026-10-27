// ── Noun Hide & Seek mode: the lobby spot, the menu, a game, the Game.ts hook ─
//
// Unlike Noun Breaks / Hoops this mode never takes the frame over: you play
// hide and seek in the normal game (run, climb, go inside). Game.ts calls
// `update(dt)` every frame (inside buildings too), and asks it, per remote
// player, how their name tag shows (`labelFor`, policy.ts), whether to
// mask their chat name, and whether I'm crouched still (`blending`).
//
// While I'm in a game it: freezes and blindfolds me when I'm a starting
// seeker in the hide phase, holds me inside the arena, gets me out of the
// van / off the dragon, teleports me to the start ring each round, finds
// who I can tag, plays whistles and pings, shows the reveal, and draws the
// CPU players. The host also builds the plaza's height grid for them.

import type { Game } from '../../Game';
import type { RespectApi } from '../../interiors/contract';
import type { HsConfig, HsEvent, HsOpenGame, HsPlayer, HsStanding } from '../contract';
import type { LobbySpot } from '../arena';
import type { NavGrid } from '../nav';
import type { Door, Vec } from '../rules';

import * as THREE from 'three';

import { randomSeed, seedKey } from '../../character/NounAppearance';
import { clampArena, doorOf, LOBBY_PROMPT_R, pickLobby, startSlot } from '../arena';
import { LIMITS, WHISTLE_CD } from '../contract';
import { CELL, makeGrid } from '../nav';
import { labelFor, type LabelShow } from '../policy';
import { inReach } from '../rules';
import { HsView3d } from '../view';

import { HideSeekLobby, newGid, type LobbyResult } from './lobby';
import { HideSeekSession } from './sync';
import { NetTransport, type HsTransport } from './transport';

export type HsUiPhase = 'idle' | 'menu' | 'lobby' | 'playing' | 'done';

export interface HsRow {
  id: string;
  name: string;
  st: HsStanding | null;
  score: number;
  cpu: boolean;
  me: boolean;
}

export interface HsUiState {
  phase: HsUiPhase;
  /** At the lobby spot with nothing open (the prompt). */
  near: boolean;
  hasSpot: boolean;
  online: boolean;
  open: HsOpenGame[];
  /** Lobby: my game's roster (hosting or joined), CPU fill, am I the host. */
  roster: HsPlayer[];
  fill: number;
  host: boolean;
  waiting: string | null;
  /** In a game. */
  game: null | {
    gamePhase: 'hide' | 'seek' | 'reveal' | 'over';
    round: number;
    rounds: number;
    t: number;
    me: HsStanding | null;
    blind: boolean;
    hidersLeft: number;
    hiders: number;
    seekers: number;
    canTag: boolean;
    pingCd: number;
    whistleCd: number;
    blending: boolean;
    win: 'hiders' | 'seekers' | null;
    rows: HsRow[];
  };
  done: null | {
    why: 'over' | 'hostLeft' | 'hostLost' | 'left';
    rows: HsRow[];
    respect: number;
    host: boolean;
  };
  toast: { text: string; at: number } | null;
  snapBytes: number;
}

const ANNOUNCE_S = 2;
/** Crouched still this long: blending in. */
const BLEND_S = 1.6;

export class HideSeekMode {
  ui: HsUiState = {
    phase: 'idle',
    near: false,
    hasSpot: false,
    online: false,
    open: [],
    roster: [],
    fill: 0,
    host: false,
    waiting: null,
    game: null,
    done: null,
    toast: null,
    snapBytes: 0,
  };
  readonly lobby: HideSeekLobby;
  readonly transport: HsTransport;
  session: HideSeekSession | null = null;
  spot: LobbySpot | null = null;
  view: HsView3d | null = null;
  /** Crouched still while hiding (Game.pickAnim plays a crouch; seekers' CPUs see less far). */
  blending = false;

  private listeners = new Set<() => void>();
  private triedSpot = false;
  private announceAcc = 0;
  private uiAcc = 0;
  private stillT = 0;
  private whistleAt = -1e9;
  private grid: NavGrid | null = null;
  private blindPos: THREE.Vector3 | null = null;
  private pendingStart = false;
  private vehicleAcc = 0;
  private edgeToastAt = 0;
  private roundRespect = new Set<number>();
  private respectTotal = 0;
  private tagTarget: string | null = null;
  /** CPU skill of the last game I started (PLAY AGAIN keeps it). */
  private skill = 0.55;

  constructor(
    private game: Game,
    transport?: HsTransport,
  ) {
    this.transport = transport ?? new NetTransport(game.net, offlineFlag());
    this.transport.onMessage = m => this.onMessage(m);
    this.lobby = new HideSeekLobby({
      myId: () => this.transport.id,
      myName: () => this.game.name || 'noun',
      mySeed: () => seedKey(this.game.seed),
      nameOf: id => this.game.net.players.get(id)?.name || 'noun',
      seedOf: id => this.game.net.players.get(id)?.seedKey,
      cpuSeed: () => seedKey(randomSeed()),
      send: m => this.transport.send(m),
      now: () => performance.now(),
    });
  }

  // ── Store (React reads `ui`) ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<HsUiState>) {
    this.ui = { ...this.ui, ...p };
    for (const l of this.listeners) l();
  }

  toast(text: string) {
    this.set({ toast: { text, at: performance.now() } });
  }

  get inGame(): boolean {
    return this.session !== null && this.session.ended === null;
  }

  // ── The spot ──

  ensureSpot(): LobbySpot | null {
    if (this.spot !== null || this.triedSpot) return this.spot;
    const g = this.game;
    if (g.level === null) return null;
    this.triedSpot = true;
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    this.spot = pickLobby((x, z) => {
      const hit = g.world.raycast(o.set(x, 8, z), down, 12);
      return hit === null ? null : { y: hit.point.y, flat: hit.normal.y > 0.97 };
    });
    if (this.spot === null) {
      console.warn('[hideseek] no clear spot for the lobby');
      return null;
    }
    this.view ??= new HsView3d(g);
    this.view.placeMarker(this.spot.x, this.spot.y, this.spot.z);
    this.set({ hasSpot: true });
    return this.spot;
  }

  // ── Policy hooks (Game.ts, WorldMap) ──

  /** How remote player `id`'s name tag shows for me. */
  labelFor(id: string): LabelShow {
    const s = this.session;
    const myGid = s !== null && s.ended === null ? s.config.gid : null;
    const mySt = myGid !== null ? s!.myStanding() : null;
    if (s !== null && myGid !== null && s.view.st.has(id))
      return labelFor(
        { gid: myGid, st: mySt },
        { gid: myGid, st: s.view.st.get(id)!, phase: s.view.phase },
      );
    const h = this.lobby.hiding.get(id);
    if (h === undefined) return 'show';
    return labelFor({ gid: myGid, st: mySt }, { gid: h.gid, st: 'h', phase: 'seek' });
  }

  /** A chat line's name: hiders stay anonymous to anyone who can't see their tag. */
  chatName(id: string, name: string): string {
    return this.labelFor(id) === 'hide' ? 'a hider' : name;
  }

  // ── The frame (Game.step, every frame, inside buildings too) ──

  update(dt: number) {
    const g = this.game;
    const sp = this.ensureSpot();
    const p = g.player.pos;
    const inside = g.interiors.inside;
    const near =
      this.ui.phase === 'idle' &&
      sp !== null &&
      !inside &&
      Math.hypot(p.x - sp.x, p.z - sp.z) < LOBBY_PROMPT_R &&
      Math.abs(p.y - sp.y) < 3;
    if (near !== this.ui.near) this.set({ near });
    for (const r of [this.lobby.tick()]) this.result(r);
    const s = this.session;
    if (s !== null) this.stepGame(dt, s);
    // Host: tell the room about my game (and who's hiding in it)
    this.announceAcc += dt;
    if (this.lobby.hosting !== null && this.announceAcc >= ANNOUNCE_S && this.transport.online) {
      this.announceAcc = 0;
      this.lobby.announce(this.hidingNow());
    }
    this.view?.update(dt, p);
    this.uiAcc += dt;
    if (this.uiAcc >= 0.2) {
      this.uiAcc = 0;
      this.refresh();
    }
  }

  private hidingNow(): string[] {
    const s = this.session;
    if (s === null || s.ended !== null || (s.view.phase !== 'hide' && s.view.phase !== 'seek'))
      return [];
    return [...s.view.st].filter(([, st]) => st === 'h').map(([id]) => id);
  }

  private stepGame(dt: number, s: HideSeekSession) {
    const g = this.game;
    const p = g.player;
    s.update(dt);
    if (s.ended !== null && this.ui.phase === 'playing') {
      this.finish(s.ended);
      return;
    }
    if (s.ended !== null) return;
    const v = s.view;
    const me = s.myStanding();
    const live = v.phase === 'hide' || v.phase === 'seek';
    // A new round: off to the start ring (out of the building first)
    if (this.pendingStart && !g.interiors.inside) {
      this.pendingStart = false;
      this.placeAtStart();
    }
    // Blindfolded: frozen where the round started
    const blind = v.phase === 'hide' && me === 's';
    if (blind) {
      this.blindPos ??= p.pos.clone();
      p.pos.copy(this.blindPos);
      p.vel.set(0, 0, 0);
    } else this.blindPos = null;
    // In the arena (not up in a building's pocket)
    if (live && !g.interiors.inside) {
      const out = clampArena(p.pos);
      if (out.x) p.vel.x = 0;
      if (out.z) p.vel.z = 0;
      if ((out.x || out.z) && performance.now() - this.edgeToastAt > 4000) {
        this.edgeToastAt = performance.now();
        this.toast("that's the edge of the game");
      }
    }
    // No vans or dragons mid-game
    this.vehicleAcc += dt;
    if (live && this.vehicleAcc > 1) {
      this.vehicleAcc = 0;
      if (g.van2.driving) g.van2.requestToggle();
      if (g.dragon.riding) g.dragon.requestCall();
    }
    // Blending: a hider on foot, still, on the ground
    const still = me === 'h' && live && p.mode === 'foot' && p.speed < 0.3 && p.climb === null;
    this.stillT = still ? this.stillT + dt : 0;
    this.blending = this.stillT >= BLEND_S;
    // Who I could tag
    this.tagTarget = null;
    if (v.phase === 'seek' && (me === 's' || me === 'f')) {
      let best = Infinity;
      for (const [id, st] of v.st) {
        if (st !== 'h') continue;
        const q = this.posOf(id);
        if (q === null || !inReach(p.pos, q)) continue;
        const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
        if (d < best) {
          best = d;
          this.tagTarget = id;
        }
      }
    }
    // CPU players and lit doors
    this.view?.setBots(
      s.botPoses(),
      id => {
        const pl = s.config.players.find(x => x.id === id);
        return { name: pl?.name ?? 'cpu', seed: pl?.seed };
      },
      id => this.labelFor(id),
      dt,
    );
    this.view?.setDoors(live && me !== 'h' ? v.lit : []);
    if (s.stats.snapBytes !== this.ui.snapBytes)
      this.ui = { ...this.ui, snapBytes: s.stats.snapBytes };
  }

  /** Where a player is (CPU from the session / view, humans from the room, me from my player). */
  private posOf(id: string): Vec | null {
    if (id === this.transport.id) return this.game.player.pos;
    const s = this.session;
    if (s !== null && id.startsWith('cpu:')) {
      if (s.role === 'host') return s.posOf(id);
      return this.view?.botPos(id) ?? null;
    }
    return this.game.net.players.get(id)?.current.pos ?? null;
  }

  private refresh() {
    const next: Partial<HsUiState> = {
      online: this.transport.online,
      open: [...this.lobby.open.values()].filter(o => o.host !== this.transport.id),
      roster: this.lobby.roster,
      fill: this.lobby.hosting?.cpu ?? this.ui.fill,
      host: this.lobby.hosting !== null,
    };
    const s = this.session;
    if (s !== null && s.ended === null) {
      const v = s.view;
      const me = s.myStanding();
      const sts = [...v.st.values()];
      next.game = {
        gamePhase: v.phase,
        round: v.round,
        rounds: s.config.rounds,
        t: v.t,
        me,
        blind: v.phase === 'hide' && me === 's',
        hidersLeft: sts.filter(x => x === 'h').length,
        hiders: sts.filter(x => x !== 's').length,
        seekers: sts.filter(x => x !== 'h').length,
        canTag: this.tagTarget !== null,
        pingCd: v.pingCd,
        whistleCd: Math.max(0, WHISTLE_CD - (performance.now() - this.whistleAt) / 1000),
        blending: this.blending,
        win: v.win,
        rows: this.rows(s),
      };
    }
    const keys = Object.keys(next) as (keyof HsUiState)[];
    if (keys.some(k => JSON.stringify(next[k]) !== JSON.stringify(this.ui[k]))) this.set(next);
  }

  private rows(s: HideSeekSession): HsRow[] {
    return s.config.players
      .map(p => ({
        id: p.id,
        name: p.name,
        st: s.view.st.get(p.id) ?? null,
        score: s.view.scores.get(p.id) ?? 0,
        cpu: p.cpu,
        me: p.id === this.transport.id,
      }))
      .sort((a, b) => b.score - a.score);
  }

  private result(r: LobbyResult | null) {
    if (r === null) return;
    switch (r.kind) {
      case 'joined':
        this.set({ phase: 'lobby', waiting: null, roster: this.lobby.roster });
        return;
      case 'full':
        this.set({ phase: 'menu', waiting: null });
        this.toast('that game is full (or already started)');
        return;
      case 'fellThrough':
        this.set({ phase: 'menu', waiting: null });
        this.toast("couldn't join: no answer from the host");
        return;
      case 'hostLeft':
        if (this.ui.phase === 'lobby' || this.ui.phase === 'done') {
          this.set({ phase: this.ui.phase === 'done' ? 'done' : 'menu', roster: [] });
          this.toast('the host closed the game');
        }
        return;
      case 'start':
        this.enter(r.config, 'client', r.host);
        return;
      case 'roster':
        this.set({ roster: this.lobby.roster });
        return;
    }
  }

  // ── Menu actions ──

  /** `?play=hideseek` (the homepage card): stand at the lobby spot with the menu open. */
  arrive(): boolean {
    const sp = this.ensureSpot();
    if (sp === null) return false;
    if (this.ui.phase !== 'idle') return true;
    this.game.player.spawn(new THREE.Vector3(sp.x, sp.y + 0.05, sp.z + 4.5), Math.PI);
    this.game.cam.snap(this.game.player);
    this.openMenu();
    return true;
  }

  /** E at the spot, or the 🙈 chip anywhere: the menu. */
  openMenu() {
    if (this.ui.phase !== 'idle' && this.ui.phase !== 'done') return;
    if (this.ui.phase === 'done') this.closeDone();
    this.refresh();
    this.set({ phase: 'menu', near: false });
  }

  closeMenu() {
    if (this.ui.phase !== 'menu') return;
    this.set({ phase: 'idle' });
  }

  private blocked(): string | null {
    const g = this.game;
    if (g.missions.ud.active) return 'come back down from the Big Drop first';
    if (g.hoops.active || g.breaks.active) return 'finish your game first';
    if (g.level === null || this.ensureSpot() === null) return 'the plaza is still loading';
    return null;
  }

  /** VS CPU: me + CPU players, straight in. */
  vsCpu(o: {
    cpu: number;
    seekers: number;
    rounds: number;
    skill: number;
    role: 'random' | 'hide' | 'seek';
  }) {
    const why = this.blocked();
    if (why !== null) return this.toast(why);
    const gid = newGid(performance.now(), Math.random());
    this.skill = o.skill;
    this.lobby.host({ cpu: o.cpu, seekers: o.seekers, rounds: o.rounds, gid });
    const me = this.transport.id;
    const config = this.lobby.start({
      seed: (Math.random() * 2 ** 31) | 0,
      skill: o.skill,
      first: o.role === 'seek' ? [me] : undefined,
      last: o.role === 'hide' ? [me] : undefined,
    });
    if (config !== null) this.enter(config, 'host', me);
  }

  /** HOST A GAME (online): open the lobby; START when people are in. */
  hostGame(o: { cpu: number; seekers: number; rounds: number }) {
    const why = this.blocked();
    if (why !== null) return this.toast(why);
    if (!this.transport.online) return this.toast("you're offline: play VS CPU");
    this.lobby.host({ ...o, gid: newGid(performance.now(), Math.random()) });
    this.announceAcc = 0;
    this.set({ phase: 'lobby', roster: this.lobby.roster, host: true });
  }

  setFill(n: number) {
    this.lobby.setFill(n);
    this.refresh();
  }

  join(gid: string) {
    const why = this.blocked();
    if (why !== null) return this.toast(why);
    const g = this.lobby.open.get(gid);
    if (g === undefined || !this.lobby.join(gid)) return this.toast('that game has gone');
    this.set({ phase: 'lobby', waiting: `joining ${g.hostName}'s game…`, roster: [], host: false });
  }

  /** START (host): everyone on the roster plays, CPUs fill. */
  startHosted(o: { skill?: number } = {}) {
    const h = this.lobby.hosting;
    if (h === null) return;
    // Anyone who's left the room since joining is off the roster
    h.players = h.players.filter(
      p => p.id === this.transport.id || this.game.net.players.has(p.id),
    );
    if (h.players.length + h.cpu < LIMITS.minPlayers)
      return this.toast('need at least one more player (or a CPU)');
    if (o.skill !== undefined) this.skill = o.skill;
    const config = this.lobby.start({ seed: (Math.random() * 2 ** 31) | 0, skill: this.skill });
    if (config !== null) this.enter(config, 'host', this.transport.id);
  }

  /** Leave the lobby (or close my hosted one). */
  leaveLobby() {
    if (this.lobby.hosting !== null) this.lobby.closeHosting();
    else this.lobby.leaveLobby();
    this.set({ phase: 'menu', roster: [], waiting: null, host: false });
  }

  // ── In a game ──

  private enter(config: HsConfig, role: 'host' | 'client', hostId: string) {
    if (this.session !== null) this.dropSession();
    const sp = this.ensureSpot();
    if (sp === null) return;
    const g = this.game;
    if (role === 'host' && config.players.some(p => p.cpu)) this.buildGrid();
    const me = this.transport.id;
    const lobbyPos = { x: sp.x, y: sp.y, z: sp.z };
    const s = new HideSeekSession({
      config,
      role,
      me,
      hostId,
      send: m => this.transport.send(m),
      pos: id => (id === me ? g.player.pos : (g.net.players.get(id)?.current.pos ?? null)),
      los: (a, b) => this.los(a, b),
      door: p => this.doorAt(p),
      blending: id =>
        id === me
          ? this.blending
          : (() => {
              const c = g.net.players.get(id)?.current;
              return c !== undefined && c.mode === 'foot' && c.anim === 'skate_crouch';
            })(),
      grid: () => this.grid,
      slot: (i, n) => {
        const q = startSlot(sp, i, n);
        return { x: q.x, y: sp.y, z: q.z, yaw: q.yaw };
      },
      lobby: lobbyPos,
      now: () => performance.now(),
    });
    s.onEvent = e => this.onEvent(e);
    this.session = s;
    this.view?.showWall(true);
    this.view?.showMarker(false);
    this.view?.clearReveal();
    this.roundRespect.clear();
    this.respectTotal = 0;
    this.whistleAt = -1e9;
    this.blindPos = null;
    this.startRoundForMe();
    this.set({ phase: 'playing', done: null, waiting: null, near: false });
    this.refresh();
    const mine = s.myStanding();
    this.toast(mine === 's' ? "you're IT: count to 45…" : 'HIDE! the seekers are counting');
  }

  /** Out of any building, then onto my spot in the start ring. */
  private startRoundForMe() {
    if (this.game.interiors.inside) {
      this.pendingStart = true;
      this.game.interiors.requestLeave();
    } else this.placeAtStart();
  }

  private placeAtStart() {
    const s = this.session;
    const sp = this.spot;
    if (s === null || sp === null) return;
    const n = s.config.players.length;
    const i = Math.max(
      0,
      s.config.players.findIndex(p => p.id === this.transport.id),
    );
    const q = startSlot(sp, i, n);
    const g = this.game;
    if (g.player.mode === 'board') g.player.toggleBoard();
    g.player.spawn(new THREE.Vector3(q.x, sp.y + 0.05, q.z), q.yaw);
    g.cam.snap(g.player);
    this.blindPos = null;
  }

  /** Tag (E / the button), whistle, ping. */
  tagNow() {
    const s = this.session;
    if (s === null || this.tagTarget === null) return;
    s.act('tag', this.tagTarget);
  }

  whistleNow() {
    const s = this.session;
    if (s === null || s.myStanding() !== 'h' || s.view.phase !== 'seek') return;
    if (performance.now() - this.whistleAt < WHISTLE_CD * 1000) return;
    this.whistleAt = performance.now();
    s.act('whistle');
  }

  pingNow() {
    const s = this.session;
    if (s === null || s.view.pingCd > 0) return;
    const st = s.myStanding();
    if ((st !== 's' && st !== 'f') || s.view.phase !== 'seek') return;
    s.act('ping');
  }

  private onEvent(e: HsEvent) {
    const s = this.session;
    if (s === null) return;
    const me = this.transport.id;
    const nameOf = (id: string) =>
      id === me ? 'you' : (s.config.players.find(p => p.id === id)?.name ?? 'someone');
    const at = (id: string) => {
      const q = this.posOf(id);
      return q === null ? null : new THREE.Vector3(q.x, q.y + 1, q.z);
    };
    switch (e.k) {
      case 'phase':
        if (e.ph === 'hide') {
          this.view?.clearReveal();
          this.view?.showWall(true);
          if (e.round > 0) {
            this.startRoundForMe();
            const st = s.myStanding();
            this.toast(`ROUND ${e.round + 1}: ${st === 's' ? "you're IT, count to 45…" : 'HIDE!'}`);
          }
        } else if (e.ph === 'seek') {
          this.game.sfx.play('go', { gain: 0.6 });
          this.toast(
            s.myStanding() === 'h' ? 'here they come… stay still' : 'READY OR NOT, HERE I COME!',
          );
        } else if (e.ph === 'reveal') this.showReveal();
        return;
      case 'tag': {
        this.game.sfx.play('cut-hit', { gain: 0.5 });
        const how = e.inside ? ' inside a building' : '';
        if (e.id === me) this.toast(`FOUND by ${nameOf(e.by)}${how}! now you seek`);
        else if (e.by === me) this.toast(`you found ${nameOf(e.id)}${how}! +5`);
        else this.toast(`${nameOf(e.by)} found ${nameOf(e.id)}${how}`);
        return;
      }
      case 'whistle':
        this.view?.whistle(e.id === me ? null : at(e.id));
        if (e.id === me) this.toast('🎵 whistled! +2 (they heard that…)');
        return;
      case 'ping':
        this.view?.ping(e.id === me ? null : at(e.id));
        if (e.id === me) this.toast('📡 a seeker pinged YOU: move!');
        else if (e.by === me) this.toast('📡 ping! listen for the chime…');
        return;
      case 'beacon':
        if (s.myStanding() !== 'h')
          this.toast('🚪 a door lit up: someone has been inside too long');
        else if (e.id === me) this.toast('🚪 your door lit up: the seekers can see it, get out!');
        return;
      case 'reassign':
        if (e.id === me) this.toast("the seeker left: you're IT now");
        return;
      case 'drop':
        if (e.id !== me && !e.id.startsWith('cpu:')) this.toast(`${nameOf(e.id)} left the game`);
        return;
      case 'win': {
        const st = s.myStanding();
        const won =
          (e.side === 'hiders' && st === 'h') ||
          (e.side === 'seekers' && (st === 's' || st === 'f'));
        this.toast(
          e.side === 'hiders'
            ? st === 'h'
              ? 'you stayed hidden: HIDERS WIN'
              : 'time up: the hiders win'
            : 'everyone found: SEEKERS WIN',
        );
        if (won && !this.roundRespect.has(e.round)) {
          this.roundRespect.add(e.round);
          const respect = (this.game as Game & { respect?: RespectApi }).respect;
          const d =
            respect?.add({
              kind: 'custom',
              label: st === 'h' ? 'stayed hidden at hide & seek' : 'found everyone at hide & seek',
              amount: st === 'h' ? 3 : 2,
            }) ?? 0;
          this.respectTotal += d;
        }
        return;
      }
    }
  }

  private showReveal() {
    const s = this.session;
    if (s === null || s.view.reveal === null) return;
    const spots = s.view.reveal
      .filter(r => r.y < 1000 || r.door !== undefined)
      .map(r => {
        const name = s.config.players.find(p => p.id === r.id)?.name ?? '?';
        const tag = r.st === 'h' ? 'HID HERE' : r.st === 'f' ? 'FOUND' : 'SEEKER';
        // Inside a building: the pillar goes on its door
        const d =
          r.door !== undefined ? this.game.interiors.doors().find(x => x.id === r.door) : undefined;
        return {
          x: d?.x ?? r.x,
          y: d !== undefined ? (d.y ?? 0) : r.y,
          z: d?.z ?? r.z,
          st: r.st,
          text: `${escapeHtml(name)} · ${tag}${d !== undefined ? ' (inside)' : ''}`,
        };
      });
    this.view?.showReveal(spots);
  }

  /** Esc / ✕: leave the game (the host leaving ends it for everyone). */
  leave() {
    const s = this.session;
    if (s === null) return;
    s.leave();
    if (this.lobby.hosting !== null) this.lobby.closeHosting();
    else this.lobby.leaveLobby();
    this.finish('left');
  }

  private finish(why: 'over' | 'hostLeft' | 'hostLost' | 'left') {
    const s = this.session;
    const rows = s !== null ? this.rows(s) : [];
    this.dropSession();
    if (why === 'left') {
      this.set({ phase: 'idle', game: null, done: null, roster: [] });
      this.toast('you left the game');
      return;
    }
    this.set({
      phase: 'done',
      game: null,
      done: { why, rows, respect: this.respectTotal, host: this.lobby.hosting !== null },
    });
    if (why === 'hostLeft') this.toast('the host left: game over');
    if (why === 'hostLost') this.toast('lost the host: game over');
  }

  private dropSession() {
    this.session = null;
    this.blending = false;
    this.stillT = 0;
    this.blindPos = null;
    this.pendingStart = false;
    this.tagTarget = null;
    this.view?.clearBots();
    this.view?.setDoors([]);
    this.view?.showWall(false);
    this.view?.showMarker(true);
  }

  /** PLAY AGAIN (host): the same lobby, a new game. */
  playAgain() {
    if (this.lobby.hosting === null) return;
    this.lobby.hosting.state = 'lobby';
    this.view?.clearReveal();
    this.startHosted();
  }

  closeDone() {
    if (this.ui.phase !== 'done') return;
    this.view?.clearReveal();
    if (this.lobby.hosting !== null) this.lobby.closeHosting();
    else this.lobby.leaveLobby();
    this.set({ phase: 'idle', done: null, roster: [] });
  }

  // ── Messages ──

  private onMessage(m: Parameters<HideSeekSession['onMessage']>[0]) {
    if (m.type === 'hideseek:start' && this.session !== null && this.session.ended === null) return;
    const r = this.lobby.onMessage(m);
    if (r?.kind === 'start') {
      // A rematch while the old game's results are up
      if (this.ui.phase === 'done') this.view?.clearReveal();
    }
    this.result(r);
    this.session?.onMessage(m);
  }

  // ── The host's world ──

  private los(a: Vec, b: Vec): boolean {
    const w = this.game.world;
    const o = _o.set(a.x, a.y + 1.5, a.z);
    for (const hy of [1.5, 0.8]) {
      const t = _t.set(b.x, b.y + hy, b.z);
      const dir = _d.subVectors(t, o);
      const len = dir.length();
      if (len < 0.3) return true;
      const hit = w.raycast(o, dir.multiplyScalar(1 / len), len - 0.25);
      if (hit === null) return true;
    }
    return false;
  }

  private doorAt(p: Vec): Door | null {
    const doors = this.game.interiors.doors();
    const d = doorOf(p, doors);
    return d === null ? null : { id: d.id, x: d.x, z: d.z };
  }

  /** The arena as a height grid for the CPU players (once). */
  private buildGrid() {
    if (this.grid !== null) return;
    const w = this.game.world;
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const half = 92;
    const n = Math.floor((half * 2) / CELL) + 1;
    const t0 = performance.now();
    this.grid = makeGrid(-half, -half, n, n, CELL, (x, z) => {
      const hit = w.raycast(o.set(x, 80, z), down, 100);
      return hit === null ? null : hit.point.y;
    });
    console.info(`[hideseek] nav grid ${n}×${n} in ${Math.round(performance.now() - t0)} ms`);
  }

  dispose() {
    if (this.session !== null) this.leave();
    else if (this.lobby.hosting !== null) this.lobby.closeHosting();
    this.view?.dispose();
    this.view = null;
    if (this.game.net.onHideSeek !== undefined) this.game.net.onHideSeek = undefined;
  }
}

const _o = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** `?offline=1` (tests, the browser check): never touch the live room. */
function offlineFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('offline') === '1';
}

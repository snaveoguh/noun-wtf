// ── Noun Breaks mode: the cypher, the battle menu and the Game.ts hook ───
//
// Owns everything between "you walked up to the cypher in the plaza" and
// "you're back on your board": the marker and its BREAK BATTLE prompt, the
// menu (VS CPU / 1V1 / CREW / WATCH, lobby.ts), challenges and invites, the
// countdown, host / client / spectator sessions (sync.ts), the result
// (respect + a toast), and restoring the player exactly on the way out.
//
// Game.ts calls `idle(dt)` every skate frame and, while `active`, hands the
// whole frame to `step(dt)`: the skater is parked on their spot on the edge
// of the circle (the view draws the dancers), the skate controls are drained,
// and the view owns the camera.

import type { Game } from '../../Game';
import type { RespectApi } from '../../interiors/contract';
import type { CrewId, CrewSize, BattleConfig, BattleView, BreakMsg } from '../contract';

import * as THREE from 'three';

import { parseSeedKey, randomSeed } from '../../character/NounAppearance';

import {
  HERE_R,
  PROMPT_R,
  buildCypherMarker,
  dist2d,
  pickCypher,
  ringSlot,
  type CypherSpot,
} from './cypher';
import { createSim, createView, preloadBreakView } from './factory';
import { BreakInputReader } from './input';
import {
  BreakLobby,
  type Difficulty,
  type Incoming,
  type LiveBattle,
  type LobbyResult,
  type Outgoing,
} from './lobby';
import { BreakSession, COUNTDOWN, JUDGE_DELAY, type BreakRole } from './sync';
import { NetTransport, type BreakTransport } from './transport';

export type BreakPhase = 'idle' | 'menu' | 'countdown' | 'battle' | 'results';

export interface BreakUiState {
  phase: BreakPhase;
  /** Standing at the cypher with nothing open (the prompt shows). */
  near: boolean;
  hasCypher: boolean;
  online: boolean;
  /** Players at the cypher, and everyone else in the room. */
  here: { id: string; name: string; seedKey?: string }[];
  room: { id: string; name: string; seedKey?: string }[];
  live: LiveBattle[];
  outgoing: Outgoing | null;
  incoming: Incoming | null;
  /** Accepted / asked to watch: waiting for the host's start. */
  waiting: string | null;
  role: BreakRole | null;
  me: string | null;
  /** Whole seconds left before the first beat (countdown phase). */
  countdown: number | null;
  results: null | {
    winner: CrewId | 'tie';
    myCrew: CrewId | null;
    totals: [number, number];
    crews: [string, string];
    respect: number | null;
    host: boolean;
  };
  toast: { text: string; at: number } | null;
  /** Debug: last snapshot size (bytes, JSON) and the clock's round trip. */
  snapBytes: number;
  rtt: number | null;
}

const ANNOUNCE_S = 2;

export class BreakMode {
  ui: BreakUiState = {
    phase: 'idle',
    near: false,
    hasCypher: false,
    online: false,
    here: [],
    room: [],
    live: [],
    outgoing: null,
    incoming: null,
    waiting: null,
    role: null,
    me: null,
    countdown: null,
    results: null,
    toast: null,
    snapBytes: 0,
    rtt: null,
  };
  /** Where the world streams around while active (the cypher). */
  readonly focus = new THREE.Vector3();
  readonly focusVel = new THREE.Vector3();
  readonly reader = new BreakInputReader();
  readonly lobby: BreakLobby;
  readonly transport: BreakTransport;
  session: BreakSession | null = null;
  view: BattleView | null = null;
  cypher: CypherSpot | null = null;
  /** DOM layer for the view's HUD (BreakUi mounts it). */
  hudLayer: HTMLElement | null = null;

  private listeners = new Set<() => void>();
  private marker: ReturnType<typeof buildCypherMarker> | null = null;
  private triedCypher = false;
  private announceAcc = 0;
  private announcedAt = false;
  private refreshAcc = 0;
  private lastRematch: {
    crewSize: CrewSize;
    difficulty: Difficulty;
    picks: { id: string; name: string; crew: CrewId }[];
  } | null = null;
  private difficulty: Difficulty = 'normal';
  private saved: {
    pos: THREE.Vector3;
    yaw: number;
    cam: THREE.Vector3;
    quat: THREE.Quaternion;
    fov: number;
    meVisible: boolean;
    moved: boolean;
  } | null = null;
  private seenDropped = new Set<string>();
  /** Other dancers' skaters, hidden while the view dances them. */
  private hiddenRemotes = new Set<string>();

  constructor(
    private game: Game,
    transport?: BreakTransport,
  ) {
    this.transport = transport ?? new NetTransport(game.net, offlineFlag());
    this.transport.onMessage = m => this.onMessage(m);
    this.lobby = new BreakLobby({
      myId: () => this.transport.id,
      myName: () => this.game.name || 'noun',
      mySeed: () => this.game.seed,
      seedOf: (id, key) =>
        parseSeedKey(key ?? this.game.net.players.get(id)?.seedKey) ?? randomSeed(),
      cpuSeed: () => randomSeed(),
      send: m => this.transport.send(m),
      now: () => performance.now(),
      busy: () => this.ui.phase === 'countdown' || this.ui.phase === 'battle',
    });
  }

  // ── Store (React reads `ui`) ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<BreakUiState>) {
    this.ui = { ...this.ui, ...p };
    for (const l of this.listeners) l();
  }

  toast(text: string) {
    this.set({ toast: { text, at: performance.now() } });
  }

  /** True while a battle owns the frame (Game.step hands over). */
  get active() {
    return (
      this.ui.phase === 'countdown' || this.ui.phase === 'battle' || this.ui.phase === 'results'
    );
  }

  private get myId() {
    return this.transport.id;
  }

  // ── The spot ──

  /** Find the cypher's spot (once the level is in) and put the marker down. */
  ensureCypher(): CypherSpot | null {
    if (this.cypher !== null || this.triedCypher) return this.cypher;
    const g = this.game;
    if (g.level === null) return null;
    this.triedCypher = true;
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    this.cypher = pickCypher((x, z) => {
      const hit = g.world.raycast(o.set(x, 8, z), down, 12);
      return hit === null ? null : { y: hit.point.y, flat: hit.normal.y > 0.97 };
    });
    if (this.cypher === null) {
      console.warn('[breaks] no clear spot for the cypher');
      return null;
    }
    this.marker = buildCypherMarker(this.cypher);
    g.gfx.scene.add(this.marker.group);
    this.focus.set(this.cypher.x, this.cypher.y, this.cypher.z);
    this.set({ hasCypher: true });
    return this.cypher;
  }

  // ── Skating: the prompt, presence, invites ──

  idle(dt: number) {
    const c = this.ensureCypher();
    this.marker?.update(dt);
    const p = this.game.player.pos;
    const d = c === null ? Infinity : dist2d(c, p.x, p.z);
    const near = this.ui.phase === 'idle' && d < PROMPT_R && Math.abs(p.y - (c?.y ?? 0)) < 3;
    if (near) void preloadBreakView();
    if (near !== this.ui.near) this.set({ near });
    // Presence: say so while at the cypher, and once when walking off
    const at = d < HERE_R;
    this.announceAcc += dt;
    if (
      this.transport.online &&
      (at !== this.announcedAt || (at && this.announceAcc >= ANNOUNCE_S))
    ) {
      this.announceAcc = 0;
      this.announcedAt = at;
      this.lobby.announce(at);
    }
    this.tickLobby(dt);
  }

  private tickLobby(dt: number) {
    for (const r of this.lobby.tick()) this.result(r);
    this.refreshAcc += dt;
    if (this.refreshAcc >= 0.5) {
      this.refreshAcc = 0;
      this.refresh();
    }
  }

  /** Who's at the cypher / in the room / battling, for the menu. */
  private refresh() {
    const c = this.cypher;
    const net = this.game.net;
    const here = new Map<string, { id: string; name: string; seedKey?: string }>();
    const room: { id: string; name: string; seedKey?: string }[] = [];
    for (const rp of net.players.values()) {
      const e = { id: rp.id, name: rp.name || 'noun', seedKey: rp.seedKey };
      room.push(e);
      const pos = rp.current.pos;
      if (c !== null && dist2d(c, pos.x, pos.z) < HERE_R) here.set(rp.id, e);
    }
    for (const h of this.lobby.here.values())
      if (!here.has(h.id)) here.set(h.id, { id: h.id, name: h.name, seedKey: h.seedKey });
    const next = {
      here: [...here.values()],
      room,
      live: [...this.lobby.live.values()],
      online: this.transport.online,
      outgoing: this.lobby.outgoing ? structuredClone(this.lobby.outgoing) : null,
      incoming: this.lobby.incoming,
      waiting: this.lobby.expect ? this.ui.waiting : null,
    };
    const same =
      JSON.stringify([
        next.here,
        next.room,
        next.live,
        next.online,
        next.outgoing,
        next.incoming,
        next.waiting,
      ]) ===
      JSON.stringify([
        this.ui.here,
        this.ui.room,
        this.ui.live,
        this.ui.online,
        this.ui.outgoing,
        this.ui.incoming,
        this.ui.waiting,
      ]);
    if (!same) this.set(next);
  }

  private result(r: LobbyResult | null) {
    if (r === null) return;
    if (r.kind === 'go') this.begin(r.config);
    else if (r.kind === 'fellThrough') {
      this.set({ waiting: null });
      this.toast('the battle fell through');
    } else this.refresh();
  }

  // ── Menu actions ──

  /** E / tap on the prompt: open the battle menu. */
  promptAction() {
    if (this.ui.phase !== 'idle' || this.ensureCypher() === null) return;
    void preloadBreakView();
    this.refresh();
    this.set({ phase: 'menu', near: false });
  }

  closeMenu() {
    if (this.ui.phase !== 'menu') return;
    this.lobby.cancelChallenge();
    this.set({ phase: 'idle', outgoing: null });
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
  }

  vsCpu(difficulty: Difficulty = this.difficulty, crewSize: CrewSize = 1) {
    this.difficulty = difficulty;
    this.lastRematch = { crewSize, difficulty, picks: [] };
    this.begin(this.lobby.vsCpu(crewSize, difficulty));
  }

  /** 1V1: challenge one player (at the cypher or anywhere in the room). */
  challenge(id: string, difficulty: Difficulty = this.difficulty) {
    const name = this.game.net.players.get(id)?.name || this.lobby.here.get(id)?.name || 'noun';
    const picks = [{ id, name, crew: 1 as CrewId }];
    this.lastRematch = { crewSize: 1, difficulty, picks };
    this.result(this.lobby.challenge(1, picks, difficulty));
    this.refresh();
  }

  /** CREW 2V2 / 3V3: my crewmates (crew 0) and rivals (crew 1); CPUs fill the rest. */
  crew(
    size: CrewSize,
    picks: { id: string; name: string; crew: CrewId }[],
    difficulty: Difficulty = this.difficulty,
  ) {
    this.lastRematch = { crewSize: size, difficulty, picks };
    this.result(this.lobby.challenge(size, picks, difficulty));
    this.refresh();
  }

  startNow() {
    this.result(this.lobby.startNow());
  }

  cpuInstead() {
    this.result(this.lobby.cpuInstead());
  }

  cancelChallenge() {
    this.lobby.cancelChallenge();
    this.refresh();
  }

  acceptInvite() {
    const inv = this.lobby.incoming;
    if (!inv) return;
    void preloadBreakView();
    this.lobby.accept();
    if (this.ui.phase === 'results') this.exit();
    this.set({ incoming: null, waiting: `waiting for ${inv.name}…` });
  }

  declineInvite() {
    this.lobby.decline();
    this.set({ incoming: null });
  }

  watch(gid: string) {
    const l = this.lobby.live.get(gid);
    if (!l || !this.lobby.watch(gid)) return;
    void preloadBreakView();
    this.set({ waiting: `joining ${l.hostName}'s battle…` });
  }

  // ── Messages ──

  onMessage(m: BreakMsg) {
    switch (m.type) {
      case 'break:lobby':
      case 'break:challenge':
      case 'break:reply': {
        const r = this.lobby.onMessage(m);
        if (r?.kind === 'invite') this.refresh();
        else this.result(r);
        return;
      }
      case 'break:start': {
        if (this.ui.phase === 'countdown' || this.ui.phase === 'battle') return;
        const as = this.lobby.wants(m);
        if (as === null || !m.host) return;
        this.lobby.expect = null;
        if (this.ui.phase === 'results') this.exit();
        this.enter(
          m.config,
          as === 'member' ? 'client' : 'spectator',
          m.host,
          m.at ?? -COUNTDOWN,
          m.lag ?? 0,
        );
        return;
      }
      case 'break:watch': {
        const s = this.session;
        if (s?.role !== 'host' || m.gid !== s.gid || !m.from) return;
        this.transport.send({
          type: 'break:start',
          host: this.myId,
          config: s.config,
          to: m.from,
          at: s.battleNow(),
          lag: s.lag,
        });
        return;
      }
      default:
        this.session?.onMessage(m);
    }
  }

  // ── In and out ──

  /** Host: announce the battle and go. */
  private begin(config: BattleConfig) {
    const lag = JUDGE_DELAY;
    this.transport.send({ type: 'break:start', host: this.myId, config, at: -COUNTDOWN, lag });
    this.enter(config, 'host', this.myId, -COUNTDOWN, lag);
  }

  private enter(config: BattleConfig, role: BreakRole, hostId: string, at: number, lag: number) {
    const c = this.ensureCypher();
    if (c === null) return;
    const g = this.game;
    const me = role === 'spectator' ? null : this.myId;
    const mine = config.dancers.find(d => d.id === me);
    if (this.saved === null) {
      const cam = g.gfx.camera;
      const p = g.player;
      this.saved = {
        pos: p.pos.clone(),
        yaw: p.mode === 'foot' ? p.footYaw : Math.atan2(p.fwd.x, p.fwd.z),
        cam: cam.position.clone(),
        quat: cam.quaternion.clone(),
        fov: cam.fov,
        meVisible: g.me?.root.visible ?? true,
        moved: false,
      };
    }
    // Park me on my spot on the edge of the circle (the view draws my dancer)
    if (mine !== undefined) {
      const idx = config.dancers.filter(d => d.crew === mine.crew).findIndex(d => d.id === mine.id);
      const s = ringSlot(c, mine.crew, idx, config.crewSize);
      const far = dist2d(c, g.player.pos.x, g.player.pos.z) > HERE_R * 2;
      g.player.spawn(new THREE.Vector3(s.x, s.y + 0.05, s.z), s.yaw);
      this.saved.moved = true;
      if (g.me) g.me.root.visible = false;
      if (far) this.toast('off to the plaza cypher…');
    }
    this.focus.set(c.x, c.y, c.z);
    if (this.saved.pos.distanceTo(this.focus) > 150) g.mountain?.prime(this.focus);
    this.session = new BreakSession({
      config,
      role,
      me,
      hostId,
      send: m => this.transport.send(m),
      makeSim: createSim,
      at,
      lag,
    });
    const view = createView({
      scene: g.gfx.scene,
      camera: g.gfx.camera,
      renderer: g.gfx.renderer,
      hudLayer: this.hudLayer,
      labelLayer: g.labelLayerEl,
      assets: g.assets,
      toon: g.gfx.toon,
      quality: g.gfx.quality,
      audio: g.audio.ctx,
      audioOut: g.audio.master,
    });
    view.mount(config, c);
    view.setLocal(me);
    this.view = view;
    if (this.marker) this.marker.group.visible = false;
    this.reader.attach();
    this.reader.onPress = (k, ms) => this.session?.press(k, ms);
    this.reader.onEscape = () => this.leave();
    this.seenDropped.clear();
    this.announceAcc = ANNOUNCE_S;
    this.set({
      phase: 'countdown',
      near: false,
      role,
      me,
      countdown: Math.ceil(-at),
      results: null,
      waiting: null,
      outgoing: null,
    });
  }

  /** One frame while active (Game.step's breaks block). */
  step(dt: number) {
    const s = this.session;
    if (s === null) return;
    this.hideDancers(s.config);
    s.update(dt);
    const st = s.render();
    if (st !== null) this.view?.update(dt, st, s.drainEvents());
    const a = s.battleNow();
    if (this.ui.phase === 'countdown') {
      if (a >= 0) this.set({ phase: 'battle', countdown: null });
      else if (Math.ceil(-a) !== this.ui.countdown) this.set({ countdown: Math.ceil(-a) });
    }
    for (const id of s.dropped)
      if (!this.seenDropped.has(id)) {
        this.seenDropped.add(id);
        const n = s.config.dancers.find(d => d.id === id)?.name ?? 'someone';
        this.toast(`${n} dropped: a CPU dances for them`);
      }
    // Host: tell the room a battle's on (WATCH)
    this.announceAcc += dt;
    if (
      s.role === 'host' &&
      this.ui.phase !== 'results' &&
      this.announceAcc >= ANNOUNCE_S &&
      this.transport.online
    ) {
      this.announceAcc = 0;
      this.lobby.announce(true, {
        gid: s.gid,
        host: this.myId,
        hostName: this.game.name,
        crewSize: s.config.crewSize,
        names: s.config.dancers.map(d => d.name),
        at: 0,
      });
    }
    this.tickLobby(dt);
    if (s.stats.snapBytes !== this.ui.snapBytes || s.clock.rtt !== this.ui.rtt)
      this.ui = { ...this.ui, snapBytes: s.stats.snapBytes, rtt: s.clock.rtt };
    if (this.ui.phase !== 'results' && s.hostLeft) {
      this.exit();
      this.toast('the host left: battle over');
      return;
    }
    if (this.ui.phase !== 'results' && s.ended !== null) this.showResults();
  }

  private showResults() {
    const s = this.session!;
    const end = s.ended!;
    const me = s.config.dancers.find(d => d.id === s.me);
    const myCrew = me?.crew ?? null;
    let respect: number | null = null;
    if (myCrew !== null && end.winner !== 'tie')
      respect = this.report(end.winner === myCrew, s.config.crewSize);
    const crewName = (c: CrewId) =>
      s.config.crewSize === 1
        ? (s.config.dancers.find(d => d.crew === c)?.name ?? '')
        : c === myCrew
          ? 'YOUR CREW'
          : c === 0
            ? 'RED CREW'
            : 'BLUE CREW';
    if (s.role === 'host' && this.transport.online) this.lobby.announce(true);
    this.set({
      phase: 'results',
      results: {
        winner: end.winner,
        myCrew,
        totals: end.totals,
        crews: [crewName(0), crewName(1)],
        respect,
        host: s.role === 'host',
      },
    });
    const won = myCrew !== null && end.winner === myCrew;
    this.toast(
      end.winner === 'tie'
        ? "a tie: the judges couldn't split it"
        : myCrew === null
          ? `${crewName(end.winner)} take it`
          : `${won ? 'you won the battle' : 'you lost the battle'}${respect !== null && respect !== 0 ? ` · ${respect > 0 ? '+' : ''}${respect} respect` : ''}`,
    );
  }

  /** Respect (game.respect, interiors/contract.ts), when it's there. */
  private report(won: boolean, crewSize: CrewSize): number | null {
    const respect = (this.game as Game & { respect?: RespectApi }).respect;
    return respect?.add({ kind: won ? 'break_win' : 'break_loss', crewSize }) ?? null;
  }

  /** RUN IT BACK (host): the same format and the same people, challenged again. */
  rematch() {
    const s = this.session;
    const r = this.lastRematch;
    if (s?.role !== 'host' || r === null) return;
    this.exit();
    const picks = r.picks.filter(p => this.game.net.players.has(p.id));
    if (picks.length === 0) this.vsCpu(r.difficulty, r.crewSize);
    else {
      this.set({ phase: 'menu' });
      if (r.crewSize === 1) this.challenge(picks[0].id, r.difficulty);
      else this.crew(r.crewSize, picks, r.difficulty);
    }
  }

  /** Esc / the leave button: forfeit (a loss) or stop watching. */
  leave() {
    const s = this.session;
    if (s === null) return;
    if (this.ui.phase === 'results') return this.exit();
    if (!s.over) {
      s.leave();
      if (s.role !== 'spectator' && this.ui.phase === 'battle') {
        const me = s.config.dancers.find(d => d.id === s.me);
        if (me) this.report(false, s.config.crewSize);
        this.toast('you left the cypher: that one counts as a loss');
      }
    }
    this.exit();
  }

  /** The other human dancers' skaters (parked on the circle) would double up with the view's dancers. */
  private hideDancers(config: BattleConfig) {
    for (const d of config.dancers) {
      if (!d.human || d.id === this.myId) continue;
      const r = this.game.remotes.get(d.id);
      if (r === undefined) continue;
      r.character.root.visible = false;
      if (r.label) r.label.style.visibility = 'hidden';
      this.hiddenRemotes.add(d.id);
    }
  }

  /** Back to skating, exactly as before: player, camera, rider. */
  exit() {
    const g = this.game;
    for (const id of this.hiddenRemotes) {
      const r = g.remotes.get(id);
      if (r === undefined) continue;
      r.character.root.visible = true;
      if (r.label) r.label.style.visibility = '';
    }
    this.hiddenRemotes.clear();
    const s = this.session;
    if (s?.role === 'host' && this.transport.online) this.lobby.announce(this.announcedAt);
    this.view?.unmount();
    this.view = null;
    this.session = null;
    this.reader.detach();
    this.reader.onPress = null;
    this.reader.onEscape = null;
    if (this.marker) this.marker.group.visible = true;
    const sv = this.saved;
    if (sv !== null) {
      const cam = g.gfx.camera;
      cam.position.copy(sv.cam);
      cam.quaternion.copy(sv.quat);
      if (cam.fov !== sv.fov) {
        cam.fov = sv.fov;
        cam.updateProjectionMatrix();
      }
      if (sv.moved) g.player.spawn(sv.pos, sv.yaw);
      if (g.me) g.me.root.visible = sv.meVisible;
      if (g.mountain !== null && this.focus.distanceTo(sv.pos) > 150) g.mountain.prime(sv.pos);
    }
    this.saved = null;
    this.set({ phase: 'idle', role: null, me: null, results: null, countdown: null });
  }

  dispose() {
    if (this.active) this.exit();
    if (this.announcedAt && this.transport.online) this.lobby.announce(false);
    this.marker?.dispose();
    this.marker = null;
    if (this.game.net.onBreak !== undefined) this.game.net.onBreak = undefined;
  }
}

/** `?offline=1` (tests, the browser check): never touch the live room. */
function offlineFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('offline') === '1';
}

// ── Noun Football mode: `game.football`, the menus' state, the Game hook ──
//
// Owns everything between "you walked into NOUN STADIUM and pressed PLAY"
// and "you're back outside the main entrance":
//   arrive()        `/world?play=football` (or the PLAY chip in the
//                   stadium): to the stadium, which builds in slices
//                   (game.stadium), then the match view (football/view,
//                   lazy) builds its footballers one a frame; the menu
//                   opens over an attract match (CPU v CPU, broadcast cam);
//   the menu        VS CPU (5 / 7 / 11-a-side, difficulty, length, kits),
//                   CUP (8-club knockout) and SEASON (4-club round robin),
//                   WATCH (CPU v CPU), ONLINE (host a lobby, join a team for
//                   1v1 or co-op, challenge someone at the stadium, watch a
//                   live match);
//   the match       FootballHost (net/sync.ts) runs the sim at SIM_DT for
//                   local and hosted matches; FootballClient draws a remote
//                   host's snapshots; pads from net/input.ts; the view draws
//                   prev / next / alpha and plays the events;
//   results         respect for wins (game.respect), cup / season progress;
//   leaving         frees the view (the stadium stays: game.stadium owns
//                   it), puts the camera and the rider back.
//
// Game.ts calls `idle(dt)` every normal frame and, while `active`, hands
// the whole frame to `step(dt)`.

import type { Game } from '../../Game';
import type { RespectApi } from '../../interiors/contract';
import type {
  CamMode,
  Difficulty,
  FootballApi,
  FootballEvent,
  MatchConfig,
  PadInput,
  SimState,
  TeamId,
  TeamSize,
} from '../contract';
import type { FootballView } from '../view';
import type { FootballFrame } from './sync';

import * as THREE from 'three';

import { randomSeed, seedKey } from '../../character/NounAppearance';
import { perf } from '../../perf/PerfProbe';
import { warmHidden } from '../../render/shaderWarm';
import { FootballSim } from '../sim/FootballSim';
import { KITS, makeMatch } from '../sim/setup';
import { inStadium, stadiumFrame, stadiumSpawn } from '../site';

import {
  myFixture,
  newCup,
  opponentDifficulty,
  recordMine,
  type CupKind,
  type CupState,
} from './cup';
import { FootballInputReader } from './input';
import { FootballLobby, type LobbyInfo, type LobbyEvent } from './lobby';
import { FootballClient, FootballHost, createWatcher } from './sync';
import { NetTransport, type FootballTransport } from './transport';

export type FootballPhase = 'idle' | 'loading' | 'menu' | 'playing' | 'results';
export type MatchKind = 'cpu' | 'cup' | 'season' | 'watch' | 'online';

export interface FootballUiState {
  phase: FootballPhase;
  /** Loading: what's building (0..1). */
  progress: number;
  /** The rider is inside NOUN STADIUM (the PLAY chip shows). */
  near: boolean;
  size: TeamSize;
  difficulty: Difficulty;
  /** Real minutes per half. */
  halfMinutes: number;
  kit: number;
  oppKit: number;
  /** In a match: what kind, the pause menu, my team. */
  kind: MatchKind | null;
  paused: boolean;
  myTeam: TeamId | null;
  cam: CamMode;
  device: 'keyboard' | 'gamepad' | 'touch';
  online: boolean;
  lobbies: LobbyInfo[];
  /** The lobby I host / joined. */
  hosting: { gid: string; players: { id: string; name: string; team: TeamId }[] } | null;
  joined: { gid: string; team: TeamId } | null;
  incoming: { name: string; size: TeamSize; coop: boolean } | null;
  outgoing: { name: string } | null;
  /** Riders at the stadium I could challenge. */
  nearPlayers: { id: string; name: string }[];
  cup: CupState | null;
  results: null | {
    score: [number, number];
    pens?: [number, number];
    winner: TeamId | null;
    won: boolean | null;
    names: [string, string];
    respect: number | null;
    reason: string;
    cupLine?: string;
  };
  toast: { text: string; at: number } | null;
}

export const WIN_RESPECT: Record<Difficulty | 'human', number> = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  human: 8,
};
const CUP_KEY = 'noun-football-cup-v1';
const SETTINGS_KEY = 'noun-football-v1';
const ANNOUNCE_S = 2;

const viewMod = () => import('../view');

function offlineFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('offline') === '1';
}

function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s === null ? null : (JSON.parse(s) as T);
  } catch {
    return null;
  }
}

function save(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private mode etc.
  }
}

/** Offline transport for local matches (nothing goes on the wire). */
const LOCAL: FootballTransport = {
  selfId: 'me',
  online: false,
  send() {},
  onMessage() {
    return () => {};
  },
};

type Session =
  | { role: 'host'; host: FootballHost; me: string | null; kind: MatchKind; config: MatchConfig }
  | {
      role: 'client';
      client: FootballClient;
      me: string | null;
      kind: MatchKind;
      config: MatchConfig;
    };

interface Saved {
  cam: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
  meVisible: boolean;
  labels: string;
  statsSuspended: boolean;
}

export class FootballMode implements FootballApi {
  ui: FootballUiState;
  view: FootballView | null = null;
  readonly input = new FootballInputReader();
  readonly transport: NetTransport;
  readonly lobby: FootballLobby;
  private listeners = new Set<() => void>();
  private session: Session | null = null;
  /** The attract match behind the menu. */
  private attract: FootballHost | null = null;
  private saved: Saved | null = null;
  private loadingView = false;
  private frame = stadiumFrame();
  private announceAcc = 0;
  private refreshAcc = 0;
  private lastFrame: FootballFrame | null = null;
  private resultsShown = false;
  private camFwd = new THREE.Vector3();

  constructor(readonly game: Game) {
    const st = load<Partial<FootballUiState>>(SETTINGS_KEY) ?? {};
    this.ui = {
      phase: 'idle',
      progress: 0,
      near: false,
      size: st.size ?? 11,
      difficulty: st.difficulty ?? 2,
      halfMinutes: st.halfMinutes ?? 4,
      kit: st.kit ?? 0,
      oppKit: st.oppKit ?? 1,
      kind: null,
      paused: false,
      myTeam: null,
      cam: 'broadcast',
      device: 'keyboard',
      online: false,
      lobbies: [],
      hosting: null,
      joined: null,
      incoming: null,
      outgoing: null,
      nearPlayers: [],
      cup: load<CupState>(CUP_KEY),
      results: null,
      toast: null,
    };
    this.transport = new NetTransport(game.net, offlineFlag());
    this.lobby = new FootballLobby({
      transport: this.transport,
      now: () => performance.now(),
      myName: () => this.game.name || 'noun',
      busy: () => this.session !== null && this.session.kind === 'online',
      onEvent: e => this.onLobby(e),
    });
  }

  // ── Store ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(p: Partial<FootballUiState>) {
    this.ui = { ...this.ui, ...p };
    for (const l of this.listeners) l();
  }

  toast(text: string) {
    this.set({ toast: { text, at: performance.now() } });
  }

  get active(): boolean {
    return this.ui.phase !== 'idle';
  }

  /** The human id on this screen in the current match. */
  private get me(): string | null {
    return this.session?.me ?? null;
  }

  // ── In and out ──

  /** `/world?play=football`, or PLAY at the stadium: there, menu open. False until the game's ready. */
  arrive(): boolean {
    if (this.active) return true;
    const g = this.game;
    if (g.me === null || g.level === null) return false;
    // To the main entrance if we're not already in the stadium
    const p = g.player.pos;
    if (!inStadium(p.x, p.z, 10)) {
      const sp = stadiumSpawn();
      g.player.spawn(new THREE.Vector3(sp.x, sp.y, sp.z), sp.yaw);
      g.cam.snap(g.player);
    }
    const cam = g.gfx.camera;
    this.saved = {
      cam: cam.position.clone(),
      quat: cam.quaternion.clone(),
      fov: cam.fov,
      meVisible: g.me.root.visible,
      labels: g.labelLayerEl.style.visibility,
      statsSuspended: g.stats.suspended,
    };
    g.labelLayerEl.style.visibility = 'hidden';
    g.stats.suspended = true;
    this.input.attach();
    this.set({ phase: 'loading', progress: 0, results: null });
    this.loadView();
    return true;
  }

  private loadView() {
    if (this.loadingView || this.view !== null) return;
    this.loadingView = true;
    void viewMod().then(
      m => {
        this.loadingView = false;
        if (!this.active) return;
        this.mountView(m);
      },
      err => {
        this.loadingView = false;
        console.warn('[football] view failed to load', err);
        this.toast('football failed to load');
        this.exit();
      },
    );
  }

  private mountView(m: typeof import('../view')) {
    // The stadium has to be there first (step() keeps building it)
    const st = this.game.stadium.view;
    if (st === null) {
      window.setTimeout(() => this.active && this.mountView(m), 200);
      return;
    }
    const g = this.game;
    const gfx = g.gfx;
    const low = gfx.quality === 'low';
    this.frame = st.opts.frame;
    this.view = m.createFootballView(
      { frame: this.frame, low },
      {
        scene: gfx.scene,
        stadium: st,
        assets: g.assets,
        toon: gfx.toon,
        shadows: !low,
        audio: () => g.audio.ctx,
        audioOut: () => g.audio.master,
        canvas: gfx.renderer.domElement,
        warm: obj => warmHidden(gfx.renderer, obj, gfx.camera, gfx.scene, f => gfx.asDrawn(f)),
        ownStadium: false,
        ink: gfx.outline,
        // the TV gantry sits on the main stand (the tunnel side, pitch −x)
        stand: -1,
        reduceMotion: matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      },
    );
    this.view.setCamera('broadcast');
  }

  /** ESC / LEAVE from the menu: back outside. */
  leave() {
    if (this.session !== null && this.session.kind === 'online') this.endSession('left');
    this.exit();
  }

  /** Back to the world, exactly as before (the rider at the stadium). */
  exit() {
    const g = this.game;
    this.endSession(null);
    this.stopAttract();
    this.input.detach();
    this.view?.dispose();
    this.view = null;
    const sv = this.saved;
    if (sv !== null) {
      const cam = g.gfx.camera;
      cam.position.copy(sv.cam);
      cam.quaternion.copy(sv.quat);
      if (cam.fov !== sv.fov) {
        cam.fov = sv.fov;
        cam.updateProjectionMatrix();
      }
      if (g.me !== null) g.me.root.visible = sv.meVisible;
      g.labelLayerEl.style.visibility = sv.labels;
      g.stats.suspended = sv.statsSuspended;
    }
    this.saved = null;
    if (this.lobby.mine !== null) this.lobby.close();
    if (this.lobby.joined !== null) this.lobby.leaveTeam();
    g.cam.snap(g.player);
    this.set({
      phase: 'idle',
      kind: null,
      paused: false,
      myTeam: null,
      hosting: null,
      joined: null,
    });
  }

  // ── Settings ──

  setOption(
    p: Partial<Pick<FootballUiState, 'size' | 'difficulty' | 'halfMinutes' | 'kit' | 'oppKit'>>,
  ) {
    const next = { ...this.ui, ...p };
    if (next.kit === next.oppKit) next.oppKit = (next.kit + 1) % KITS.length;
    this.set({
      size: next.size,
      difficulty: next.difficulty,
      halfMinutes: next.halfMinutes,
      kit: next.kit,
      oppKit: next.oppKit,
    });
    save(SETTINGS_KEY, {
      size: next.size,
      difficulty: next.difficulty,
      halfMinutes: next.halfMinutes,
      kit: next.kit,
      oppKit: next.oppKit,
    });
  }

  cycleCam() {
    const order: CamMode[] = ['broadcast', 'player', 'high'];
    const cam = order[(order.indexOf(this.ui.cam) + 1) % order.length];
    this.view?.setCamera(cam, this.focusId());
    this.set({ cam });
  }

  private focusId(): string | null {
    const n = this.lastFrame?.next;
    if (!n || this.me === null) return null;
    return n.players.find(p => p.human === this.me)?.id ?? null;
  }

  // ── Matches ──

  private seedKeys() {
    const mine = seedKey(this.game.seed);
    const cache = new Map<string, string>();
    return {
      seedKey: (team: TeamId, i: number) => {
        const k = `${team}:${i}`;
        let v = cache.get(k);
        if (v === undefined) {
          v = seedKey(randomSeed());
          cache.set(k, v);
        }
        return v;
      },
      mine,
    };
  }

  private config(o: {
    humans: { id: string; name: string; team: TeamId }[];
    difficulty: [Difficulty, Difficulty];
    kits: [number, number];
    knockout?: boolean;
    halfSeconds?: number;
    size?: TeamSize;
  }): MatchConfig {
    const sk = this.seedKeys();
    const humanSeedKey: Record<string, string> = {};
    for (const h of o.humans)
      if (h.id === 'me' || h.id === this.transport.selfId) humanSeedKey[h.id] = sk.mine;
    return makeMatch({
      size: o.size ?? this.ui.size,
      seed: (Math.random() * 2 ** 31) | 0,
      humans: o.humans,
      difficulty: o.difficulty,
      kits: o.kits,
      halfSeconds: o.halfSeconds ?? this.ui.halfMinutes * 60,
      knockout: o.knockout ?? false,
      seedKey: sk.seedKey,
      humanSeedKey,
    });
  }

  /** VS CPU: you're the home side. */
  vsCpu() {
    const d = this.ui.difficulty;
    const cfg = this.config({
      humans: [{ id: 'me', name: this.game.name || 'you', team: 0 }],
      difficulty: [d, d],
      kits: [this.ui.kit, this.ui.oppKit],
    });
    this.startLocal(cfg, 'me', 'cpu');
  }

  /** WATCH: CPU v CPU from the broadcast camera. */
  watch() {
    const d = this.ui.difficulty;
    const cfg = this.config({
      humans: [],
      difficulty: [d, d],
      kits: [this.ui.kit, this.ui.oppKit],
    });
    this.startLocal(cfg, null, 'watch');
  }

  /** A new cup or season with your club (replaces one in progress). */
  newCup(kind: CupKind) {
    const cup = newCup(
      kind,
      (Math.random() * 2 ** 31) | 0,
      this.ui.kit,
      this.ui.size,
      this.ui.difficulty,
    );
    save(CUP_KEY, cup);
    this.set({ cup });
  }

  /** Play your next cup / season fixture. */
  playCup() {
    const cup = this.ui.cup;
    if (cup === null || cup.done) return;
    const f = myFixture(cup);
    if (f === null) return;
    const opp = f.home === cup.me ? f.away : f.home;
    const d = opponentDifficulty(cup);
    const cfg = this.config({
      humans: [{ id: 'me', name: this.game.name || 'you', team: 0 }],
      difficulty: [d, d],
      kits: [cup.me, opp],
      knockout: cup.kind === 'cup',
      size: cup.size,
    });
    this.startLocal(cfg, 'me', cup.kind);
  }

  abandonCup() {
    save(CUP_KEY, null);
    this.set({ cup: null });
  }

  private startLocal(cfg: MatchConfig, me: string | null, kind: MatchKind) {
    this.endSession(null);
    this.stopAttract();
    const host = new FootballHost({
      gid: `local-${Date.now()}`,
      config: cfg,
      sim: new FootballSim(cfg),
      transport: LOCAL,
      me,
      announce: false,
    });
    this.session = { role: 'host', host, me, kind, config: cfg };
    this.beginMatch(cfg, me, kind);
  }

  private beginMatch(cfg: MatchConfig, me: string | null, kind: MatchKind) {
    const view = this.view;
    if (view !== null) {
      view.clearMatch();
      view.setMatch(cfg);
      view.setLocal?.(me);
      view.setLive(true);
      view.setCamera(this.ui.cam, null);
    }
    if (this.game.me !== null) this.game.me.root.visible = false;
    const myTeam = me === null ? null : (cfg.humans.find(h => h.id === me)?.team ?? null);
    this.resultsShown = false;
    this.lastFrame = null;
    this.set({ phase: 'playing', kind, paused: false, myTeam, results: null });
  }

  private endSession(reason: string | null) {
    const s = this.session;
    if (s === null) return;
    if (s.role === 'host') {
      if (reason !== null) s.host.leave();
      s.host.dispose();
    } else {
      if (reason !== null) s.client.leave();
      s.client.dispose();
    }
    this.session = null;
  }

  private startAttract() {
    if (
      this.attract !== null ||
      this.view === null ||
      (this.view.pending > 0 && this.view.built === false)
    )
      return;
    const cfg = this.config({
      humans: [],
      difficulty: [3, 3],
      kits: [this.ui.kit, this.ui.oppKit],
      halfSeconds: 900,
    });
    this.attract = new FootballHost({
      gid: 'attract',
      config: cfg,
      sim: new FootballSim(cfg),
      transport: LOCAL,
      me: null,
      announce: false,
    });
    this.view.clearMatch();
    this.view.setMatch(cfg);
    this.view.setLocal?.(null);
    this.view.setLive(true);
    this.view.setCamera('broadcast');
  }

  private stopAttract() {
    if (this.attract === null) return;
    this.attract.dispose();
    this.attract = null;
    this.view?.clearMatch();
  }

  /** Pause (local matches stop; online the menu just opens over it). */
  setPaused(p: boolean) {
    if (this.ui.phase !== 'playing') return;
    this.set({ paused: p });
  }

  /** Quit the match in progress back to the menu (online: you leave). */
  quitMatch() {
    const s = this.session;
    if (s !== null && s.kind === 'online') this.toast('you left the match');
    this.endSession(s?.kind === 'online' ? 'left' : null);
    this.openMenu();
  }

  rematch() {
    const k = this.ui.kind;
    if (k === 'cup' || k === 'season') return this.playCup();
    if (k === 'watch') return this.watch();
    this.vsCpu();
  }

  openMenu() {
    this.endSession(null);
    if (this.game.me !== null) this.game.me.root.visible = false;
    this.set({ phase: 'menu', kind: null, paused: false, results: null, myTeam: null });
  }

  // ── Online ──

  hostLobby() {
    if (!this.transport.online) {
      this.toast('offline: online play needs the multiplayer server');
      return;
    }
    const gid = this.lobby.host(this.ui.size);
    void gid;
    this.syncLobby();
  }

  joinLobby(gid: string, team: TeamId) {
    this.lobby.joinTeam(gid, team);
    this.syncLobby();
  }

  leaveLobby() {
    if (this.lobby.mine !== null) this.lobby.close();
    if (this.lobby.joined !== null) this.lobby.leaveTeam();
    this.syncLobby();
  }

  setLobbyTeam(id: string, team: TeamId) {
    this.lobby.setTeam(id, team);
    this.syncLobby();
  }

  challenge(id: string, name: string, coop = false) {
    this.lobby.challenge(id, name, this.ui.size, coop);
    this.syncLobby();
  }

  acceptInvite() {
    this.lobby.accept();
    this.syncLobby();
  }

  declineInvite() {
    this.lobby.decline();
    this.syncLobby();
  }

  watchLive(gid: string) {
    this.lobby.watch(gid);
  }

  /** Host: start the lobby's match (CPU fills every other footballer). */
  startOnline() {
    const mine = this.lobby.mine;
    if (mine === null) return;
    const humans = mine.players.map(p => ({ id: p.id, name: p.name, team: p.team }));
    const d = this.ui.difficulty;
    const cfg = this.config({ humans, difficulty: [d, d], kits: [this.ui.kit, this.ui.oppKit] });
    // Everyone plays as their own rider (seed keys travel in the lobby names only, so others get stock Nouns)
    this.lobby.setLive(true, [0, 0]);
    this.endSession(null);
    this.stopAttract();
    const me = this.transport.selfId;
    const host = new FootballHost({
      gid: mine.gid,
      config: cfg,
      sim: new FootballSim(cfg),
      transport: this.transport,
      me,
    });
    this.session = { role: 'host', host, me, kind: 'online', config: cfg };
    this.beginMatch(cfg, me, 'online');
  }

  private onLobby(e: LobbyEvent) {
    if (e.kind === 'start') {
      const m = e.msg;
      this.endSession(null);
      this.stopAttract();
      const watching = e.role === 'watch';
      const me = watching ? null : this.transport.selfId;
      const client = watching
        ? createWatcher({ gid: m.gid, config: m.config, hostId: m.host, transport: this.transport })
        : new FootballClient({
            gid: m.gid,
            config: m.config,
            hostId: m.host,
            transport: this.transport,
            me,
            selfLead: 0.08,
          });
      this.session = { role: 'client', client, me, kind: 'online', config: m.config };
      if (!this.active) this.arrive();
      this.beginMatch(m.config, me, watching ? 'watch' : 'online');
      return;
    }
    if (e.kind === 'invite') this.toast(`${e.invite.name} wants a game of football`);
    if (e.kind === 'declined') this.toast(`${e.invite.name} said no`);
    if (e.kind === 'accepted' && this.lobby.mine !== null) {
      // a challenge was accepted: straight into the match
      this.startOnline();
      return;
    }
    this.syncLobby();
  }

  private syncLobby() {
    const l = this.lobby;
    const inc = l.incoming;
    this.set({
      online: this.transport.online,
      lobbies: [...l.lobbies.values()].filter(q => q.gid !== l.mine?.gid),
      hosting: l.mine !== null ? { gid: l.mine.gid, players: l.mine.players.slice() } : null,
      joined: l.joined !== null ? { gid: l.joined.gid, team: l.joined.team } : null,
      incoming: inc !== null ? { name: inc.name, size: inc.size, coop: inc.coop } : null,
      outgoing: l.outgoing !== null ? { name: l.outgoing.name } : null,
    });
  }

  private refreshNear() {
    const g = this.game;
    const out: { id: string; name: string }[] = [];
    for (const [id, r] of g.remotes) {
      const p = r.character.root.position;
      if (!inStadium(p.x, p.z, 30)) continue;
      out.push({ id, name: g.net.players.get(id)?.name ?? 'noun' });
    }
    const same =
      out.length === this.ui.nearPlayers.length &&
      out.every((q, i) => q.id === this.ui.nearPlayers[i].id);
    if (!same) this.set({ nearPlayers: out });
  }

  // ── The frame ──

  /** One frame while active (Game.step's football block). */
  step(dt: number) {
    const g = this.game;
    const cam = g.gfx.camera;
    perf.lap('other');
    g.stadium.update(dt, cam.position);
    perf.lap('fb-stadium');
    const view = this.view;
    if (this.input.device !== this.ui.device) this.set({ device: this.input.device });
    // Building: the stadium, then the view, then its footballers (one a frame)
    if (view === null || !view.built) {
      if (view !== null) view.buildStep();
      const sv = g.stadium.view;
      const p = view?.built === true ? 1 : sv?.built === true ? 0.6 : 0.2;
      if (Math.abs(p - this.ui.progress) > 0.05) this.set({ progress: p });
      // Hold the camera on the stadium while it builds
      const f = this.frame;
      cam.position.set(f.x - 140, f.y + 60, f.z + 30);
      cam.lookAt(f.x, f.y, f.z);
      return;
    }
    if (this.ui.phase === 'loading') {
      this.set({ phase: 'menu', progress: 1 });
      if (g.me !== null) g.me.root.visible = false;
    }
    const edges = this.input.takeEdges();
    if (edges.cam) this.cycleCam();
    if (edges.menu) {
      if (this.ui.phase === 'playing') this.setPaused(!this.ui.paused);
      else if (this.ui.phase === 'results') this.openMenu();
    }
    // The match, or the attract match behind the menu
    let fr: FootballFrame | null = null;
    let events: FootballEvent[] = [];
    const s = this.session;
    if (s !== null && this.ui.phase === 'playing') {
      cam.getWorldDirection(this.camFwd);
      const pad: PadInput | null =
        s.me !== null && !this.ui.paused
          ? this.input.sample(this.camFwd.x, this.camFwd.z, this.frame)
          : null;
      if (s.role === 'host') {
        // Local matches hold on the goal while its replay plays (the replay
        // stops when play goes live); online the match never waits
        const hold = s.kind !== 'online' && (this.ui.paused || view.replaying);
        if (!hold) {
          fr = s.host.frame(dt, pad);
          events = s.host.drainEvents();
        } else fr = this.lastFrame;
      } else {
        fr = s.client.frame(dt, pad);
        events = s.client.drainEvents();
        if (s.client.ended !== null && !this.resultsShown) this.clientEnded(s.client.ended.reason);
      }
    } else if (this.ui.phase === 'menu' || this.ui.phase === 'results') {
      if (this.attract === null && this.ui.phase === 'menu') this.startAttract();
      if (this.attract !== null) {
        fr = this.attract.frame(dt, null);
        events = this.attract.drainEvents();
      }
    }
    perf.lap('fb-sim');
    if (fr !== null) {
      this.lastFrame = fr;
      if (events.length > 0) view.events(events, fr.next);
      view.draw(fr.prev, fr.next, fr.alpha, dt);
      view.camera(cam, dt, fr.next);
      if (s !== null) for (const e of events) if (e.type === 'final') this.finalWhistle(e, fr.next);
    } else view.buildStep();
    perf.lap('fb-view');
    g.gfx.followShadow(this.focusPoint(fr));
    // Presence + lobbies
    this.announceAcc += dt;
    this.refreshAcc += dt;
    if (this.refreshAcc >= 0.5) {
      this.refreshAcc = 0;
      this.lobby.tick();
      this.refreshNear();
      this.syncLobby();
    }
    if (this.announceAcc >= ANNOUNCE_S) {
      this.announceAcc = 0;
      if (s?.role === 'host' && s.kind === 'online' && fr !== null)
        this.lobby.setLive(true, fr.next.score);
    }
  }

  private _focus = new THREE.Vector3();
  private focusPoint(fr: FootballFrame | null) {
    const f = this.frame;
    const b = fr?.next.ball;
    const c = Math.cos(f.yaw);
    const sn = Math.sin(f.yaw);
    const px = b?.x ?? 0;
    const pz = b?.z ?? 0;
    return this._focus.set(f.x + px * c + pz * sn, f.y, f.z - px * sn + pz * c);
  }

  /** Walking round (Game.step's normal path): the PLAY chip near the stadium, invites. */
  idle(dt: number) {
    this.refreshAcc += dt;
    if (this.refreshAcc < 0.5) return;
    this.refreshAcc = 0;
    const p = this.game.player.pos;
    const near = inStadium(p.x, p.z, 4);
    if (near !== this.ui.near) this.set({ near });
    this.lobby.tick();
    if (this.lobby.incoming !== null || this.ui.incoming !== null) this.syncLobby();
  }

  // ── The end ──

  private finalWhistle(e: Extract<FootballEvent, { type: 'final' }>, st: SimState) {
    if (this.resultsShown) return;
    this.resultsShown = true;
    const s = this.session!;
    const myTeam = this.ui.myTeam;
    const won = myTeam === null ? null : e.winner === null ? null : e.winner === myTeam;
    let respect: number | null = null;
    if (won === true) {
      const vsHuman = s.config.humans.some(h => h.team !== myTeam);
      const amount = vsHuman
        ? WIN_RESPECT.human
        : WIN_RESPECT[s.config.difficulty[(1 - myTeam!) as TeamId]];
      const r = (this.game as Game & { respect?: RespectApi }).respect;
      respect = r?.add({ kind: 'custom', label: 'won at football', amount }) ?? null;
    }
    let cupLine: string | undefined;
    if ((s.kind === 'cup' || s.kind === 'season') && this.ui.cup !== null && myTeam !== null) {
      const mine = st.score[myTeam];
      const theirs = st.score[(1 - myTeam) as TeamId];
      const pens = e.pens
        ? ([e.pens[myTeam], e.pens[(1 - myTeam) as TeamId]] as [number, number])
        : undefined;
      const cup = recordMine(this.ui.cup, mine, theirs, pens);
      save(CUP_KEY, cup);
      this.set({ cup });
      if (cup.done) {
        cupLine =
          cup.winner === cup.me
            ? `CHAMPIONS! ${KITS[cup.me].name.toUpperCase()} WIN THE ${cup.kind === 'cup' ? 'CUP' : 'LEAGUE'}`
            : `${KITS[cup.winner ?? 0].name.toUpperCase()} WIN IT`;
        if (cup.winner === cup.me) {
          const r = (this.game as Game & { respect?: RespectApi }).respect;
          const extra = r?.add({ kind: 'custom', label: 'won the football cup', amount: 10 }) ?? 0;
          respect = (respect ?? 0) + extra;
        }
      } else cupLine = myFixture(cup) === null ? 'KNOCKED OUT' : 'THROUGH TO THE NEXT ROUND';
    }
    if (s.role === 'host' && s.kind === 'online') this.lobby.close();
    this.set({
      phase: 'results',
      results: {
        score: [st.score[0], st.score[1]],
        pens: e.pens,
        winner: e.winner,
        won,
        names: [s.config.kits[0].name, s.config.kits[1].name],
        respect,
        reason: 'FULL TIME',
        cupLine,
      },
    });
  }

  private clientEnded(reason: string) {
    if (this.resultsShown) return;
    if (reason === 'final') return; // the final event shows the results
    this.resultsShown = true;
    const n = this.lastFrame?.next;
    const s = this.session!;
    this.set({
      phase: 'results',
      results: {
        score: n ? [n.score[0], n.score[1]] : [0, 0],
        winner: null,
        won: null,
        names: [s.config.kits[0].name, s.config.kits[1].name],
        respect: null,
        reason: reason === 'host_left' ? 'THE HOST LEFT' : 'MATCH ENDED',
      },
    });
  }

  dispose() {
    if (this.active) this.exit();
    this.lobby.dispose();
    this.transport.dispose();
    this.input.detach();
  }

  /** Dev / tests. */
  get debug() {
    return { session: this.session, attract: this.attract, frame: this.lastFrame };
  }
}

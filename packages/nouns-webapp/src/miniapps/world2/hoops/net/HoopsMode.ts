// ── Noun Hoops mode: game flow around the court + the Game.ts hook ───────
//
// Owns everything between "you're standing on the Noun Jersey court" and
// "you're back on your board": the PLAY BALL prompt, the court lobby (mode,
// difficulty, target, humans who JOIN, bots borrowed from the Jersey crew),
// challenges from anywhere (invite → teleport), host / client / spectator
// sessions (sync.ts), and restoring the skater exactly on the way out.
//
// Game.ts calls `idle(dt)` every skate frame and, while `active`, hands the
// whole frame to `step(dt)` (the skater, its camera and stats are parked
// untouched, so leaving restores them as they were).

import type { HoopsViewLike } from './stubView';
import type { Game } from '../../Game';

import * as THREE from 'three';

import { randomSeed, seedKey } from '../../character/NounAppearance';
import {
  JERSEY_COURT,
  MODE_DEFAULTS,
  NO_INPUT,
  type Baller,
  type GameConfig,
  type HoopsMsg,
  type TeamId,
  type TeamSize,
} from '../contract';

import { CourtXform, hoopsEntry } from './court';
import { createSim, createView } from './factory';
import { BallerInputReader } from './input';
import { HoopsSession, type HoopsRole } from './sync';
import { NetTransport, type HoopsTransport } from './transport';

export type HoopsPhase = 'idle' | 'lobby' | 'teleport' | 'playing' | 'results';

export interface LobbyPlayer {
  id: string;
  name: string;
  team: TeamId;
  seedKey?: string;
}

export interface HoopsUiState {
  phase: HoopsPhase;
  /** On the court with nothing open: what E / tap does. */
  prompt:
    | null
    | { kind: 'play' }
    | { kind: 'join' | 'watch'; gid: string; hostName: string; size: TeamSize };
  lobby: null | {
    gid: string;
    mine: boolean;
    joined: boolean;
    hostName: string;
    size: TeamSize;
    difficulty: 1 | 2 | 3;
    target: number;
    players: LobbyPlayer[];
  };
  invite: null | { gid: string; from: string; fromName: string; size: TeamSize; at: number };
  challenge: null | {
    gid: string;
    to: string;
    toName: string;
    size: TeamSize;
    at: number;
    status: 'waiting' | 'declined' | 'timeout';
  };
  role: HoopsRole | null;
  teleport: string | null;
  results: null | {
    score: [number, number];
    winner: TeamId;
    myTeam: TeamId | null;
    mvp: { name: string; points: number } | null;
    host: boolean;
    waiting: boolean;
  };
  toast: { text: string; at: number } | null;
  /** Debug: last snapshot size (bytes, JSON). */
  snapBytes: number;
  /** This world has the Noun Jersey court (challenges need it). */
  hasCourt: boolean;
}

const INVITE_S = 20;
const LOBBY_EVERY = 2;
const FALLBACK_NAMES = [
  'Swish',
  'Brick',
  'Dime',
  'Glass',
  'Splash',
  'Hops',
  'Euro',
  'Board Man',
  'And-One',
  'Fadeaway',
];

const gidNew = () => Math.random().toString(36).slice(2, 10);

export class HoopsMode {
  ui: HoopsUiState = {
    phase: 'idle',
    prompt: null,
    lobby: null,
    invite: null,
    challenge: null,
    role: null,
    teleport: null,
    results: null,
    toast: null,
    snapBytes: 0,
    hasCourt: false,
  };
  /** Where the world streams around while active (court / my baller). */
  readonly focus = new THREE.Vector3();
  readonly focusVel = new THREE.Vector3();
  readonly reader = new BallerInputReader();
  session: HoopsSession | null = null;
  view: HoopsViewLike | null = null;
  court: CourtXform | null = null;
  /** DOM layer for the view's HUD (HoopsUi mounts it). */
  hudLayer: HTMLElement | null = null;
  readonly transport: HoopsTransport;

  private listeners = new Set<() => void>();
  private remoteLobbies = new Map<
    string,
    { m: Extract<HoopsMsg, { type: 'hoops:lobby' }>; at: number }
  >();
  /** A `hoops:start` from this host is expected (joined / accepted / watching / rematch). */
  private expect: { host: string; watch?: string } | null = null;
  private saved: {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    fov: number;
    meVisible: boolean;
  } | null = null;
  private lobbyAcc = 0;
  private teleportT = 0;
  private teleportAt = 0;
  private gid = '';
  private hostId = '';
  private config: GameConfig | null = null;
  private v = new THREE.Vector3();
  private escOff: (() => void) | null = null;
  /** `?play=hoops`: open the lobby the first time we're standing on the court. */
  private entry = typeof window === 'undefined' ? null : hoopsEntry();

  constructor(
    private game: Game,
    transport?: HoopsTransport,
  ) {
    this.transport = transport ?? new NetTransport(game.net, false);
    this.transport.onMessage = m => this.onMessage(m);
  }

  // ── Store (React reads `ui`) ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<HoopsUiState>) {
    this.ui = { ...this.ui, ...p };
    for (const l of this.listeners) l();
  }

  private toast(text: string) {
    this.set({ toast: { text, at: performance.now() } });
  }

  /** True while hoops owns the frame (Game.step hands over). */
  get active() {
    return (
      this.ui.phase === 'teleport' || this.ui.phase === 'playing' || this.ui.phase === 'results'
    );
  }

  private get myId() {
    return this.transport.id;
  }

  private ensureCourt() {
    if (this.court === null && this.game.mountain !== null) this.court = CourtXform.current();
    if (this.court !== null && !this.ui.hasCourt) this.set({ hasCourt: true });
    return this.court;
  }

  // ── Skating: prompt, lobby presence, invite timeouts ──

  idle(dt: number) {
    const now = performance.now();
    const court = this.ensureCourt();
    for (const [gid, l] of this.remoteLobbies)
      if (now - l.at > 6000) this.remoteLobbies.delete(gid);
    let prompt: HoopsUiState['prompt'] = null;
    if (court !== null && this.ui.phase === 'idle') {
      const p = this.game.player.pos;
      if (court.onCourt(p.x, p.y, p.z)) {
        const l = [...this.remoteLobbies.values()].find(q => q.m.open);
        prompt =
          l !== undefined
            ? {
                kind: l.m.live ? 'watch' : 'join',
                gid: l.m.gid,
                hostName: l.m.hostName,
                size: l.m.size,
              }
            : { kind: 'play' };
      }
    }
    if (JSON.stringify(prompt) !== JSON.stringify(this.ui.prompt)) this.set({ prompt });
    if (this.entry !== null && prompt !== null) {
      const size = this.entry.size;
      this.entry = null;
      // Someone's lobby is already open on the court: show theirs instead
      if (prompt.kind === 'play') {
        this.openLobby();
        this.setMode(size);
      } else if (prompt.kind === 'join') this.promptAction();
    }
    const inv = this.ui.invite;
    if (inv && now - inv.at > INVITE_S * 1000) this.declineInvite();
    const ch = this.ui.challenge;
    if (ch && ch.status === 'waiting' && now - ch.at > INVITE_S * 1000)
      this.set({ challenge: { ...ch, status: 'timeout' } });
    if (ch && ch.status !== 'waiting' && now - ch.at > (INVITE_S + 4) * 1000)
      this.set({ challenge: null });
    if (this.ui.lobby?.mine === true) this.tickLobby(dt, false);
    // Accepted, but the host never started (gone / busy)
    if (this.ui.teleport !== null && this.ui.phase === 'idle' && now - this.teleportAt > 8000) {
      this.expect = null;
      this.set({ teleport: null });
      this.toast('the game fell through');
    }
  }

  private tickLobby(dt: number, live: boolean) {
    this.lobbyAcc += dt;
    if (this.lobbyAcc < LOBBY_EVERY) return;
    this.lobbyAcc = 0;
    this.announce(live, true);
  }

  private announce(live: boolean, open: boolean) {
    const l = this.ui.lobby;
    const cfg = this.config;
    if (!this.transport.online) return;
    const players: LobbyPlayer[] =
      live && cfg
        ? cfg.players.filter(p => !p.bot).map(p => ({ id: p.id, name: p.name, team: p.team }))
        : (l?.players ?? []).map(p => ({ id: p.id, name: p.name, team: p.team }));
    this.transport.send({
      type: 'hoops:lobby',
      gid: live ? this.gid : (l?.gid ?? this.gid),
      host: this.myId,
      hostName: this.game.name,
      size: (live ? cfg?.size : l?.size) ?? 1,
      target: (live ? cfg?.target : l?.target) ?? 11,
      live,
      players,
      open,
    });
  }

  /** E / tap on the prompt. */
  promptAction() {
    const p = this.ui.prompt;
    if (p === null) return;
    if (p.kind === 'play') this.openLobby();
    else if (p.kind === 'join') this.openRemoteLobby(p.gid);
    else this.watch(p.gid);
  }

  // ── Lobby (host side) ──

  openLobby() {
    if (this.ensureCourt() === null || this.ui.phase !== 'idle') return;
    const size: TeamSize = 1;
    this.lobbyAcc = LOBBY_EVERY;
    this.set({
      phase: 'lobby',
      prompt: null,
      lobby: {
        gid: gidNew(),
        mine: true,
        joined: true,
        hostName: this.game.name,
        size,
        difficulty: 2,
        target: MODE_DEFAULTS[size].target,
        players: [
          { id: this.myId, name: this.game.name, team: 0, seedKey: seedKey(this.game.seed) },
        ],
      },
    });
  }

  setMode(size: TeamSize) {
    const l = this.ui.lobby;
    if (l?.mine !== true) return;
    const players = l.players.slice(0, size * 2);
    this.set({
      lobby: { ...l, size, target: MODE_DEFAULTS[size].target, players: balance(players, size) },
    });
    this.lobbyAcc = LOBBY_EVERY;
  }

  setDifficulty(difficulty: 1 | 2 | 3) {
    const l = this.ui.lobby;
    if (l?.mine === true) this.set({ lobby: { ...l, difficulty } });
  }

  setTarget(target: number) {
    const l = this.ui.lobby;
    if (l?.mine === true)
      this.set({ lobby: { ...l, target: Math.max(3, Math.min(51, Math.round(target))) } });
    this.lobbyAcc = LOBBY_EVERY;
  }

  /** Swap a lobby player to the other team (host). */
  swapTeam(id: string) {
    const l = this.ui.lobby;
    if (l?.mine !== true) return;
    const players = l.players.map(p => (p.id === id ? { ...p, team: (1 - p.team) as TeamId } : p));
    if (
      players.filter(p => p.team === 0).length > l.size ||
      players.filter(p => p.team === 1).length > l.size
    )
      return;
    this.set({ lobby: { ...l, players } });
    this.lobbyAcc = LOBBY_EVERY;
  }

  cancelLobby() {
    const l = this.ui.lobby;
    if (l === null) return;
    if (l.mine) this.announce(false, false);
    else if (l.joined) this.sendJoin(l.gid, true);
    this.expect = null;
    this.set({ phase: 'idle', lobby: null });
  }

  /** START: humans from the lobby, the rest borrowed from the Jersey crew. */
  startLobby() {
    const l = this.ui.lobby;
    if (l?.mine !== true) return;
    const humans = l.players.map(p => ({ ...p }));
    this.gid = l.gid;
    this.begin(this.buildConfig(l.size, humans, l.difficulty, l.target), false);
  }

  private buildConfig(
    size: TeamSize,
    humans: LobbyPlayer[],
    difficulty: 1 | 2 | 3,
    target: number,
  ): GameConfig {
    const seed = (Math.random() * 2 ** 31) | 0;
    const players: Baller[] = humans.map(h => ({
      id: h.id,
      team: h.team,
      bot: false,
      name: h.name || 'noun',
      seedKey: h.seedKey ?? this.seedOf(h.id),
      ratings: { speed: 0.6, shooting: 0.6, dunking: 0.6, defense: 0.6, passing: 0.6 },
    }));
    const need = size * 2 - players.length;
    this.game.crew?.giveBack();
    const crew = this.game.crew?.borrow(need) ?? [];
    let r = seed;
    const rnd = () => {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      return r / 0x7fffffff;
    };
    for (let i = 0; i < need; i++) {
      const team: TeamId = players.filter(p => p.team === 0).length < size ? 0 : 1;
      const c = crew[i];
      players.push({
        id: `bot:${i}`,
        team,
        bot: true,
        name: c?.name ?? FALLBACK_NAMES[i % FALLBACK_NAMES.length],
        seedKey: seedKey(c?.seed ?? randomSeed()),
        ratings: {
          speed: 0.4 + rnd() * 0.5,
          shooting: 0.4 + rnd() * 0.5,
          dunking: 0.3 + rnd() * 0.6,
          defense: 0.4 + rnd() * 0.5,
          passing: 0.4 + rnd() * 0.5,
        },
      });
    }
    return {
      ...MODE_DEFAULTS[size],
      target,
      difficulty,
      seed,
      players,
      court: JERSEY_COURT,
    };
  }

  private seedOf(id: string) {
    if (id === this.myId) return seedKey(this.game.seed);
    return this.game.net.players.get(id)?.seedKey ?? seedKey(randomSeed());
  }

  /** Host: announce the game and go. */
  private begin(config: GameConfig, teleport: boolean) {
    this.config = config;
    this.transport.send({ type: 'hoops:start', gid: this.gid, host: this.myId, config });
    this.enter(config, 'host', this.myId, teleport);
    this.announce(true, true);
  }

  // ── Lobby (guest side) ──

  private openRemoteLobby(gid: string) {
    const l = this.remoteLobbies.get(gid)?.m;
    if (!l) return;
    this.set({
      phase: 'lobby',
      prompt: null,
      lobby: {
        gid,
        mine: false,
        joined: false,
        hostName: l.hostName,
        size: l.size,
        difficulty: 2,
        target: l.target,
        players: l.players,
      },
    });
  }

  joinLobby() {
    const l = this.ui.lobby;
    if (!l || l.mine) return;
    const host = this.remoteLobbies.get(l.gid)?.m.host;
    if (!host) return;
    this.expect = { host };
    this.sendJoin(l.gid, false);
    this.set({ lobby: { ...l, joined: true } });
  }

  private sendJoin(gid: string, leave: boolean) {
    const host = this.remoteLobbies.get(gid)?.m.host;
    if (!host) return;
    this.transport.send({
      type: 'hoops:join',
      gid,
      from: this.myId,
      to: host,
      name: this.game.name,
      seedKey: seedKey(this.game.seed),
      ...(leave ? { leave: true } : {}),
    });
  }

  watch(gid: string) {
    const l = this.remoteLobbies.get(gid)?.m;
    if (!l || this.ensureCourt() === null) return;
    this.expect = { host: l.host, watch: gid };
    this.transport.send({ type: 'hoops:watch', gid, from: this.myId });
    this.toast(`watching ${l.hostName}'s game…`);
  }

  // ── Challenges ──

  challenge(to: string, size: TeamSize = 1) {
    if (this.ensureCourt() === null || this.ui.phase !== 'idle' || !this.transport.online) return;
    const gid = gidNew();
    const toName = this.game.net.players.get(to)?.name || 'noun';
    this.set({ challenge: { gid, to, toName, size, at: performance.now(), status: 'waiting' } });
    this.transport.send({
      type: 'hoops:challenge',
      gid,
      from: this.myId,
      to,
      size,
      fromName: this.game.name,
    });
  }

  cancelChallenge() {
    this.set({ challenge: null });
  }

  acceptInvite() {
    const inv = this.ui.invite;
    if (!inv) return;
    if (this.ensureCourt() === null) {
      this.declineInvite();
      return;
    }
    this.expect = { host: inv.from };
    this.transport.send({
      type: 'hoops:reply',
      gid: inv.gid,
      from: this.myId,
      to: inv.from,
      accept: true,
    });
    this.teleportAt = performance.now();
    this.set({ invite: null, teleport: 'teleporting to Noun Jersey…' });
  }

  declineInvite() {
    const inv = this.ui.invite;
    if (!inv) return;
    this.transport.send({
      type: 'hoops:reply',
      gid: inv.gid,
      from: this.myId,
      to: inv.from,
      accept: false,
    });
    this.set({ invite: null });
  }

  // ── Messages ──

  onMessage(m: HoopsMsg) {
    switch (m.type) {
      case 'hoops:lobby': {
        if (m.host === this.myId) return;
        if (m.open) this.remoteLobbies.set(m.gid, { m, at: performance.now() });
        else this.remoteLobbies.delete(m.gid);
        const l = this.ui.lobby;
        if (l && !l.mine && l.gid === m.gid) {
          if (!m.open) {
            this.expect = null;
            this.set({ phase: 'idle', lobby: null });
            this.toast('lobby closed');
          } else this.set({ lobby: { ...l, players: m.players, size: m.size, target: m.target } });
        }
        return;
      }
      case 'hoops:join': {
        const l = this.ui.lobby;
        if (l?.mine !== true || l.gid !== m.gid || this.ui.phase !== 'lobby') return;
        let players = l.players.filter(p => p.id !== m.from);
        if (m.leave !== true) {
          if (players.length >= l.size * 2) return;
          const t0 = players.filter(p => p.team === 0).length;
          players = [
            ...players,
            {
              id: m.from,
              name: String(m.name).slice(0, 24) || 'noun',
              team: t0 <= players.length - t0 && t0 < l.size ? 0 : 1,
              seedKey: typeof m.seedKey === 'string' ? m.seedKey.slice(0, 40) : undefined,
            },
          ];
        }
        this.set({ lobby: { ...l, players } });
        this.announce(false, true);
        return;
      }
      case 'hoops:challenge': {
        const busy =
          this.ui.phase !== 'idle' || this.ui.invite !== null || this.ensureCourt() === null;
        if (busy) {
          this.transport.send({
            type: 'hoops:reply',
            gid: m.gid,
            from: this.myId,
            to: m.from,
            accept: false,
          });
          return;
        }
        const size = ([1, 2, 3, 5] as const).includes(m.size) ? m.size : 1;
        this.set({
          invite: {
            gid: m.gid,
            from: m.from,
            fromName: String(m.fromName).slice(0, 24) || 'noun',
            size,
            at: performance.now(),
          },
        });
        return;
      }
      case 'hoops:reply': {
        const ch = this.ui.challenge;
        if (!ch || ch.gid !== m.gid || ch.status !== 'waiting') return;
        if (!m.accept) {
          this.set({ challenge: { ...ch, status: 'declined', at: performance.now() } });
          return;
        }
        if (this.ui.phase !== 'idle') return;
        this.set({ challenge: null, teleport: 'teleporting to Noun Jersey…' });
        this.gid = ch.gid;
        const humans: LobbyPlayer[] = [
          { id: this.myId, name: this.game.name, team: 0 },
          { id: ch.to, name: ch.toName, team: 1 },
        ];
        this.begin(this.buildConfig(ch.size, humans, 2, MODE_DEFAULTS[ch.size].target), true);
        return;
      }
      case 'hoops:start': {
        const ex = this.expect;
        if (!ex || ex.host !== m.host) return;
        if (this.session !== null && this.ui.phase !== 'results') return;
        const watching = ex.watch === m.gid && m.to === this.myId;
        const mine = m.config.players.some(p => p.id === this.myId && !p.bot);
        if (!watching && !mine) return;
        this.gid = m.gid;
        this.config = m.config;
        if (this.session !== null) this.teardown();
        const teleport = this.ui.teleport !== null;
        this.set({ lobby: null });
        this.enter(m.config, watching && !mine ? 'spectator' : 'client', m.host, teleport);
        return;
      }
      case 'hoops:watch': {
        if (this.session?.role !== 'host' || m.gid !== this.gid || !this.config) return;
        this.transport.send({
          type: 'hoops:start',
          gid: this.gid,
          host: this.myId,
          config: this.config,
          to: m.from,
        });
        return;
      }
      case 'hoops:leave': {
        const l = this.ui.lobby;
        if (l?.mine === true && l.gid === m.gid) {
          this.set({ lobby: { ...l, players: l.players.filter(p => p.id !== m.id) } });
        }
        this.session?.onMessage(m);
        return;
      }
      default:
        this.session?.onMessage(m);
    }
  }

  // ── In and out ──

  private enter(config: GameConfig, role: HoopsRole, hostId: string, teleport: boolean) {
    const court = this.ensureCourt();
    if (court === null) return;
    const g = this.game;
    this.hostId = hostId;
    this.config = config;
    if (this.saved === null) {
      const cam = g.gfx.camera;
      this.saved = {
        pos: cam.position.clone(),
        quat: cam.quaternion.clone(),
        fov: cam.fov,
        meVisible: g.me?.root.visible ?? true,
      };
    }
    if (g.me) g.me.root.visible = false;
    this.reader.attach();
    const me = role === 'spectator' ? null : this.myId;
    this.session = new HoopsSession({
      gid: this.gid,
      config,
      role,
      me,
      hostId,
      send: m => this.transport.send(m),
      makeSim: createSim,
    });
    court.toWorld(0, 0, 0, this.focus);
    if (teleport) g.mountain?.prime(this.focus);
    if (this.hudLayer !== null)
      this.view = createView({
        scene: g.gfx.scene,
        camera: g.gfx.camera,
        canvas: g.gfx.renderer.domElement,
        hudLayer: this.hudLayer,
        court,
        config,
        me,
        assets: g.assets,
        toon: g.gfx.toon,
        touch: this.reader.touch,
        audio: g.audio.ctx,
      });
    this.teleportT = teleport ? 1.4 : 0;
    this.lobbyAcc = 0;
    if (this.escOff === null) {
      const esc = (e: KeyboardEvent) => {
        if (e.code !== 'Escape' || this.ui.phase !== 'playing') return;
        this.forfeit();
      };
      window.addEventListener('keydown', esc);
      this.escOff = () => window.removeEventListener('keydown', esc);
    }
    this.set({
      phase: teleport ? 'teleport' : 'playing',
      teleport: teleport ? 'teleporting to Noun Jersey…' : null,
      prompt: null,
      lobby: null,
      role,
      results: null,
      challenge: null,
    });
  }

  /** One frame while active (Game.step's hoops block). */
  step(dt: number) {
    const s = this.session;
    if (s === null) return;
    const g = this.game;
    if (this.ui.phase === 'teleport') {
      this.teleportT -= dt;
      if (this.teleportT <= 0) this.set({ phase: 'playing', teleport: null });
    }
    const playing = this.ui.phase === 'playing';
    g.gfx.camera.getWorldDirection(this.v);
    const input = playing ? this.reader.sample(this.v.x, this.v.z, this.court) : NO_INPUT;
    if (playing) s.update(dt, input);
    const st = s.render();
    if (st !== null) {
      this.view?.update(dt, st, s.drainEvents());
      const me = st.players.find(p => p.id === s.me);
      if (me && this.court) this.court.toWorld(me.x, me.y, me.z, this.focus);
    }
    if (s.role === 'host' && playing) this.tickLobby(dt, true);
    if (s.stats.snapBytes !== this.ui.snapBytes)
      this.ui = { ...this.ui, snapBytes: s.stats.snapBytes };
    if (playing && s.hostLeft) {
      this.exit();
      this.toast('host left: back to skating');
      return;
    }
    if (playing && s.ended !== null) this.showResults();
  }

  private showResults() {
    const s = this.session!;
    const myTeam = s.config.players.find(p => p.id === s.me)?.team ?? null;
    const mvp = s.mvp();
    if (s.role === 'host') this.announce(false, false);
    this.set({
      phase: 'results',
      results: {
        score: s.ended!.score,
        winner: s.ended!.winner,
        myTeam,
        mvp: mvp ? { name: mvp.name, points: mvp.points } : null,
        host: s.role === 'host',
        waiting: false,
      },
    });
  }

  /** Results → rematch: the host restarts with the same humans, others wait for it. */
  playAgain() {
    const s = this.session;
    const r = this.ui.results;
    if (!s || !r) return;
    if (s.role !== 'host') {
      this.expect = { host: this.hostId };
      this.set({ results: { ...r, waiting: true } });
      return;
    }
    const humans = s.config.players
      .filter(
        p =>
          !p.bot &&
          (p.id === this.myId || this.game.net.players.has(p.id) || !this.transport.online),
      )
      .map(p => ({ id: p.id, name: p.name, team: p.team, seedKey: p.seedKey }));
    const cfg = this.buildConfig(s.config.size, humans, s.config.difficulty ?? 2, s.config.target);
    this.teardown();
    this.gid = gidNew();
    this.begin(cfg, false);
  }

  /** Forfeit (Esc / button): leave the game now. */
  forfeit() {
    this.backToSkating();
  }

  backToSkating() {
    const s = this.session;
    if (s && !s.over) s.leave();
    else if (s?.role === 'host')
      this.transport.send({ type: 'hoops:leave', gid: this.gid, id: this.myId });
    this.exit();
  }

  private teardown() {
    this.view?.dispose();
    this.view = null;
    this.session = null;
  }

  /** Back to skating, exactly as before: camera, rider, crew. */
  exit() {
    const g = this.game;
    if (this.ui.lobby?.mine === true || this.session?.role === 'host') this.announce(false, false);
    this.teardown();
    this.reader.detach();
    this.escOff?.();
    this.escOff = null;
    const sv = this.saved;
    if (sv !== null) {
      const cam = g.gfx.camera;
      cam.position.copy(sv.pos);
      cam.quaternion.copy(sv.quat);
      if (cam.fov !== sv.fov) {
        cam.fov = sv.fov;
        cam.updateProjectionMatrix();
      }
      if (g.me) g.me.root.visible = sv.meVisible;
    }
    this.saved = null;
    // Teleported in from afar: stream the world back in around the skater
    if (g.mountain !== null && this.focus.distanceTo(g.player.pos) > 150)
      g.mountain.prime(g.player.pos);
    g.crew?.giveBack();
    this.expect = null;
    this.config = null;
    this.set({ phase: 'idle', role: null, results: null, teleport: null, lobby: null });
  }

  dispose() {
    if (this.active) this.exit();
  }
}

/** Keep each team at most `size` (overflow moves across). */
function balance(players: LobbyPlayer[], size: number): LobbyPlayer[] {
  const out = players.map(p => ({ ...p }));
  for (const t of [0, 1] as TeamId[]) {
    const mine = out.filter(p => p.team === t);
    for (const p of mine.slice(size)) p.team = (1 - t) as TeamId;
  }
  return out;
}

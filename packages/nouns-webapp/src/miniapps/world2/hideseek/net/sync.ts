// ── HideSeekSession: one game's rules + host-authoritative sync ──────────
//
// No three.js, no DOM: unit-tested over a loopback running the real relay
// (sync.test.ts). The scheme:
//
//   The host runs the rules (rules.ts) and the CPU players (bots.ts) on its
//   own frame clock, and sends `hideseek:s` (the snapshot: phase, round,
//   seconds left, everyone's standing, scores, lit doors, CPU poses and the
//   events since the last one) to the players SNAP_HZ times a second. It
//   applies the same snapshot to itself, so host and clients show the game
//   through one code path.
//
//   Players move themselves (the normal game, positions on `world:move`).
//   The host decides everything else. A player asks with `hideseek:act`
//   (tag {target} / whistle / ping); the host checks a tag against ITS view
//   of where both players are (rules.checkTag: reach + a clear line on the
//   host's own collision world), so a client can't tag from across the map
//   or through a wall, and the relay rewrites `from` so nobody can act as
//   someone else.
//
//   Clients count the clock down between snapshots and draw the CPU players
//   INTERP_MS behind, between the two snapshots around that moment.
//
//   A player dropping (the relay's `hideseek:leave {id}`): out of the game;
//   no seekers left → the host makes a random hider the seeker (rules.drop).
//   The host leaving (or going quiet for HOST_LOST_MS) ends the game for
//   everyone.

import type {
  HsAct,
  HsBotPose,
  HsConfig,
  HsEvent,
  HsMsg,
  HsPhase,
  HsSnap,
  HsSpot,
  HsStanding,
} from '../contract';
import type { NavGrid } from '../nav';
import type { Door, HsWorld, Vec } from '../rules';

import { makeBot, resetBot, thinkBot, type Bot, type BotSeen } from '../bots';
import { BOT_ANIMS } from '../contract';
import { hideSpots } from '../nav';
import {
  checkDoor,
  drop,
  newGame,
  ping,
  snapshot,
  step,
  tag,
  whistle,
  type HsState,
} from '../rules';

export type HsRoleNet = 'host' | 'client';

export const SNAP_HZ = 5;
export const INTERP_MS = 220;
export const HOST_LOST_MS = 12_000;

export interface SessionDeps {
  config: HsConfig;
  role: HsRoleNet;
  me: string;
  hostId: string;
  send(m: HsMsg): void;
  /** Humans' positions (me: my player; others: the room's interpolated poses). */
  pos(id: string): Vec | null;
  los(a: Vec, b: Vec): boolean;
  /** The building a position is inside. */
  door(p: Vec): Door | null;
  /** A human hider crouched still (blending). */
  blending(id: string): boolean;
  /** The host's height grid (null until built): CPU players need it. */
  grid(): NavGrid | null;
  /** Where rounds start (the lobby spot) and each player's slot in the ring. */
  slot(i: number, n: number): { x: number; y: number; z: number; yaw: number };
  lobby: Vec;
  now(): number;
}

export interface HsView {
  phase: HsPhase;
  round: number;
  /** Seconds left in the phase (counted down locally between snapshots). */
  t: number;
  st: Map<string, HsStanding>;
  scores: Map<string, number>;
  lit: Door[];
  reveal: HsSpot[] | null;
  win: 'hiders' | 'seekers' | null;
  /** My ping cooldown (s), when I'm seeking. */
  pingCd: number;
}

interface BotSnap {
  at: number;
  poses: Map<string, HsBotPose>;
}

export class HideSeekSession {
  readonly config: HsConfig;
  readonly role: HsRoleNet;
  readonly me: string;
  readonly hostId: string;
  view: HsView;
  /** Null while playing; why it stopped otherwise. */
  ended: null | 'over' | 'hostLeft' | 'hostLost' = null;
  /** Events as they arrive (the Mode turns them into sounds and toasts). */
  onEvent: ((e: HsEvent) => void) | null = null;
  /** Host only: the rules and the CPU players. */
  state: HsState | null = null;
  bots = new Map<string, Bot>();
  stats = { snaps: 0, snapBytes: 0, rejected: 0 };

  private snapAcc = 0;
  private lastSnapAt: number;
  private lastPhaseKey = '';
  private botSnaps: BotSnap[] = [];
  private sounds: { id: string; pos: Vec; kind: 'whistle' | 'ping'; by?: string; at: number }[] =
    [];
  private time = 0;
  private spots: ReturnType<typeof hideSpots> | null = null;
  private spotsOf: NavGrid | null = null;

  constructor(private d: SessionDeps) {
    this.config = d.config;
    this.role = d.role;
    this.me = d.me;
    this.hostId = d.hostId;
    this.lastSnapAt = d.now();
    this.view = {
      phase: 'hide',
      round: 0,
      t: d.config.hideS,
      st: new Map(),
      scores: new Map(),
      lit: [],
      reveal: null,
      win: null,
      pingCd: 0,
    };
    if (d.role === 'host') {
      this.state = newGame(d.config);
      const n = d.config.players.length;
      d.config.players.forEach((p, i) => {
        if (!p.cpu) return;
        const s = d.slot(i, n);
        this.bots.set(p.id, makeBot(p.id, s, s.yaw, d.config.seed ^ (i * 7919)));
      });
      this.publish();
    }
  }

  /** The world as the rules see it: CPU players from the bots, humans from the room. */
  readonly world: HsWorld = {
    pos: id => {
      const b = this.bots.get(id);
      return b !== undefined ? b.pos : this.d.pos(id);
    },
    los: (a, b) => this.d.los(a, b),
    door: p => this.d.door(p),
  };

  myStanding(): HsStanding | null {
    return this.view.st.get(this.me) ?? null;
  }

  // ── The frame ──

  update(dt: number) {
    if (this.ended !== null) return;
    this.time += dt;
    this.view.t = Math.max(0, this.view.t - dt);
    if (this.view.pingCd > 0) this.view.pingCd = Math.max(0, this.view.pingCd - dt);
    const now = this.d.now();
    this.sounds = this.sounds.filter(s => now - s.at < 3000);
    if (this.role === 'client') {
      if (now - this.lastSnapAt > HOST_LOST_MS) this.ended = 'hostLost';
      return;
    }
    const s = this.state!;
    this.stepBots(dt);
    step(s, dt, this.world);
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ || s.events.length > 0) {
      this.snapAcc = 0;
      this.publish();
    }
  }

  private publish() {
    const s = this.state!;
    const bots: HsBotPose[] = [];
    for (const b of this.bots.values()) {
      if (!s.players.has(b.id)) continue;
      bots.push([
        b.id,
        Math.round(b.pos.x * 100) / 100,
        Math.round(b.pos.y * 100) / 100,
        Math.round(b.pos.z * 100) / 100,
        Math.round(b.yaw * 100) / 100,
        Math.max(0, BOT_ANIMS.indexOf(b.anim)),
      ]);
    }
    const snap: HsSnap = { ...snapshot(s), bots };
    const m: HsMsg = { type: 'hideseek:s', gid: this.config.gid, s: snap };
    this.d.send(m);
    this.stats.snaps++;
    this.stats.snapBytes = JSON.stringify(m).length;
    this.apply(snap);
  }

  // ── CPU players (host) ──

  private stepBots(dt: number) {
    const s = this.state!;
    const grid = this.d.grid();
    if (grid === null || this.bots.size === 0) return;
    if (this.spotsOf !== grid) {
      this.spots = hideSpots(grid);
      this.spotsOf = grid;
    }
    if (s.phase !== 'hide' && s.phase !== 'seek') return;
    const players: BotSeen[] = [];
    for (const p of s.players.values()) {
      const pos = this.world.pos(p.id);
      if (pos === null) continue;
      const b = this.bots.get(p.id);
      players.push({
        id: p.id,
        pos,
        st: p.st,
        blending:
          b !== undefined ? b.mode === 'hidden' && b.path.length === 0 : this.d.blending(p.id),
      });
    }
    const lit = [...s.lit.values()];
    for (const b of this.bots.values()) {
      if (!s.players.has(b.id)) continue;
      const acts = thinkBot(b, dt, {
        grid,
        spots: this.spots!,
        lobby: this.d.lobby,
        phase: s.phase,
        time: this.time,
        skill: this.config.skill,
        players,
        los: (a, c) => this.d.los(a, c),
        lit,
        canPing: id => (s.players.get(id)?.pingCd ?? 1) <= 0,
        sounds: this.sounds,
      });
      for (const a of acts) {
        if (a.a === 'tag') tag(s, a.by, a.id, this.world);
        else if (a.a === 'door') checkDoor(s, a.by, a.door, this.world);
        else if (a.a === 'whistle') whistle(s, a.id);
        else if (a.a === 'ping') ping(s, a.by);
      }
    }
  }

  // ── Asking the host ──

  /** Tag / whistle / ping: the host decides. */
  act(a: HsAct, target?: string) {
    if (this.ended !== null) return;
    if (this.role === 'host') this.hostAct(this.me, a, target);
    else
      this.d.send({ type: 'hideseek:act', gid: this.config.gid, a, ...(target ? { target } : {}) });
  }

  private hostAct(from: string, a: HsAct, target?: string) {
    const s = this.state!;
    let ok = false;
    if (a === 'tag' && target !== undefined) ok = tag(s, from, target, this.world) === 'ok';
    else if (a === 'whistle') ok = whistle(s, from);
    else if (a === 'ping') ok = ping(s, from) !== null;
    if (!ok) this.stats.rejected++;
    if (s.events.length > 0) this.publish();
  }

  // ── Messages ──

  onMessage(m: HsMsg) {
    if (this.ended !== null) return;
    switch (m.type) {
      case 'hideseek:s':
        if (this.role !== 'client' || m.gid !== this.config.gid) return;
        this.lastSnapAt = this.d.now();
        this.apply(m.s);
        return;
      case 'hideseek:act':
        if (this.role !== 'host' || m.gid !== this.config.gid || m.from === undefined) return;
        if (!this.state!.players.has(m.from)) return;
        this.hostAct(m.from, m.a, m.target);
        return;
      case 'hideseek:leave':
        if (m.gid !== this.config.gid || m.id === undefined) return;
        if (m.id === this.hostId) {
          if (this.role === 'client') this.ended = 'hostLeft';
          return;
        }
        if (this.role === 'host') {
          drop(this.state!, m.id, this.world);
          this.publish();
        }
        return;
      case 'hideseek:end':
        if (this.role === 'client' && m.gid === this.config.gid) this.ended = 'hostLeft';
        return;
      default:
        return;
    }
  }

  /** A snapshot (the host's own, or one that arrived) into the view. */
  private apply(snap: HsSnap) {
    const v = this.view;
    v.phase = snap.ph;
    v.round = snap.r;
    v.t = snap.t;
    v.st = new Map(snap.st);
    v.scores = new Map(snap.sc);
    v.lit = snap.bc.map(([id, x, z]) => ({ id, x, z }));
    v.win = snap.win ?? null;
    v.reveal = snap.rv ?? null;
    const cd = snap.cd?.find(([id]) => id === this.me);
    if (cd !== undefined) v.pingCd = cd[1];
    const now = this.d.now();
    this.botSnaps.push({ at: now, poses: new Map(snap.bots.map(b => [b[0], b])) });
    if (this.botSnaps.length > 6) this.botSnaps.shift();
    const key = `${snap.r}:${snap.ph}`;
    if (key !== this.lastPhaseKey) {
      this.lastPhaseKey = key;
      if (snap.ph === 'hide' && this.role === 'host') this.resetBots();
    }
    for (const e of snap.ev) {
      if (e.k === 'whistle' || e.k === 'ping') {
        const p = this.world.pos(e.id);
        if (p !== null)
          this.sounds.unshift({
            id: e.id,
            pos: { ...p },
            kind: e.k,
            by: e.k === 'ping' ? e.by : undefined,
            at: now,
          });
      }
      this.onEvent?.(e);
    }
    if (snap.ph === 'over' && this.ended === null) this.ended = 'over';
  }

  private resetBots() {
    const n = this.config.players.length;
    this.config.players.forEach((p, i) => {
      const b = this.bots.get(p.id);
      if (b === undefined) return;
      const s = this.d.slot(i, n);
      resetBot(b, s, s.yaw);
    });
  }

  /** CPU poses to draw now (interpolated INTERP_MS back). */
  botPoses(): { id: string; x: number; y: number; z: number; yaw: number; anim: string }[] {
    const snaps = this.botSnaps;
    if (snaps.length === 0) return [];
    const t = this.d.now() - (this.role === 'host' ? 0 : INTERP_MS);
    let a = snaps[0]!;
    let b = snaps[snaps.length - 1]!;
    for (let i = 0; i < snaps.length - 1; i++)
      if (snaps[i]!.at <= t && snaps[i + 1]!.at >= t) {
        a = snaps[i]!;
        b = snaps[i + 1]!;
        break;
      }
    if (this.role === 'host') {
      // The host draws its own bots as they are
      return [...this.bots.values()]
        .filter(x => this.view.st.has(x.id))
        .map(x => ({ id: x.id, x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw, anim: x.anim }));
    }
    const k = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 1;
    const out: { id: string; x: number; y: number; z: number; yaw: number; anim: string }[] = [];
    for (const [id, pb] of b.poses) {
      const pa = a.poses.get(id) ?? pb;
      let dy = pb[4] - pa[4];
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      out.push({
        id,
        x: pa[1] + (pb[1] - pa[1]) * k,
        y: pa[2] + (pb[2] - pa[2]) * k,
        z: pa[3] + (pb[3] - pa[3]) * k,
        yaw: pa[4] + dy * k,
        anim: BOT_ANIMS[pb[5]] ?? 'idle',
      });
    }
    return out;
  }

  /** Esc / leave: out of the game (the host leaving ends it). */
  leave() {
    if (this.ended !== null) return;
    if (this.role === 'host') this.d.send({ type: 'hideseek:end', gid: this.config.gid });
    else this.d.send({ type: 'hideseek:leave', gid: this.config.gid });
    this.ended = this.role === 'host' ? 'over' : 'hostLeft';
  }

  /** Where a player was last heard from (for sounds): CPU or human. */
  posOf(id: string): Vec | null {
    return this.world.pos(id);
  }
}

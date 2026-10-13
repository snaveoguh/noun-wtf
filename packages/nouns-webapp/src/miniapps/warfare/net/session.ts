// ── WarfareSession: one online match, host-authoritative ───────────────
//
// No three.js, no DOM: unit-tested over in-memory transports (net.test.ts).
//
//   host     the browser that made the match runs the real WarfareSim at
//            60 Hz (bots included). Remote inputs land in a small jitter
//            buffer per player; every 3rd step (20 Hz) it broadcasts a
//            compact snapshot + the events and projectile births since the
//            last one. Joiners take over a bot's slot; leavers hand it back.
//   client   sends its input every tick, batched in pairs (30 msgs/s,
//            seq-numbered). It keeps two local sims built from the same
//            match config:
//              auth  the latest snapshot written into a full SimState (what
//                    it would resume from if it became host);
//              pred  a `replica` sim (no damage / match flow) that the game
//                    renders: my player is predicted with my own inputs and
//                    re-based on every snapshot (unacked inputs replayed),
//                    everyone else is interpolated ~100 ms in the past, and
//                    paint flies cosmetically (my shots instantly, theirs
//                    from the host's births). Hits, kills and scores only
//                    ever come from the host's events.
//
// Host leaving: the relay names the earliest-joined member as the new host;
// that client promotes its `auth` sim (bots re-thought from scratch) and
// carries on, everyone else just keeps reading snapshots.

import { createBotMem } from '../sim/bots';
import { WarfareSim } from '../sim/sim';
import {
  DT,
  emptyInput,
  type MatchConfig,
  type PlayerInput,
  type PlayerState,
  type Projectile,
  type SimEvent,
} from '../sim/types';
import { WEAPON_ORDER, type WeaponId } from '../sim/weapons';

import {
  applyHumanSnap,
  applyPlayerSnap,
  applySnapshot,
  decodeSnapshot,
  encodeSnapshot,
  packBirths,
  packEvents,
  packInput,
  unpackBirths,
  unpackEvents,
  unpackInputs,
  type DecodedSnap,
} from './codec';
import {
  cleanName,
  type HumanInfo,
  type NetMatchCfg,
  type NetStatus,
  type RosterSlot,
  type WfMsg,
  type WfTransport,
} from './protocol';

export type NetRole = 'host' | 'client';

export const SNAP_EVERY = 3; // steps → 20 Hz
export const INTERP_MS = 100;
const PING_MS = 2000;
const ROSTER_MS = 2000;
const WAIT_SNAP_MS = 250;
const END_LINGER_MS = 4000;
const HISTORY = 240;
/** Projectile ids a client mints itself (cosmetic shots) start here. */
const LOCAL_IDS = 1_000_000_000;

const LOOK_RE = /^(?:\d{1,3}-){4}\d{1,3}$/;
const LOCAL_EVENTS = new Set(['fire', 'reload', 'swap', 'jump', 'land', 'throw']);

export const seqAfter = (a: number, b: number) =>
  ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;

export function cleanWeapons(v: unknown): WeaponId[] {
  const list = Array.isArray(v) ? v : [];
  const out = WEAPON_ORDER.filter(w => list.includes(w) || w === 'splatter' || w === 'hopper');
  return out;
}

export function cleanLook(v: unknown, fallback: string): string {
  return typeof v === 'string' && LOOK_RE.test(v) ? v : fallback;
}

function simConfig(cfg: NetMatchCfg, humans: HumanInfo[]): MatchConfig {
  return {
    mode: cfg.mode,
    map: cfg.map,
    teamSize: cfg.teamSize,
    difficulty: cfg.difficulty,
    seed: cfg.seed,
    humans,
    target: cfg.target,
    timeLimit: cfg.timeLimit,
  };
}

interface Remote {
  slot: number;
  q: { seq: number; inp: PlayerInput }[];
  last: number;
  cur: PlayerInput;
  seq: number;
  started: boolean;
}

export interface SessionStats {
  snapsSent: number;
  snapsRecv: number;
  /** JSON bytes of the last / largest snapshot message. */
  snapBytes: number;
  snapBytesMax: number;
  snapBytesTotal: number;
  inputsSent: number;
  inputBytes: number;
  /** Last prediction error at re-base (m). */
  correction: number;
}

export interface Toast {
  id: number;
  text: string;
  t: number;
}

export class WarfareSession {
  role: NetRole;
  readonly gid: string;
  code = '';
  readonly pub: boolean;
  readonly cfg: NetMatchCfg;
  readonly mySlot: number;
  hostId: string;
  status: NetStatus;
  roster: RosterSlot[];
  /** Bumps whenever names / looks / bot flags change (avatars refresh). */
  rosterVer = 0;
  /** My round trip to the relay (ms). */
  ping = -1;
  /** Host sent wf:end, or the match is otherwise over for this session. */
  ended = false;
  closed = false;
  toasts: Toast[] = [];
  /** Visual-only prediction error being smoothed away (client). */
  corr = { x: 0, y: 0, z: 0 };
  stats: SessionStats = {
    snapsSent: 0,
    snapsRecv: 0,
    snapBytes: 0,
    snapBytesMax: 0,
    snapBytesTotal: 0,
    inputsSent: 0,
    inputBytes: 0,
    correction: 0,
  };
  onHosted: ((code: string) => void) | null = null;

  private t: WfTransport;
  private now: () => number;
  private auth: WarfareSim;
  private pred: WarfareSim | null = null;
  private toastId = 1;
  private lastPing = -1e9;
  private pingDue = false;
  // host
  private remote = new Map<string, Remote>();
  private outEvents: SimEvent[] = [];
  private outBirths: Projectile[] = [];
  private stepN = 0;
  private lastSnapAt = -1e9;
  private lastRosterAt = -1e9;
  private rosterDirty = false;
  private endAt = -1;
  // client
  private snaps: { t: number; s: DecodedSnap }[] = [];
  private pending: { t: number; events: SimEvent[]; births: unknown }[] = [];
  private immediate: SimEvent[] = [];
  private rebaseQ: DecodedSnap | null = null;
  private lastTick = -1;
  private seq = 0;
  private batch: number[] = [];
  private batchN = 0;
  private history: { seq: number; inp: PlayerInput }[] = [];
  private firstSnap = true;

  private constructor(o: {
    t: WfTransport;
    role: NetRole;
    gid: string;
    pub: boolean;
    cfg: NetMatchCfg;
    slot: number;
    humans: HumanInfo[];
    roster: RosterSlot[] | null;
    status: NetStatus;
    hostId: string;
    now?: () => number;
  }) {
    this.t = o.t;
    this.role = o.role;
    this.gid = o.gid;
    this.pub = o.pub;
    this.cfg = o.cfg;
    this.mySlot = o.slot;
    this.status = o.status;
    this.hostId = o.hostId;
    this.now = o.now ?? (() => performance.now());
    this.auth = new WarfareSim(simConfig(o.cfg, o.humans));
    if (o.role === 'client') {
      this.auth.bots.clear();
      const pred = new WarfareSim(simConfig(o.cfg, o.humans));
      pred.replica = true;
      pred.bots.clear();
      pred.state.nextId = LOCAL_IDS;
      this.pred = pred;
    }
    this.roster =
      o.roster ??
      this.auth.state.players.map(p => ({
        id: p.bot ? '' : o.t.id,
        name: p.name,
        look: p.look,
        bot: p.bot,
        weapons: [...p.weapons],
        ping: -1,
      }));
    this.applyRoster(this.roster);
  }

  /** Make a match: I'm slot 0 and the host. Registers it with the relay. */
  static host(
    t: WfTransport,
    o: { cfg: NetMatchCfg; me: HumanInfo; pub: boolean; gid: string; now?: () => number },
  ): WarfareSession {
    const s = new WarfareSession({
      t,
      role: 'host',
      gid: o.gid,
      pub: o.pub,
      cfg: o.cfg,
      slot: 0,
      humans: [{ ...o.me, name: cleanName(o.me.name) }],
      roster: null,
      status: 'waiting',
      hostId: t.id,
      now: o.now,
    });
    t.send({
      type: 'wf:host',
      gid: o.gid,
      pub: o.pub,
      mode: o.cfg.mode,
      map: o.cfg.map,
      size: o.cfg.teamSize,
      name: cleanName(o.me.name),
    });
    return s;
  }

  /** Join from the host's welcome. */
  static join(
    t: WfTransport,
    w: Extract<WfMsg, { type: 'wf:welcome' }>,
    now?: () => number,
  ): WarfareSession {
    const s = new WarfareSession({
      t,
      role: 'client',
      gid: w.gid,
      pub: w.pub,
      cfg: w.cfg,
      slot: w.slot,
      humans: [],
      roster: w.roster,
      status: w.status,
      hostId: w.from ?? '',
      now,
    });
    s.code = w.code;
    return s;
  }

  /** What the game renders (host: the real sim; client: the predicted replica). */
  get sim(): WarfareSim {
    return this.pred ?? this.auth;
  }

  get myId() {
    return this.t.id;
  }

  /** Humans in the match (me included). */
  get humans(): number {
    return this.roster.filter(r => !r.bot).length;
  }

  /** Host: may the sim advance? (Clients always tick their prediction.) */
  get canStep(): boolean {
    return this.role === 'client' || (this.status === 'live' && !this.closed);
  }

  private toast(text: string) {
    this.toasts = [
      ...this.toasts.filter(x => this.now() - x.t < 4000),
      {
        id: this.toastId++,
        text,
        t: this.now(),
      },
    ].slice(-3);
  }

  private send(m: WfMsg) {
    if (!this.closed) this.t.send(m);
  }

  // ── Per frame ─────────────────────────────────────────────────────────

  /** Timers: pings, roster, waiting snapshots, end of match. */
  update() {
    if (this.closed) return;
    const now = this.now();
    if (now - this.lastPing > PING_MS) {
      this.lastPing = now;
      this.send({ type: 'wf:ping', t: now });
    }
    if (this.role !== 'host') return;
    if (this.status === 'waiting' && now - this.lastSnapAt > WAIT_SNAP_MS) this.broadcastSnap();
    if (this.rosterDirty || now - this.lastRosterAt > ROSTER_MS) this.broadcastRoster();
    if (this.endAt < 0 && this.auth.state.match.phase === 'matchEnd') this.endAt = now;
    if (this.endAt >= 0 && !this.ended && now - this.endAt > END_LINGER_MS) {
      this.ended = true;
      this.send({ type: 'wf:end', gid: this.gid });
    }
  }

  /** Host: open the doors (waiting → live). */
  start() {
    if (this.role !== 'host' || this.status === 'live') return;
    this.status = 'live';
    this.rosterDirty = true;
    this.sendMeta();
  }

  /** One fixed 60 Hz tick with my input. Returns events for the view. */
  tick(inp: PlayerInput): SimEvent[] {
    if (this.closed) return [];
    return this.role === 'host' ? this.hostTick(inp) : this.clientTick(inp);
  }

  /**
   * Client: messages that arrived since the last tick — re-base my
   * prediction, and hand back events about me (spawn / hit / kill) that
   * shouldn't wait for interpolation. Call before sampling the next tick.
   */
  pump(): SimEvent[] {
    if (this.role !== 'client') return [];
    if (this.rebaseQ !== null) {
      this.rebase(this.rebaseQ);
      this.rebaseQ = null;
    }
    const out = this.immediate;
    this.immediate = [];
    return out;
  }

  leave() {
    if (this.closed) return;
    this.send({ type: 'wf:leave', gid: this.gid });
    this.closed = true;
  }

  // ── Host ──────────────────────────────────────────────────────────────

  private hostTick(inp: PlayerInput): SimEvent[] {
    if (this.status !== 'live') return [];
    const sim = this.auth;
    const inputs = new Map<number, PlayerInput>();
    inputs.set(this.mySlot, inp);
    for (const r of this.remote.values()) {
      // Two-input cushion; skip ahead when the queue backs up
      if (r.q.length > 8) r.q.splice(0, r.q.length - 3);
      if (!r.started && r.q.length >= 2) r.started = true;
      if (r.started && r.q.length > 0) {
        const n = r.q.shift()!;
        r.cur = n.inp;
        r.seq = n.seq;
      }
      inputs.set(r.slot, r.cur);
    }
    const events = sim.step(inputs);
    for (const pr of sim.state.projectiles)
      if (pr.born >= sim.state.time - 1e-9) this.outBirths.push(pr);
    for (const e of events) {
      this.outEvents.push(e);
      if (e.type === 'match' && this.endAt < 0) this.endAt = this.now();
    }
    if (++this.stepN % SNAP_EVERY === 0) this.broadcastSnap();
    return events;
  }

  private broadcastSnap() {
    const acks = new Map<number, number>();
    const humans = [this.mySlot];
    for (const r of this.remote.values()) {
      acks.set(r.slot, r.seq);
      humans.push(r.slot);
    }
    const m: WfMsg = {
      type: 'wf:s',
      gid: this.gid,
      d: encodeSnapshot(this.auth, humans, acks),
    };
    if (this.outEvents.length > 0) m.e = packEvents(this.outEvents);
    if (this.outBirths.length > 0) m.b = packBirths(this.outBirths);
    this.outEvents = [];
    this.outBirths = [];
    this.lastSnapAt = this.now();
    const bytes = JSON.stringify(m).length;
    this.stats.snapsSent++;
    this.stats.snapBytes = bytes;
    this.stats.snapBytesTotal += bytes;
    this.stats.snapBytesMax = Math.max(this.stats.snapBytesMax, bytes);
    this.send(m);
  }

  private broadcastRoster() {
    this.rosterDirty = false;
    this.lastRosterAt = this.now();
    this.roster[this.mySlot] = { ...this.roster[this.mySlot], ping: this.ping };
    this.send({ type: 'wf:roster', gid: this.gid, roster: this.roster, status: this.status });
  }

  private sendMeta() {
    this.send({ type: 'wf:meta', gid: this.gid, humans: this.humans, status: this.status });
  }

  /** Pick a bot's slot for a newcomer: the team with fewer humans, lowest index. */
  private pickSlot(): number {
    const ps = this.auth.state.players;
    const free = ps.filter(p => p.bot && p.id !== this.mySlot);
    if (free.length === 0) return -1;
    if (free[0].team === -1) return free[0].id;
    const humansOn = (t: number) => ps.filter(p => !p.bot && p.team === t).length;
    free.sort((a, b) => humansOn(a.team) - humansOn(b.team) || a.id - b.id);
    return free[0].id;
  }

  private admit(from: string, info: { name: unknown; look: unknown; weapons: unknown }) {
    const sim = this.auth;
    let r = this.remote.get(from);
    if (r === undefined) {
      const slot = this.pickSlot();
      if (slot < 0) {
        this.send({ type: 'wf:reject', gid: this.gid, to: from, reason: 'match is full' });
        return;
      }
      const p = sim.state.players[slot];
      p.bot = false;
      sim.bots.delete(slot);
      p.name = cleanName(info.name);
      p.look = cleanLook(info.look, p.look);
      p.weapons = cleanWeapons(info.weapons);
      if (!p.weapons.includes(p.weapon))
        p.weapon = p.weapons.includes('hopper') ? 'hopper' : p.weapons[0];
      r = {
        slot,
        q: [],
        last: 0,
        cur: emptyInput(p.yaw, p.pitch),
        seq: 0,
        started: false,
      };
      this.remote.set(from, r);
      this.roster[slot] = {
        id: from,
        name: p.name,
        look: p.look,
        bot: false,
        weapons: [...p.weapons],
        ping: -1,
      };
      this.rosterVer++;
      this.toast(`${p.name} joined`);
    }
    this.send({
      type: 'wf:welcome',
      gid: this.gid,
      to: from,
      code: this.code,
      pub: this.pub,
      cfg: this.cfg,
      slot: r.slot,
      roster: this.roster,
      status: this.status,
    });
    this.broadcastRoster();
    this.sendMeta();
    this.broadcastSnap();
  }

  /** A human left: a bot takes the slot (name and score stay). */
  private toBot(slot: number) {
    const p = this.auth.state.players[slot];
    if (p === undefined || slot === this.mySlot) return;
    p.bot = true;
    this.auth.bots.set(slot, createBotMem(this.auth, p));
    this.roster[slot] = { ...this.roster[slot], id: '', bot: true, ping: -1 };
    this.rosterVer++;
    this.rosterDirty = true;
    this.sendMeta();
  }

  // ── Client ────────────────────────────────────────────────────────────

  private clientTick(inp: PlayerInput): SimEvent[] {
    const pred = this.pred!;
    // Input: every tick, two per message
    const next = (this.seq + 1) & 0xffff;
    this.history.push({ seq: next, inp: { ...inp } });
    if (this.history.length > HISTORY) this.history.shift();
    packInput(inp, this.batch);
    if (++this.batchN >= 2) {
      this.seq = next;
      const m: WfMsg = { type: 'wf:in', gid: this.gid, q: this.seq, i: this.batch };
      if (this.pingDue) {
        m.pg = Math.round(this.ping);
        this.pingDue = false;
      }
      this.batch = [];
      this.batchN = 0;
      this.stats.inputsSent++;
      this.stats.inputBytes = JSON.stringify(m).length;
      this.send(m);
    }
    const rt = this.now() - INTERP_MS;
    this.syncMatch();
    this.applyInterp(rt);
    const evs = pred.step({ [this.mySlot]: inp });
    this.applyInterp(rt);
    const out: SimEvent[] = [];
    // Host events + paint, released as interpolation reaches them
    while (this.pending.length > 0 && this.pending[0].t <= rt) {
      const p = this.pending.shift()!;
      for (const e of p.events) if (!(e.type === 'fire' && e.pid === this.mySlot)) out.push(e);
      for (const pr of unpackBirths(p.births, pred.state.players, pred.state.time))
        if (pr.owner !== this.mySlot) pred.state.projectiles.push(pr);
    }
    for (const e of evs)
      if (LOCAL_EVENTS.has(e.type) && (e as { pid: number }).pid === this.mySlot) out.push(e);
    const k = 0.86;
    this.corr.x *= k;
    this.corr.y *= k;
    this.corr.z *= k;
    return out;
  }

  /** Match + zones always mirror the latest snapshot. */
  private syncMatch() {
    const pred = this.pred!;
    const a = this.auth.state;
    Object.assign(pred.state.match, a.match, { scores: [a.match.scores[0], a.match.scores[1]] });
    for (let i = 0; i < a.zones.length && i < pred.state.zones.length; i++)
      Object.assign(pred.state.zones[i], a.zones[i]);
  }

  /** Everyone but me: interpolated between the two snapshots around `rt`. */
  private applyInterp(rt: number) {
    const sn = this.snaps;
    if (sn.length === 0) return;
    let a = sn[0];
    let b = sn[sn.length - 1];
    if (rt <= a.t) b = a;
    else
      for (let i = 0; i < sn.length - 1; i++)
        if (sn[i].t <= rt && sn[i + 1].t >= rt) {
          a = sn[i];
          b = sn[i + 1];
          break;
        }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
    const ps = this.pred!.state.players;
    for (let i = 0; i < ps.length; i++) {
      if (i === this.mySlot) continue;
      const pb = b.s.players[i];
      if (pb === undefined) continue;
      const pa = a.s.players[i] ?? pb;
      const p = ps[i];
      applyPlayerSnap(p, pb);
      const kk = pa.alive !== pb.alive || Math.abs(pa.x - pb.x) + Math.abs(pa.z - pb.z) > 5 ? 1 : k;
      p.x = pa.x + (pb.x - pa.x) * kk;
      p.y = pa.y + (pb.y - pa.y) * kk;
      p.z = pa.z + (pb.z - pa.z) * kk;
      let dy = pb.yaw - pa.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw = pa.yaw + dy * kk;
      p.pitch = pa.pitch + (pb.pitch - pa.pitch) * kk;
      // The replica never respawns anyone itself
      p.respawnAt = Infinity;
    }
  }

  /** New snapshot: my state from the host, then my unacked inputs on top. */
  private rebase(s: DecodedSnap) {
    const pred = this.pred!;
    const me = pred.state.players[this.mySlot];
    const bx = me.x + this.corr.x;
    const by = me.y + this.corr.y;
    const bz = me.z + this.corr.z;
    const wasAlive = me.alive;
    const ps = s.players[this.mySlot];
    if (ps === undefined) return;
    applyPlayerSnap(me, ps);
    const h = s.humans.get(this.mySlot);
    if (h !== undefined) applyHumanSnap(me, h);
    me.respawnAt = Infinity;
    pred.state.tick = s.tick;
    pred.state.time = s.time;
    this.syncMatch();
    const ack = h?.ack ?? 0;
    this.history = this.history.filter(x => seqAfter(x.seq, ack));
    if (this.firstSnap) {
      // Joined: face where the host has me facing
      this.firstSnap = false;
      this.history = [];
      this.immediate.unshift({ type: 'spawn', pid: this.mySlot });
    }
    // Replay without flying paint twice
    const saved = pred.state.projectiles;
    pred.state.projectiles = [];
    for (const x of this.history) pred.step({ [this.mySlot]: x.inp });
    pred.state.projectiles = saved;
    if (wasAlive && me.alive) {
      const ex = bx - me.x;
      const ey = by - me.y;
      const ez = bz - me.z;
      const e = Math.hypot(ex, ey, ez);
      this.stats.correction = e;
      if (e < 2) this.corr = { x: ex, y: ey, z: ez };
      else this.corr = { x: 0, y: 0, z: 0 };
    } else this.corr = { x: 0, y: 0, z: 0 };
  }

  private applyRoster(roster: RosterSlot[]) {
    const sims = this.pred !== null ? [this.auth, this.pred] : [this.auth];
    for (const sim of sims)
      for (let i = 0; i < sim.state.players.length && i < roster.length; i++) {
        const r = roster[i];
        const p: PlayerState = sim.state.players[i];
        p.name = cleanName(r.name);
        p.look = cleanLook(r.look, p.look);
        p.bot = r.bot === true;
        p.weapons = cleanWeapons(r.weapons);
      }
    this.rosterVer++;
  }

  /** The host left and the relay picked me: run the match from my latest snapshot. */
  private promote(oldHost: string) {
    const auth = this.auth;
    const pred = this.pred;
    this.role = 'host';
    this.hostId = this.t.id;
    auth.rng.s = auth.state.rngState >>> 0;
    if (pred !== null) {
      const a = auth.state.players[this.mySlot];
      const p = pred.state.players[this.mySlot];
      if (a.alive && p.alive) {
        a.x = p.x;
        a.y = p.y;
        a.z = p.z;
        a.vx = p.vx;
        a.vy = p.vy;
        a.vz = p.vz;
        a.yaw = p.yaw;
        a.pitch = p.pitch;
        a.grounded = p.grounded;
        a.crouched = p.crouched;
      }
      // Paint in flight carries on (now for real)
      auth.state.projectiles = pred.state.projectiles.map(pr => ({
        ...pr,
        born: auth.state.time - Math.max(0, pred.state.time - pr.born),
        fuseAt: pr.fuseAt > 0 ? auth.state.time + Math.max(0, pr.fuseAt - pred.state.time) : 0,
      }));
    }
    this.pred = null;
    auth.lastInputs.clear();
    auth.bots.clear();
    this.remote.clear();
    for (const p of auth.state.players) {
      if (p.id === this.mySlot) continue;
      const r = this.roster[p.id];
      if (r === undefined || r.bot || r.id === '' || r.id === oldHost) {
        p.bot = true;
        auth.bots.set(p.id, createBotMem(auth, p));
        if (r !== undefined) this.roster[p.id] = { ...r, id: '', bot: true, ping: -1 };
      } else {
        p.bot = false;
        this.remote.set(r.id, {
          slot: p.id,
          q: [],
          last: 0,
          cur: emptyInput(p.yaw, p.pitch),
          seq: 0,
          started: false,
        });
      }
    }
    // Their timers are relative to the new clock from here on
    for (const p of auth.state.players)
      if (!p.alive && p.respawnAt < auth.state.time) p.respawnAt = auth.state.time + DT;
    this.outEvents = [];
    this.outBirths = [];
    this.rosterVer++;
    this.rosterDirty = true;
    this.sendMeta();
    this.broadcastSnap();
    this.toast("host left — you're hosting now");
  }

  // ── Messages ──────────────────────────────────────────────────────────

  onMessage(m: WfMsg) {
    if (this.closed) return;
    switch (m.type) {
      case 'wf:pong':
        this.ping = Math.max(0, this.now() - m.t);
        this.pingDue = true;
        if (this.role === 'host')
          this.roster[this.mySlot] = { ...this.roster[this.mySlot], ping: this.ping };
        return;
      case 'wf:hosted':
        if (m.gid !== this.gid) return;
        this.code = m.code;
        this.onHosted?.(m.code);
        return;
      default:
        break;
    }
    if (!('gid' in m) || m.gid !== this.gid) return;
    switch (m.type) {
      case 'wf:join':
        if (this.role === 'host' && typeof m.from === 'string') this.admit(m.from, m);
        return;
      case 'wf:in': {
        if (this.role !== 'host' || typeof m.id !== 'string') return;
        const r = this.remote.get(m.id);
        if (r === undefined || typeof m.q !== 'number') return;
        const ins = unpackInputs(m.i);
        for (let k = 0; k < ins.length; k++) {
          const seq = (m.q - (ins.length - 1 - k)) & 0xffff;
          if (r.last !== 0 && !seqAfter(seq, r.last)) continue;
          r.last = seq;
          r.q.push({ seq, inp: ins[k] });
        }
        if (typeof m.pg === 'number' && Number.isFinite(m.pg)) {
          const ping = Math.max(0, Math.min(9999, Math.round(m.pg)));
          this.roster[r.slot] = { ...this.roster[r.slot], ping };
        }
        return;
      }
      case 'wf:s': {
        if (this.role !== 'client') return;
        const s = decodeSnapshot(m.d);
        if (s === null || s.players.length !== this.auth.state.players.length) return;
        if (this.lastTick >= 0 && s.tick < this.lastTick) return;
        this.lastTick = s.tick;
        this.stats.snapsRecv++;
        applySnapshot(this.auth.state, s);
        this.auth.rng.s = s.rngState;
        const t = this.now();
        this.snaps.push({ t, s });
        if (this.snaps.length > 30) this.snaps.shift();
        const evs = unpackEvents(m.e, s.players.length);
        const later: SimEvent[] = [];
        for (const e of evs) {
          const aboutMe =
            (e.type === 'spawn' && e.pid === this.mySlot) ||
            ((e.type === 'hit' || e.type === 'kill') && e.victim === this.mySlot);
          (aboutMe ? this.immediate : later).push(e);
        }
        this.pending.push({ t, events: later, births: m.b });
        this.rebaseQ = s;
        return;
      }
      case 'wf:roster':
        if (this.role !== 'client' || !Array.isArray(m.roster)) return;
        if (m.roster.length !== this.auth.state.players.length) return;
        this.roster = m.roster.map(r => ({
          id: typeof r.id === 'string' ? r.id.slice(0, 64) : '',
          name: cleanName(r.name),
          look: cleanLook(r.look, '0-0-0-0-0'),
          bot: r.bot === true,
          weapons: cleanWeapons(r.weapons),
          ping: typeof r.ping === 'number' && Number.isFinite(r.ping) ? r.ping : -1,
        }));
        this.applyRoster(this.roster);
        if (m.status === 'live' || m.status === 'waiting') this.status = m.status;
        return;
      case 'wf:left': {
        const slot = this.roster.findIndex(r => r.id === m.id && !r.bot);
        const name = slot >= 0 ? this.roster[slot].name : 'someone';
        if (m.host !== this.hostId) {
          const old = this.hostId;
          this.hostId = m.host;
          this.lastTick = -1;
          this.history = [];
          if (m.host === this.t.id && this.role === 'client') this.promote(old);
          else
            this.toast(
              `host left — ${this.roster.find(r => r.id === m.host)?.name ?? 'someone'} is hosting`,
            );
          return;
        }
        if (this.role === 'host') {
          const r = this.remote.get(m.id);
          if (r !== undefined) {
            this.remote.delete(m.id);
            this.toBot(r.slot);
            this.toast(`${name} left — a bot took over`);
          }
        } else if (slot >= 0) this.toast(`${name} left — a bot took over`);
        return;
      }
      case 'wf:end':
        this.ended = true;
        return;
      default:
        return;
    }
  }
}

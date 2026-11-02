// ── Football sync: one match, host-authoritative ─────────────────────────
//
// No three.js, no DOM, no Game: unit-tested over a LoopbackHub (sync.test.ts)
// with a tiny fake sim. Depends only on the contract (FootballSimApi).
//
//   FootballHost    owns the sim. Steps it at SIM_DT from an accumulator
//                   with my pad + the remote humans' pads (seq-numbered,
//                   through a small jitter buffer; a late pad is held, a
//                   silent one decays to NO_PAD after 0.5 s, a backed-up
//                   queue is skipped ahead with its buttons folded in so no
//                   tap is lost). Every 4th step (15 Hz) it broadcasts a
//                   quantised snapshot stamped with the host clock at that
//                   step, plus the events of the last ~1.5 s numbered by
//                   seq (so a lost snapshot loses no events). Answers pings
//                   (pong with its clock), watch / late join (football:start
//                   with `to`), ends with football:end {reason: 'final'}.
//   FootballClient  sends its pad at 30 Hz, pings for the host clock (lowest
//                   round trip wins), buffers snapshots and hands the view
//                   prev / next / alpha at a render time that runs smoothly
//                   behind the host (≥ 100 ms, more when latency / jitter
//                   need it). Plays every event exactly once, when the view
//                   reaches its tick. Optionally leads its own footballer a
//                   little (`selfLead`). Ends on football:end, the host
//                   leaving ('host_left') or 10 s of silence ('timeout').
//   WATCH           a FootballClient with `me: null`: sends nothing.

import type { FootballTransport } from './transport';

import {
  NO_PAD,
  SIM_DT,
  type FootballEndReason,
  type FootballEvent,
  type FootballMsg,
  type FootballSimApi,
  type MatchConfig,
  type PadInput,
  type SimState,
  type TeamId,
} from '../contract';

import {
  compactPad,
  decodeState,
  encodeState,
  mergeButtons,
  packEvents,
  sanitizePad,
  unpackEvents,
  type TimedEvent,
} from './codec';

/** Steps per snapshot (60 / 4 = 15 Hz). */
export const SNAP_EVERY = 4;
const SNAP_MS = SNAP_EVERY * SIM_DT * 1000;
export const INPUT_HZ = 30;
/** Least time the client draws behind the host (ms). */
export const INTERP_MS = 100;
const MAX_DELAY_MS = 500;
const MAX_STEPS = 8;
/** Events re-sent in each snapshot for this long (ticks), at most EVENT_CAP of them. */
const EVENT_WINDOW = 90;
const EVENT_CAP = 48;
/** A remote pad not heard for this many steps decays to NO_PAD. */
const STALE_STEPS = 30;
const PING_FAST = 5;
const PING_FAST_MS = 250;
const PING_MS = 2000;
const TIMEOUT_MS = 10000;
const FIRST_TIMEOUT_MS = 20000;
const SNAPS_KEPT = 32;
const AGES_KEPT = 30;

export interface FootballFrame {
  prev: SimState;
  next: SimState;
  /** 0..1 from prev to next. */
  alpha: number;
}

export interface FootballEnded {
  reason: FootballEndReason;
  winner: TeamId | null;
  score: [number, number];
  pens?: [number, number];
}

export interface SyncStats {
  snapsSent: number;
  snapsRecv: number;
  /** Bytes of the last / largest football:s message (JSON on the wire). */
  snapBytes: number;
  snapBytesMax: number;
  inputsSent: number;
  inputBytes: number;
  eventsPlayed: number;
}

const newStats = (): SyncStats => ({
  snapsSent: 0,
  snapsRecv: 0,
  snapBytes: 0,
  snapBytesMax: 0,
  inputsSent: 0,
  inputBytes: 0,
  eventsPlayed: 0,
});

/** 16-bit sequence a is after b. */
export const seqAfter = (a: number, b: number) =>
  ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;

/** A state without the sim's internals, deep-copied (safe to keep). */
export function viewCopy(s: SimState): SimState {
  const rest: Partial<SimState> = { ...s };
  delete rest.sim;
  return structuredClone(rest) as SimState;
}

function resultOf(s: SimState, finalEv?: Extract<FootballEvent, { type: 'final' }>): FootballEnded {
  const score: [number, number] = [s.score[0], s.score[1]];
  let pens: [number, number] | undefined;
  if (s.shootout)
    pens = [s.shootout.kicks[0].filter(Boolean).length, s.shootout.kicks[1].filter(Boolean).length];
  if (finalEv) {
    return {
      reason: 'final',
      winner: finalEv.winner,
      score: [finalEv.score[0], finalEv.score[1]],
      ...(finalEv.pens ? { pens: [finalEv.pens[0], finalEv.pens[1]] } : pens ? { pens } : {}),
    };
  }
  const a = score[0] + (pens ? pens[0] / 100 : 0);
  const b = score[1] + (pens ? pens[1] / 100 : 0);
  return {
    reason: 'final',
    winner: a > b ? 0 : b > a ? 1 : null,
    score,
    ...(pens ? { pens } : {}),
  };
}

// ── Host ────────────────────────────────────────────────────────────────

export interface HostOptions {
  gid: string;
  config: MatchConfig;
  sim: FootballSimApi;
  transport: FootballTransport;
  /** My human id (in config.humans), or null when the host only runs it. */
  me: string | null;
  /** ms clock (tests inject one). */
  now?: () => number;
  /** Send football:start to the members now (default true). */
  announce?: boolean;
}

interface Remote {
  q: { seq: number; pad: PadInput }[];
  cur: PadInput;
  /** Last seq applied (acked in snapshots). */
  seq: number;
  /** Steps since a new pad was applied. */
  held: number;
  heard: boolean;
}

export class FootballHost {
  readonly role = 'host' as const;
  readonly gid: string;
  readonly config: MatchConfig;
  readonly sim: FootballSimApi;
  readonly me: string | null;
  ended: FootballEnded | null = null;
  stats = newStats();
  /** Spectators who asked to watch (ids). */
  readonly watchers = new Set<string>();
  /** Remote humans who left (their pads stop: they're left out of `step`'s inputs). */
  readonly gone = new Set<string>();

  private t: FootballTransport;
  private now: () => number;
  private off: () => void;
  private acc = 0;
  private stepN = 0;
  private prev: SimState;
  private next: SimState;
  private remote = new Map<string, Remote>();
  private log: TimedEvent[] = [];
  private evSeq = 0;
  private out: FootballEvent[] = [];
  private finalEv: Extract<FootballEvent, { type: 'final' }> | undefined;

  constructor(o: HostOptions) {
    this.gid = o.gid;
    this.config = o.config;
    this.sim = o.sim;
    this.me = o.me;
    this.t = o.transport;
    this.now = o.now ?? (() => performance.now());
    this.next = viewCopy(o.sim.state());
    this.prev = this.next;
    for (const h of o.config.humans)
      if (h.id !== o.me)
        this.remote.set(h.id, { q: [], cur: { ...NO_PAD }, seq: 0, held: 0, heard: false });
    this.off = this.t.onMessage(m => this.onMessage(m));
    if (o.announce !== false) this.announce();
  }

  get over() {
    return this.ended !== null;
  }

  /** football:start to the members (or `to` one late joiner / watcher). */
  announce(to?: string) {
    this.t.send({
      type: 'football:start',
      gid: this.gid,
      host: this.t.selfId,
      config: this.config,
      ...(to !== undefined ? { to } : {}),
    });
  }

  /** Advance by a frame with my pad; returns what to draw. */
  frame(dt: number, pad: PadInput | null = null): FootballFrame {
    if (this.ended === null) this.advance(dt, pad);
    return {
      prev: this.prev,
      next: this.next,
      alpha: this.ended === null ? Math.min(1, this.acc / SIM_DT) : 1,
    };
  }

  private advance(dt: number, pad: PadInput | null) {
    this.acc = Math.min(this.acc + Math.max(0, dt), SIM_DT * MAX_STEPS);
    const n = Math.floor(this.acc / SIM_DT + 1e-9);
    this.acc = Math.max(0, this.acc - n * SIM_DT);
    const now = this.now();
    for (let k = 0; k < n; k++) {
      const inputs: Record<string, PadInput> = {};
      if (this.me !== null) inputs[this.me] = pad ?? NO_PAD;
      for (const [id, r] of this.remote) {
        if (this.gone.has(id)) continue;
        inputs[id] = this.remotePad(r);
      }
      const s = this.sim.step(inputs);
      this.prev = this.next;
      this.next = viewCopy(s);
      for (const e of s.events) {
        this.out.push(e);
        this.log.push({ seq: this.evSeq++, tick: s.tick, ev: e });
        if (e.type === 'final') this.finalEv = e;
      }
      const final = s.phase === 'final';
      if (++this.stepN % SNAP_EVERY === 0 || final) {
        // The host clock at the moment this step "happened"
        const stamp = now - (this.acc + (n - 1 - k) * SIM_DT) * 1000;
        this.broadcast(s, stamp);
      }
      if (final) {
        // The last events (final whistle) ride only in this snapshot: send it
        // a couple more times (a client dedupes by tick, events by seq)
        const stamp = now - this.acc * 1000;
        this.broadcast(s, stamp);
        this.broadcast(s, stamp);
        this.finish(s);
        return;
      }
    }
  }

  private remotePad(r: Remote): PadInput {
    // Each 30 Hz pad covers two 60 Hz steps; skip ahead when backed up, folding
    // the skipped pads' buttons in so a quick tap still reaches the sim
    if (r.q.length > 4) {
      const drop = r.q.splice(0, r.q.length - 2);
      let p = r.q[0].pad;
      for (const d of drop) p = mergeButtons(p, d.pad);
      r.q[0] = { seq: r.q[0].seq, pad: p };
    }
    if (r.q.length > 0 && (r.held >= 2 || r.q.length > 2)) {
      const nx = r.q.shift()!;
      r.cur = nx.pad;
      r.seq = nx.seq;
      r.held = 0;
    }
    r.held++;
    return r.held > STALE_STEPS ? NO_PAD : r.cur;
  }

  private broadcast(s: SimState, stamp: number) {
    const minTick = s.tick - EVENT_WINDOW;
    while (this.log.length > 0 && (this.log[0].tick < minTick || this.log.length > EVENT_CAP))
      this.log.shift();
    const acks = this.config.humans.map(h => this.remote.get(h.id)?.seq ?? 0);
    const msg: FootballMsg = {
      type: 'football:s',
      gid: this.gid,
      d: encodeState(s, this.config, acks),
      a: Math.round(stamp),
      ...(this.log.length > 0 ? { e: packEvents(this.log, s.tick, this.config) } : {}),
    };
    const bytes = JSON.stringify(msg).length;
    this.stats.snapsSent++;
    this.stats.snapBytes = bytes;
    this.stats.snapBytesMax = Math.max(this.stats.snapBytesMax, bytes);
    this.t.send(msg);
  }

  private finish(s: SimState) {
    this.ended = resultOf(s, this.finalEv);
    this.t.send({
      type: 'football:end',
      gid: this.gid,
      winner: this.ended.winner,
      score: this.ended.score,
      ...(this.ended.pens ? { pens: this.ended.pens } : {}),
      reason: 'final',
    });
  }

  onMessage(m: FootballMsg) {
    if (m.gid !== this.gid) return;
    switch (m.type) {
      case 'football:input': {
        const r = this.remote.get(m.id);
        if (r === undefined) return;
        const last = r.q.length > 0 ? r.q[r.q.length - 1].seq : r.seq;
        if (r.heard && !seqAfter(m.seq, last)) return;
        r.heard = true;
        this.gone.delete(m.id);
        r.q.push({ seq: m.seq, pad: sanitizePad(m.pad) });
        return;
      }
      case 'football:ping':
        this.t.send({ type: 'football:pong', gid: this.gid, to: m.from, c: m.c, a: this.now() });
        return;
      case 'football:watch':
        if (this.ended !== null) return;
        this.watchers.add(m.from);
        this.announce(m.from);
        return;
      case 'football:join':
        // A human listed in the config (re)joining a live match
        if (this.ended !== null || m.leave === true || !this.remote.has(m.from)) return;
        this.gone.delete(m.from);
        this.announce(m.from);
        return;
      case 'football:leave': {
        this.watchers.delete(m.id);
        const r = this.remote.get(m.id);
        if (r !== undefined) {
          this.gone.add(m.id);
          r.q = [];
          r.cur = { ...NO_PAD };
        }
        return;
      }
      default:
        return;
    }
  }

  /** Events since the last drain (the host's own view plays them once). */
  drainEvents(): FootballEvent[] {
    const e = this.out;
    this.out = [];
    this.stats.eventsPlayed += e.length;
    return e;
  }

  /** I'm leaving (forfeit / Esc): the relay ends the match for everyone. */
  leave() {
    this.t.send({ type: 'football:leave', gid: this.gid, id: this.t.selfId });
    if (this.ended === null) {
      const s = this.next;
      this.ended = { reason: 'left', winner: null, score: [s.score[0], s.score[1]] };
    }
    this.dispose();
  }

  dispose() {
    this.off();
  }
}

// ── Host clock (client side) ────────────────────────────────────────────

/**
 * The host's clock as seen from here: offset (ms) so that host ≈ local +
 * offset. From pongs: the sample with the lowest round trip (least
 * queueing, so the most symmetric) of the last 8. Before any pong (or for
 * a watcher, who never pings): from snapshot arrivals, max(a − recv), i.e.
 * as if the fastest snapshot had come instantly.
 */
export class HostClock {
  private samples: { rtt: number; off: number }[] = [];
  private arrOff: number | null = null;

  pong(c: number, a: number, now: number) {
    const rtt = now - c;
    if (!(rtt >= 0) || rtt > 5000) return;
    this.samples.push({ rtt, off: a + rtt / 2 - now });
    if (this.samples.length > 8) this.samples.shift();
  }

  arrival(a: number, now: number) {
    const o = a - now;
    if (this.arrOff === null || o > this.arrOff) this.arrOff = o;
  }

  get synced() {
    return this.samples.length > 0;
  }

  get offset(): number {
    if (this.samples.length > 0) return this.samples.reduce((x, y) => (y.rtt < x.rtt ? y : x)).off;
    return this.arrOff ?? 0;
  }

  /** Lowest round trip so far (ms), null before the first pong. */
  get rtt(): number | null {
    return this.samples.length === 0 ? null : Math.min(...this.samples.map(s => s.rtt));
  }
}

// ── Client / watcher ────────────────────────────────────────────────────

export interface ClientOptions {
  gid: string;
  config: MatchConfig;
  /** The host's connection id (football:start's `host`). */
  hostId: string;
  transport: FootballTransport;
  /** My human id, or null to WATCH (sends nothing). */
  me: string | null;
  now?: () => number;
  /**
   * Draw my own controlled footballer this far ahead along its velocity (s,
   * ≤ 0.25; default 0 = off), to hide some of the interpolation delay.
   */
  selfLead?: number;
}

interface Snap {
  /** Host clock at the step (ms). */
  a: number;
  state: SimState;
  acks: number[];
}

export class FootballClient {
  readonly role: 'client' | 'watch';
  readonly gid: string;
  readonly config: MatchConfig;
  readonly hostId: string;
  readonly me: string | null;
  readonly clock = new HostClock();
  ended: FootballEnded | null = null;
  stats = newStats();
  /** Current draw delay behind the host clock (ms). */
  delay = INTERP_MS;

  private t: FootballTransport;
  private now: () => number;
  private off: () => void;
  private selfLead: number;
  private snaps: Snap[] = [];
  private arrivals: { a: number; recv: number }[] = [];
  private renderT: number | null = null;
  private seq = 0;
  private sendAcc = Infinity;
  private pingN = 0;
  private pingAcc = Infinity;
  private started: number;
  private lastRecv: number | null = null;
  private lastSeq = -1;
  /** Host clock when I arrived (events before it aren't played). */
  private joinedAt = -Infinity;
  private pending: TimedEvent[] = [];
  private out: FootballEvent[] = [];

  constructor(o: ClientOptions) {
    this.gid = o.gid;
    this.config = o.config;
    this.hostId = o.hostId;
    this.me = o.me;
    this.role = o.me === null ? 'watch' : 'client';
    this.t = o.transport;
    this.now = o.now ?? (() => performance.now());
    this.selfLead = Math.max(0, Math.min(0.25, o.selfLead ?? 0));
    this.started = this.now();
    this.off = this.t.onMessage(m => this.onMessage(m));
  }

  get watching() {
    return this.me === null;
  }

  get over() {
    return this.ended !== null;
  }

  /** The newest snapshot's state (null before the first). */
  get latest(): SimState | null {
    return this.snaps.length > 0 ? this.snaps[this.snaps.length - 1].state : null;
  }

  /** My pad's last seq the host has applied (null before a snapshot). */
  get acked(): number | null {
    const s = this.snaps[this.snaps.length - 1];
    if (s === undefined || this.me === null) return null;
    const i = this.config.humans.findIndex(h => h.id === this.me);
    return i < 0 ? null : (s.acks[i] ?? 0);
  }

  /** Advance by a frame with my pad (ignored when watching); returns what to draw. */
  frame(dt: number, pad: PadInput | null = null): FootballFrame | null {
    const now = this.now();
    if (this.ended === null) {
      if (this.me !== null) {
        this.sendPad(dt, pad ?? NO_PAD);
        this.ping(dt, now);
      }
      const silent = this.lastRecv === null ? now - this.started : now - this.lastRecv;
      if (silent > (this.lastRecv === null ? FIRST_TIMEOUT_MS : TIMEOUT_MS)) {
        const s = this.latest;
        this.ended = {
          reason: 'timeout',
          winner: null,
          score: s ? [s.score[0], s.score[1]] : [0, 0],
        };
      }
    }
    return this.render(dt, now);
  }

  private sendPad(dt: number, pad: PadInput) {
    this.sendAcc += dt;
    if (this.sendAcc < 1 / INPUT_HZ - 1e-6) return;
    this.sendAcc = this.sendAcc === Infinity ? 0 : this.sendAcc % (1 / INPUT_HZ);
    this.seq = (this.seq + 1) & 0xffff;
    const m: FootballMsg = {
      type: 'football:input',
      gid: this.gid,
      id: this.me!,
      seq: this.seq,
      pad: compactPad(pad),
    };
    this.stats.inputsSent++;
    this.stats.inputBytes = JSON.stringify(m).length;
    this.t.send(m);
  }

  private ping(dt: number, now: number) {
    this.pingAcc += dt * 1000;
    const every = this.pingN < PING_FAST ? PING_FAST_MS : PING_MS;
    if (this.pingAcc < every) return;
    this.pingAcc = 0;
    this.pingN++;
    this.t.send({ type: 'football:ping', gid: this.gid, from: this.t.selfId, c: now });
  }

  private render(dt: number, now: number): FootballFrame | null {
    const sn = this.snaps;
    if (sn.length === 0) return null;
    const off = this.clock.offset;
    // How late snapshots arrive (by the current offset): draw far enough behind
    let age = 0;
    for (const r of this.arrivals) age = Math.max(age, r.recv + off - r.a);
    const want = Math.max(INTERP_MS, Math.min(MAX_DELAY_MS, age + SNAP_MS + 15));
    this.delay += (want - this.delay) * Math.min(1, dt * 0.8);
    if (want > this.delay + 60) this.delay = want - 60;
    const target = now + off - this.delay;
    if (this.renderT === null || Math.abs(target - this.renderT) > 400) this.renderT = target;
    else {
      this.renderT += dt * 1000;
      this.renderT += (target - this.renderT) * Math.min(1, dt * 2);
    }
    const rt = this.renderT;
    let a = sn[0];
    let b = sn[0];
    let alpha = 0;
    if (rt >= sn[sn.length - 1].a) {
      a = b = sn[sn.length - 1];
      alpha = 1;
    } else if (rt > sn[0].a) {
      for (let i = 0; i < sn.length - 1; i++)
        if (sn[i].a <= rt && sn[i + 1].a > rt) {
          a = sn[i];
          b = sn[i + 1];
          alpha = b.a > a.a ? (rt - a.a) / (b.a - a.a) : 1;
          break;
        }
    }
    // Events up to the tick on screen (or anything 2 s stale: never starve)
    const tickNow = a.state.tick + (b.state.tick - a.state.tick) * alpha;
    const latestTick = sn[sn.length - 1].state.tick;
    if (this.pending.length > 0) {
      const keep: TimedEvent[] = [];
      for (const e of this.pending)
        if (e.tick <= tickNow + 1e-6 || e.tick < latestTick - 120 || this.ended !== null)
          this.out.push(e.ev);
        else keep.push(e);
      this.pending = keep;
    }
    let prev = a.state;
    let next = b.state;
    if (this.selfLead > 0 && this.me !== null && this.ended === null) {
      prev = lead(prev, this.me, this.selfLead);
      next = lead(next, this.me, this.selfLead);
    }
    return { prev, next, alpha };
  }

  onMessage(m: FootballMsg) {
    if (m.gid !== this.gid) return;
    const now = this.now();
    switch (m.type) {
      case 'football:s': {
        const dec = decodeState(m.d, this.config);
        if (dec === null) return;
        this.stats.snapsRecv++;
        const first = this.lastRecv === null;
        this.lastRecv = now;
        const a = m.a ?? now + this.clock.offset;
        this.clock.arrival(a, now);
        this.arrivals.push({ a, recv: now });
        if (this.arrivals.length > AGES_KEPT) this.arrivals.shift();
        const tick = dec.state.tick;
        // Joining late: don't replay what happened before I arrived (by the
        // host clock, as if this first snapshot came instantly; 250 ms slack)
        if (first) this.joinedAt = this.started + (a - now) - 250;
        for (const e of unpackEvents(m.e, tick, this.config)) {
          if (e.seq <= this.lastSeq) continue;
          this.lastSeq = e.seq;
          if (a - (tick - e.tick) * SIM_DT * 1000 < this.joinedAt) continue;
          this.pending.push(e);
        }
        this.pending.sort((x, y) => x.tick - y.tick || x.seq - y.seq);
        const sn = this.snaps;
        if (sn.some(s => s.state.tick === tick)) return;
        const snap: Snap = { a, state: dec.state, acks: dec.acks };
        let i = sn.length;
        while (i > 0 && sn[i - 1].state.tick > tick) i--;
        // Keep stamps monotonic with ticks (a reordered stamp can't go backwards)
        if (i > 0 && snap.a <= sn[i - 1].a) snap.a = sn[i - 1].a + 0.001;
        sn.splice(i, 0, snap);
        while (sn.length > SNAPS_KEPT) sn.shift();
        if (dec.state.phase === 'final' && this.ended === null) this.ended = resultOf(dec.state);
        return;
      }
      case 'football:pong':
        if (m.to === this.t.selfId) this.clock.pong(m.c, m.a, now);
        return;
      case 'football:end':
        if (this.ended === null || this.ended.reason === 'final')
          this.ended = {
            reason: m.reason ?? 'final',
            winner: m.winner,
            score: [m.score[0], m.score[1]],
            ...(m.pens ? { pens: m.pens } : {}),
          };
        return;
      case 'football:leave':
        if (m.id === this.hostId && this.ended === null) {
          const s = this.latest;
          this.ended = {
            reason: 'host_left',
            winner: null,
            score: s ? [s.score[0], s.score[1]] : [0, 0],
          };
        }
        return;
      default:
        return;
    }
  }

  /** Events the view hasn't played yet (each exactly once, in order). */
  drainEvents(): FootballEvent[] {
    const e = this.out;
    this.out = [];
    this.stats.eventsPlayed += e.length;
    return e;
  }

  leave() {
    this.t.send({ type: 'football:leave', gid: this.gid, id: this.t.selfId });
    if (this.ended === null) {
      const s = this.latest;
      this.ended = { reason: 'left', winner: null, score: s ? [s.score[0], s.score[1]] : [0, 0] };
    }
    this.dispose();
  }

  dispose() {
    this.off();
  }
}

/** Spectator: a client that sends nothing (after the lobby's football:watch). */
export function createWatcher(o: Omit<ClientOptions, 'me' | 'selfLead'>) {
  return new FootballClient({ ...o, me: null });
}

/** A copy of `s` with the footballer I control moved `t` s along its velocity. */
function lead(s: SimState, me: string, t: number): SimState {
  const i = s.players.findIndex(p => p.human === me);
  if (i < 0) return s;
  const p = s.players[i];
  const players = s.players.slice();
  players[i] = { ...p, x: p.x + p.vx * t, z: p.z + p.vz * t };
  const ball =
    s.ball.owner === p.id && s.ball.mode === 'free'
      ? { ...s.ball, x: s.ball.x + p.vx * t, z: s.ball.z + p.vz * t }
      : s.ball;
  return { ...s, players, ball };
}

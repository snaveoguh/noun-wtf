// ── BreakSession: one battle's sim + host-authoritative sync ─────────────
//
// No three.js, no DOM: unit-tested over a loopback running the real relay
// (sync.test.ts). The scheme:
//
//   The battle clock A. The host owns it: A = seconds since the battle
//   began, by the host's performance.now(), starting at −COUNTDOWN when it
//   sends `break:start`. Everyone plays the beat on A and stamps their key
//   presses with A, so a press is judged against the beat the player heard.
//
//   Clients estimate A. `break:start` carries the host's `at` (seeded with a
//   guessed one-way delay), then `break:ping {c}` / `break:pong {c, a}`:
//   six quick pings at the start, one every 2 s after. Each pong gives
//   rtt = now − c and offset = a + rtt/2 − now; the sample with the lowest
//   rtt wins (the least queueing, so the most symmetric), and the local
//   clock slews to it (≤ 10%) instead of jumping, so the music never skips.
//
//   The host's sim runs LAG behind A (S = A − LAG; LAG = 0.15 s, vs the CPU
//   too: on a slow device a key event can wait behind a 100 ms+ frame, and
//   the sim mustn't call the beat a miss before it's seen it). Every input, the host's own included, waits in a
//   time-ordered queue and is fed to the sim when S passes its stamp, so the
//   sim judges everyone's presses in order and on time even though remote
//   ones arrive one-way latency late. The host accepts a remote stamp t only
//   when A − MAX_LATE ≤ t ≤ A + FUTURE_TOL (late: an old or replayed press;
//   future: a clock that's ahead or a client stamping beats it hasn't heard
//   yet), in order per dancer and at most 16 a second. One arriving later
//   than LAG (a lag spike) is still judged by its stamp ("any order").
//
//   Snapshots: the SimState at ~10 Hz (+ the events since the last one) to
//   members and spectators. Clients sample them LAG + 100 ms behind their
//   A estimate, interpolating, then bring the result forward to A (the beat
//   runs on, a move keeps going at its rate, ≤ 0.35 s) so the view's music
//   and beat track are on the same clock the player stamps with. Beat
//   events are made locally from that clock, never sent.
//
//   A member dropping: the relay sends `break:leave {id}`; the host hands
//   that dancer to the CPU (sim.setCpu, or plays their prompts itself).
//   The host leaving ends the battle for everyone.

import type {
  BattleConfig,
  BattleSim,
  BattleSimFactory,
  BreakInput,
  BreakKey,
  BreakMsg,
  CrewId,
  DancerPose,
  SimEvent,
  SimState,
} from '../contract';

import { snapMsg } from './codec';

export type BreakRole = 'host' | 'client' | 'spectator';

/** Countdown before the first beat (s). */
export const COUNTDOWN = 3;
/** The host's sim runs this far behind the battle clock when remote humans play. */
export const JUDGE_DELAY = 0.15;
export const SNAP_DT = 0.1;
/** Remote stamps may be this far ahead of the host's clock (estimate error). */
export const FUTURE_TOL = 0.08;
/** …and at most this old when they arrive. */
export const MAX_LATE = 0.4;
/** Clients sample snapshots this far behind the newest they could have. */
export const INTERP_BACK = 0.1;
/** At most this far forward when bringing a snapshot to the live clock. */
export const MAX_AHEAD = 0.35;
const SIM_STEP = 1 / 60;
// A slow frame (a phone, a hidden tab) catches up to 4 s at once
const MAX_SUBSTEPS = 240;
const PING_FAST = 6;
const PING_FAST_DT = 0.25;
const PING_DT = 2;
const SLEW = 0.1;
const SNAP_ERR = 0.2;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// ── The client's estimate of the host's battle clock ──

export class BattleClock {
  private samples: { rtt: number; off: number }[] = [];
  private target: number | null = null;
  private off = 0;
  private lastMs = -Infinity;

  /** `break:start`: the host's clock read `a` when it sent; one-way guessed. */
  seed(a: number, nowMs: number, oneWay = 0.05) {
    if (this.samples.length > 0) return;
    this.set(a + oneWay - nowMs / 1000, nowMs, true);
  }

  /** A snapshot's `a`: before any pong, never run behind what the host has sent. */
  hint(a: number, nowMs: number) {
    if (this.samples.length > 0) return;
    const off = a - nowMs / 1000;
    if (this.target === null || off > this.target) this.set(off, nowMs, this.target === null);
  }

  /** A pong for the ping sent at `c` (ms), carrying the host's clock `a`. */
  pong(c: number, a: number, nowMs: number) {
    const rtt = (nowMs - c) / 1000;
    if (!(rtt >= 0) || rtt > 5) return;
    this.samples.push({ rtt, off: a + rtt / 2 - nowMs / 1000 });
    if (this.samples.length > 10) this.samples.shift();
    const best = this.samples.reduce((x, y) => (y.rtt < x.rtt ? y : x));
    this.set(best.off, nowMs, this.samples.length === 1);
  }

  get synced() {
    return this.samples.length > 0;
  }

  /** Best (lowest) round trip so far (s), null before the first pong. */
  get rtt(): number | null {
    return this.samples.length === 0 ? null : Math.min(...this.samples.map(s => s.rtt));
  }

  /** The battle clock (s) at local time `nowMs`. */
  now(nowMs: number): number {
    if (this.target === null) return -COUNTDOWN;
    const dt = Math.max(0, (nowMs - this.lastMs) / 1000);
    this.lastMs = Math.max(this.lastMs, nowMs);
    const d = this.target - this.off;
    if (Math.abs(d) > SNAP_ERR) this.off = this.target;
    else this.off += clamp(d, -dt * SLEW, dt * SLEW);
    return nowMs / 1000 + this.off;
  }

  private set(off: number, nowMs: number, snap: boolean) {
    this.target = off;
    if (snap) {
      this.off = off;
      this.lastMs = nowMs;
    }
  }
}

// ── The host's gate on remote stamps ──

export type Verdict = 'ok' | 'future' | 'late' | 'order' | 'rate';

export class InputGate {
  private last = new Map<string, { t: number; recent: number[] }>();
  constructor(
    readonly future = FUTURE_TOL,
    readonly late = MAX_LATE,
    readonly perSec = 16,
  ) {}

  /** Judge a remote input arriving at host battle time `hostNow`. */
  check(i: BreakInput, hostNow: number): Verdict {
    if (i.t > hostNow + this.future) return 'future';
    if (hostNow - i.t > this.late) return 'late';
    const l = this.last.get(i.id) ?? { t: -Infinity, recent: [] };
    // Chords (two keys on one beat) may cross on the wire by a hair
    if (i.t < l.t - 0.02) return 'order';
    l.recent = l.recent.filter(x => hostNow - x < 1);
    if (l.recent.length >= this.perSec) return 'rate';
    l.recent.push(hostNow);
    l.t = Math.max(l.t, i.t);
    this.last.set(i.id, l);
    return 'ok';
  }
}

// ── Snapshot interpolation ──

const clone = (s: SimState): SimState => structuredClone(s);

/** a → b by k: the clock, live score and each move's progress; the rest from b. */
export function lerpState(a: SimState, b: SimState, k: number): SimState {
  const o = clone(b);
  o.t = lerp(a.t, b.t, k);
  o.beat = lerp(a.beat, b.beat, k);
  if (a.phase === b.phase && a.turn?.id === b.turn?.id)
    o.turnScore = lerp(a.turnScore, b.turnScore, k);
  for (const p of o.poses) {
    const pa = a.poses.find(q => q.id === p.id);
    if (pa && pa.move === p.move && p.moveT >= pa.moveT) p.moveT = lerp(pa.moveT, p.moveT, k);
  }
  return o;
}

/** The state at battle time `t` from snapshots sorted by t (clamped to the ends). */
export function sampleSnaps(snaps: readonly SimState[], t: number): SimState | null {
  if (snaps.length === 0) return null;
  if (t <= snaps[0].t) return clone(snaps[0]);
  const last = snaps[snaps.length - 1];
  if (t >= last.t) return clone(last);
  for (let i = 0; i < snaps.length - 1; i++) {
    const a = snaps[i];
    const b = snaps[i + 1];
    if (a.t <= t && t <= b.t) return lerpState(a, b, b.t > a.t ? (t - a.t) / (b.t - a.t) : 1);
  }
  return clone(last);
}

/** How fast each dancer's current move is going (moveT per second), from successive states. */
export class MoveRates {
  readonly rate = new Map<string, number>();
  private prev = new Map<string, { move: DancerPose['move']; moveT: number; t: number }>();

  update(s: SimState) {
    for (const p of s.poses) {
      const q = this.prev.get(p.id);
      if (q && q.move === p.move && p.move !== null && s.t > q.t && p.moveT >= q.moveT) {
        const r = (p.moveT - q.moveT) / (s.t - q.t);
        const old = this.rate.get(p.id);
        this.rate.set(p.id, old === undefined ? r : lerp(old, r, 0.5));
      } else if (!q || q.move !== p.move) this.rate.delete(p.id);
      this.prev.set(p.id, { move: p.move, moveT: p.moveT, t: s.t });
    }
  }
}

/** Bring a state forward to the live clock `t`: the beat runs on, moves keep going. */
export function advanceState(
  s: SimState,
  t: number,
  bpm: number,
  rates: ReadonlyMap<string, number>,
  maxAhead = MAX_AHEAD,
): SimState {
  const o = clone(s);
  const dt = t - s.t;
  o.t = t;
  o.beat = s.beat + (dt * bpm) / 60;
  const ext = clamp(dt, 0, maxAhead);
  for (const p of o.poses)
    if (p.move !== null) p.moveT = Math.min(1, p.moveT + (rates.get(p.id) ?? 0) * ext);
  return o;
}

// ── The session ──

export interface SessionOptions {
  config: BattleConfig;
  role: BreakRole;
  /** My dancer id (null for spectators). */
  me: string | null;
  hostId: string;
  send: (m: BreakMsg) => void;
  makeSim: BattleSimFactory;
  /** Host: the battle clock now (−COUNTDOWN at the start). Others: `break:start`'s `at`. */
  at: number;
  /** Judge delay: the host picks it, clients take it from `break:start`. */
  lag?: number;
  /** ms clock (tests inject one). */
  now?: () => number;
}

export interface SessionStats {
  snapsSent: number;
  snapsRecv: number;
  snapBytes: number;
  snapBytesMax: number;
  inputsSent: number;
  inputsAccepted: number;
  rejected: Record<Exclude<Verdict, 'ok'>, number>;
}

const CPU_TAKEOVER_SKILL = 0.6;

export class BreakSession {
  readonly gid: string;
  readonly config: BattleConfig;
  readonly role: BreakRole;
  readonly me: string | null;
  readonly hostId: string;
  readonly lag: number;
  readonly clock = new BattleClock();
  /** Host: the battle. Others: null. */
  readonly sim: BattleSim | null;
  /** Events for the view since it last drained them. */
  events: SimEvent[] = [];
  ended: { winner: CrewId | 'tie'; totals: [number, number] } | null = null;
  hostLeft = false;
  /** Humans who dropped (a CPU dances for them). */
  readonly dropped = new Set<string>();
  stats: SessionStats = {
    snapsSent: 0,
    snapsRecv: 0,
    snapBytes: 0,
    snapBytesMax: 0,
    inputsSent: 0,
    inputsAccepted: 0,
    rejected: { future: 0, late: 0, order: 0, rate: 0 },
  };

  private send: (m: BreakMsg) => void;
  private nowMs: () => number;
  /** Host: local ms at which A = 0. */
  private zeroMs = 0;
  private simT = 0;
  private pending: BreakInput[] = [];
  private gate = new InputGate();
  private outEvents: SimEvent[] = [];
  private lastSnapA = -Infinity;
  private lastPhase = '';
  private auto = new Map<string, number>();
  private humans: Set<string>;
  /** Client. */
  private snaps: SimState[] = [];
  private rates = new MoveRates();
  private lastBeat = -1;
  private pingN = 0;
  private pingAt = -Infinity;

  constructor(o: SessionOptions) {
    this.config = o.config;
    this.gid = o.config.gid;
    this.role = o.role;
    this.me = o.me;
    this.hostId = o.hostId;
    this.send = o.send;
    this.nowMs = o.now ?? (() => performance.now());
    this.humans = new Set(o.config.dancers.filter(d => d.human).map(d => d.id));
    this.lag = o.lag ?? (o.role === 'host' ? JUDGE_DELAY : 0);
    const now = this.nowMs();
    if (o.role === 'host') {
      this.zeroMs = now - o.at * 1000;
      this.sim = o.makeSim(o.config);
    } else {
      this.sim = null;
      this.clock.seed(o.at, now);
    }
  }

  get over() {
    return this.ended !== null || this.hostLeft;
  }

  /** The battle clock (s) at local time `ms` (default: now). */
  battleNow(ms = this.nowMs()): number {
    return this.role === 'host' ? (ms - this.zeroMs) / 1000 : this.clock.now(ms);
  }

  /** My key press at local time `ms` (a DOM event's timeStamp; default now). */
  press(key: BreakKey, ms = this.nowMs()) {
    if (this.me === null || this.role === 'spectator' || this.over) return;
    const t = this.battleNow(ms);
    if (t < 0) return;
    const i: BreakInput = { id: this.me, key, t: Math.round(t * 1000) / 1000 };
    if (this.role === 'host') this.queue(i);
    else {
      this.stats.inputsSent++;
      this.send({ type: 'break:input', gid: this.gid, i });
    }
  }

  /** Advance by a frame. */
  update(dt: number) {
    if (this.role === 'host') this.hostUpdate();
    else this.clientUpdate(dt);
  }

  // ── Host ──

  private queue(i: BreakInput) {
    let k = this.pending.length;
    while (k > 0 && this.pending[k - 1].t > i.t) k--;
    this.pending.splice(k, 0, i);
  }

  private hostUpdate() {
    const sim = this.sim!;
    if (this.ended !== null) return;
    const a = this.battleNow();
    const target = a - this.lag;
    let n = 0;
    while (this.simT + 1e-9 < target && n < MAX_SUBSTEPS && this.ended === null) {
      const next = Math.min(this.simT + SIM_STEP, target);
      while (this.pending.length > 0 && this.pending[0].t <= next) sim.input(this.pending.shift()!);
      const evs = sim.step(next - this.simT);
      this.simT = next;
      n++;
      this.take(evs);
      this.autopilot();
    }
    const s = sim.state();
    if (this.ended === null && s.phase === 'done' && s.winner !== undefined)
      this.finish(s.winner, s.totals);
    if (this.ended === null && (a - this.lastSnapA >= SNAP_DT || s.phase !== this.lastPhase))
      this.broadcast(s, a);
  }

  private take(evs: readonly SimEvent[]) {
    for (const e of evs) {
      if (e.e !== 'beat') this.events.push(e);
      this.outEvents.push(e);
      if (e.e === 'end' && this.ended === null) this.finish(e.winner, e.totals);
    }
  }

  private broadcast(s: SimState, a: number) {
    const m = snapMsg(this.gid, s, this.outEvents, a);
    this.outEvents = [];
    this.lastSnapA = a;
    this.lastPhase = s.phase;
    const bytes = JSON.stringify(m).length;
    this.stats.snapsSent++;
    this.stats.snapBytes = bytes;
    this.stats.snapBytesMax = Math.max(this.stats.snapBytesMax, bytes);
    this.send(m);
  }

  private finish(winner: CrewId | 'tie', totals: [number, number]) {
    this.ended = { winner, totals: [totals[0], totals[1]] };
    this.broadcast(this.sim!.state(), this.battleNow());
    this.send({ type: 'break:end', gid: this.gid, winner, totals: this.ended.totals });
  }

  /** A dropped human's turn: play their prompts (when the sim can't take them over). */
  private autopilot() {
    if (this.auto.size === 0) return;
    const s = this.sim!.state();
    const id = s.turn?.id;
    if (id === undefined || !this.auto.has(id)) return;
    let last = this.auto.get(id)!;
    const spb = 60 / this.config.bpm;
    for (const p of s.prompts) {
      if (p.beat <= last) continue;
      // A steady-ish CPU: within the "great" window, deterministic per beat
      const h = Math.sin(p.beat * 12.9898) * 43758.5453;
      const jitter = (h - Math.floor(h) - 0.5) * 0.08;
      this.queue({ id, key: p.key, t: s.t + (p.beat - s.beat) * spb + jitter });
      last = Math.max(last, p.beat);
    }
    this.auto.set(id, last);
  }

  private takeOver(id: string) {
    if (!this.humans.has(id) || id === this.me || this.dropped.has(id)) return;
    this.dropped.add(id);
    if (this.sim?.setCpu) this.sim.setCpu(id, CPU_TAKEOVER_SKILL);
    else this.auto.set(id, -Infinity);
    // Their queued presses are void now
    this.pending = this.pending.filter(i => i.id !== id);
  }

  // ── Client / spectator ──

  private clientUpdate(dt: number) {
    if (this.over) return;
    this.pingAt += dt;
    const every = this.pingN < PING_FAST ? PING_FAST_DT : PING_DT;
    if (this.pingAt >= every || this.pingN === 0) {
      this.pingAt = 0;
      this.pingN++;
      this.send({ type: 'break:ping', gid: this.gid, c: this.nowMs() });
    }
  }

  // ── Messages ──

  onMessage(m: BreakMsg) {
    if (!('gid' in m) || m.gid !== this.gid) return;
    if (this.role === 'host') this.hostMessage(m);
    else this.clientMessage(m);
  }

  private hostMessage(m: BreakMsg) {
    switch (m.type) {
      case 'break:input': {
        const i = m.i;
        if (!this.humans.has(i.id) || i.id === this.me || this.dropped.has(i.id) || this.over)
          return;
        const v = this.gate.check(i, this.battleNow());
        if (v !== 'ok') {
          this.stats.rejected[v]++;
          return;
        }
        this.stats.inputsAccepted++;
        this.queue({ id: i.id, key: i.key, t: i.t });
        return;
      }
      case 'break:ping':
        if (m.from)
          this.send({
            type: 'break:pong',
            gid: this.gid,
            to: m.from,
            c: m.c,
            a: Math.round(this.battleNow() * 10000) / 10000,
          });
        return;
      case 'break:leave':
        if (m.id) this.takeOver(m.id);
        return;
      default:
        return;
    }
  }

  private clientMessage(m: BreakMsg) {
    const now = this.nowMs();
    switch (m.type) {
      case 'break:s': {
        this.stats.snapsRecv++;
        if (m.a !== undefined) this.clock.hint(m.a, now);
        for (const e of m.e ?? []) if (e.e !== 'beat') this.events.push(e);
        const s = m.state;
        const last = this.snaps[this.snaps.length - 1];
        if (last !== undefined && s.t < last.t) return;
        this.snaps.push(s);
        while (this.snaps.length > 2 && s.t - this.snaps[0].t > 2) this.snaps.shift();
        if (this.snaps.length > 40) this.snaps.shift();
        this.rates.update(s);
        if (this.ended === null && s.phase === 'done' && s.winner !== undefined)
          this.ended = { winner: s.winner, totals: [s.totals[0], s.totals[1]] };
        return;
      }
      case 'break:pong':
        this.clock.pong(m.c, m.a, now);
        return;
      case 'break:end':
        this.ended = { winner: m.winner, totals: m.totals ?? this.snaps.at(-1)?.totals ?? [0, 0] };
        return;
      case 'break:leave':
        if (m.id === this.hostId) this.hostLeft = true;
        else if (m.id) this.dropped.add(m.id);
        return;
      default:
        return;
    }
  }

  /** Leaving (Esc / button). */
  leave() {
    this.send({ type: 'break:leave', gid: this.gid });
  }

  // ── What to draw ──

  /** The state for the view this frame, on the live battle clock (null before the first snapshot). */
  render(): SimState | null {
    const a = this.battleNow();
    let base: SimState | null;
    if (this.role === 'host') {
      base = this.sim!.state();
      this.rates.update(base);
    } else base = sampleSnaps(this.snaps, a - this.lag - INTERP_BACK);
    if (base === null) return null;
    const out =
      this.ended !== null ? base : advanceState(base, a, this.config.bpm, this.rates.rate);
    this.beats(out);
    return out;
  }

  /** Beat events from the live clock (the view's music and fx stay on it). */
  private beats(s: SimState) {
    if (s.beat < 0 || s.phase === 'done') return;
    const b = Math.floor(s.beat);
    if (b - this.lastBeat > 4) this.lastBeat = b - 1;
    while (this.lastBeat < b) {
      this.lastBeat++;
      this.events.push({ e: 'beat', beat: this.lastBeat, downbeat: this.lastBeat % 4 === 0 });
    }
  }

  /** Drain the events the view hasn't played yet. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

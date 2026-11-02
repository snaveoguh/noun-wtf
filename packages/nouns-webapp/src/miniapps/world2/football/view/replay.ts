// ── Noun Football: replays (pure) ────────────────────────────────────────
//
// ReplayBuffer keeps the last ~10 s of drawn SimStates in a ring of
// preallocated frames (the view records every new tick in `draw`; no
// per-frame garbage), and samples any moment in it, interpolated.
// ReplayDirector plays a window of it back: each angle in turn at a rate
// (goal replays: the last few seconds at 0.5×, from behind the goal, then
// a long lens from the touchline), then says it's done. Skippable.

import type { BallState, PlayerState, SimState } from '../contract';
import type { ReplayAngle } from './camFraming';

const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
};

function copyPlayer(dst: PlayerState, src: PlayerState) {
  dst.id = src.id;
  dst.team = src.team;
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vz = src.vz;
  dst.yaw = src.yaw;
  dst.action = src.action;
  dst.actionT = src.actionT;
  dst.actionDir = src.actionDir;
  dst.stamina = src.stamina;
  dst.yellow = src.yellow;
  dst.off = src.off;
  dst.human = src.human;
}

const newPlayer = (): PlayerState => ({
  id: '',
  team: 0,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vz: 0,
  yaw: 0,
  action: 'idle',
  actionT: 0,
  stamina: 1,
  yellow: 0,
});

/** Copy `src` into `dst` reusing dst's player objects (shares stats / goals / restart refs). */
export function copyState(dst: SimState, src: SimState): SimState {
  if (dst === src) return dst;
  const keep = dst.players;
  const ball = dst.ball;
  const score = dst.score;
  Object.assign(dst, src);
  dst.players = keep === src.players ? [] : keep;
  while (dst.players.length < src.players.length) dst.players.push(newPlayer());
  dst.players.length = src.players.length;
  for (let i = 0; i < src.players.length; i++) copyPlayer(dst.players[i], src.players[i]);
  dst.ball = Object.assign(ball === src.ball ? ({} as BallState) : ball, src.ball);
  dst.score = score === src.score ? [0, 0] : score;
  dst.score[0] = src.score[0];
  dst.score[1] = src.score[1];
  dst.events = [];
  return dst;
}

export function blankState(): SimState {
  return {
    tick: -1,
    time: 0,
    period: 1,
    clock: 0,
    added: 0,
    phase: 'pregame',
    phaseT: 0,
    score: [0, 0],
    poss: 0,
    attackPlusZ: 0,
    restart: null,
    players: [],
    ball: {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      mode: 'dead',
      owner: null,
      lastTouch: null,
    },
    shootout: null,
    goals: [],
    stats: [
      {
        shots: 0,
        onTarget: 0,
        poss: 0,
        passes: 0,
        passesDone: 0,
        tackles: 0,
        fouls: 0,
        corners: 0,
        offsides: 0,
        yellows: 0,
        reds: 0,
        saves: 0,
      },
      {
        shots: 0,
        onTarget: 0,
        poss: 0,
        passes: 0,
        passesDone: 0,
        tackles: 0,
        fouls: 0,
        corners: 0,
        offsides: 0,
        yellows: 0,
        reds: 0,
        saves: 0,
      },
    ],
    charge: {},
    events: [],
  };
}

/**
 * Interpolate two states into `out` (players matched by id; discrete fields
 * from `b`; actionT only blends inside one action).
 */
export function lerpState(a: SimState, b: SimState, k: number, out: SimState): SimState {
  copyState(out, b);
  if (k >= 1 || a === b) return out;
  const L = (x: number, y: number) => x + (y - x) * k;
  out.time = L(a.time, b.time);
  out.clock = L(a.clock, b.clock);
  for (let i = 0; i < out.players.length; i++) {
    const pb = out.players[i];
    const pa = a.players[i]?.id === pb.id ? a.players[i] : a.players.find(q => q.id === pb.id);
    if (pa === undefined) continue;
    pb.x = L(pa.x, pb.x);
    pb.y = L(pa.y, pb.y);
    pb.z = L(pa.z, pb.z);
    pb.vx = L(pa.vx, pb.vx);
    pb.vz = L(pa.vz, pb.vz);
    pb.yaw = lerpAngle(pa.yaw, pb.yaw, k);
    pb.stamina = L(pa.stamina, pb.stamina);
    if (pa.action === pb.action && pb.actionT >= pa.actionT) pb.actionT = L(pa.actionT, pb.actionT);
  }
  const ba = a.ball;
  const bb = out.ball;
  // A teleport (restart placement) doesn't lerp across the pitch
  if (Math.hypot(bb.x - ba.x, bb.z - ba.z) < 6) {
    bb.x = L(ba.x, bb.x);
    bb.y = L(ba.y, bb.y);
    bb.z = L(ba.z, bb.z);
  }
  return out;
}

export class ReplayBuffer {
  private ring: SimState[] = [];
  private head = 0;
  private count = 0;
  private lastTick = -1;
  private lastTime = -Infinity;
  /** Capacity in frames (60 Hz). */
  readonly cap: number;

  constructor(readonly seconds = 10) {
    this.cap = Math.ceil(seconds * 60) + 8;
  }

  get size() {
    return this.count;
  }

  /** Record a state (once per tick; a time going backwards resets the buffer). */
  push(s: SimState) {
    if (s.tick === this.lastTick) return;
    if (s.time < this.lastTime - 1e-6) this.clear();
    this.lastTick = s.tick;
    this.lastTime = s.time;
    let slot: SimState;
    if (this.ring.length < this.cap) {
      slot = blankState();
      this.ring.push(slot);
    } else slot = this.ring[this.head];
    copyState(slot, s);
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.count + 1, this.cap);
    // Keep only `seconds` of history (snapshots may come at 15 Hz: time, not count)
    while (this.count > 2 && s.time - this.at(0).time > this.seconds + 1e-6) this.count--;
  }

  /** i-th oldest frame. */
  at(i: number): SimState {
    const start = (this.head - this.count + this.cap * 2) % this.cap;
    return this.ring[(start + i) % this.ring.length];
  }

  /** [oldest time, newest time] (empty: [0, 0]). */
  span(): [number, number] {
    if (this.count === 0) return [0, 0];
    return [this.at(0).time, this.at(this.count - 1).time];
  }

  /** The state at time `t` (clamped to the span), interpolated, into `out`. */
  sample(t: number, out: SimState): SimState | null {
    if (this.count === 0) return null;
    const [t0, t1] = this.span();
    if (t <= t0) return copyState(out, this.at(0));
    if (t >= t1) return copyState(out, this.at(this.count - 1));
    // Binary search the frame pair
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.at(mid).time <= t) lo = mid;
      else hi = mid;
    }
    const a = this.at(lo);
    const b = this.at(hi);
    const k = b.time > a.time ? (t - a.time) / (b.time - a.time) : 1;
    return lerpState(a, b, k, out);
  }

  clear() {
    this.count = 0;
    this.head = 0;
    this.lastTick = -1;
    this.lastTime = -Infinity;
  }
}

export interface ReplaySegment {
  angle: ReplayAngle;
  /** Buffer time window (s). */
  from: number;
  to: number;
  /** Playback rate (0.5 = half speed). */
  rate: number;
}

export class ReplayDirector {
  segments: ReplaySegment[] = [];
  private i = 0;
  /** Buffer time being shown. */
  t = 0;
  active = false;

  /**
   * Plan a replay of the last `seconds` (clamped to what's recorded):
   * each angle in turn at `rate`. False if there's not enough recorded.
   */
  start(
    buf: ReplayBuffer,
    seconds: number,
    angles: ReplayAngle[] = ['goalcam', 'tele'],
    rate = 0.5,
    endAt?: number,
  ): boolean {
    const [t0, t1] = buf.span();
    const end = Math.min(endAt ?? t1, t1);
    const from = Math.max(t0, end - seconds);
    if (end - from < 0.5) return false;
    this.segments = angles.map(angle => ({ angle, from, to: end, rate }));
    this.i = 0;
    this.t = from;
    this.active = true;
    return true;
  }

  get segment(): ReplaySegment | null {
    return this.active ? (this.segments[this.i] ?? null) : null;
  }

  /** Real seconds the whole replay lasts. */
  get duration(): number {
    return this.segments.reduce((s, g) => s + (g.to - g.from) / g.rate, 0);
  }

  /** Advance by real `dt`; returns true when the segment changed (a cut). */
  update(dt: number): boolean {
    const g = this.segment;
    if (g === null) return false;
    this.t += dt * g.rate;
    if (this.t < g.to) return false;
    this.i++;
    const n = this.segment;
    if (n === null) {
      this.active = false;
      return true;
    }
    this.t = n.from;
    return true;
  }

  skip() {
    this.active = false;
  }
}

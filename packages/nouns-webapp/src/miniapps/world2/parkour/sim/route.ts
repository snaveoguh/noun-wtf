// ── NOUN PARKOUR: route timing, medals and ghosts (pure) ─────────────────
//
// A route is a start, an ordered list of checkpoints (spheres you pass
// through, in order) and medal times. The clock starts on the first move
// after the countdown and stops in the last checkpoint. Ghosts are your
// best run sampled at 10 Hz (position, facing, parkour pose), packed into
// integers for localStorage.

export interface Checkpoint {
  x: number;
  y: number;
  z: number;
  /** Radius (m): you pass it anywhere inside. */
  r: number;
  /** Shown on the HUD as the next target ("UP THE WALL", "JUMP THE ALLEY"). */
  hint?: string;
}

export interface Medals {
  gold: number;
  silver: number;
  bronze: number;
}

export interface RouteDef {
  id: string;
  name: string;
  blurb: string;
  start: { x: number; y: number; z: number; yaw: number };
  checkpoints: Checkpoint[];
  medals: Medals;
}

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export function medalFor(time: number, m: Medals): Medal {
  if (time <= m.gold) return 'gold';
  if (time <= m.silver) return 'silver';
  if (time <= m.bronze) return 'bronze';
  return null;
}

export const STARS: Record<Exclude<Medal, null> | 'none', number> = {
  gold: 3,
  silver: 2,
  bronze: 1,
  none: 0,
};

export function inCheckpoint(c: Checkpoint, x: number, y: number, z: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  // A little taller than wide: you pass a roof gate standing up, not by its feet
  const dy = (y + 0.9 - c.y) / 1.4;
  return dx * dx + dz * dz + dy * dy <= c.r * c.r;
}

export type RunPhase = 'ready' | 'running' | 'done';

export interface RunResult {
  time: number;
  splits: number[];
  medal: Medal;
  /** Beat the previous best (or there was none). */
  best: boolean;
  /** Previous best time (null: first finish). */
  prev: number | null;
}

/** One attempt at a route. Feed it the rider's position every frame. */
export class RunClock {
  phase: RunPhase = 'ready';
  /** Seconds since the start (frozen at the finish). */
  time = 0;
  /** Index of the next checkpoint. */
  next = 0;
  splits: number[] = [];
  result: RunResult | null = null;

  constructor(
    readonly route: RouteDef,
    /** Best splits so far (empty: no best yet). */
    readonly bestSplits: number[] = [],
  ) {}

  start() {
    this.phase = 'running';
    this.time = 0;
    this.next = 0;
    this.splits = [];
    this.result = null;
  }

  /** Advance; returns the checkpoint index passed this frame, or -1. */
  update(dt: number, x: number, y: number, z: number): number {
    if (this.phase !== 'running') return -1;
    this.time += dt;
    const c = this.route.checkpoints[this.next];
    if (c === undefined || !inCheckpoint(c, x, y, z)) return -1;
    const i = this.next;
    this.splits.push(this.time);
    this.next++;
    if (this.next >= this.route.checkpoints.length) {
      this.phase = 'done';
      const prev = this.bestSplits.length > 0 ? this.bestSplits[this.bestSplits.length - 1] : null;
      this.result = {
        time: this.time,
        splits: [...this.splits],
        medal: medalFor(this.time, this.route.medals),
        best: prev === null || this.time < prev,
        prev,
      };
    }
    return i;
  }

  /** Split against the best run at checkpoint `i` (− = ahead), or null. */
  delta(i: number): number | null {
    const b = this.bestSplits[i];
    const s = this.splits[i];
    return b === undefined || s === undefined ? null : s - b;
  }
}

/** Seconds as the HUD shows them: 0:42.37 */
export function fmtTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
}

export function fmtDelta(d: number): string {
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
}

// ── Ghosts ──────────────────────────────────────────────────────────────

export const GHOST_HZ = 10;
/** Per sample: x, y, z (cm), yaw (centi-rad), anim code, phase (0..99). */
const STRIDE = 6;
/** 10 minutes at 10 Hz. */
const MAX_SAMPLES = 6000;

export interface GhostFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  phase: number;
}

export class GhostRecorder {
  private data: number[] = [];
  private acc = 0;

  get samples() {
    return this.data.length / STRIDE;
  }

  /** Call every frame from the run's start; samples at GHOST_HZ. */
  add(dt: number, f: GhostFrame) {
    if (this.data.length > 0) {
      this.acc += dt;
      if (this.acc < 1 / GHOST_HZ - 1e-6) return;
      this.acc -= 1 / GHOST_HZ;
    }
    if (this.data.length >= MAX_SAMPLES * STRIDE) return;
    this.data.push(
      Math.round(f.x * 100),
      Math.round(f.y * 100),
      Math.round(f.z * 100),
      Math.round(wrap(f.yaw) * 100),
      f.anim | 0,
      Math.round(Math.min(0.99, Math.max(0, f.phase)) * 100),
    );
  }

  pack(): number[] {
    return [...this.data];
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A packed ghost from storage → validated, or null. */
export function unpackGhost(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length % STRIDE !== 0 || v.length === 0) return null;
  if (v.length > MAX_SAMPLES * STRIDE) return null;
  for (const n of v) if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return v as number[];
}

/** The ghost at time `t` (s from the start), interpolated; null past its end. */
export function ghostAt(g: number[], t: number, out: GhostFrame): GhostFrame | null {
  const n = g.length / STRIDE;
  if (n === 0) return null;
  const f = Math.max(0, t * GHOST_HZ);
  const i = Math.floor(f);
  if (i >= n - 1) {
    if (i > n - 1 + GHOST_HZ) return null; // a second past its finish: gone
    return read(g, n - 1, out);
  }
  const k = f - i;
  const a = i * STRIDE;
  const b = a + STRIDE;
  out.x = (g[a] + (g[b] - g[a]) * k) / 100;
  out.y = (g[a + 1] + (g[b + 1] - g[a + 1]) * k) / 100;
  out.z = (g[a + 2] + (g[b + 2] - g[a + 2]) * k) / 100;
  const ya = g[a + 3] / 100;
  const yb = g[b + 3] / 100;
  out.yaw = ya + wrap(yb - ya) * k;
  out.anim = k < 0.5 ? g[a + 4] : g[b + 4];
  const pa = g[a + 5] / 100;
  let pb = g[b + 5] / 100;
  // Gait phases wrap round
  if (g[a + 4] === g[b + 4] && pb < pa - 0.5) pb += 1;
  out.phase = (pa + (pb - pa) * k) % 1;
  return out;
}

function read(g: number[], i: number, out: GhostFrame) {
  const a = i * STRIDE;
  out.x = g[a] / 100;
  out.y = g[a + 1] / 100;
  out.z = g[a + 2] / 100;
  out.yaw = g[a + 3] / 100;
  out.anim = g[a + 4];
  out.phase = g[a + 5] / 100;
  return out;
}

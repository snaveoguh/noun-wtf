// ── The Dragon Run: a ring course in the sky (pure, no three.js) ─────────
//
// From the Dragon Roost in Noggle City, out through the Noggle Arch, along
// the coast to Crabby Light, over Neon Nouns' Boom Tower and back to the
// Roost. Checkpoints sit over those four places; plain rings fill the legs
// every ~RING_SPACING m, at a height above the highest ground under them
// with a little deterministic weave, so every client flies the same course.
//
// A run starts when you fly through the start ring and ends at the finish
// (the start ring again); missing a ring doesn't void it, you just have to
// turn back for it (the next ring only lights once you've passed the one
// before). The run's path is kept (5 samples/s) for the ghost and so a
// future leaderboard can check it (verifyCourseRun) the way speed records
// are checked against their ride trace.

export interface Ring {
  x: number;
  y: number;
  z: number;
  /** Pass radius (m). */
  r: number;
  /** Checkpoints are named and bigger. */
  label: string | null;
}

export interface CourseAnchor {
  label: string;
  x: number;
  z: number;
  /** Ground level here (m). */
  ground: number;
  /** Height above it (m). */
  alt: number;
}

export const RING_SPACING = 520;
export const RING_R = 13;
export const CHECKPOINT_R = 18;
/** Plain rings fly this high over the highest ground under their leg. */
const LEG_ALT = 38;

/**
 * The rings: anchor[0] is the start/finish (flown again at the end), each
 * anchor a checkpoint, plain rings between. `groundAt` samples the ground
 * along each leg so rings never sit in a hill.
 */
export function buildCourse(
  anchors: CourseAnchor[],
  groundAt: (x: number, z: number) => number,
  spacing = RING_SPACING,
): Ring[] {
  if (anchors.length < 2) return [];
  const loop = [...anchors, anchors[0]!];
  const rings: Ring[] = [];
  const at = (a: CourseAnchor): Ring => ({
    x: a.x,
    y: a.ground + a.alt,
    z: a.z,
    r: CHECKPOINT_R,
    label: a.label,
  });
  rings.push(at(loop[0]!));
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1]!;
    const b = loop[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(0, Math.round(len / spacing) - 1);
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      const j = rings.length + 1;
      // a little weave off the straight line, so it reads as a course
      const x = a.x + (b.x - a.x) * f + Math.cos(j * 2.3) * 25;
      const z = a.z + (b.z - a.z) * f + Math.sin(j * 2.3) * 25;
      // highest ground within a ring's width of it
      let g = -Infinity;
      for (const [dx, dz] of [
        [0, 0],
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ] as const)
        g = Math.max(g, groundAt(x + dx, z + dz));
      // ramp between the anchors' own heights (weaving), never below the floor
      const ramp = a.ground + a.alt + (b.ground + b.alt - a.ground - a.alt) * f;
      const weave = Math.sin(j * 1.7) * 14;
      rings.push({ x, y: Math.max(g + LEG_ALT, ramp + weave), z, r: RING_R, label: null });
    }
    rings.push(i === loop.length - 1 ? { ...at(loop[0]!), label: 'FINISH' } : at(b));
  }
  return rings;
}

/** Path length through every ring in order (m). */
export function courseLength(rings: readonly Ring[]): number {
  let L = 0;
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1]!;
    const b = rings[i]!;
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return L;
}

/** Did the step from p0 to p1 pass within the ring's radius of its centre? */
export function passes(
  ring: Ring,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const L2 = dx * dx + dy * dy + dz * dz;
  let t = L2 > 0 ? ((ring.x - x0) * dx + (ring.y - y0) * dy + (ring.z - z0) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + dx * t - ring.x;
  const cy = y0 + dy * t - ring.y;
  const cz = z0 + dz * t - ring.z;
  return cx * cx + cy * cy + cz * cz <= ring.r * ring.r;
}

/** Path samples per second kept for the ghost / proof. */
export const TRACE_HZ = 5;

export type CourseEvent =
  | { t: 'start' }
  | { t: 'ring'; index: number; label: string | null; ms: number }
  | { t: 'finish'; ms: number };

/**
 * One run: feed it every step's move (from → to, dt). `next` is the ring to
 * fly through; ring 0 starts the clock, the last stops it.
 */
export class CourseRun {
  next = 0;
  ms = 0;
  done = false;
  /** [x, y, z, yaw, ms] × samples (from the start ring on). */
  readonly trace: number[] = [];
  /** Run time (ms) each ring was passed at, by ring index. */
  readonly splits: number[] = [];
  private sampleAcc = 0;

  constructor(readonly rings: readonly Ring[]) {}

  get started(): boolean {
    return this.next > 0;
  }

  step(
    dt: number,
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    yaw: number,
  ): CourseEvent[] {
    const out: CourseEvent[] = [];
    if (this.done || this.rings.length < 2) return out;
    if (this.started) {
      this.ms += dt * 1000;
      this.sampleAcc += dt;
      if (this.sampleAcc >= 1 / TRACE_HZ) {
        this.sampleAcc -= 1 / TRACE_HZ;
        this.sample(to, yaw);
      }
    }
    // (one ring per step: rings are hundreds of metres apart)
    const ring = this.rings[this.next]!;
    if (!passes(ring, from.x, from.y, from.z, to.x, to.y, to.z)) return out;
    if (this.next === 0) {
      this.ms = 0;
      this.trace.length = 0;
      this.splits.length = 0;
      this.splits.push(0);
      this.sampleAcc = 0;
      this.sample(to, yaw);
      out.push({ t: 'start' });
    } else if (this.next === this.rings.length - 1) {
      this.sample(to, yaw);
      this.splits.push(Math.round(this.ms));
      this.done = true;
      out.push({ t: 'finish', ms: Math.round(this.ms) });
      return out;
    } else {
      this.splits.push(Math.round(this.ms));
      out.push({ t: 'ring', index: this.next, label: ring.label, ms: Math.round(this.ms) });
    }
    this.next++;
    return out;
  }

  private sample(p: { x: number; y: number; z: number }, yaw: number) {
    // (a ring on the same frame as a timed sample: one sample, not two at one time)
    const n = this.trace.length;
    if (n >= 5 && this.trace[n - 1] === Math.round(this.ms)) return;
    this.trace.push(
      Math.round(p.x * 10) / 10,
      Math.round(p.y * 10) / 10,
      Math.round(p.z * 10) / 10,
      Math.round(yaw * 1000) / 1000,
      Math.round(this.ms),
    );
  }
}

/** Ghost pose at run time `ms` from a trace ([x, y, z, yaw, ms] × n), or null past its end. */
export function ghostAt(
  trace: readonly number[],
  ms: number,
  out: { x: number; y: number; z: number; yaw: number },
): typeof out | null {
  const n = Math.floor(trace.length / 5);
  if (n === 0 || ms > trace[(n - 1) * 5 + 4]!) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid * 5 + 4]! <= ms) lo = mid;
    else hi = mid;
  }
  const a = lo * 5;
  const b = hi * 5;
  const ta = trace[a + 4]!;
  const tb = trace[b + 4]!;
  const k = tb > ta ? Math.max(0, Math.min(1, (ms - ta) / (tb - ta))) : 0;
  out.x = trace[a]! + (trace[b]! - trace[a]!) * k;
  out.y = trace[a + 1]! + (trace[b + 1]! - trace[a + 1]!) * k;
  out.z = trace[a + 2]! + (trace[b + 2]! - trace[a + 2]!) * k;
  let dy = trace[b + 3]! - trace[a + 3]!;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  out.yaw = trace[a + 3]! + dy * k;
  return out;
}

export interface CourseCheck {
  ok: boolean;
  reason?: string;
  ms?: number;
}

/**
 * Does a run's trace fly the course? Times rise, no step is faster than the
 * dragon can go (`maxSpeed` m/s, with slack for sampling), the first sample
 * is at the start ring, every ring is passed in order between samples
 * (within its radius plus the distance a sample gap can cut a corner) and
 * the last sample is at the finish. For a future server-checked board.
 */
export function verifyCourseRun(
  trace: readonly number[],
  rings: readonly Ring[],
  maxSpeed: number,
): CourseCheck {
  const n = Math.floor(trace.length / 5);
  if (trace.length % 5 !== 0 || n < 2) return { ok: false, reason: 'trace too short' };
  if (rings.length < 2) return { ok: false, reason: 'no course' };
  const gap = 1000 / TRACE_HZ;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 5;
    const x = trace[o]!;
    const y = trace[o + 1]!;
    const z = trace[o + 2]!;
    const t = trace[o + 4]!;
    if (![x, y, z, t].every(Number.isFinite)) return { ok: false, reason: 'bad sample' };
    if (i === 0) {
      if (t !== 0) return { ok: false, reason: 'does not start at 0' };
      const r = rings[0]!;
      if (Math.hypot(x - r.x, y - r.y, z - r.z) > r.r + maxSpeed * (gap / 1000))
        return { ok: false, reason: 'does not start at the start ring' };
      next = 1;
      continue;
    }
    const p = i - 1;
    const px = trace[p * 5]!;
    const py = trace[p * 5 + 1]!;
    const pz = trace[p * 5 + 2]!;
    const pt = trace[p * 5 + 4]!;
    const dt = (t - pt) / 1000;
    if (dt <= 0) return { ok: false, reason: 'time goes backwards' };
    if (dt > 2) return { ok: false, reason: 'gap in the trace' };
    const d = Math.hypot(x - px, y - py, z - pz);
    // the samples' 0.1 m rounding + a frame of jitter
    if (d > maxSpeed * 1.08 * dt + 0.5) return { ok: false, reason: 'faster than a dragon flies' };
    // rings passed on this leg (a sample gap may cut inside a ring: widen by half a step)
    while (next < rings.length) {
      const r = rings[next]!;
      const wide = { ...r, r: r.r + d / 2 };
      if (!passes(wide, px, py, pz, x, y, z)) break;
      next++;
    }
  }
  if (next < rings.length) return { ok: false, reason: `missed ring ${next}` };
  return { ok: true, ms: trace[(n - 1) * 5 + 4]! };
}

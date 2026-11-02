// ── Frame-time statistics (pure) ────────────────────────────────────────
//
// A fixed ring of recent frame times plus per-system buckets, summarised
// as percentiles. No DOM, no three.js: the probe (perf/PerfProbe.ts) and
// the overlay feed it; tests cover it.

/** Ring buffer of the last `size` samples (Float64Array, no per-frame allocation). */
export class Ring {
  readonly buf: Float64Array;
  /** Samples written (total, not capped). */
  count = 0;

  constructor(readonly size: number) {
    this.buf = new Float64Array(size);
  }

  push(v: number) {
    this.buf[this.count % this.size] = v;
    this.count++;
  }

  /** Samples currently held. */
  get length(): number {
    return Math.min(this.count, this.size);
  }

  /** Copy of the held samples (oldest first). */
  values(): number[] {
    const n = this.length;
    const out = new Array<number>(n);
    const start = this.count > this.size ? this.count % this.size : 0;
    for (let i = 0; i < n; i++) out[i] = this.buf[(start + i) % this.size];
    return out;
  }

  clear() {
    this.count = 0;
  }
}

/** Nearest-rank percentile of a sorted array (p in 0..100); 0 when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const k = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, k))];
}

export interface FrameSummary {
  frames: number;
  /** Mean frames per second over the window (frames / summed frame time). */
  fps: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Frames over 50 ms (a visible hitch: 3+ vsyncs at 60 Hz). */
  hitches: number;
}

/** Summarise frame times (ms). */
export function summarize(ms: readonly number[]): FrameSummary {
  const s = [...ms].sort((a, b) => a - b);
  let sum = 0;
  let hitches = 0;
  for (const v of s) {
    sum += v;
    if (v > 50) hitches++;
  }
  const n = s.length;
  return {
    frames: n,
    fps: sum > 0 ? (n * 1000) / sum : 0,
    mean: n > 0 ? sum / n : 0,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: n > 0 ? s[n - 1] : 0,
    hitches,
  };
}

/** Per-system time: mean and p95 ms per frame, ranked by mean. */
export interface BucketSummary {
  name: string;
  mean: number;
  p95: number;
  max: number;
}

export function summarizeBuckets(buckets: ReadonlyMap<string, Ring>): BucketSummary[] {
  const out: BucketSummary[] = [];
  for (const [name, r] of buckets) {
    const v = r.values().sort((a, b) => a - b);
    if (v.length === 0) continue;
    let sum = 0;
    for (const x of v) sum += x;
    out.push({ name, mean: sum / v.length, p95: percentile(v, 95), max: v[v.length - 1] });
  }
  return out.sort((a, b) => b.mean - a.mean);
}

// ── Hitch log: what ran in each bad frame ───────────────────────────────

/** One frame that stalled: when, how long, and the systems that took the time. */
export interface HitchEntry {
  /** performance.now() at the frame's start (ms). */
  at: number;
  /** rAF interval that ended in this frame (ms; the gap the player saw). */
  frameMs: number;
  /** Main-thread ms inside Game.step this frame. */
  cpuMs: number;
  /** Systems over 2 ms this frame, biggest first: [name, ms]. */
  top: [string, number][];
}

/** A frame whose own work took this long is a hitch whatever the frame rate. */
export const HITCH_CPU_MS = 50;

/**
 * Is this frame a hitch? Either the game's own work took over 50 ms, or the
 * gap since the last frame was far longer than usual (3× the running median
 * and over 100 ms): something outside Game.step (GC, a long task, the
 * browser) held the main thread. Relative to the median because a slow
 * device (or headless software GL) misses 50 ms every frame.
 */
export function isHitch(frameMs: number, cpuMs: number, medianFrameMs: number): boolean {
  if (cpuMs > HITCH_CPU_MS) return true;
  return frameMs > 100 && frameMs > 3 * Math.max(medianFrameMs, 16.7);
}

/** The systems worth naming in a hitch: over `min` ms, biggest first, at most `n`. */
export function topSystems(acc: ReadonlyMap<string, number>, n = 5, min = 2): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, v] of acc) if (v >= min) out.push([k, Math.round(v * 10) / 10]);
  return out.sort((a, b) => b[1] - a[1]).slice(0, n);
}

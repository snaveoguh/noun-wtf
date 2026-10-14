// ── Reading a ride trace back: where the rider was at any moment ──
//
// A trace is [t, x, y, z, speed, state] samples (state 0 ground, 1 air,
// 2 grind, 3 manual, 4 bail), every 0.4 s on the ground and every 1/30 s in
// the air (thinner where a long ride was trimmed). Between two samples the
// position is interpolated: a straight line on the ground, a free-fall arc
// in the air (so a trimmed jump still flies a parabola), and the heading
// comes from the velocity around that moment.

const STRIDE = 6;
const AIR = 1;
const G = 12.5;

export const STATE_NAMES = ['GROUND', 'AIR', 'GRIND', 'MANUAL', 'BAIL'] as const;

export interface RunFrame {
  /** Seconds since the trace's first sample. */
  t: number;
  x: number;
  y: number;
  z: number;
  /** Velocity (m/s), from the samples around this moment. */
  vx: number;
  vy: number;
  vz: number;
  /** Speed as the game measured it (m/s). */
  speed: number;
  state: number;
  /** In the air: height above take-off and time aloft so far. */
  airM: number;
  airS: number;
}

export function runLength(s: Float32Array): number {
  const n = Math.floor(s.length / STRIDE);
  return n < 2 ? 0 : s[(n - 1) * STRIDE] - s[0];
}

/** Last sample index i with t_i ≤ t (binary search). */
function indexAt(s: Float32Array, t: number): number {
  const n = Math.floor(s.length / STRIDE);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid * STRIDE] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Velocity of the segment i → i+1 (zero for a missing one). */
function segVel(s: Float32Array, i: number, n: number): [number, number, number] {
  if (i < 0 || i + 1 >= n) return [0, 0, 0];
  const a = i * STRIDE;
  const b = a + STRIDE;
  const dt = s[b] - s[a];
  if (!(dt > 0)) return [0, 0, 0];
  return [(s[b + 1] - s[a + 1]) / dt, (s[b + 2] - s[a + 2]) / dt, (s[b + 3] - s[a + 3]) / dt];
}

/** The rider at `t` seconds into the run (clamped to its ends). */
export function sampleRun(s: Float32Array, tRel: number): RunFrame {
  const n = Math.floor(s.length / STRIDE);
  const t0 = s[0];
  const t = t0 + Math.max(0, Math.min(tRel, runLength(s)));
  const i = indexAt(s, t);
  const a = i * STRIDE;
  const j = Math.min(i + 1, n - 1);
  const b = j * STRIDE;
  const dt = s[b] - s[a];
  const u = dt > 0 ? (t - s[a]) / dt : 0;
  const tau = u * dt;
  const inAir = s[a + 5] === AIR && s[b + 5] === AIR && j !== i;
  const x = s[a + 1] + (s[b + 1] - s[a + 1]) * u;
  const z = s[a + 3] + (s[b + 3] - s[a + 3]) * u;
  // In the air the chord sags into the arc the rider actually flew
  let y = s[a + 2] + (s[b + 2] - s[a + 2]) * u;
  if (inAir) y += 0.5 * G * tau * (dt - tau);
  const speed = s[a + 4] + (s[b + 4] - s[a + 4]) * u;

  // Velocity: this segment's, blended toward the neighbours' near the ends
  const v = segVel(s, i, n);
  const prev = segVel(s, i - 1, n);
  const next = segVel(s, i + 1, n);
  const w = 0.5 - Math.abs(u - 0.5);
  const other = u < 0.5 ? prev : next;
  let vx = v[0] * (0.5 + w) + other[0] * (0.5 - w);
  let vy = v[1] * (0.5 + w) + other[1] * (0.5 - w);
  let vz = v[2] * (0.5 + w) + other[2] * (0.5 - w);
  if (inAir) vy = (s[b + 2] - s[a + 2]) / dt + G * (dt / 2 - tau);
  if (i === j) [vx, vy, vz] = prev;

  // Air so far: from the first air sample of this air
  let airM = 0;
  let airS = 0;
  if (s[a + 5] === AIR) {
    let k = i;
    while (k > 0 && s[(k - 1) * STRIDE + 5] === AIR) k--;
    const y0 = s[k * STRIDE + 2];
    let top = y;
    for (let q = k; q <= i; q++) top = Math.max(top, s[q * STRIDE + 2]);
    airM = Math.max(0, top - y0);
    airS = t - s[k * STRIDE];
  }
  return { t: t - t0, x, y, z, vx, vy, vz, speed, state: s[a + 5], airM, airS };
}

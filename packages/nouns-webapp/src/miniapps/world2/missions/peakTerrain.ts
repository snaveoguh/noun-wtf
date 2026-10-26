// ── The Big Drop: a 1,000 km snow peak behind the deepest door (pure) ──
//
// One analytic surface, in the peak's own coordinates: the summit pad is at
// the origin, y = 0, and the mountain falls away in every direction at a
// steady ~49° until it's 1,000 km down, then eases out onto a flat snowfield.
// On the way down: moguls, and kicker ridges across the fall line that throw
// you into long airs. No three.js here, so it's tested on its own and the
// dimension (peak.ts) only has to shift it into world space.

import { smoothstep, vnoise } from '../world/mountain/config';

export const PEAK = {
  /** Summit to the snowfield at the bottom (m). */
  drop: 1_000_000,
  /** Fall-line gradient once the slope is in (rise over run), about 49°. */
  grade: 1.15,
  /** Flat summit pad radius (m). */
  pad: 24,
  /** The gradient eases in over this far below the pad (m). */
  ease: 120,
  /** Width of the bend from the slope onto the flat snowfield (m of height). */
  runout: 4000,
  /** Kicker ridges across the fall line: one every `kickEvery` m of slope. */
  kickEvery: 520,
  /** Ridge height (m) at its tallest; it varies around the mountain. */
  kickHeight: 5,
  /** No kickers on the first stretch below the pad (m). */
  kickFrom: 400,
} as const;

/** Upper bound on |∇height| (the ray marcher's step size relies on it). */
export const PEAK_LIPSCHITZ = 1.6;

const SEED = 0x70656b;

const ss01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** w·ln(1 + e^(u/w)), without overflow either way. */
function softplus(u: number, w: number): number {
  return u > 0 ? u + w * Math.log1p(Math.exp(-u / w)) : w * Math.log1p(Math.exp(u / w));
}

/** Depth of the smooth cone (no detail) at `s` m out from the pad's edge, ≥ 0. */
export function coneDepth(s: number): number {
  if (s <= 0) return 0;
  const L = PEAK.ease;
  const g = PEAK.grade * (s - L * (1 - Math.exp(-s / L)));
  // Ease the last few km onto the snowfield instead of hitting it at 49°
  return PEAK.drop - softplus(PEAK.drop - g, PEAK.runout / 4);
}

/** A kicker's profile over one period: a 30 m lip up, a 70 m roll back down. */
function kick(phase: number): number {
  if (phase < 30) return ss01(phase / 30);
  if (phase < 100) return 1 - ss01((phase - 30) / 70);
  return 0;
}

/** Surface height at (x, z), peak coordinates (summit pad at y = 0). */
export function peakHeight(x: number, z: number): number {
  const s = Math.hypot(x, z) - PEAK.pad;
  if (s <= 0) return 0;
  const depth = coneDepth(s);
  // Detail fades in below the pad and out on the snowfield
  const on = smoothstep(0, 60, s) * (1 - smoothstep(PEAK.drop - 20_000, PEAK.drop, depth));
  if (on <= 0) return -depth;
  const moguls = 2.2 * vnoise(x / 80, z / 80, SEED + 1) + 0.7 * vnoise(x / 31, z / 31, SEED + 2);
  let ridge = 0;
  if (s > PEAK.kickFrom) {
    // Taller in some directions than others, so no two lines ride the same
    const size = 0.65 + 0.35 * vnoise(x / 400, z / 400, SEED + 3);
    ridge = PEAK.kickHeight * size * kick(s % PEAK.kickEvery);
  }
  return -depth + on * (moguls + ridge);
}

/** Unit surface normal at (x, z) (central differences). */
export function peakNormal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const e = 0.5;
  const gx = (peakHeight(x + e, z) - peakHeight(x - e, z)) / (2 * e);
  const gz = (peakHeight(x, z + e) - peakHeight(x, z - e)) / (2 * e);
  const l = Math.hypot(gx, 1, gz);
  out.x = -gx / l;
  out.y = 1 / l;
  out.z = -gz / l;
  return out;
}

/**
 * Ray-march a heightfield `h` whose slope never exceeds `lip`: the hit
 * distance along the unit ray, or -1. A ray that starts under the surface
 * pointing down hits at 0 (callers snap back up).
 */
export function raycastHeight(
  h: (x: number, z: number) => number,
  lip: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  far: number,
): number {
  const rate = lip * Math.hypot(dx, dz) + Math.max(0, -dy);
  let gap = oy - h(ox, oz);
  if (gap < 0) return dy < -0.2 ? 0 : -1;
  let t = 0;
  let prevT = 0;
  for (let i = 0; i < 160; i++) {
    if (gap < 0.002) return t;
    prevT = t;
    t += rate > 1e-6 ? Math.max(0.015, (gap / rate) * 0.95) : far + 1;
    if (t > far) t = far;
    gap = oy + dy * t - h(ox + dx * t, oz + dz * t);
    if (gap < 0) {
      let a = prevT;
      let b = t;
      for (let k = 0; k < 12; k++) {
        const m = (a + b) * 0.5;
        if (oy + dy * m - h(ox + dx * m, oz + dz * m) > 0) a = m;
        else b = m;
      }
      return (a + b) * 0.5;
    }
    if (t >= far) return -1;
  }
  return -1;
}

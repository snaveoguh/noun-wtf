// ── The Big Drop: a 1,000 km snow peak behind the deepest door (pure) ──
//
// One analytic surface, in the peak's own coordinates: the summit pad is at
// the origin, y = 0, and the mountain falls away in every direction at a
// steady ~49° until it's 1,000 km down, then eases out onto a flat snowfield.
// On the way down: moguls and ridges across the fall line, and the race
// track (bigdrop/track.ts) carved into it by bigdrop/terrainCarve.ts: a
// groomed lane, powder pillows, gullies, berms, kickers, loop pads. No
// three.js here, so it's tested on its own and the dimension (peak.ts) only
// has to shift it into world space.

import { smoothstep, vnoise } from '../world/mountain/config';

import { CARVED, trackCarve } from './bigdrop/terrainCarve';
import { coneDepth, PEAK } from './bigdrop/terrainPeak';

export { coneDepth, coneHeight, PEAK } from './bigdrop/terrainPeak';

/**
 * Upper bound on |∇height| (the ray marcher's step size relies on it). The
 * open mountain stays under 1.52 (a board counts ground with a normal above
 * 0.55); the only steeper faces are the short back faces right behind the
 * track's kicker lips (bigdrop/track.ts KickerShape), up to ~3.2.
 */
export const PEAK_LIPSCHITZ = 3.6;

const SEED = 0x70656b;

const ss01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** A kicker's profile over one period: a 30 m lip up, a 70 m roll back down. */
function kick(phase: number): number {
  if (phase < 30) return ss01(phase / 30);
  if (phase < 100) return 1 - ss01((phase - 30) / 70);
  return 0;
}

/** The open mountain's own detail at (x, z), `s` m out from the pad: moguls and ridges. */
function detail(x: number, z: number, s: number): number {
  const moguls = 2.2 * vnoise(x / 80, z / 80, SEED + 1) + 0.7 * vnoise(x / 31, z / 31, SEED + 2);
  let ridge = 0;
  if (s > PEAK.kickFrom) {
    // Taller in some directions than others, so no two lines ride the same
    const size = 0.65 + 0.35 * vnoise(x / 400, z / 400, SEED + 3);
    ridge = PEAK.kickHeight * size * kick(s % PEAK.kickEvery);
  }
  return moguls + ridge;
}

/**
 * Surface height at (x, z), peak coordinates (summit pad at y = 0): the
 * cone, its moguls and ridges, and the race track carved down it
 * (bigdrop/terrainCarve.ts).
 */
export function peakHeight(x: number, z: number): number {
  const s = Math.hypot(x, z) - PEAK.pad;
  if (s <= 0) return 0;
  const depth = coneDepth(s);
  // Detail fades in below the pad and out on the snowfield
  const on = smoothstep(0, 60, s) * (1 - smoothstep(PEAK.drop - 20_000, PEAK.drop, depth));
  if (on <= 0) return -depth;
  const carved = trackCarve(x, z, -depth);
  if (carved !== carved) return -depth + on * detail(x, z, s);
  const keep = CARVED.keep;
  return -depth + on * (keep > 0 ? carved + keep * detail(x, z, s) : carved);
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

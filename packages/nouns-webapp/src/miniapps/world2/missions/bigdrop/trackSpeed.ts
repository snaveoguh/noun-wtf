// ── The Big Drop's expected speed down the line (pure) ──────────────────
//
// The track is designed in seconds, not metres: a rider who doesn't bail is
// past 500 km/h within a minute and 2,000 km/h later, so a 260 m slalom wave
// or a 300 m kicker spacing that suits the first kilometre is a blur by the
// twentieth. This integrates the board's own mountain physics (Player.ts:
// gravity along a 49° slope at 40%, rolling friction, air drag that eases
// off with distance ridden, the ride-streak push) once, from a standing
// start on the summit pad, and tabulates the speed by track distance. The
// track scales its sections, weaves and kickers by it (trackScale). Over
// the SSX course at the top the board is governed (courseSpec.ts
// courseCap), so the table is too.

import { courseCap } from './courseSpec';
import { PEAK } from './terrainPeak';

/** Gravity inside the Big Drop: 12.5 m/s² (Player tuning) × 0.4 (peak.ts PEAK_GRAVITY). */
export const PEAK_G = 12.5 * 0.4;
/** The fall line's angle below horizontal (rad). */
export const SLOPE_ANGLE = Math.atan(PEAK.grade);
/** Gravity along the slope and into it (m/s²). */
export const G_ALONG = PEAK_G * Math.sin(SLOPE_ANGLE);
export const G_NORMAL = PEAK_G * Math.cos(SLOPE_ANGLE);
/** Metres of slope per metre of peak z. */
export const SLOPE_PER_Z = Math.hypot(1, PEAK.grade);

// Player.ts on the mountain: friction 0.1, drag 0.0035 × peak.ts PEAK_DRAG
// 0.15, divided by (1 + run / 400); +0.35 m/s² per minute of riding
const FRICTION = 0.1;
const DRAG = 0.0035 * 0.15;
const RUN_DRAG_K = 400;
const STREAK = 0.35 / 60;

/** Table spacing (m of track distance). */
const STEP = 100;
const Z0 = PEAK.pad;
const Z_END = PEAK.pad + PEAK.drop / PEAK.grade + 10_000;

let speed: Float64Array | null = null;
let scaleInt: Float64Array | null = null;

function build() {
  const n = Math.ceil((Z_END - Z0) / STEP) + 2;
  const v = new Float64Array(n);
  let t = 0;
  let sp = 4;
  let run = 0;
  let z = Z0;
  const dt = 0.02;
  v[0] = sp;
  let next = 1;
  while (next < n) {
    const a =
      G_ALONG -
      FRICTION -
      (DRAG / (1 + run / RUN_DRAG_K)) * sp * sp +
      (sp > 30 / 3.6 ? STREAK * t : 0);
    sp = Math.min(courseCap(z), Math.max(1, sp + a * dt));
    const d = sp * dt;
    run += d;
    z += d / SLOPE_PER_Z;
    t += dt;
    while (next < n && z >= Z0 + next * STEP) v[next++] = sp;
  }
  speed = v;
  // ∫ ds / scale, for weaves whose wavelength grows with the speed
  const I = new Float64Array(n);
  for (let i = 1; i < n; i++)
    I[i] = I[i - 1]! + STEP * 0.5 * (1 / scaleOf(v[i - 1]!) + 1 / scaleOf(v[i]!));
  scaleInt = I;
}

function scaleOf(v: number): number {
  return Math.min(5, Math.max(1, v / 120));
}

function lerpTable(tab: Float64Array, s: number): number {
  const f = (Math.max(Z0, s) - Z0) / STEP;
  const i = Math.min(tab.length - 2, Math.floor(f));
  const k = Math.min(1, f - i);
  return tab[i]! + (tab[i + 1]! - tab[i]!) * k;
}

/** Expected speed (m/s) of a clean run at track distance `s`, from a standing start. */
export function expectedSpeed(s: number): number {
  if (speed === null) build();
  return lerpTable(speed!, s);
}

/** How much bigger the track is drawn at `s`: 1 near the top, up to 5 deep down. */
export function trackScale(s: number): number {
  return scaleOf(expectedSpeed(s));
}

/** ∫ ds / trackScale(s) from the top of the track: a distance that ticks slower deep down. */
export function scaledDistance(s: number): number {
  if (scaleInt === null) build();
  if (s <= Z0) return s - Z0;
  return lerpTable(scaleInt!, s);
}

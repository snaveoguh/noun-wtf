// ── Noun Football: kick solving (pure) ──────────────────────────────────
//
// Turns "hit it there, this hard, with this curl" into a launch velocity
// by flying the real ball physics (ball.ts) and correcting the aim a few
// times, so a curled shot really does bend back inside the post and a
// driven shot really does dip under the bar.

import type { BallState, PitchSpec } from '../contract';

import { newHits, stepBall, type BallCtx } from './ball';

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
}

const _b: BallState = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  wx: 0,
  wy: 0,
  wz: 0,
  mode: 'free',
  owner: null,
  lastTouch: null,
};
const _hits = newHits();
const _ctx: BallCtx = { inGoal: 0 };

/**
 * Fly a launch until it has covered the horizontal distance to the target
 * (or lands / 3 s). Returns where it was then: across-error (+ = left of
 * the line of the kick), height, and time.
 */
function fly(
  p: PitchSpec,
  x: number,
  y: number,
  z: number,
  l: Launch,
  tx: number,
  tz: number,
): { lat: number; y: number; t: number; reached: boolean } {
  const b = _b;
  b.x = x;
  b.y = y;
  b.z = z;
  b.vx = l.vx;
  b.vy = l.vy;
  b.vz = l.vz;
  b.wx = l.wx;
  b.wy = l.wy;
  b.wz = l.wz;
  _ctx.inGoal = 0;
  const dx = tx - x;
  const dz = tz - z;
  const D = Math.hypot(dx, dz) || 1;
  const ux = dx / D;
  const uz = dz / D;
  const dt = 1 / 120;
  let t = 0;
  let px = b.x;
  let pz = b.z;
  let py = b.y;
  for (; t < 3; t += dt) {
    px = b.x;
    pz = b.z;
    py = b.y;
    // No woodwork or nets while aiming (we want the free path)
    flightOnly(b, p, dt);
    const along = (b.x - x) * ux + (b.z - z) * uz;
    if (along >= D) {
      // interpolate to the crossing
      const a0 = (px - x) * ux + (pz - z) * uz;
      const f = (D - a0) / Math.max(1e-6, along - a0);
      const cx = px + (b.x - px) * f;
      const cz = pz + (b.z - pz) * f;
      const cy = py + (b.y - py) * f;
      // left of the kick line: (−uz, ux)·… in three.js handedness left of +z is +x
      const lat = (cx - tx) * uz - (cz - tz) * ux;
      return { lat, y: cy, t: t + dt * f, reached: true };
    }
  }
  return { lat: 0, y: b.y, t, reached: false };
}

/** Free flight + the ground (no goals), for aiming. */
function flightOnly(b: BallState, p: PitchSpec, dt: number) {
  // Re-use stepBall with a pitch that has no goal frame nearby: the aim
  // happens in open play coordinates, so posts are far unless shooting at
  // them, and then we want the unobstructed path anyway.
  stepBall(b, NO_GOALS(p), _ctx, dt, _hits);
}

let noGoalsFor: PitchSpec | null = null;
let noGoals: PitchSpec | null = null;
function NO_GOALS(p: PitchSpec): PitchSpec {
  if (noGoalsFor !== p) {
    noGoalsFor = p;
    // Goals pushed far away: pure flight
    noGoals = { ...p, length: 1e6 };
  }
  return noGoals!;
}

/**
 * Launch that passes through (tx, ty, tz) at horizontal speed ~`speed`,
 * with sidespin `spinY` (+ curls left in three.js terms: toward +x when
 * kicking along +z) and top/back spin `spinTop` (+ = topspin).
 */
export function aimKick(
  p: PitchSpec,
  x: number,
  y: number,
  z: number,
  tx: number,
  ty: number,
  tz: number,
  speed: number,
  spinY: number,
  spinTop: number,
): Launch {
  const dx = tx - x;
  const dz = tz - z;
  const D = Math.max(0.5, Math.hypot(dx, dz));
  let yaw = Math.atan2(dx, dz);
  const T0 = D / speed;
  let vy = (ty - y) / T0 + 0.5 * 9.81 * T0;
  const l: Launch = { vx: 0, vy: 0, vz: 0, wx: 0, wy: spinY, wz: 0 };
  for (let it = 0; it < 4; it++) {
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    l.vx = sx * speed;
    l.vz = sz * speed;
    l.vy = vy;
    // Topspin axis is the kick's "right": w = spinTop · (cos, 0, −sin)
    l.wx = spinTop * sz;
    l.wz = -spinTop * sx;
    l.wy = spinY;
    const r = fly(p, x, y, z, l, tx, tz);
    if (!r.reached) {
      vy += 2;
      continue;
    }
    // Lateral error → turn the aim the other way
    yaw -= Math.atan2(r.lat, D) * 1.0;
    // Height error → adjust launch vy by the time of flight
    vy += (ty - r.y) / Math.max(0.15, r.t);
  }
  return l;
}

/** Point on the target goal frame for an aim (−1..1 across, 0..1 height) at end s. */
export function goalPoint(p: PitchSpec, s: number, ax: number, ay: number) {
  return {
    x: ax * (p.goalWidth / 2 - 0.3),
    y: 0.25 + ay * (p.goalHeight - 0.4),
    z: (s * p.length) / 2 + s * 0.3,
  };
}

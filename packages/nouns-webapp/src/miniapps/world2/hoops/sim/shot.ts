// Shot solving: find the launch velocity that puts the ball through a target
// point on the rim plane (directly, or off the glass), using the very same
// integrator the live ball runs on, so a zero-error solve really swishes.

import type { CourtGeo, Vec3 } from './court';

import { SIM_DT } from '../contract';

import { type BallBody, GRAVITY, newContacts, resetContacts, stepBall } from './ball';

// Same step as the live sim, so predictions match the real flight exactly.
const PDT = SIM_DT;

function body(from: Vec3, v: Vec3, spin: Vec3): BallBody {
  return {
    x: from.x,
    y: from.y,
    z: from.z,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    sx: spin.x,
    sy: spin.y,
    sz: spin.z,
  };
}

/** Backspin (rad/s) for a shot travelling along horizontal (dx, dz). */
export function backspin(dx: number, dz: number, rate = 9): Vec3 {
  const l = Math.hypot(dx, dz) || 1;
  // Axis = up × dir (to the shooter's left); backspin rotates negatively about it.
  return { x: (-dz / l) * -rate, y: 0, z: (dx / l) * -rate };
}

const contacts = newContacts();

/**
 * Where the ball crosses the plane y = planeY on the way down (rim collisions
 * off, board on). Returns null if it never gets there.
 */
function crossing(
  geo: CourtGeo,
  from: Vec3,
  v: Vec3,
  spin: Vec3,
  planeY: number,
): { x: number; z: number } | null {
  const b = body(from, v, spin);
  let apex = false;
  for (let i = 0; i < 240; i++) {
    const px = b.x;
    const py = b.y;
    const pz = b.z;
    resetContacts(contacts);
    stepBall(b, PDT, geo, contacts, true);
    if (b.vy < 0) apex = true;
    if (apex && py >= planeY && b.y < planeY) {
      const f = (py - planeY) / Math.max(1e-9, py - b.y);
      return { x: px + (b.x - px) * f, z: pz + (b.z - pz) * f };
    }
    // Topped out below the plane (or fell back under it): it never gets there.
    if ((apex && b.y < planeY) || b.y < 0.3) return null;
  }
  return null;
}

/**
 * Launch velocity at elevation `elev` (rad) that brings the ball down
 * through `target` (on the rim plane). `bank`: aim off the backboard of rim
 * `rimIdx`.
 */
export function solveShot(
  geo: CourtGeo,
  from: Vec3,
  target: Vec3,
  elev: number,
  bank: boolean,
  rimIdx: 0 | 1,
  spinRate = 9,
): Vec3 {
  return solveAim(geo, from, target, elev, bank, rimIdx, null, 8, spinRate).v;
}

/** Launch speed + heading (a solve's result, reusable as a warm start). */
export interface Aim {
  speed: number;
  yaw: number;
}

/**
 * solveShot with a warm start: aim points a few cm apart need only a couple
 * of Newton steps from a neighbouring solution.
 */
export function solveAim(
  geo: CourtGeo,
  from: Vec3,
  target: Vec3,
  elev: number,
  bank: boolean,
  rimIdx: 0 | 1,
  init: Aim | null = null,
  iters = 8,
  spinRate = 9,
): { v: Vec3; aim: Aim } {
  const ax = target.x;
  let az = target.z;
  if (bank) {
    // Mirror the target through the board's contact plane, stretched for
    // the board's restitution (the bounce keeps only e of the normal speed).
    const s = geo.sign[rimIdx];
    const plane = geo.boardFace[rimIdx] - s * geo.spec.ballRadius;
    const d2 = Math.abs(plane - target.z);
    az = plane + s * (d2 / 0.6);
  }
  const dx0 = ax - from.x;
  const dz0 = az - from.z;
  let yaw = Math.atan2(dx0, dz0);
  const D = Math.hypot(dx0, dz0);
  const H = target.y - from.y;
  const c = Math.cos(elev);
  const t = Math.tan(elev);
  const den = 2 * c * c * Math.max(0.05, D * t - H);
  let speed = Math.sqrt((GRAVITY * D * D) / den);
  if (init !== null) {
    speed = init.speed;
    yaw = init.yaw;
  }
  const spinOf = (y: number) => backspin(Math.sin(y), Math.cos(y), spinRate);
  const vel = (sp: number, y: number): Vec3 => ({
    x: Math.sin(y) * c * sp,
    y: Math.sin(elev) * sp,
    z: Math.cos(y) * c * sp,
  });
  // Residual in (along, lateral) of the aim direction.
  const resid = (sp: number, y: number): [number, number] | null => {
    const p = crossing(geo, from, vel(sp, y), spinOf(y), target.y);
    if (p === null) return null;
    const ex = p.x - target.x;
    const ez = p.z - target.z;
    if (!bank) {
      const sy = Math.sin(y);
      const cy = Math.cos(y);
      return [ex * sy + ez * cy, ex * cy - ez * sy];
    }
    // Off the glass the "along" axis flips; just use world x / z.
    return [ez * geo.sign[rimIdx] * -1, ex];
  };
  for (let it = 0; it < iters; it++) {
    const r0 = resid(speed, yaw);
    if (r0 === null) {
      speed *= 1.08;
      continue;
    }
    if (Math.abs(r0[0]) < 0.002 && Math.abs(r0[1]) < 0.002) break;
    const ds = 0.02;
    const dy = 0.002;
    const rs = resid(speed + ds, yaw);
    const ry = resid(speed, yaw + dy);
    if (rs === null || ry === null) {
      speed *= 1.03;
      continue;
    }
    const j00 = (rs[0] - r0[0]) / ds;
    const j10 = (rs[1] - r0[1]) / ds;
    const j01 = (ry[0] - r0[0]) / dy;
    const j11 = (ry[1] - r0[1]) / dy;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-9) break;
    let dS = (-r0[0] * j11 + r0[1] * j01) / det;
    let dY = (-j00 * r0[1] + j10 * r0[0]) / det;
    dS = Math.max(-2, Math.min(2, dS));
    dY = Math.max(-0.2, Math.min(0.2, dY));
    speed += dS;
    yaw += dY;
  }
  return { v: vel(speed, yaw), aim: { speed, yaw } };
}

export interface Prediction {
  made: boolean;
  rim: boolean;
  board: boolean;
}

/** Fly a ball with full physics (rims on) and see whether it goes through rim `rimIdx`. */
export function predict(
  geo: CourtGeo,
  from: Vec3,
  v: Vec3,
  spin: Vec3,
  rimIdx: number,
  maxT = 4,
): Prediction {
  const b = body(from, v, spin);
  const out: Prediction = { made: false, rim: false, board: false };
  const steps = Math.round(maxT / PDT);
  for (let i = 0; i < steps; i++) {
    resetContacts(contacts);
    stepBall(b, PDT, geo, contacts);
    if (contacts.rim > 0) out.rim = true;
    if (contacts.board > 0) out.board = true;
    if (contacts.through === rimIdx) {
      out.made = true;
      return out;
    }
    if (contacts.floor > 0 || (b.y < geo.spec.rimHeight - 0.6 && b.vy < 0)) return out;
  }
  return out;
}

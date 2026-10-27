// ── 3D Grand Exchange: you, on foot (pure) ──────────────────────────────
//
// Your own rider walks the floor: WASD / arrows / a touch stick, relative
// to the camera, Shift to run. The floor plan (layout.ts) keeps you inside
// the walls and out of the board tower; the pit tiers lift you step by
// step. No three.js and no clock: `stepWalker(w, input, camAz, dt)`.

import { clampToFloor, DOOR, floorHeight } from './layout';

export interface WalkInput {
  /** -1 … 1: forward (away from the camera) / back. */
  fwd: number;
  /** -1 … 1: right / left. */
  side: number;
  run: boolean;
}

export interface Walker {
  x: number;
  y: number;
  z: number;
  /** Facing (rad, 0 = +z, as atan2(dx, dz)). */
  heading: number;
  vx: number;
  vz: number;
  /** Ground speed (m/s). */
  speed: number;
}

export const WALK = {
  walk: 2.4,
  run: 5.2,
  /** How fast you get up to speed / stop (1/s). */
  accel: 10,
  /** Turn rate (rad/s). */
  turn: 11,
  /** Keep this far from the walls. */
  margin: 0.8,
} as const;

export const NO_INPUT: WalkInput = { fwd: 0, side: 0, run: false };

/** Just inside the door, facing into the hall. */
export function spawnWalker(): Walker {
  return { x: DOOR.x, y: 0, z: DOOR.z + 3, heading: 0, vx: 0, vz: 0, speed: 0 };
}

/**
 * The ground direction an input means, for a camera at azimuth `camAz`
 * (cameras.ts orbit: the camera sits at +sin/+cos of az from its target,
 * so "forward" is the other way).
 */
export function inputDir(i: WalkInput, camAz: number): { x: number; z: number } {
  const fx = -Math.sin(camAz);
  const fz = -Math.cos(camAz);
  // Right of forward, y up
  const rx = -fz;
  const rz = fx;
  let x = fx * i.fwd + rx * i.side;
  let z = fz * i.fwd + rz * i.side;
  const m = Math.hypot(x, z);
  if (m > 1) {
    x /= m;
    z /= m;
  }
  return { x, z };
}

export function stepWalker(w: Walker, i: WalkInput, camAz: number, dt: number): Walker {
  if (!(dt > 0)) return w;
  dt = Math.min(dt, 0.1);
  const d = inputDir(i, camAz);
  const top = i.run ? WALK.run : WALK.walk;
  const k = 1 - Math.exp(-WALK.accel * dt);
  w.vx += (d.x * top - w.vx) * k;
  w.vz += (d.z * top - w.vz) * k;
  if (Math.hypot(w.vx, w.vz) < 0.02 && d.x === 0 && d.z === 0) {
    w.vx = 0;
    w.vz = 0;
  }
  const nx = w.x + w.vx * dt;
  const nz = w.z + w.vz * dt;
  const c = clampToFloor(nx, nz, WALK.margin);
  // Blocked (wall / tower): lose the speed into it
  if (dt > 0) {
    w.vx = (c.x - w.x) / dt;
    w.vz = (c.z - w.z) / dt;
  }
  w.x = c.x;
  w.z = c.z;
  w.speed = Math.hypot(w.vx, w.vz);
  const fh = floorHeight(w.x, w.z);
  w.y += (fh - w.y) * Math.min(1, dt * 14);
  // Face where you're going
  if (d.x !== 0 || d.z !== 0) {
    const want = Math.atan2(d.x, d.z);
    let a = want - w.heading;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    w.heading += Math.sign(a) * Math.min(Math.abs(a), WALK.turn * dt);
  }
  return w;
}

/** The rig clip for a walker. */
export function walkerClip(w: Walker): 'idle' | 'walk' | 'run' {
  if (w.speed > 3.4) return 'run';
  if (w.speed > 0.25) return 'walk';
  return 'idle';
}

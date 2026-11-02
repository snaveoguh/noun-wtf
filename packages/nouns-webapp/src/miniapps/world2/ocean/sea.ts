// ── The sea at a world point (CPU): coast coords + the wave field ────────
//
// What boards, swimmers, buoys and boats float on: coast.ts gives the
// distance into the sea and along the coast, waves.ts the surface. One
// shared clock (seaClock) keeps everyone on the same wave: it's the game's
// wall clock, so other players' surfers ride the crests you see.

import {
  coastAt,
  coastFrame,
  seabedDepth,
  shoreward,
  type CoastFrame,
  type CoastPoint,
} from './coast';
import { SEA_WRAP, seaSample, type SeaSample } from './waves';

export interface SeaPoint extends SeaSample {
  /** Shoreward unit direction (world, horizontal). */
  sx: number;
  sz: number;
  /** +a (down the coast: the way the waves peel) unit direction. */
  ax: number;
  az: number;
  /** Coast distance of the point itself (m into the sea, < 0 on land). */
  d: number;
  /** Seabed height under the point (world y). */
  bed: number;
}

export const blankSea = (): SeaPoint => ({
  y: 0,
  d0: 0,
  a: 0,
  phi: 0,
  A: 0,
  k: 0.1,
  c: 6,
  depth: 0,
  ratio: 0,
  broken: 0,
  foam: 0,
  flow: 0,
  sx: 0,
  sz: 1,
  ax: 1,
  az: 0,
  d: 0,
  bed: 0,
});

const _cp: CoastPoint = { d: 0, a: 0, u: 0, vp: 0 };
const _dir = { x: 0, z: 0 };

/** The sea surface at (x, z) at time t (null: no ocean here / not placed yet). */
export function seaAt(
  x: number,
  z: number,
  t: number,
  out: SeaPoint,
  frame: CoastFrame | null = coastFrame(),
): SeaPoint | null {
  const c = frame;
  if (c === null || x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return null;
  const p = coastAt(c, x, z, _cp);
  if (p.d < -40) return null;
  seaSample(c.sea, p.d, p.a, x - c.ox, z - c.oz, t, out);
  shoreward(c, x, z, _dir);
  out.sx = _dir.x;
  out.sz = _dir.z;
  out.ax = c.fx;
  out.az = c.fz;
  out.d = p.d;
  out.bed = c.sea - seabedDepth(p.d);
  return out;
}

/** Height-only (cheaper callers still go through the same maths). */
export function seaHeight(x: number, z: number, t: number, tmp: SeaPoint): number | null {
  return seaAt(x, z, t, tmp)?.y ?? null;
}

/**
 * Surface slope (dy/dx, dy/dz) by central differences: exactly the field
 * the rider sees, Gerstner shift and chop included.
 */
export function seaSlope(
  x: number,
  z: number,
  t: number,
  tmp: SeaPoint,
  out: { x: number; z: number },
  e = 0.4,
) {
  const a = seaAt(x + e, z, t, tmp)?.y;
  const b = seaAt(x - e, z, t, tmp)?.y;
  const c = seaAt(x, z + e, t, tmp)?.y;
  const d = seaAt(x, z - e, t, tmp)?.y;
  out.x = a !== undefined && b !== undefined ? (a - b) / (2 * e) : 0;
  out.z = c !== undefined && d !== undefined ? (c - d) / (2 * e) : 0;
  return out;
}

/** The game's sea clock (s): wall time, so every client sees the same waves. */
export function seaClock(nowMs: number = Date.now()): number {
  // Wrapped (seamlessly, see SEA_WRAP) to keep float32 phases precise on the GPU
  return (nowMs / 1000) % SEA_WRAP;
}

// ── The plaza's ring of buildings as an occluder (pure) ─────────────────
//
// From the plaza floor the ring hides almost all of the mountain: every
// block stands from the street to a roof of at least 6.8 m along the whole
// facade line (|x| or |z| = 76), and the only openings are the three alley
// mouths. Phones pay ~0.2 ms per draw call, and the mountain chunks round
// the city were ~70 draws from the plaza, all behind the buildings. This
// says, conservatively, when a box out there can't be seen from a camera
// inside the square: when in doubt it's visible.

import { ALLEYS, ALLEY_O0, alleyToWorld } from './config';

/** The lowest roof anywhere on the ring (m); the facade is solid up to it. */
export const RING_MIN_ROOF = 6.8;
/** Camera must be at least this far inside the facade line. */
const INSIDE = ALLEY_O0 - 0.5;
/**
 * Margins (m). Callers rerun the test only after the camera has moved
 * `RERUN_MOVE`, so both stay above it: a sight line moves less than the
 * camera does where it crosses the facade.
 */
export const RERUN_MOVE = 0.6;
/** Treat a sight line this close under the roof line as clearing it. */
const ROOF_MARGIN = 0.75;
/** Alley mouths count this much wider each side. */
const MOUTH_MARGIN = 0.75;

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Alley mouth edges on the facade line (world x, z), two per alley. */
const MOUTHS: [number, number, number, number][] = ALLEYS.map(al => {
  const p = { x: 0, z: 0 };
  const half = al.width / 2 + MOUTH_MARGIN;
  alleyToWorld(al, al.a - half, ALLEY_O0, p);
  const x0 = p.x;
  const z0 = p.z;
  alleyToWorld(al, al.a + half, ALLEY_O0, p);
  return [x0, z0, p.x, p.z];
});

/**
 * Fraction t along camera→(px, pz) where the sight line leaves the square
 * at the facade line (the line starts inside it).
 */
function exitT(cx: number, cz: number, px: number, pz: number): number {
  let t = Infinity;
  const dx = px - cx;
  const dz = pz - cz;
  if (dx > 1e-9) t = Math.min(t, (ALLEY_O0 - cx) / dx);
  else if (dx < -1e-9) t = Math.min(t, (-ALLEY_O0 - cx) / dx);
  if (dz > 1e-9) t = Math.min(t, (ALLEY_O0 - cz) / dz);
  else if (dz < -1e-9) t = Math.min(t, (-ALLEY_O0 - cz) / dz);
  return t;
}

/**
 * Direction of (x, z) from the camera relative to the reference direction
 * (rx, rz), as a pseudo-angle in (−2, 2] that orders like the angle in
 * (−π, π] (no trig: this runs for every prop mesh as the camera moves).
 */
function relAngle(cx: number, cz: number, x: number, z: number, rx: number, rz: number) {
  const dx = x - cx;
  const dz = z - cz;
  const c = rx * dz - rz * dx;
  const d = rx * dx + rz * dz;
  const ac = Math.abs(c);
  if (d >= 0) return ac + d === 0 ? 0 : c / (d + ac);
  return (c < 0 ? -1 : 1) * (2 - ac / (ac - d));
}

/**
 * Is every part of `b` hidden from a camera at (cx, cy, cz) by the ring?
 * False whenever the camera isn't well inside the square, the box reaches
 * into the square, it could show through an alley mouth, or a sight line
 * to its top could pass over the roofs.
 */
export function ringHides(cx: number, cy: number, cz: number, b: Aabb): boolean {
  if (Math.max(Math.abs(cx), Math.abs(cz)) >= INSIDE) return false;
  // Wholly outside the facade line on some side
  if (!(b.minX >= ALLEY_O0 || b.maxX <= -ALLEY_O0 || b.minZ >= ALLEY_O0 || b.maxZ <= -ALLEY_O0))
    return false;

  // Through an alley mouth: the box's angular span from the camera overlaps a mouth's
  const mx = (b.minX + b.maxX) / 2;
  const mz = (b.minZ + b.maxZ) / 2;
  let rx = mx - cx;
  let rz = mz - cz;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [b.minX, b.maxX])
    for (const z of [b.minZ, b.maxZ]) {
      const a = relAngle(cx, cz, x, z, rx, rz);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  for (const [x0, z0, x1, z1] of MOUTHS) {
    const a0 = relAngle(cx, cz, x0, z0, rx, rz);
    const a1 = relAngle(cx, cz, x1, z1, rx, rz);
    // A mouth behind the camera (or spanning the back) can't show this box
    if (Math.abs(a0 - a1) > 2) continue;
    if (Math.max(a0, a1) >= lo && Math.min(a0, a1) <= hi) return false;
  }

  // Over the roofs: the sight line to any point of the box's top must pass
  // the facade line below the lowest roof. A lower point at the same spot is
  // hidden whenever the top one is, so the top face is enough.
  const h = b.maxY;
  const roof = RING_MIN_ROOF - ROOF_MARGIN;
  if (h <= cy && cy < roof) return true;
  const nx = Math.min(Math.max(cx, b.minX), b.maxX);
  const nz = Math.min(Math.max(cz, b.minZ), b.maxZ);
  for (const x of [b.minX, mx, b.maxX, nx])
    for (const z of [b.minZ, mz, b.maxZ, nz]) {
      const t = exitT(cx, cz, x, z);
      if (!(t > 0 && t <= 1)) return false;
      const y = cy + (h - cy) * t;
      if (y >= roof) return false;
    }
  return true;
}

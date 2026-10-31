// ── CAMP's window as a portal (pure, tested) ────────────────────────────
//
// From inside CAMP the walls hide everything but what's seen through the
// window, but frustum culling doesn't know that: the whole city behind the
// walls was still drawn (a weak phone pays ~0.2 ms a draw). From a camera
// inside the room, a box can only be seen if it's in the room or in the
// pyramid from the camera through the window opening. The pyramid only
// depends on where the camera is (not where it looks), so it's rerun when
// the camera moves. Conservative: when in doubt, it's visible.

import type { Aabb } from '../mountain/ringOcclusion';

/** A plane n·p + d ≥ 0 is the kept side. */
export interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

export interface Portal {
  /** The window opening (world): it lies in the plane z = `z`. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
}

const plane = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): Plane => {
  // Normal of the triangle a, b, c (counter-clockwise = kept side)
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { nx: nx / l, ny: ny / l, nz: nz / l, d: -(nx * ax + ny * ay + nz * az) / l };
};

/**
 * The pyramid through the window from a camera at (cx, cy, cz), on the
 * room side of the window (cz > portal.z): four side planes and the
 * window's own plane, slackened by `margin` metres.
 */
export function portalPlanes(cx: number, cy: number, cz: number, w: Portal, margin = 0.3): Plane[] {
  const x0 = w.x0 - margin;
  const x1 = w.x1 + margin;
  const y0 = w.y0 - margin;
  const y1 = w.y1 + margin;
  const z = w.z;
  const out: Plane[] = [
    plane(cx, cy, cz, x0, y1, z, x0, y0, z), // left edge
    plane(cx, cy, cz, x1, y0, z, x1, y1, z), // right edge
    plane(cx, cy, cz, x0, y0, z, x1, y0, z), // sill
    plane(cx, cy, cz, x1, y1, z, x0, y1, z), // head
    { nx: 0, ny: 0, nz: -1, d: z + margin }, // beyond the window
  ];
  // Orient each side plane so the window's centre is on its kept side
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  for (const p of out.slice(0, 4))
    if (p.nx * mx + p.ny * my + p.nz * (z - 1) + p.d < 0) {
      p.nx = -p.nx;
      p.ny = -p.ny;
      p.nz = -p.nz;
      p.d = -p.d;
    }
  return out;
}

/** Is any of the box on the kept side of every plane? (Conservative.) */
export function boxInPlanes(planes: readonly Plane[], b: Aabb): boolean {
  for (const p of planes) {
    // The box corner furthest along the normal
    const x = p.nx >= 0 ? b.maxX : b.minX;
    const y = p.ny >= 0 ? b.maxY : b.minY;
    const z = p.nz >= 0 ? b.maxZ : b.minZ;
    if (p.nx * x + p.ny * y + p.nz * z + p.d < 0) return false;
  }
  return true;
}

export function boxesOverlap(a: Aabb, b: Aabb): boolean {
  return (
    a.minX <= b.maxX &&
    b.minX <= a.maxX &&
    a.minY <= b.maxY &&
    b.minY <= a.maxY &&
    a.minZ <= b.maxZ &&
    b.minZ <= a.maxZ
  );
}

/** Can a camera inside the room see this box (in the room, or through the window)? */
export function seenFromRoom(planes: readonly Plane[], room: Aabb, b: Aabb): boolean {
  return boxesOverlap(room, b) || boxInPlanes(planes, b);
}

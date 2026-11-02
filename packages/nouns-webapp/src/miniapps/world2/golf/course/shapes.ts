// ── Noun Golf: ground shapes (pure) ──────────────────────────────────────
//
// Approximate signed distances (m, negative inside) for the contract's
// Shape (wobbly blobs, rounded rects) and Ribbon (a polyline with a half
// width per point). Approximate is enough: they decide lies and blend
// heights, and both the sim and the view read the same numbers.

import type { Ribbon, Shape, V2 } from '../contract';

/** Signed distance from (x, z) to the shape's edge (negative inside). */
export function shapeDist(s: Shape, x: number, z: number): number {
  const dx = x - s.x;
  const dz = z - s.z;
  if (s.kind === 'blob') {
    const c = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    const lx = (dx * c - dz * sn) / s.sx;
    const lz = dx * sn + dz * c;
    const l = Math.sqrt(lx * lx + lz * lz);
    if (l < 1e-9) return -s.r * Math.min(1, s.sx);
    const cx = lx / l;
    const cz = lz / l;
    // cos 2θ, sin 2θ, cos 3θ, sin 3θ from the unit vector (no atan2)
    const c2 = cx * cx - cz * cz;
    const s2 = 2 * cx * cz;
    const c3 = cx * c2 - cz * s2;
    const s3 = cz * c2 + cx * s2;
    const k = s.k;
    const R = s.r * (1 + k[0] * c2 + k[1] * s2 + k[2] * c3 + k[3] * s3);
    return (l - R) * Math.min(1, s.sx);
  }
  // Rounded rect: local z along yaw (forward), x across (right)
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const lx = dx * fz - dz * fx;
  const lz = dx * fx + dz * fz;
  const qx = Math.abs(lx) - s.hw + s.round;
  const qz = Math.abs(lz) - s.hl + s.round;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - s.round;
}

/** Union of shapes. */
export function unionDist(shapes: Shape[], x: number, z: number): number {
  let d = Infinity;
  for (const s of shapes) d = Math.min(d, shapeDist(s, x, z));
  return d;
}

/** Bounding circle radius of a shape (around s.x, s.z). */
export function shapeRadius(s: Shape): number {
  if (s.kind === 'blob') {
    const w = 1 + Math.abs(s.k[0]) + Math.abs(s.k[1]) + Math.abs(s.k[2]) + Math.abs(s.k[3]);
    return s.r * Math.max(1, s.sx) * w;
  }
  return Math.sqrt(s.hw * s.hw + s.hl * s.hl);
}

/**
 * Signed distance to a ribbon (negative inside) and the along-ribbon
 * position of the nearest point (0..1 of its length), in `out`.
 */
export function ribbonDist(r: Ribbon, x: number, z: number, out?: { t: number }): number {
  const p = r.pts;
  let best = Infinity;
  let bestT = 0;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < p.length; i++) total += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1].x;
    const az = p[i - 1].z;
    const bx = p[i].x - ax;
    const bz = p[i].z - az;
    const L2 = bx * bx + bz * bz;
    let t = L2 > 0 ? ((x - ax) * bx + (z - az) * bz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + bx * t - x;
    const cz = az + bz * t - z;
    const half = r.half[i - 1] + (r.half[i] - r.half[i - 1]) * t;
    const d = Math.sqrt(cx * cx + cz * cz) - half;
    const L = Math.sqrt(L2);
    if (d < best) {
      best = d;
      bestT = total > 0 ? (acc + L * t) / total : 0;
    }
    acc += L;
  }
  if (out !== undefined) out.t = bestT;
  return best;
}

/** Distance from a point to a polyline. */
export function polyDist(pts: V2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x;
    const az = pts[i - 1].z;
    const bx = pts[i].x - ax;
    const bz = pts[i].z - az;
    const L2 = bx * bx + bz * bz;
    let t = L2 > 0 ? ((x - ax) * bx + (z - az) * bz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + bx * t - x;
    const cz = az + bz * t - z;
    best = Math.min(best, Math.sqrt(cx * cx + cz * cz));
  }
  return best;
}

/** Polyline length. */
export function polyLength(pts: V2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

/** Point at distance s along a polyline (clamped), with its heading. */
export function polyAt(pts: V2[], s: number, out: { x: number; z: number; yaw: number }) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    const L = Math.hypot(dx, dz);
    if (acc + L >= s || i === pts.length - 1) {
      const t = L > 0 ? Math.min(1, Math.max(0, (s - acc) / L)) : 0;
      out.x = pts[i - 1].x + dx * t;
      out.z = pts[i - 1].z + dz * t;
      out.yaw = Math.atan2(dx, dz);
      return out;
    }
    acc += L;
  }
  out.x = pts[0].x;
  out.z = pts[0].z;
  out.yaw = 0;
  return out;
}

/** Ribbon bounding box. */
export function ribbonBox(r: Ribbon): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  r.pts.forEach((p, i) => {
    const h = r.half[i];
    x0 = Math.min(x0, p.x - h);
    z0 = Math.min(z0, p.z - h);
    x1 = Math.max(x1, p.x + h);
    z1 = Math.max(z1, p.z + h);
  });
  return { x0, z0, x1, z1 };
}

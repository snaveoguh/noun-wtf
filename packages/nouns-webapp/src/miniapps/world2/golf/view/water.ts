// ── Noun Golf view: pond surfaces (pure) ────────────────────────────────
//
// One flat fan per pond shape at the pond's level, reaching PAD m past its
// edge: the banks rise out of it (surface.ts carves a shore cone that's
// back above the level within ~2 m), so the ground clips the shoreline
// and nothing has to trace it. All ponds go in one mesh, drawn with the
// mountain dressing's water material (same program, same shimmer).

import type { CourseLayout, Shape } from '../contract';

import { shapeDist, shapeRadius } from '../course/shapes';

/** How far the water plane reaches past the pond's edge (m). */
export const WATER_PAD = 2.5;

/** Points round a shape at signed distance `pad` from its edge (`n` of them). */
export function shapeOutline(s: Shape, pad: number, n: number): { x: number; z: number }[] {
  const R = shapeRadius(s) + pad + 2;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let lo = 0;
    let hi = R;
    while (shapeDist(s, s.x + dx * hi, s.z + dz * hi) < pad) hi *= 1.5;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2;
      if (shapeDist(s, s.x + dx * m, s.z + dz * m) < pad) lo = m;
      else hi = m;
    }
    out.push({ x: s.x + dx * lo, z: s.z + dz * lo });
  }
  return out;
}

export interface WaterData {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  /** The dressing water material's flow attribute: (flow x, flow z, is-water). */
  water: Float32Array;
  idx: Uint32Array;
  count: number;
}

/** Every pond as fans, positions relative to (ox, oz). */
export function pondSurfaces(
  L: CourseLayout,
  ox: number,
  oz: number,
  colour: { r: number; g: number; b: number },
): WaterData {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const h of L.holes)
    for (const p of h.water)
      for (const s of p.shapes) {
        const ring = shapeOutline(s, WATER_PAD, 48);
        const c = pos.length / 3;
        pos.push(s.x - ox, p.level, s.z - oz);
        for (const q of ring) pos.push(q.x - ox, p.level, q.z - oz);
        for (let i = 0; i < ring.length; i++) {
          const a = c + 1 + i;
          const b = c + 1 + ((i + 1) % ring.length);
          // Up-facing: (b − c) × (a − c) has +y for increasing angle
          idx.push(c, b, a);
        }
      }
  const count = pos.length / 3;
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const water = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    nrm[i * 3 + 1] = 1;
    col[i * 3] = colour.r;
    col[i * 3 + 1] = colour.g;
    col[i * 3 + 2] = colour.b;
    water[i * 3] = 0.15;
    water[i * 3 + 1] = 0.05;
    water[i * 3 + 2] = 1;
  }
  return { pos: Float32Array.from(pos), nrm, col, water, idx: Uint32Array.from(idx), count };
}

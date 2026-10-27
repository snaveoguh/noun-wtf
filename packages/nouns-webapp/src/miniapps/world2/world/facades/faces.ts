// ── The GLB's facade walls as rectangles (pure, tested) ─────────────────
//
// The baked plaza draws its walls with a handful of facade materials, each
// a bag of triangles. Here they're turned back into axis-aligned wall
// rectangles: triangles are grouped by plane, each plane is cut on a grid
// of its own vertex coordinates, and the covered grid cells are merged
// into rectangles. Each keeps the affine lightmap mapping of the triangle
// it came from, so a replacement wall can reuse the baked lighting.

import type { LightmapMap } from './geom';
import type { WallFace } from './layout';

export interface SourceTri {
  p: [number, number, number][];
  /** Lightmap uvs of the three corners (TEXCOORD_1), if the mesh has them. */
  uv1?: [number, number][];
}

export interface FaceRect extends WallFace {
  lm: LightmapMap | null;
}

interface PlaneTri {
  s: [number, number, number];
  y: [number, number, number];
  uv1?: [number, number][];
}

function inTri(t: PlaneTri, s: number, y: number): boolean {
  const [s0, s1, s2] = t.s;
  const [y0, y1, y2] = t.y;
  const d = (y1 - y2) * (s0 - s2) + (s2 - s1) * (y0 - y2);
  if (Math.abs(d) < 1e-9) return false;
  const a = ((y1 - y2) * (s - s2) + (s2 - s1) * (y - y2)) / d;
  const b = ((y2 - y0) * (s - s2) + (s0 - s2) * (y - y2)) / d;
  const c = 1 - a - b;
  return a >= -1e-6 && b >= -1e-6 && c >= -1e-6;
}

/** Affine (s, y) → uv1 from a triangle, as a LightmapMap anchored at (s0, y0). */
function lmFrom(t: PlaneTri, s0: number, y0: number): LightmapMap | null {
  if (t.uv1 === undefined) return null;
  const [sa, sb, sc] = t.s;
  const [ya, yb, yc] = t.y;
  const det = (sb - sa) * (yc - ya) - (sc - sa) * (yb - ya);
  if (Math.abs(det) < 1e-9) return null;
  const ds: [number, number] = [0, 0];
  const dy: [number, number] = [0, 0];
  for (let k = 0; k < 2; k++) {
    const ua = t.uv1[0]![k]!;
    const ub = t.uv1[1]![k]!;
    const uc = t.uv1[2]![k]!;
    ds[k] = ((ub - ua) * (yc - ya) - (uc - ua) * (yb - ya)) / det;
    dy[k] = ((uc - ua) * (sb - sa) - (ub - ua) * (sc - sa)) / det;
  }
  const o: [number, number] = [
    t.uv1[0]![0]! + (s0 - sa) * ds[0] + (y0 - ya) * dy[0],
    t.uv1[0]![1]! + (s0 - sa) * ds[1] + (y0 - ya) * dy[1],
  ];
  return { s0, y0, o, ds, dy };
}

/** Wall rectangles from vertical, axis-aligned triangles. */
export function facesFromTriangles(tris: readonly SourceTri[]): FaceRect[] {
  const planes = new Map<string, { nx: number; nz: number; at: number; tris: PlaneTri[] }>();
  for (const t of tris) {
    const [a, b, c] = t.p as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    // Face normal
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-8 || Math.abs(ny / l) > 0.05) continue;
    let ax: number;
    let az: number;
    if (Math.abs(nx / l) > 0.99) {
      ax = Math.sign(nx);
      az = 0;
    } else if (Math.abs(nz / l) > 0.99) {
      ax = 0;
      az = Math.sign(nz);
    } else continue;
    const at = az !== 0 ? (a[2] + b[2] + c[2]) / 3 : (a[0] + b[0] + c[0]) / 3;
    const key = `${ax},${az},${Math.round(at * 100)}`;
    let pl = planes.get(key);
    if (pl === undefined) {
      pl = { nx: ax, nz: az, at, tris: [] };
      planes.set(key, pl);
    }
    const sOf = (p: [number, number, number]) => (az !== 0 ? p[0] : p[2]);
    pl.tris.push({ s: [sOf(a), sOf(b), sOf(c)], y: [a[1], b[1], c[1]], uv1: t.uv1 });
  }
  const out: FaceRect[] = [];
  for (const pl of planes.values()) {
    const q = (v: number) => Math.round(v * 1000) / 1000;
    const ss = [...new Set(pl.tris.flatMap(t => t.s.map(q)))].sort((x, y) => x - y);
    const ys = [...new Set(pl.tris.flatMap(t => t.y.map(q)))].sort((x, y) => x - y);
    // Covered grid cells → the triangle covering each
    const cover: (PlaneTri | null)[][] = [];
    for (let i = 0; i + 1 < ss.length; i++) {
      const col: (PlaneTri | null)[] = [];
      for (let j = 0; j + 1 < ys.length; j++) {
        const ms = (ss[i]! + ss[i + 1]!) / 2;
        const my = (ys[j]! + ys[j + 1]!) / 2;
        col.push(pl.tris.find(t => inTri(t, ms, my)) ?? null);
      }
      cover.push(col);
    }
    // Cells only merge when their triangles share one lightmap mapping
    const sig = cover.map(c =>
      c.map(t => {
        if (t === null) return null;
        const m = lmFrom(t, 0, 0);
        return m === null
          ? '-'
          : [...m.o, ...m.ds, ...m.dy].map(v => Math.round(v * 1e5)).join(',');
      }),
    );
    // Merge: vertical runs per column, then join equal runs across columns
    const used = cover.map(c => c.map(() => false));
    for (let i = 0; i < cover.length; i++)
      for (let j = 0; j < cover[i]!.length; j++) {
        const t0 = cover[i]![j];
        if (t0 === null || t0 === undefined || used[i]![j]) continue;
        const k0 = sig[i]![j];
        let j1 = j;
        while (j1 + 1 < cover[i]!.length && sig[i]![j1 + 1] === k0 && !used[i]![j1 + 1]) j1++;
        let i1 = i;
        const fits = (ii: number) => {
          for (let jj = j; jj <= j1; jj++) if (sig[ii]![jj] !== k0 || used[ii]![jj]) return false;
          return true;
        };
        while (i1 + 1 < cover.length && fits(i1 + 1)) i1++;
        for (let ii = i; ii <= i1; ii++) for (let jj = j; jj <= j1; jj++) used[ii]![jj] = true;
        const s0 = ss[i]!;
        const y0 = ys[j]!;
        out.push({
          nx: pl.nx,
          nz: pl.nz,
          at: pl.at,
          s0,
          s1: ss[i1 + 1]!,
          y0,
          y1: ys[j1 + 1]!,
          lm: lmFrom(t0, s0, y0),
        });
      }
  }
  return out;
}

/** uv1 at (s, y) of a face's lightmap mapping. */
export function lmAt(lm: LightmapMap, s: number, y: number): [number, number] {
  return [
    lm.o[0] + (s - lm.s0) * lm.ds[0] + (y - lm.y0) * lm.dy[0],
    lm.o[1] + (s - lm.s0) * lm.ds[1] + (y - lm.y0) * lm.dy[1],
  ];
}

/** World AABB. */
export interface Box3Like {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Connected pieces of a triangle soup as world AABBs (balconies, rooftop units…). */
export function piecesOf(tris: readonly SourceTri[]): Box3Like[] {
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const seen = new Map<string, number>();
  tris.forEach((t, i) => {
    for (const p of t.p) {
      const key = `${Math.round(p[0] * 20)}:${Math.round(p[1] * 20)}:${Math.round(p[2] * 20)}`;
      const j = seen.get(key);
      if (j === undefined) seen.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const boxes = new Map<number, Box3Like>();
  tris.forEach((t, i) => {
    const r = find(i);
    const b = boxes.get(r) ?? {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    for (const p of t.p) {
      b.minX = Math.min(b.minX, p[0]);
      b.maxX = Math.max(b.maxX, p[0]);
      b.minY = Math.min(b.minY, p[1]);
      b.maxY = Math.max(b.maxY, p[1]);
      b.minZ = Math.min(b.minZ, p[2]);
      b.maxZ = Math.max(b.maxZ, p[2]);
    }
    boxes.set(r, b);
  });
  return [...boxes.values()];
}

/**
 * Sort a GLB piece into what it means for the facades: balconies (and
 * their slabs) block a fire escape; small tall things on a roof are
 * rooftop units to keep clear of. Full-width string courses and cornices
 * are neither.
 */
export function classifyPiece(
  material: string,
  b: Box3Like,
): { obstacle: boolean; roofUnit: boolean } {
  const w = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const dep = Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
  return {
    obstacle: w < 4 && (dep > 0.4 || /^railing/i.test(material)),
    roofUnit: w < 4 && b.maxY - b.minY > 0.5,
  };
}

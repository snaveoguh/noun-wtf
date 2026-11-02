// ── Synthetic courses for the sim's tests ───────────────────────────────
//
// A CourseSurface built from a few primitives: a tilted base plane of one
// lie, regions painted on top (circles / rectangles, later ones win, each
// with its own lie and optional plane: a sloped green), bowls (bunkers),
// ponds (a sunk bed under a flat water level), an OB box (outside it is
// 'ob') and trees. testHoles() lays out a small course of simple holes for
// the rules and CPU tests.

import type { CourseSurface, Lie, Tree, V2, V3 } from '../contract';
import type { HoleInfo } from './rules';

export type Region =
  | { kind: 'circle'; x: number; z: number; r: number; lie: Lie }
  | { kind: 'rect'; x0: number; z0: number; x1: number; z1: number; lie: Lie };

export interface Bowl {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export interface PondSpec {
  x: number;
  z: number;
  r: number;
  /** Water level drop under the ground around it (m). */
  below?: number;
}

/** A plane laid over a region: y = y0 + gx·(x − cx) + gz·(z − cz), blended in at the edge. */
export interface PlaneSpec {
  x: number;
  z: number;
  r: number;
  y0: number;
  gx: number;
  gz: number;
}

export interface TestCourseSpec {
  base?: Lie;
  /** Base ground: y = y0 + gx·x + gz·z. */
  y0?: number;
  gx?: number;
  gz?: number;
  regions?: Region[];
  bowls?: Bowl[];
  ponds?: PondSpec[];
  planes?: PlaneSpec[];
  trees?: Omit<Tree, 'y'>[];
  /** Inside this box is in bounds; outside is 'ob'. */
  inBounds?: { x0: number; z0: number; x1: number; z1: number };
}

const inRegion = (r: Region, x: number, z: number) =>
  r.kind === 'circle'
    ? (x - r.x) * (x - r.x) + (z - r.z) * (z - r.z) <= r.r * r.r
    : x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function makeSurface(spec: TestCourseSpec = {}): CourseSurface & { trees: Tree[] } {
  const base = spec.base ?? 'fairway';
  const y0 = spec.y0 ?? 0;
  const gx = spec.gx ?? 0;
  const gz = spec.gz ?? 0;
  const regions = spec.regions ?? [];
  const bowls = spec.bowls ?? [];
  const ponds = spec.ponds ?? [];
  const planes = spec.planes ?? [];

  const baseH = (x: number, z: number) => {
    let h = y0 + gx * x + gz * z;
    for (const p of planes) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d >= p.r + 4) continue;
      const ph = p.y0 + p.gx * (x - p.x) + p.gz * (z - p.z);
      // Fully the plane inside r, a smooth 4 m blend outside it
      const t = d <= p.r ? 1 : 1 - (d - p.r) / 4;
      const s = t * t * (3 - 2 * t);
      h = h + (ph - h) * s;
    }
    return h;
  };

  const height = (x: number, z: number) => {
    let h = baseH(x, z);
    for (const b of bowls) {
      const d2 = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
      if (d2 < 1) h -= b.depth * (1 - d2) * (1 - d2);
    }
    for (const p of ponds) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) h -= 1.5 * (1 - (d / p.r) ** 2) + (p.below ?? 0.4);
    }
    return h;
  };

  const waterLevel = (x: number, z: number): number | null => {
    for (const p of ponds) {
      if (Math.hypot(x - p.x, z - p.z) < p.r) return baseH(p.x, p.z) - (p.below ?? 0.4) + 0.05;
    }
    return null;
  };

  const trees: Tree[] = (spec.trees ?? []).map(t => ({ ...t, y: height(t.x, t.z) }));

  const lie = (x: number, z: number): Lie => {
    const ib = spec.inBounds;
    if (ib && (x < ib.x0 || x > ib.x1 || z < ib.z0 || z > ib.z1)) return 'ob';
    if (waterLevel(x, z) !== null) return 'water';
    for (const b of bowls) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return 'sand';
    for (let i = regions.length - 1; i >= 0; i--)
      if (inRegion(regions[i], x, z)) return regions[i].lie;
    return base;
  };

  const E = 0.05;
  return {
    trees,
    height,
    normal(x: number, z: number, out: V3): V3 {
      const dx = (height(x + E, z) - height(x - E, z)) / (2 * E);
      const dz = (height(x, z + E) - height(x, z - E)) / (2 * E);
      const l = Math.sqrt(dx * dx + 1 + dz * dz);
      out.x = -dx / l;
      out.y = 1 / l;
      out.z = -dz / l;
      return out;
    },
    lie,
    waterLevel,
    treesNear(x: number, z: number, r: number, out: Tree[]): Tree[] {
      for (const t of trees) {
        if (Math.hypot(t.x - x, t.z - z) <= r + t.r + t.trunk) out.push(t);
      }
      return out;
    },
  };
}

export const flatFairway = (lie: Lie = 'fairway') => makeSurface({ base: lie });

// ── A little course: holes side by side, each running +z ─────────────────

export interface TestHoleSpec {
  par: 3 | 4 | 5;
  length: number;
  /** A pond across the line at this distance (m) with this radius. */
  pond?: { at: number; r: number };
  /** A green-side bunker. */
  bunker?: boolean;
  /** Green tilt. */
  green?: { gx: number; gz: number };
}

export const TEST_HOLES: TestHoleSpec[] = [
  { par: 4, length: 360 },
  { par: 3, length: 150, pond: { at: 75, r: 25 } },
  { par: 5, length: 480, bunker: true },
  { par: 4, length: 330, green: { gx: 0.015, gz: -0.01 }, bunker: true },
];

export function testHoles(specs: TestHoleSpec[] = TEST_HOLES): {
  surface: CourseSurface;
  holes: HoleInfo[];
} {
  const regions: Region[] = [];
  const bowls: Bowl[] = [];
  const ponds: PondSpec[] = [];
  const planes: PlaneSpec[] = [];
  const holes: HoleInfo[] = [];
  const W = 260;
  specs.forEach((s, i) => {
    const x = i * W;
    const L = s.length;
    regions.push({ kind: 'rect', x0: x - 70, z0: -30, x1: x + 70, z1: L + 50, lie: 'deep' });
    regions.push({ kind: 'rect', x0: x - 40, z0: -20, x1: x + 40, z1: L + 35, lie: 'rough' });
    regions.push({
      kind: 'rect',
      x0: x - 18,
      z0: s.par === 3 ? L - 30 : 40,
      x1: x + 18,
      z1: L,
      lie: 'fairway',
    });
    regions.push({ kind: 'circle', x, z: L, r: 18, lie: 'fringe' });
    regions.push({ kind: 'circle', x, z: L, r: 16, lie: 'green' });
    regions.push({ kind: 'rect', x0: x - 4, z0: -3, x1: x + 4, z1: 3, lie: 'tee' });
    if (s.green) planes.push({ x, z: L, r: 17, y0: 0, gx: s.green.gx, gz: s.green.gz });
    if (s.bunker === true) bowls.push({ x: x + 22, z: L - 6, r: 6, depth: 0.6 });
    if (s.pond) ponds.push({ x, z: s.pond.at, r: s.pond.r });
    const line: V2[] = [
      { x, z: 0 },
      { x, z: L },
    ];
    holes.push({
      n: i + 1,
      par: s.par,
      teeSpot: { x, y: 0, z: 0 },
      pin: { x, y: 0, z: L },
      line,
    });
  });
  const surface = makeSurface({
    base: 'ob',
    regions,
    bowls,
    ponds,
    planes,
  });
  // Lies outside every hole's deep grass are OB (the base lie)
  for (const h of holes) {
    h.pin.y = surface.height(h.pin.x, h.pin.z);
    h.surface = surface;
  }
  return { surface, holes };
}

// ── Noun Golf: the course surface (height + lie), pure ───────────────────
//
// One analytic function for the whole course, read by:
//   - the mountain terrain (terrain.ts applyGolf): what you walk, ride and
//     drive on, and what the chunk mesher draws (sunk a touch under the
//     view's overlays, golfSink);
//   - the ball sim (CourseSurface, golf/sim);
//   - the view (overlay meshes sample it at their own resolution).
//
// height = courseBase (site.ts)
//        → ponds carved to under their level
//        → pads and tees flattened (raised tees on the downhill par 3s)
//        → greens: their own tilted plane + a tier / soft contours, blended
//          into the surroundings over GREEN_BLEND m
//        → bunkers dug DEPTH under whatever's there
//
// Every blend is wide enough to keep the gradient well under the terrain's
// Lipschitz bound (1.4): the steepest bits are bunker faces (~0.5) and the
// island green's bank (~0.4).

import type { CourseLayout, CourseSurface, Lie, Ribbon, Shape, Tree, V3 } from '../contract';

import { smoothstep, vnoise } from '../../world/mountain/config';

import { buildLayout, type HoleExtra } from './layout';
import { polyDist, ribbonBox, ribbonDist, shapeDist, shapeRadius, unionDist } from './shapes';
import { BOUNDS, SITE, blendWeight, courseBase, inBounds, outsideCore, toCourse } from './site';

/** How far the view's overlay meshes reach past their shape's edge (m). */
export const OVERLAY_FRINGE = 5;
/** How far the mountain mesh is sunk under the overlays (m). */
export const SINK = 0.35;
const GREEN_BLEND = 9;
const PAD_BLEND = 7;
/** Pond banks: rise per metre out from the floor's edge. */
const SHORE = 0.32;

type FeatKind =
  | 'pond'
  | 'pad'
  | 'tee'
  | 'green'
  | 'pg'
  | 'bunker'
  | 'fairway'
  | 'path'
  | 'corridor'
  | 'range';

interface Feat {
  kind: FeatKind;
  hole: number;
  shapes?: Shape[];
  ribbon?: Ribbon;
  /** Corridor: the hole's line and reach. */
  line?: { x: number; z: number }[];
  reach?: number;
  /** Flatten level / water level. */
  y?: number;
  depth?: number;
  /** Green plane + contour. */
  plane?: { cx: number; cz: number; y0: number; gx: number; gz: number };
  ridge?: { fx: number; fz: number; at: number; h: number } | null;
  seed?: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const CELL = 40;

export interface GroundSample {
  lie: Lie;
  /** Mowing stripe on fairways / the range (0 or 1). */
  stripe: number;
  /** Hole number the point belongs to (0: none). */
  hole: number;
}

export class GolfCourse implements CourseSurface {
  readonly layout: CourseLayout;
  private feats: Feat[] = [];
  private nx: number;
  private nz: number;
  private cells: Int32Array[];
  private treeCells = new Map<number, Tree[]>();
  private readonly _c = { u: 0, v: 0 };
  private readonly _t = { t: 0 };

  constructor(build = buildLayout()) {
    this.layout = build.layout;
    this.nx = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / CELL);
    this.nz = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / CELL);
    this.index(build.extra);
    const lists: number[][] = Array.from({ length: this.nx * this.nz }, () => []);
    this.feats.forEach((f, i) => {
      const i0 = Math.max(0, Math.floor((f.x0 - BOUNDS.x0) / CELL));
      const i1 = Math.min(this.nx - 1, Math.floor((f.x1 - BOUNDS.x0) / CELL));
      const k0 = Math.max(0, Math.floor((f.z0 - BOUNDS.z0) / CELL));
      const k1 = Math.min(this.nz - 1, Math.floor((f.z1 - BOUNDS.z0) / CELL));
      for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) lists[k * this.nx + j].push(i);
    });
    this.cells = lists.map(l => Int32Array.from(l));
    this.settlePonds(build.extra);
    this.finalize();
  }

  private addShape(
    kind: FeatKind,
    hole: number,
    shapes: Shape[],
    pad: number,
    extra: Partial<Feat>,
  ) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const s of shapes) {
      const r = shapeRadius(s) + pad;
      x0 = Math.min(x0, s.x - r);
      z0 = Math.min(z0, s.z - r);
      x1 = Math.max(x1, s.x + r);
      z1 = Math.max(z1, s.z + r);
    }
    this.feats.push({ kind, hole, shapes, x0, z0, x1, z1, ...extra });
  }

  private addRibbon(kind: FeatKind, hole: number, ribbon: Ribbon, pad: number) {
    const b = ribbonBox(ribbon);
    this.feats.push({
      kind,
      hole,
      ribbon,
      x0: b.x0 - pad,
      z0: b.z0 - pad,
      x1: b.x1 + pad,
      z1: b.z1 + pad,
    });
  }

  private index(extra: HoleExtra[]) {
    const L = this.layout;
    const pad = OVERLAY_FRINGE + 1;
    const c = this._c;
    // Ponds (levels set once everything else is in: see settlePonds)
    for (const h of L.holes)
      for (const w of h.water) this.addShape('pond', h.n, w.shapes, 18, { y: 0 });
    for (const p of L.pads) {
      toCourse(p.shape.x, p.shape.z, c);
      p.y = courseBase(p.shape.x, p.shape.z, c.v);
      this.addShape('pad', 0, [p.shape], PAD_BLEND + pad, { y: p.y });
    }
    L.holes.forEach((h, i) => {
      const ex = extra[i];
      toCourse(h.tee.x, h.tee.z, c);
      const ty = courseBase(h.tee.x, h.tee.z, c.v) + ex.teeRaise;
      this.addShape('tee', h.n, [h.tee], PAD_BLEND + pad, { y: ty });
      const gp = h.greenPlane;
      const ridgeOn = ex.special !== 'noggle' && (h.n * 7) % 3 === 0;
      const al = Math.hypot(gp.gx, gp.gz) || 1;
      this.addShape('green', h.n, h.green, GREEN_BLEND + pad, {
        plane: gp,
        ridge: ridgeOn ? { fx: gp.gx / al, fz: gp.gz / al, at: 1.5, h: 0.34 } : null,
        seed: h.n,
      });
      for (const b of h.bunkers)
        this.addShape('bunker', h.n, [b.shape], 2 + pad, { depth: b.depth });
      if (h.fairway) this.addRibbon('fairway', h.n, h.fairway, pad);
      const reach = (h.fairway ? 17 : 12) + h.roughHalf;
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (const p of h.line) {
        x0 = Math.min(x0, p.x - reach - 20);
        z0 = Math.min(z0, p.z - reach - 20);
        x1 = Math.max(x1, p.x + reach + 20);
        z1 = Math.max(z1, p.z + reach + 20);
      }
      this.feats.push({ kind: 'corridor', hole: h.n, line: h.line, reach, x0, z0, x1, z1 });
    });
    {
      const pg = L.puttingGreen;
      toCourse(pg.x, pg.z, c);
      const y0 = courseBase(pg.x, pg.z, c.v) + 0.3;
      this.addShape('pg', 0, [pg], GREEN_BLEND + pad, {
        plane: { cx: pg.x, cz: pg.z, y0, gx: 0.012, gz: -0.008 },
        ridge: null,
        seed: 77,
      });
    }
    this.addShape('range', 0, [L.range.area], pad, {});
    L.paths.forEach(p => this.addRibbon('path', 0, p, pad));
  }

  private noPonds = false;

  /**
   * Each pond's level sits 0.45 m under the lowest ground along its real
   * edge (as built, greens and bunkers included), so the water never
   * stands over its rim; then the island green is lifted clear of its lake.
   */
  private settlePonds(extra: HoleExtra[]) {
    this.noPonds = true;
    const ponds = this.feats.filter(f => f.kind === 'pond');
    let k = 0;
    for (const h of this.layout.holes)
      for (const w of h.water) {
        let lo = Infinity;
        for (const s of w.shapes) {
          const r = shapeRadius(s) + 2;
          for (let x = s.x - r; x <= s.x + r; x += 1)
            for (let z = s.z - r; z <= s.z + r; z += 1) {
              if (Math.abs(unionDist(w.shapes, x, z)) > 1.5) continue;
              lo = Math.min(lo, this.height(x, z));
            }
        }
        w.level = lo - 0.45;
        ponds[k++].y = w.level;
      }
    this.noPonds = false;
    this.layout.holes.forEach((h, i) => {
      if (extra[i].special !== 'island') return;
      const lake = h.water[h.water.length - 1];
      h.greenPlane.y0 = Math.max(h.greenPlane.y0, lake.level + 1.1);
    });
  }

  private finalize() {
    const L = this.layout;
    for (const h of L.holes) {
      h.teeSpot.y = this.height(h.teeSpot.x, h.teeSpot.z);
      h.pin.y = this.height(h.pin.x, h.pin.z);
    }
    for (const b of L.buildings) b.y = this.height(b.x, b.z);
    for (const s of L.buggies) s.y = this.height(s.x, s.z);
    for (const b of L.range.bays) b.y = this.height(b.x, b.z);
    for (const t of L.range.targets) t.y = this.height(t.x, t.z);
    L.spawn.y = this.height(L.spawn.x, L.spawn.z);
    for (const t of L.trees) {
      t.y = this.height(t.x, t.z);
      const key = this.treeKey(Math.floor(t.x / 20), Math.floor(t.z / 20));
      let list = this.treeCells.get(key);
      if (list === undefined) this.treeCells.set(key, (list = []));
      list.push(t);
    }
  }

  private treeKey(i: number, k: number) {
    return (i + 4096) * 8192 + (k + 4096);
  }

  private cell(x: number, z: number): Int32Array | null {
    const i = Math.floor((x - BOUNDS.x0) / CELL);
    const k = Math.floor((z - BOUNDS.z0) / CELL);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return null;
    return this.cells[k * this.nx + i];
  }

  private greenY(f: Feat, x: number, z: number): number {
    const p = f.plane!;
    const dx = x - p.cx;
    const dz = z - p.cz;
    let y = p.y0 + p.gx * dx + p.gz * dz + 0.13 * vnoise(x / 7.5, z / 7.5, 0x6f00 + (f.seed ?? 0));
    const r = f.ridge;
    if (r) y += r.h * smoothstep(-3.2, 3.2, dx * r.fx + dz * r.fz - r.at);
    return y;
  }

  /** Course height at (x, z) (valid over the whole terraced area). */
  height(x: number, z: number): number {
    const c = this._c;
    toCourse(x, z, c);
    let y = courseBase(x, z, c.v);
    const list = this.cell(x, z);
    if (list === null) return y;
    const F = this.feats;
    // Order matters: carve, flatten, greens, then dig the bunkers
    for (let q = 0; q < list.length; q++) {
      const f = F[list[q]];
      if (f.kind !== 'pond' || this.noPonds || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1)
        continue;
      // A cone of shore at a fixed slope from the floor (whatever the ground does round it)
      const d = unionDist(f.shapes!, x, z);
      // (steeper past 6 m, so it's always back above the ground inside the pond's box)
      y = Math.min(y, f.y! - 1.3 + SHORE * Math.max(0, d + 4.5) + 0.38 * Math.max(0, d - 6));
    }
    for (let q = 0; q < list.length; q++) {
      const f = F[list[q]];
      if ((f.kind !== 'pad' && f.kind !== 'tee') || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1)
        continue;
      const d = shapeDist(f.shapes![0], x, z);
      const w = 1 - smoothstep(0, PAD_BLEND, d);
      if (w > 0) y += (f.y! - y) * w;
    }
    for (let q = 0; q < list.length; q++) {
      const f = F[list[q]];
      if ((f.kind !== 'green' && f.kind !== 'pg') || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1)
        continue;
      const d = unionDist(f.shapes!, x, z);
      const w = 1 - smoothstep(0, GREEN_BLEND, d);
      if (w > 0) y += (this.greenY(f, x, z) - y) * w;
    }
    for (let q = 0; q < list.length; q++) {
      const f = F[list[q]];
      if (f.kind !== 'bunker' || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      const d = shapeDist(f.shapes![0], x, z);
      y -= f.depth! * (1 - smoothstep(-1.7, 0.7, d));
    }
    return y;
  }

  normal(x: number, z: number, out: V3): V3 {
    const e = 0.15;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const l = Math.sqrt(dx * dx + 1 + dz * dz);
    out.x = -dx / l;
    out.y = 1 / l;
    out.z = -dz / l;
    return out;
  }

  /** Lie + mowing stripe + hole. */
  ground(x: number, z: number, out: GroundSample): GroundSample {
    out.stripe = 0;
    out.hole = 0;
    const c = this._c;
    toCourse(x, z, c);
    if (outsideCore(c.u, c.v) > 0) {
      out.lie = 'ob';
      return out;
    }
    const list = this.cell(x, z);
    if (list === null) {
      out.lie = 'ob';
      return out;
    }
    const F = this.feats;
    let rank = 9;
    let lie: Lie = 'deep';
    const take = (r: number, l: Lie, hole: number) => {
      if (r < rank) {
        rank = r;
        lie = l;
        out.hole = hole;
      }
    };
    for (let q = 0; q < list.length; q++) {
      const f = F[list[q]];
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      switch (f.kind) {
        case 'pond': {
          if (unionDist(f.shapes!, x, z) < 0 && this.height(x, z) < f.y! + 0.03)
            take(0, 'water', f.hole);
          break;
        }
        case 'bunker':
          if (rank > 1 && shapeDist(f.shapes![0], x, z) < 0) take(1, 'sand', f.hole);
          break;
        case 'green':
        case 'pg': {
          if (rank <= 2) break;
          const d = unionDist(f.shapes!, x, z);
          if (d < 0) take(2, 'green', f.hole);
          else if (d < 1.6) take(3, 'fringe', f.hole);
          break;
        }
        case 'tee':
          if (rank > 4 && shapeDist(f.shapes![0], x, z) < 0) take(4, 'tee', f.hole);
          break;
        case 'pad':
          if (rank > 4 && shapeDist(f.shapes![0], x, z) < 0) take(4, 'tee', 0);
          break;
        case 'path':
          if (rank > 5 && ribbonDist(f.ribbon!, x, z) < 0) take(5, 'path', 0);
          break;
        case 'fairway': {
          if (rank <= 6) break;
          const d = ribbonDist(f.ribbon!, x, z, this._t);
          if (d < 0) {
            take(6, 'fairway', f.hole);
            out.stripe = Math.floor(this._t.t * 40) & 1;
          }
          break;
        }
        case 'range':
          if (rank > 6 && shapeDist(f.shapes![0], x, z) < 0) {
            take(6, 'fairway', 0);
            toCourse(x, z, c);
            out.stripe = Math.floor(c.v / 9) & 1;
          }
          break;
        case 'corridor':
          if (rank > 7 && polyDist(f.line!, x, z) < f.reach!) take(7, 'rough', f.hole);
          break;
      }
    }
    out.lie = lie;
    return out;
  }

  private readonly _g: GroundSample = { lie: 'deep', stripe: 0, hole: 0 };

  lie(x: number, z: number): Lie {
    return this.ground(x, z, this._g).lie;
  }

  waterLevel(x: number, z: number): number | null {
    const list = this.cell(x, z);
    if (list === null) return null;
    for (let q = 0; q < list.length; q++) {
      const f = this.feats[list[q]];
      if (f.kind !== 'pond' || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      if (unionDist(f.shapes!, x, z) < 0 && this.height(x, z) < f.y! + 0.03) return f.y!;
    }
    return null;
  }

  treesNear(x: number, z: number, r: number, out: Tree[]): Tree[] {
    out.length = 0;
    const i0 = Math.floor((x - r - 8) / 20);
    const i1 = Math.floor((x + r + 8) / 20);
    const k0 = Math.floor((z - r - 8) / 20);
    const k1 = Math.floor((z + r + 8) / 20);
    for (let k = k0; k <= k1; k++)
      for (let i = i0; i <= i1; i++) {
        const l = this.treeCells.get(this.treeKey(i, k));
        if (l !== undefined) for (const t of l) out.push(t);
      }
    return out;
  }

  /**
   * How far the mountain mesh drops under the view's overlays here (m):
   * SINK well inside the fringe, easing to 0 by its outer edge.
   */
  sink(x: number, z: number): number {
    const list = this.cell(x, z);
    if (list === null) return 0;
    let d = Infinity;
    for (let q = 0; q < list.length; q++) {
      const f = this.feats[list[q]];
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      switch (f.kind) {
        case 'pad':
        case 'tee':
        case 'green':
        case 'pg':
        case 'bunker':
        case 'range':
          d = Math.min(d, unionDist(f.shapes!, x, z));
          break;
        case 'fairway':
        case 'path':
          d = Math.min(d, ribbonDist(f.ribbon!, x, z));
          break;
      }
      if (d < 1) break;
    }
    return SINK * (1 - smoothstep(1, OVERLAY_FRINGE - 0.5, d));
  }
}

// ── The one course (built on first use) + the terrain hooks ─────────────

let course: GolfCourse | null = null;

export function golfCourse(): GolfCourse {
  if (course === null) course = new GolfCourse();
  return course;
}

export function golfCourseBuilt(): boolean {
  return course !== null;
}

const _c2 = { u: 0, v: 0 };

/**
 * Blend the course into a terrain sample (terrain.ts sampleTerrain). The
 * course is only built once something asks about a point on its site.
 */
export function applyGolf(x: number, z: number, out: { y: number; track: number; alley: number }) {
  if (!inBounds(x, z)) return;
  toCourse(x, z, _c2);
  const w = blendWeight(_c2.u, _c2.v);
  if (w <= 0) return;
  const g = golfCourse().height(x, z);
  out.y += (g - out.y) * w;
  out.track *= 1 - w;
  out.alley *= 1 - w;
}

/** Keep-out for the mountain's dressing, creatures, oddities: the core + 30 m. */
export function golfBlocked(x: number, z: number): boolean {
  if (!inBounds(x, z)) return false;
  toCourse(x, z, _c2);
  return outsideCore(_c2.u, _c2.v) < 30;
}

/** The rendered mountain's drop under the course overlays (terrain.ts meshHeight). */
export function golfSink(x: number, z: number): number {
  if (!inBounds(x, z)) return 0;
  toCourse(x, z, _c2);
  if (outsideCore(_c2.u, _c2.v) > OVERLAY_FRINGE + 2) return 0;
  return golfCourse().sink(x, z);
}

/** Inside the course boundary (white stakes)? */
export function inGolfCore(x: number, z: number, margin = 0): boolean {
  if (!inBounds(x, z)) return false;
  toCourse(x, z, _c2);
  return outsideCore(_c2.u, _c2.v) <= margin;
}

export { SITE };

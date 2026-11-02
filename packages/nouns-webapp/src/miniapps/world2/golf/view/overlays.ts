// ── Noun Golf view: the ground overlays (pure, no three.js) ─────────────
//
// The mountain mesh is sunk SINK m under every overlay footprint (fairways,
// greens, tees, bunkers, pads, the putting green, the range, the paths),
// easing back to 0 by OVERLAY_FRINGE − 0.5 m past the edge. These meshes
// sit on the true surface (golfCourse().height, +a few cm) over each
// footprint and OVERLAY_FRINGE m past it, coloured by lieColour, so the
// sunk edge never shows and the colours meet the mountain's (which reads
// the same function).
//
// The course is cut into regions (each hole, the clubhouse, the range),
// one mesh each. A region is:
//   - a coarse grid (fairways, tees, pads, the range area) at 2 m;
//   - fine grids (greens, bunkers, the putting green) at 0.75 m, one per
//     cluster of nearby shapes, overlapping the coarse grid by a cell and
//     lifted 1.5 cm over it, so there are no cracks between the two;
//   - path strips: a ribbon-aligned cross-section with columns on the
//     path's edge, so the concrete edge is crisp;
//   - range target discs (polar patches).
// LOD 1 (far) is the same at 2.5× the spacing.
//
// Builders are generators: they yield every row or so and the slice
// scheduler (slices.ts) runs them inside a frame budget.

import type { CourseLayout, Ribbon, Shape } from '../contract';
import type { GolfCourse, GroundSample } from '../course/surface';
import type { MeshData } from './kit';

import { lieColour, type Rgb } from '../course/colors';
import { ribbonBox, ribbonDist, shapeDist, shapeRadius } from '../course/shapes';
import { OVERLAY_FRINGE } from '../course/surface';

export interface OverlayLod {
  coarse: number;
  fine: number;
  strip: number;
  disc: number;
}

export const OVERLAY_LOD: OverlayLod[] = [
  { coarse: 2, fine: 0.75, strip: 3, disc: 1 },
  { coarse: 5, fine: 2, strip: 7, disc: 2.5 },
];

/** Lift over the true surface (m): fine over coarse, paths and discs over both. */
export const LIFT = { coarse: 0.025, fine: 0.04, strip: 0.06, disc: 0.07 } as const;
/**
 * An overlay's outermost vertices dip this far under the true surface, so
 * its edge slides under the mountain mesh instead of standing on it: no
 * step for the ink pass to outline, nothing to see but one colour.
 */
export const EDGE_DIP = -0.12;

export interface FineShape {
  shape: Shape;
  kind: 'green' | 'bunker';
}

export interface Region {
  id: string;
  /** Hole number (0: clubhouse / range). */
  hole: number;
  /** Footprint bounds incl. the fringe (world). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Mesh origin (the bounds' centre). */
  cx: number;
  cz: number;
  ribbons: Ribbon[];
  shapes: Shape[];
  fine: FineShape[];
  paths: Ribbon[];
  discs: { x: number; z: number; r: number }[];
}

/** Extra metres the fine grid reaches round a shape (green / bunker) at a LOD's coarse spacing. */
export function fineZone(kind: FineShape['kind'], coarse: number): number {
  return kind === 'green' ? Math.max(OVERLAY_FRINGE, 3 + coarse) : 2.5 + coarse;
}

function boxOf(r: Region) {
  r.cx = (r.x0 + r.x1) / 2;
  r.cz = (r.z0 + r.z1) / 2;
}

function grow(r: Region, x0: number, z0: number, x1: number, z1: number) {
  r.x0 = Math.min(r.x0, x0);
  r.z0 = Math.min(r.z0, z0);
  r.x1 = Math.max(r.x1, x1);
  r.z1 = Math.max(r.z1, z1);
}

function growShape(r: Region, s: Shape, pad: number) {
  const R = shapeRadius(s) + pad;
  grow(r, s.x - R, s.z - R, s.x + R, s.z + R);
}

function growRibbon(r: Region, rb: Ribbon, pad: number) {
  const b = ribbonBox(rb);
  grow(r, b.x0 - pad, b.z0 - pad, b.x1 + pad, b.z1 + pad);
}

/** The course cut into overlay regions: holes 1..19, the clubhouse, the range. */
export function courseRegions(L: CourseLayout): Region[] {
  const empty = (id: string, hole: number): Region => ({
    id,
    hole,
    x0: Infinity,
    z0: Infinity,
    x1: -Infinity,
    z1: -Infinity,
    cx: 0,
    cz: 0,
    ribbons: [],
    shapes: [],
    fine: [],
    paths: [],
    discs: [],
  });
  const holes = L.holes.map(h => {
    const r = empty(`h${h.n}`, h.n);
    if (h.fairway !== null) r.ribbons.push(h.fairway);
    r.shapes.push(h.tee);
    for (const g of h.green) r.fine.push({ shape: g, kind: 'green' });
    for (const b of h.bunkers) r.fine.push({ shape: b.shape, kind: 'bunker' });
    return r;
  });
  const club = empty('club', 0);
  const range = empty('range', 0);
  club.fine.push({ shape: L.puttingGreen, kind: 'green' });
  // Pads: the clubhouse's and the range tee's stay home; a building's pad
  // out on the course (the starter, the 19th hole bar) joins the nearest hole
  L.pads.forEach((p, i) => {
    if (i === 1) {
      range.shapes.push(p.shape);
      return;
    }
    let best: Region = club;
    if (i > 1) {
      let bd = 90;
      L.holes.forEach((h, k) => {
        const g = h.green[0];
        const d = Math.min(
          Math.hypot(h.tee.x - p.shape.x, h.tee.z - p.shape.z),
          Math.hypot(g.x - p.shape.x, g.z - p.shape.z),
        );
        if (d < bd) {
          bd = d;
          best = holes[k];
        }
      });
    }
    best.shapes.push(p.shape);
  });
  range.shapes.push(L.range.area);
  for (const t of L.range.targets) range.discs.push({ x: t.x, z: t.z, r: t.r });
  // Paths: leg i runs along hole i; the rest (home paths) are the clubhouse's
  L.paths.forEach((p, i) => (i < holes.length ? holes[i] : club).paths.push(p));
  const all = [...holes, club, range];
  const pad = OVERLAY_FRINGE + 8;
  for (const r of all) {
    for (const s of r.shapes) growShape(r, s, pad);
    for (const f of r.fine) growShape(r, f.shape, pad + 6);
    for (const rb of r.ribbons) growRibbon(r, rb, pad);
    for (const rb of r.paths) growRibbon(r, rb, pad);
    for (const d of r.discs) grow(r, d.x - d.r - pad, d.z - d.r - pad, d.x + d.r + pad, d.z + d.r + pad);
    boxOf(r);
  }
  return all;
}

/** Distance from (x, z) to a region's bounds (0 inside). */
export function regionDist(r: Region, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

// ── Output buffer ───────────────────────────────────────────────────────

/** A growable typed array (no garbage from number[] growth while building). */
class Buf<T extends Float32Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  push(...v: number[]) {
    if (this.n + v.length > this.a.length) {
      const next = new (this.a.constructor as { new (n: number): T })(Math.max(this.a.length * 2, this.n + v.length));
      next.set(this.a);
      this.a = next;
    }
    for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i];
  }
  done(): T {
    return this.a.slice(0, this.n) as T;
  }
}

class Out {
  pos = new Buf(new Float32Array(3 * 4096));
  nrm = new Buf(new Float32Array(3 * 4096));
  col = new Buf(new Float32Array(3 * 4096));
  idx = new Buf(new Uint32Array(6 * 4096));
  constructor(
    readonly ox: number,
    readonly oz: number,
  ) {}
  get count() {
    return this.pos.n / 3;
  }
  data(): MeshData {
    return {
      pos: this.pos.done(),
      nrm: this.nrm.done(),
      col: this.col.done(),
      uv: null,
      idx: this.idx.done(),
      count: this.count,
    };
  }
}

const _g: GroundSample = { lie: 'deep', stripe: 0, hole: 0 };
const _c: Rgb = { r: 0, g: 0, b: 0 };
const _n = { x: 0, y: 1, z: 0 };

function pushVertex(C: GolfCourse, o: Out, x: number, y: number, z: number, n: { x: number; y: number; z: number }) {
  o.pos.push(x - o.ox, y, z - o.oz);
  o.nrm.push(n.x, n.y, n.z);
  const g = C.ground(x, z, _g);
  lieColour(g.lie, g.stripe, x, z, _c);
  o.col.push(_c.r, _c.g, _c.b);
}

// ── Grids ───────────────────────────────────────────────────────────────

/**
 * A masked grid over [x0, x1] × [z0, z1] at spacing h: the cells whose
 * centre passes `include`, with heights from the course (+ lift). Yields
 * after every row.
 */
export function* gridPatch(
  C: GolfCourse,
  o: Out,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  h: number,
  lift: number,
  include: (x: number, z: number) => boolean,
): Generator<void> {
  const nx = Math.max(1, Math.ceil((x1 - x0) / h));
  const nz = Math.max(1, Math.ceil((z1 - z0) / h));
  const cells = new Uint8Array(nx * nz);
  let any = false;
  for (let k = 0; k < nz; k++) {
    const cz = z0 + (k + 0.5) * h;
    for (let i = 0; i < nx; i++)
      if (include(x0 + (i + 0.5) * h, cz)) {
        cells[k * nx + i] = 1;
        any = true;
      }
    yield;
  }
  if (!any) return;
  const W = nx + 1;
  const vid = new Int32Array(W * (nz + 1)).fill(-1);
  const hy = new Float32Array(W * (nz + 1));
  // Vertex use count: 4 = interior, fewer = on the patch's edge
  const uses = new Uint8Array(W * (nz + 1));
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      if (cells[k * nx + i] === 0) continue;
      vid[k * W + i] = vid[k * W + i + 1] = vid[(k + 1) * W + i] = vid[(k + 1) * W + i + 1] = 0;
      uses[k * W + i]++;
      uses[k * W + i + 1]++;
      uses[(k + 1) * W + i]++;
      uses[(k + 1) * W + i + 1]++;
    }
  // Heights first (normals read neighbours)
  for (let k = 0; k <= nz; k++) {
    const z = z0 + k * h;
    for (let i = 0; i <= nx; i++) if (vid[k * W + i] === 0) hy[k * W + i] = C.height(x0 + i * h, z);
    yield;
  }
  for (let k = 0; k <= nz; k++) {
    const z = z0 + k * h;
    for (let i = 0; i <= nx; i++) {
      const q = k * W + i;
      if (vid[q] !== 0) continue;
      const x = x0 + i * h;
      const l = i > 0 && vid[q - 1] !== -1;
      const r = i < nx && vid[q + 1] !== -1;
      const d = k > 0 && vid[q - W] !== -1;
      const u = k < nz && vid[q + W] !== -1;
      if ((l || r) && (d || u)) {
        const dx = ((r ? hy[q + 1] : hy[q]) - (l ? hy[q - 1] : hy[q])) / (h * ((l ? 1 : 0) + (r ? 1 : 0)));
        const dz = ((u ? hy[q + W] : hy[q]) - (d ? hy[q - W] : hy[q])) / (h * ((d ? 1 : 0) + (u ? 1 : 0)));
        const L = Math.sqrt(dx * dx + 1 + dz * dz);
        _n.x = -dx / L;
        _n.y = 1 / L;
        _n.z = -dz / L;
      } else C.normal(x, z, _n);
      vid[q] = o.count;
      pushVertex(C, o, x, hy[q] + (uses[q] < 4 ? EDGE_DIP : lift), z, _n);
    }
    yield;
  }
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      if (cells[k * nx + i] === 0) continue;
      const a = vid[k * W + i];
      const b = vid[k * W + i + 1];
      const d = vid[(k + 1) * W + i];
      const e = vid[(k + 1) * W + i + 1];
      // CCW seen from above (+Y), as the mountain mesh
      o.idx.push(a, d, b, b, d, e);
    }
}

/**
 * A ribbon-aligned strip (cart paths): columns at fixed offsets across it,
 * two of them hugging each edge so the concrete stops crisply.
 */
export function* stripPatch(
  C: GolfCourse,
  o: Out,
  rb: Ribbon,
  step: number,
  lift: number,
): Generator<void> {
  const half = rb.half[0];
  const reach = half + OVERLAY_FRINGE;
  const cols = [-reach, -half - 2.2, -half - 0.08, -half + 0.08, 0, half - 0.08, half + 0.08, half + 2.2, reach];
  // Split at sharp corners: each run is its own strip, run on past its ends,
  // so the outside of a corner is covered too
  const runs: { x: number; z: number }[][] = [[rb.pts[0]]];
  for (let i = 1; i < rb.pts.length; i++) {
    runs[runs.length - 1].push(rb.pts[i]);
    if (i < rb.pts.length - 1) {
      const a = rb.pts[i - 1];
      const b = rb.pts[i];
      const c = rb.pts[i + 1];
      const t1 = Math.atan2(b.x - a.x, b.z - a.z);
      const t2 = Math.atan2(c.x - b.x, c.z - b.z);
      let turn = Math.abs(t2 - t1);
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      if (turn > 0.45) runs.push([b]);
    }
  }
  for (const run of runs) if (run.length > 1) yield* stripRun(C, o, run, step, lift, half, reach, cols);
}

function* stripRun(
  C: GolfCourse,
  o: Out,
  P: { x: number; z: number }[],
  step: number,
  lift: number,
  half: number,
  reach: number,
  cols: number[],
): Generator<void> {
  void half;
  // Resample the polyline at `step`, with a side vector per point
  const pts: { x: number; z: number; sx: number; sz: number }[] = [];
  for (let i = 1; i < P.length; i++) {
    const ax = P[i - 1].x;
    const az = P[i - 1].z;
    const L = Math.hypot(P[i].x - ax, P[i].z - az);
    const n = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < n || (i === P.length - 1 && s === n); s++) {
      const t = s / n;
      pts.push({ x: ax + (P[i].x - ax) * t, z: az + (P[i].z - az) * t, sx: 0, sz: 0 });
    }
  }
  if (pts.length < 2) return;
  // Run on past both ends by the fringe (ribbonDist's ends are round caps)
  const cap = (e: number, n: number) => {
    const dx = pts[e].x - pts[n].x;
    const dz = pts[e].z - pts[n].z;
    const L = Math.hypot(dx, dz) || 1;
    return { x: pts[e].x + (dx / L) * reach, z: pts[e].z + (dz / L) * reach, sx: 0, sz: 0 };
  };
  const head = cap(0, 1);
  const tail = cap(pts.length - 1, pts.length - 2);
  pts.unshift(head);
  pts.push(tail);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    // Right of the direction of travel
    pts[i].sx = dz / L;
    pts[i].sz = -dx / L;
  }
  const base = o.count;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const end = i === 0 || i === pts.length - 1;
    for (const c of cols) {
      const x = p.x + p.sx * c;
      const z = p.z + p.sz * c;
      C.normal(x, z, _n);
      const edge = end || c === cols[0] || c === cols[cols.length - 1];
      pushVertex(C, o, x, C.height(x, z) + (edge ? EDGE_DIP : lift), z, _n);
    }
    if ((i & 3) === 3) yield;
  }
  const nc = cols.length;
  for (let i = 0; i < pts.length - 1; i++)
    for (let c = 0; c < nc - 1; c++) {
      const a = base + i * nc + c;
      const b = a + 1;
      const d = a + nc;
      const e = d + 1;
      // Pick the winding that faces up
      const ax = o.pos.a[a * 3];
      const az = o.pos.a[a * 3 + 2];
      const bx = o.pos.a[b * 3] - ax;
      const bz = o.pos.a[b * 3 + 2] - az;
      const dx = o.pos.a[d * 3] - ax;
      const dz = o.pos.a[d * 3 + 2] - az;
      // y of (d − a) × (b − a)
      if (dz * bx - dx * bz > 0) o.idx.push(a, d, b, b, d, e);
      else o.idx.push(a, b, d, b, e, d);
    }
}

/** A disc patch (range target greens) following the ground. */
export function* discPatch(
  C: GolfCourse,
  o: Out,
  x: number,
  z: number,
  r: number,
  step: number,
  lift: number,
): Generator<void> {
  const rings = Math.max(2, Math.ceil(r / step));
  const sides = Math.max(12, Math.ceil((Math.PI * 2 * r) / step));
  const c0 = o.count;
  C.normal(x, z, _n);
  o.pos.push(x - o.ox, C.height(x, z) + lift, z - o.oz);
  o.nrm.push(_n.x, _n.y, _n.z);
  const g = rgbOf(0x86df5a, x, z);
  o.col.push(g.r, g.g, g.b);
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / rings;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      C.normal(px, pz, _n);
      o.pos.push(px - o.ox, C.height(px, pz) + lift, pz - o.oz);
      o.nrm.push(_n.x, _n.y, _n.z);
      const c = rgbOf(k === rings ? 0x5fbd40 : 0x86df5a, px, pz);
      o.col.push(c.r, c.g, c.b);
    }
  }
  yield;
  for (let s = 0; s < sides; s++) {
    const a = c0 + 1 + s;
    const b = c0 + 1 + ((s + 1) % sides);
    o.idx.push(c0, b, a);
  }
  for (let k = 1; k < rings; k++)
    for (let s = 0; s < sides; s++) {
      const a = c0 + 1 + (k - 1) * sides + s;
      const b = c0 + 1 + (k - 1) * sides + ((s + 1) % sides);
      const d = a + sides;
      const e = b + sides;
      o.idx.push(a, e, d, a, b, e);
    }
}

function rgbOf(hex: number, x: number, z: number): Rgb {
  // Targets read as greens: the green's colour, the fringe's on the edge
  lieColour(hex === 0x5fbd40 ? 'fringe' : 'green', 0, x, z, _c);
  return _c;
}

// ── Regions ─────────────────────────────────────────────────────────────

/** Groups of fine shapes whose grids would overlap (one grid each). */
export function fineClusters(fine: FineShape[], coarse: number): FineShape[][] {
  const box = (f: FineShape) => {
    const R = shapeRadius(f.shape) + fineZone(f.kind, coarse) + 3;
    return [f.shape.x - R, f.shape.z - R, f.shape.x + R, f.shape.z + R];
  };
  const parent = fine.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const boxes = fine.map(box);
  for (let i = 0; i < fine.length; i++)
    for (let j = i + 1; j < fine.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) parent[find(i)] = find(j);
    }
  const groups = new Map<number, FineShape[]>();
  fine.forEach((f, i) => {
    const k = find(i);
    let g = groups.get(k);
    if (g === undefined) groups.set(k, (g = []));
    g.push(f);
  });
  return [...groups.values()];
}

/** Signed distance to everything the region overlays (m, negative inside). */
export function regionDist2(r: Region, x: number, z: number): number {
  let d = Infinity;
  for (const s of r.shapes) d = Math.min(d, shapeDist(s, x, z));
  for (const f of r.fine) d = Math.min(d, shapeDist(f.shape, x, z));
  for (const rb of r.ribbons) if (d > -1) d = Math.min(d, ribbonDist(rb, x, z));
  return d;
}

/** Distance past the fine zones (negative: inside one). */
function fineDist(fine: FineShape[], coarse: number, x: number, z: number): number {
  let d = Infinity;
  for (const f of fine) d = Math.min(d, shapeDist(f.shape, x, z) - fineZone(f.kind, coarse));
  return d;
}

export interface RegionBuild {
  data: MeshData | null;
  /** Wall-clock ms spent in the generator (the scheduler adds it up). */
  verts: number;
}

/** Build one region's overlay mesh at a LOD (positions relative to (r.cx, r.cz)). */
export function* buildRegion(C: GolfCourse, r: Region, lod: number, out: RegionBuild): Generator<void> {
  const L = OVERLAY_LOD[lod];
  const o = new Out(r.cx, r.cz);
  const hc = L.coarse;
  const hf = L.fine;
  const F = OVERLAY_FRINGE;
  // Coarse: anything within the fringe, except well inside a fine zone
  if (r.shapes.length > 0 || r.ribbons.length > 0 || r.fine.length > 0) {
    const cut = hc * 0.72;
    yield* gridPatch(C, o, r.x0, r.z0, r.x1, r.z1, hc, LIFT.coarse, (x, z) => {
      if (r.fine.length > 0 && fineDist(r.fine, hc, x, z) < -hc) return false;
      let d = Infinity;
      for (const s of r.shapes) d = Math.min(d, shapeDist(s, x, z));
      for (const f of r.fine) d = Math.min(d, shapeDist(f.shape, x, z));
      if (d < F + cut) return true;
      for (const rb of r.ribbons) if (ribbonDist(rb, x, z) < F + cut) return true;
      return false;
    });
  }
  // Fine: each cluster of greens / bunkers
  for (const cl of fineClusters(r.fine, hc)) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const f of cl) {
      const R = shapeRadius(f.shape) + fineZone(f.kind, hc) + hf * 3;
      x0 = Math.min(x0, f.shape.x - R);
      z0 = Math.min(z0, f.shape.z - R);
      x1 = Math.max(x1, f.shape.x + R);
      z1 = Math.max(z1, f.shape.z + R);
    }
    yield* gridPatch(C, o, x0, z0, x1, z1, hf, LIFT.fine, (x, z) => fineDist(cl, hc, x, z) < hf * 1.5);
  }
  for (const p of r.paths) yield* stripPatch(C, o, p, L.strip, LIFT.strip);
  for (const d of r.discs) yield* discPatch(C, o, d.x, d.z, d.r, L.disc, LIFT.disc);
  yield;
  out.data = o.count > 0 ? o.data() : null;
  out.verts = o.count;
}

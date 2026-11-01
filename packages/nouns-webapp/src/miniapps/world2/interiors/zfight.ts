// ── Z-fighting finder (pure): coplanar, overlapping faces of different colour ──
//
// Two faces facing the same way on (nearly) the same plane flicker in and
// out of each other at a distance: a label flush with a fridge door, a rug
// on the floor, a band level with a cabinet top. This finds them in a set
// of painted geometries (the kit's buckets), so a test can keep every
// decal off its host. Faces facing opposite ways (a box resting on a
// shelf) never show each other, so they don't count.

import type * as THREE from 'three';

/**
 * Planes closer than this (m) fight. The room camera's depth buffer
 * (near 0.15 m, 24 bits) resolves ~0.05 mm at 10 m and ~0.2 mm at 20 m, so
 * anything pulled 2× this far apart stays put on screen.
 */
export const FIGHT_TOL = 0.001;

export interface Face {
  /** Unit normal and plane offset (n · p = d). */
  n: [number, number, number];
  d: number;
  /** Triangle corners. */
  p: [number, number, number][];
  /** Which geometry it came from, and its look (bucket + colour). */
  src: number;
  look: string;
  /** Bounds (for a quick reject). */
  lo: [number, number, number];
  hi: [number, number, number];
}

export interface Fight {
  a: Face;
  b: Face;
  /** Overlap area (m²) and how far apart the planes are (m). */
  area: number;
  gap: number;
}

/** Faces of painted geometries (position + colour attributes, non-indexed). */
export function facesOf(
  geos: { geo: THREE.BufferGeometry; bucket: string }[],
  only?: ReadonlySet<number>,
): Face[] {
  const out: Face[] = [];
  geos.forEach(({ geo, bucket }, src) => {
    if (only !== undefined && !only.has(src)) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute | undefined;
    const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const art = bucket === 'art' || bucket === 'artGlow';
    // A piece is mostly one colour: reuse the last face's look string while
    // its colour (and atlas spot) is the same (building it was most of the cost)
    let lastLook = bucket;
    let lr = NaN;
    let lg = NaN;
    let lb = NaN;
    let lu = NaN;
    let lv = NaN;
    // Plain float arrays (the kit's are): read them directly, not through getX
    const P =
      pos.itemSize === 3 &&
      !pos.normalized &&
      (pos as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute !== true
        ? (pos.array as ArrayLike<number>)
        : null;
    const at = (i: number): [number, number, number] =>
      P !== null
        ? [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!]
        : [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const a = at(i);
      const b = at(i + 1);
      const c = at(i + 2);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      // Textured faces differ by what part of the atlas they show
      let look = bucket;
      if (col !== undefined) {
        const cr = col.getX(i);
        const cg = col.getY(i);
        const cb = col.getZ(i);
        const u = art ? (uv?.getX(i) ?? NaN) : 0;
        const v = art ? (uv?.getY(i) ?? NaN) : 0;
        // (NaN never equals itself, so a missing uv is rebuilt each time, as before)
        if (cr !== lr || cg !== lg || cb !== lb || u !== lu || v !== lv) {
          const tex = art ? `@${uv?.getX(i).toFixed(3)},${uv?.getY(i).toFixed(3)}` : '';
          lastLook = `${bucket}:${cr.toFixed(3)},${cg.toFixed(3)},${cb.toFixed(3)}${tex}`;
          lr = cr;
          lg = cg;
          lb = cb;
          lu = u;
          lv = v;
        }
        look = lastLook;
      }
      out.push({
        n: [nx, ny, nz],
        d: nx * a[0] + ny * a[1] + nz * a[2],
        p: [a, b, c],
        src,
        look,
        lo: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
        hi: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])],
      });
    }
  });
  return out;
}

/**
 * Pairs of faces from different geometries that face the same way, lie
 * within `tol` metres of the same plane, overlap by more than `minArea`
 * and look different.
 */
export function findFights(faces: Face[], tol = FIGHT_TOL, minArea = 2e-4): Fight[] {
  // Bucket by quantised normal and plane offset (neighbouring offset cells
  // too). Numeric keys, groups kept in first-seen order (the order fights
  // come out in decides which of a pair's planes resolveFights moves first)
  const nkey = (f: Face) =>
    ((Math.round(f.n[0] * 200) + 200) * 401 + (Math.round(f.n[1] * 200) + 200)) * 401 +
    (Math.round(f.n[2] * 200) + 200);
  const byNormal = new Map<number, Map<number, Face[]>>();
  const order: { list: Face[]; nk: number; cell: number }[] = [];
  for (const f of faces) {
    const nk = nkey(f);
    // (| 0: a small int, not a boxed double / -0, as the map key; same cell either way)
    const c = Math.round(f.d / tol) | 0;
    let cells = byNormal.get(nk);
    if (cells === undefined) byNormal.set(nk, (cells = new Map()));
    let g = cells.get(c);
    if (g === undefined) {
      cells.set(c, (g = []));
      order.push({ list: g, nk, cell: c });
    }
    g.push(f);
  }
  const out: Fight[] = [];
  const seen = new Set<string>();
  const none: Face[] = [];
  const test = (a: Face, b: Face) => {
    if (a === b || a.src === b.src || a.look === b.look) return;
    // Bounds must overlap (by more than a sliver) across the plane
    let apart = false;
    for (let k = 0; k < 3 && !apart; k++) {
      if (Math.abs(a.n[k]!) > 0.9) continue;
      apart = Math.min(a.hi[k]!, b.hi[k]!) - Math.max(a.lo[k]!, b.lo[k]!) < 1e-4;
    }
    if (apart) return;
    const gap = Math.abs(a.d - b.d);
    if (gap > tol) return;
    const area = overlapArea(a, b);
    if (area <= minArea) return;
    const key = a.src < b.src ? `${a.src}:${b.src}` : `${b.src}:${a.src}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a, b, area, gap });
  };
  // Within a plane cell, only faces whose bounds overlap along one in-plane
  // axis can fight: bin each cell along it, and test a face only against the
  // faces in the bins it spans. Candidates are tested in the cell's own order,
  // so fights come out exactly as the all-pairs loop found them (a room's
  // floor plane holds ~560 faces: ~300k pair tests a pass before, entering a
  // room spent ~0.3 s here on a tablet)
  const binned = new Map<Face[], Binned>();
  const binsOf = (list: Face[]) => {
    let b = binned.get(list);
    if (b === undefined) binned.set(list, (b = binFaces(list)));
    return b;
  };
  const cand: number[] = [];
  const against = (a: Face, list: Face[]) => {
    if (list.length < BIN_MIN) {
      for (const b of list) test(a, b);
      return;
    }
    const g = binsOf(list);
    const k = g.axis;
    const lo = Math.floor((a.lo[k]! + SHRINK) / BIN);
    const hi = Math.floor((a.hi[k]! - SHRINK) / BIN);
    g.stamp++;
    cand.length = 0;
    for (let c = lo; c <= hi; c++) {
      const bin = g.bins.get(c);
      if (bin === undefined) continue;
      for (const i of bin)
        if (g.seen[i] !== g.stamp) {
          g.seen[i] = g.stamp;
          cand.push(i);
        }
    }
    cand.sort((x, y) => x - y);
    for (const i of cand) test(a, list[i]!);
  };
  for (const { list, nk, cell } of order) {
    const cells = byNormal.get(nk)!;
    const near = cells.get(cell) ?? none;
    const next = cells.get(cell + 1) ?? none;
    for (const a of list) {
      against(a, near);
      against(a, next);
    }
  }
  return out;
}

/** Bin width (m) along a plane cell's in-plane axis, and the cell size worth binning. */
const BIN = 0.25;
const BIN_MIN = 24;
/** Bounds shrink before binning: under half test()'s 1e-4 sliver, so two faces
 * overlapping by 1e-4 still share a bin. */
const SHRINK = 4e-5;

interface Binned {
  axis: number;
  /** Bin → indices into the cell's list, ascending. */
  bins: Map<number, number[]>;
  seen: Int32Array;
  stamp: number;
}

/**
 * Bin a plane cell's faces along the in-plane axis the normal is least
 * aligned with. A face goes in every bin its bounds span (shrunk by under half
 * the 1e-4 sliver test() ignores), so a pair test() could accept always shares a bin.
 */
function binFaces(list: Face[]): Binned {
  const n = list[0]!.n;
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const axis = ax <= ay && ax <= az ? 0 : ay <= az ? 1 : 2;
  const bins = new Map<number, number[]>();
  list.forEach((f, i) => {
    const lo = Math.floor((f.lo[axis]! + SHRINK) / BIN);
    const hi = Math.floor((f.hi[axis]! - SHRINK) / BIN);
    for (let c = lo; c <= hi; c++) {
      let b = bins.get(c);
      if (b === undefined) bins.set(c, (b = []));
      b.push(i);
    }
  });
  return { axis, bins, seen: new Int32Array(list.length), stamp: 0 };
}

/** Overlap area of two (nearly) coplanar triangles, projected on their dominant plane. */
export function overlapArea(a: Face, b: Face): number {
  const [nx, ny, nz] = a.n.map(Math.abs) as [number, number, number];
  // Drop the axis the normal points along most
  const drop = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
  const keep = [0, 1, 2].filter(i => i !== drop) as [number, number];
  const flat = (f: Face) => f.p.map(q => [q[keep[0]], q[keep[1]]] as [number, number]);
  const A = ccw(flat(a));
  const B = ccw(flat(b));
  // Quick reject on bounds
  const bb = (t: [number, number][]) => [
    Math.min(...t.map(q => q[0])),
    Math.max(...t.map(q => q[0])),
    Math.min(...t.map(q => q[1])),
    Math.max(...t.map(q => q[1])),
  ];
  const ba = bb(A);
  const bbb = bb(B);
  if (ba[1]! <= bbb[0]! || bbb[1]! <= ba[0]! || ba[3]! <= bbb[2]! || bbb[3]! <= ba[2]!) return 0;
  // Area in the projection, scaled back to the true plane
  const scale = 1 / Math.max(1e-6, [nx, ny, nz][drop]!);
  return polyArea(clip(A, B)) * scale;
}

function ccw(t: [number, number][]): [number, number][] {
  return signed(t) < 0 ? [...t].reverse() : t;
}

function signed(poly: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function polyArea(poly: [number, number][]): number {
  return poly.length < 3 ? 0 : Math.abs(signed(poly));
}

/** Sutherland–Hodgman: `subject` clipped by convex counter-clockwise `clipper`. */
function clip(subject: [number, number][], clipper: [number, number][]): [number, number][] {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length > 0; i++) {
    const [ax, ay] = clipper[i]!;
    const [bx, by] = clipper[(i + 1) % clipper.length]!;
    const inside = (p: [number, number]) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) >= 0;
    const cross = (p: [number, number], q: [number, number]): [number, number] => {
      const a1 = by - ay;
      const b1 = ax - bx;
      const c1 = a1 * ax + b1 * ay;
      const a2 = q[1] - p[1];
      const b2 = p[0] - q[0];
      const c2 = a2 * p[0] + b2 * p[1];
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-12) return p;
      return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j + input.length - 1) % input.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
  }
  return out;
}

/**
 * Pull apart every z-fight in place: of each fighting pair, the geometry
 * added later (`geos` is in add order: a label after its door, a lamp panel
 * after its trim) has every vertex on the shared plane pushed `step` metres
 * out along the plane's normal. For a box that lengthens it by `step` on
 * that face (no cracks); a flat panel just moves forward. Repeats until
 * nothing fights (a few passes at most). Returns how many faces moved.
 */
export function resolveFights(
  geos: { geo: THREE.BufferGeometry; bucket: string }[],
  step = 2 * FIGHT_TOL,
  tol = FIGHT_TOL,
  passes = 40,
): number {
  let moved = 0;
  // A run of n flush pieces fans out one step per pass (each pass moves
  // the later of every pair); after the first, only re-check those pieces
  let faces = facesOf(geos);
  let narrowed = false;
  for (let pass = 0; pass < passes; pass++) {
    let fights = findFights(faces, tol);
    // Clean among the pieces being fanned out: check everything once more
    // (a moved face can land on a third piece's plane)
    if (fights.length === 0 && narrowed) fights = findFights(facesOf(geos), tol);
    if (fights.length === 0) break;
    const done = new Set<string>();
    const involved = new Set<number>();
    for (const f of fights) {
      involved.add(f.a.src);
      involved.add(f.b.src);
      const later = f.a.src > f.b.src ? f.a : f.b;
      const key = `${later.src}|${later.n.map(v => v.toFixed(2)).join(',')}|${later.d.toFixed(4)}`;
      if (done.has(key)) continue;
      done.add(key);
      const pos = geos[later.src]!.geo.attributes.position as THREE.BufferAttribute;
      const [nx, ny, nz] = later.n;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (Math.abs(nx * x + ny * y + nz * z - later.d) < tol)
          pos.setXYZ(i, x + nx * step, y + ny * step, z + nz * step);
      }
      pos.needsUpdate = true;
      moved++;
    }
    faces = facesOf(geos, involved);
    narrowed = true;
  }
  return moved;
}

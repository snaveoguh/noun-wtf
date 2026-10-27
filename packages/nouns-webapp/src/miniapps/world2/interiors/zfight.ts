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
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const a: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const b: [number, number, number] = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
      const c: [number, number, number] = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
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
      const tex =
        bucket === 'art' || bucket === 'artGlow'
          ? `@${uv?.getX(i).toFixed(3)},${uv?.getY(i).toFixed(3)}`
          : '';
      const look =
        col !== undefined
          ? `${bucket}:${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}${tex}`
          : bucket;
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
  // Bucket by quantised normal and plane offset (neighbouring offset cells too)
  const cell = (f: Face) => Math.round(f.d / tol);
  const nkey = (f: Face) => f.n.map(v => Math.round(v * 200)).join(',');
  const groups = new Map<string, Face[]>();
  for (const f of faces) {
    const k = `${nkey(f)}|${cell(f)}`;
    let g = groups.get(k);
    if (g === undefined) groups.set(k, (g = []));
    g.push(f);
  }
  const out: Fight[] = [];
  const seen = new Set<string>();
  for (const [k, list] of groups) {
    const [nk, ck] = k.split('|') as [string, string];
    const others = [Number(ck), Number(ck) + 1].flatMap(c => groups.get(`${nk}|${c}`) ?? []);
    for (const a of list)
      for (const b of others) {
        if (a === b || a.src === b.src || a.look === b.look) continue;
        // Bounds must overlap (by more than a sliver) across the plane
        let apart = false;
        for (let k = 0; k < 3 && !apart; k++) {
          if (Math.abs(a.n[k]!) > 0.9) continue;
          apart = Math.min(a.hi[k]!, b.hi[k]!) - Math.max(a.lo[k]!, b.lo[k]!) < 1e-4;
        }
        if (apart) continue;
        const gap = Math.abs(a.d - b.d);
        if (gap > tol) continue;
        const area = overlapArea(a, b);
        if (area <= minArea) continue;
        const key = a.src < b.src ? `${a.src}:${b.src}` : `${b.src}:${a.src}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a, b, area, gap });
      }
  }
  return out;
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

// ── NOUN STADIUM's colliders (pure, pitch-local) ─────────────────────────
//
// The solid shell a rider can't walk through, as a few dozen convex
// "slabs": in a stand's own frame (r back from its front, a along it) a
// slab spans [r0, r1] × [a0, a1] with a bottom and a top that each run
// linearly in r (a rake, a sloped soffit; a box when both are flat). The
// view turns them into one position-only geometry for
// CollisionWorld.setDynamic. The stands' collision is the rake itself (a
// smooth slope over the steps, so you can climb up into the seats), the
// facade is closed except the main entrance, and the main entrance, the
// concourse and the players' tunnel lead to the pitch (collider.test.ts
// walks it).
//
// The roofs, the pylons and the big screen have none (out of reach; and
// a roof underfoot would stand you above the run-proof band on the downhill
// side, see football/site.ts).

import { STADIUM } from '../../contract';

import {
  ADS,
  CORNER,
  DUGOUT,
  ENTRANCE,
  FACADE,
  FRONT_WALL,
  LOWER_BACK,
  STANDS,
  TUNNEL,
  TUNNEL_ROW0,
  rowR,
  rowY,
  standToPitch,
  tierBack,
  tierTop,
  type StandDef,
} from './layout';

export interface Slab {
  /** 8 corners (pitch-local): bottom r0a0, r1a0, r1a1, r0a1, then the same on top. */
  pts: [number, number, number][];
  name: string;
}

const _p = { x: 0, z: 0 };

/** A slab in a stand's frame (or the pitch frame: pass null and r = x, a = z). */
export function slab(
  s: StandDef | null,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  bottom: [number, number],
  top: [number, number],
  name: string,
): Slab {
  const at = (r: number, a: number) => {
    if (s === null) return [r, a] as const;
    standToPitch(s, r, a, _p);
    return [_p.x, _p.z] as const;
  };
  const pts: [number, number, number][] = [];
  for (const [ys, k] of [
    [bottom, 0],
    [top, 1],
  ] as const) {
    void k;
    for (const [r, a] of [
      [r0, a0],
      [r1, a0],
      [r1, a1],
      [r0, a1],
    ] as const) {
      const [x, z] = at(r, a);
      const y = r === r0 ? ys[0] : ys[1];
      pts.push([x, y, z]);
    }
  }
  return { pts, name };
}

/** A pitch-frame box. */
export const boxSlab = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  name: string,
) => slab(null, x0, x1, z0, z1, [y0, y0], [y1, y1], name);

/** Every collider slab of the stadium. */
export function stadiumSlabs(): Slab[] {
  const out: Slab[] = [];
  for (const s of STANDS) {
    const t0 = s.tiers[0]!;
    const back0 = tierBack(t0);
    const rake: [number, number] = [FRONT_WALL, tierTop(t0)];
    if (s.id === 'main') {
      // split round the tunnel (walls + slab + the rows over it)
      const g = TUNNEL.half + TUNNEL.wall;
      out.push(slab(s, 0, back0, -s.half, -g, [0, 0], rake, 'main lower −'));
      out.push(slab(s, 0, back0, g, s.half, [0, 0], rake, 'main lower +'));
      const top = TUNNEL.height + TUNNEL.slab;
      for (const side of [-1, 1])
        out.push(
          slab(
            s,
            -1.5,
            back0,
            side < 0 ? -g : TUNNEL.half,
            side < 0 ? -TUNNEL.half : g,
            [0, 0],
            [top, top],
            'tunnel wall',
          ),
        );
      const r8 = rowR(t0, TUNNEL_ROW0);
      out.push(slab(s, -1.5, r8, -g, g, [TUNNEL.height, TUNNEL.height], [top, top], 'tunnel slab'));
      out.push(
        slab(
          s,
          r8,
          back0,
          -g,
          g,
          [TUNNEL.height, TUNNEL.height],
          [rowY(t0, TUNNEL_ROW0 - 1), tierTop(t0)],
          'over tunnel',
        ),
      );
    } else out.push(slab(s, 0, back0, -s.half, s.half, [0, 0], rake, `${s.id} tier`));
    const t1 = s.tiers[1];
    if (t1 !== undefined) {
      out.push(
        slab(
          s,
          t1.r0,
          tierBack(t1),
          -s.half,
          s.half,
          [t1.y0 - 1.6, tierTop(t1) - 1],
          [t1.y0, tierTop(t1)],
          `${s.id} upper`,
        ),
      );
      // the boxes' glass front between the tiers
      out.push(
        slab(
          s,
          LOWER_BACK,
          t1.r0,
          -s.half,
          s.half,
          [tierTop(t0) + 1, tierTop(t0) + 1],
          [t1.y0, t1.y0],
          `${s.id} boxes`,
        ),
      );
    }
  }
  // Facade (closed but for the main entrance)
  const X = STADIUM.halfX;
  const Z = STADIUM.halfZ;
  const T = FACADE.thick;
  out.push(boxSlab(X - T, 0, -Z, X, FACADE.side, Z, 'facade far'));
  out.push(boxSlab(-X, 0, -Z, -X + T, FACADE.side, -ENTRANCE.half, 'facade main −'));
  out.push(boxSlab(-X, 0, ENTRANCE.half, -X + T, FACADE.side, Z, 'facade main +'));
  out.push(
    boxSlab(-X, ENTRANCE.height, -ENTRANCE.half, -X + T, FACADE.side, ENTRANCE.half, 'lintel'),
  );
  out.push(boxSlab(-X + T, 0, Z - T, X - T, FACADE.end, Z, 'facade east'));
  out.push(boxSlab(-X + T, 0, -Z, X - T, FACADE.end, -Z + T, 'facade west'));
  // Corner blocks
  const side = STANDS[0]!;
  const end = STANDS[2]!;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const xa = end.half;
      const xb = X - T;
      const za = side.half;
      const zb = Z - T;
      out.push(
        boxSlab(
          sx < 0 ? -xb : xa,
          0,
          sz < 0 ? -zb : za,
          sx < 0 ? -xa : xb,
          CORNER.height,
          sz < 0 ? -za : zb,
          'corner',
        ),
      );
    }
  // Dugouts: back wall + roof (you can step in under it)
  for (const sz of [-1, 1]) {
    const z0 = sz < 0 ? -DUGOUT.z1 : DUGOUT.z0;
    const z1 = sz < 0 ? -DUGOUT.z0 : DUGOUT.z1;
    const xb = DUGOUT.x - DUGOUT.depth;
    out.push(boxSlab(xb - 0.15, 0, z0, xb, DUGOUT.height, z1, 'dugout back'));
    out.push(boxSlab(xb, DUGOUT.height - 0.12, z0, DUGOUT.x, DUGOUT.height, z1, 'dugout roof'));
  }
  // Ad boards
  const ht = ADS.height;
  for (const sx of [-1, 1]) {
    const x0 = sx * ADS.sideX;
    const x1 = x0 + sx * 0.25;
    const xs: [number, number] = sx < 0 ? [x1, x0] : [x0, x1];
    if (sx < 0) {
      out.push(boxSlab(xs[0], 0, -ADS.sideHalf, xs[1], ht, -ADS.mainGap, 'ads'));
      out.push(boxSlab(xs[0], 0, ADS.mainGap, xs[1], ht, ADS.sideHalf, 'ads'));
    } else out.push(boxSlab(xs[0], 0, -ADS.sideHalf, xs[1], ht, ADS.sideHalf, 'ads'));
  }
  for (const sz of [-1, 1]) {
    const z0 = sz * ADS.endZ;
    const z1 = z0 + sz * 0.25;
    out.push(boxSlab(-ADS.endHalf, 0, Math.min(z0, z1), ADS.endHalf, ht, Math.max(z0, z1), 'ads'));
  }
  return out;
}

/** The 12 triangles of a slab (pitch-local positions, 36 vertices × xyz). */
export function slabTriangles(sl: Slab, out: number[]) {
  const p = sl.pts;
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  for (const [a, b, c, d] of faces) {
    for (const i of [a, b, c, a, c, d]) out.push(p[i!]![0], p[i!]![1], p[i!]![2]);
  }
  return out;
}

/** All collider triangles, pitch-local (position triplets, non-indexed). */
export function colliderPositions(): Float32Array {
  const out: number[] = [];
  for (const s of stadiumSlabs()) slabTriangles(s, out);
  return new Float32Array(out);
}

/**
 * Is pitch-local point (x, y, z) inside any slab (grown by `r`)? Tests only:
 * slabs are convex, so a point is inside when it's behind all six faces.
 */
export function insideSlab(sl: Slab, x: number, y: number, z: number, r = 0): boolean {
  const p = sl.pts;
  // centroid (to orient each face outward)
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const q of p) {
    cx += q[0] / 8;
    cy += q[1] / 8;
    cz += q[2] / 8;
  }
  const faces = [
    [0, 1, 2],
    [4, 6, 5],
    [0, 4, 1],
    [1, 5, 2],
    [2, 6, 3],
    [3, 7, 0],
  ];
  for (const [a, b, c] of faces) {
    const A = p[a!]!;
    const B = p[b!]!;
    const C = p[c!]!;
    const ux = B[0] - A[0];
    const uy = B[1] - A[1];
    const uz = B[2] - A[2];
    const vx = C[0] - A[0];
    const vy = C[1] - A[1];
    const vz = C[2] - A[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    // outward
    if ((cx - A[0]) * nx + (cy - A[1]) * ny + (cz - A[2]) * nz > 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    if ((x - A[0]) * nx + (y - A[1]) * ny + (z - A[2]) * nz > r) return false;
  }
  return true;
}

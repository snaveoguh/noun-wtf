// ── NOUN STADIUM's static parts, written into merged buffers ─────────────
//
// Each function writes one part of the bowl (pitch-local) into the Geo of
// its material: `shell` (concrete, steel, roofs, facade: lit, vertex
// colours, casts shadows), `seats` (the rows: recoloured by setKits via
// their tag), `ground` (grass stripes, surround, plaza: coplanar with the
// terrain pad, drawn over it with a polygon offset), `kit` (lines, goal
// frames, corner flags: rebuilt by setPitch), `ads` and `screen` (canvas
// textures, unlit) and `lamps` (floodlight heads, unlit). StadiumView runs
// them a few per frame.

import type { PitchSpec } from '../../contract';

import { GRASS, STADIUM } from '../../contract';

import { type Geo, type V3 } from './geo';
import {
  ADS,
  AISLE_EVERY,
  AISLE_W,
  CORNER,
  DUGOUT,
  ENTRANCE,
  FACADE,
  FRONT_WALL,
  LOWER_BACK,
  SCREEN,
  STANDS,
  TUNNEL,
  TUNNEL_ROW0,
  rowR,
  rowY,
  standToPitch,
  tierBack,
  tierTop,
  type StandDef,
  type Tier,
} from './layout';

export const COL = {
  concrete: 0xbdb7ac,
  concreteDark: 0x8d877d,
  aisle: 0xa49e94,
  front: 0x262b38,
  fascia: 0x1d2230,
  glass: 0x2f5470,
  roofTop: 0xd9d6cf,
  roofUnder: 0xf1efe9,
  steel: 0xeceae4,
  facade: 0x23304d,
  pilaster: 0xe7e1d4,
  band: 0xf3c25b,
  tunnel: 0x3a3f4b,
  grassA: 0x3f8f3a,
  grassB: 0x4c9f44,
  surround: 0x2f6a35,
  plaza: 0xaaa49b,
  concourse: 0x9b958b,
  line: 0xf6f6f1,
  post: 0xffffff,
  flag: 0xf3c25b,
  flagCloth: 0xe0362f,
  lamp: 0xfff3d2,
  lampFrame: 0x2b2e35,
  neutralSeat: 0x3d4454,
} as const;

/** Seat tags (setKits): home-coloured, away-coloured. Risers get +2 (darker). */
export const TAG_HOME = 1;
export const TAG_AWAY = 2;

const _p = { x: 0, z: 0 };

/** Stand-frame point (r back, y up, a along) → pitch-local. */
function P(s: StandDef, r: number, y: number, a: number): V3 {
  standToPitch(s, r, a, _p);
  return [_p.x, y, _p.z];
}

/** Unit vectors in pitch space: toward the pitch, back, along +a. */
function dirs(s: StandDef) {
  const toPitch: V3 = s.axis === 'x' ? [-s.side, 0, 0] : [0, 0, -s.side];
  const back: V3 = [-toPitch[0], 0, -toPitch[2]];
  const along: V3 = s.axis === 'x' ? [0, 0, 1] : [1, 0, 0];
  return { toPitch, back, along, up: [0, 1, 0] as V3 };
}

/** Which team's colour a seat at `a` along stand `s` takes. */
function seatTag(s: StandDef, a: number): number {
  if (s.id === 'west') return TAG_HOME;
  if (s.id === 'east') return TAG_AWAY;
  return a < 0 ? TAG_HOME : TAG_AWAY;
}

/** Segments of a row along a: seats and aisles (and the tunnel gap). */
function rowSegments(s: StandDef, gap: number): { a0: number; a1: number; aisle: boolean }[] {
  const cuts: [number, number, boolean][] = [];
  const kMax = Math.floor((s.half - 2) / AISLE_EVERY);
  for (let k = -kMax; k <= kMax; k++) {
    const c = k * AISLE_EVERY;
    if (gap > 0 && Math.abs(c) < gap + AISLE_W) continue;
    cuts.push([c - AISLE_W / 2, c + AISLE_W / 2, true]);
  }
  if (gap > 0) cuts.push([-gap, gap, false]);
  cuts.sort((p, q) => p[0] - q[0]);
  const out: { a0: number; a1: number; aisle: boolean }[] = [];
  let a = -s.half;
  for (const [c0, c1, isAisle] of cuts) {
    if (c0 > a) out.push({ a0: a, a1: c0, aisle: false });
    if (isAisle) out.push({ a0: c0, a1: c1, aisle: true });
    a = c1;
  }
  if (a < s.half) out.push({ a0: a, a1: s.half, aisle: false });
  return out;
}

/** One tier's rows (treads + risers) into `seats`, its ends into `shell`. */
export function buildTier(s: StandDef, t: Tier, lower: boolean, seats: Geo, shell: Geo) {
  const d = dirs(s);
  const tunnelGap = s.id === 'main' && lower ? TUNNEL.half + TUNNEL.wall : 0;
  const full = rowSegments(s, 0);
  const cut = tunnelGap > 0 ? rowSegments(s, tunnelGap) : full;
  for (let i = 0; i < t.rows; i++) {
    const r0 = rowR(t, i);
    const r1 = r0 + t.depth;
    const y = rowY(t, i);
    const yPrev = i === 0 ? y : rowY(t, i - 1);
    const segs = i < TUNNEL_ROW0 ? cut : full;
    for (const g of segs) {
      const tag = g.aisle ? 0 : seatTag(s, (g.a0 + g.a1) / 2);
      const c = g.aisle ? COL.aisle : COL.neutralSeat;
      seats.quad(
        P(s, r0, y, g.a0),
        P(s, r1, y, g.a0),
        P(s, r1, y, g.a1),
        P(s, r0, y, g.a1),
        d.up,
        c,
        undefined,
        tag,
      );
      let yb = yPrev;
      // the first row over the tunnel rises off the slab
      if (
        tunnelGap > 0 &&
        i === TUNNEL_ROW0 &&
        Math.abs(g.a0 + g.a1) < 1e-6 &&
        g.a1 - g.a0 < 2 * tunnelGap + 0.01
      )
        yb = TUNNEL.height + TUNNEL.slab;
      if (i > 0 && y > yb)
        seats.quad(
          P(s, r0, yb, g.a0),
          P(s, r0, y, g.a0),
          P(s, r0, y, g.a1),
          P(s, r0, yb, g.a1),
          d.toPitch,
          g.aisle ? COL.concreteDark : COL.neutralSeat,
          undefined,
          tag === 0 ? 0 : tag + 2,
        );
    }
  }
  // Tier bottom: for the lower tier the ground, for the upper its soffit
  const base = (r: number) =>
    lower ? 0 : t.y0 - 1.6 + ((r - t.r0) / (tierBack(t) - t.r0)) * (tierTop(t) - 1 - (t.y0 - 1.6));
  // stepped end walls at a = ±half
  for (const sa of [-1, 1]) {
    const a = sa * s.half;
    const n: V3 = [d.along[0] * sa, 0, d.along[2] * sa];
    for (let i = 0; i < t.rows; i++) {
      const r0 = rowR(t, i);
      const r1 = r0 + t.depth;
      const y = rowY(t, i);
      shell.quad(
        P(s, r0, base(r0), a),
        P(s, r1, base(r1), a),
        P(s, r1, y, a),
        P(s, r0, y, a),
        n,
        COL.concrete,
      );
    }
  }
  const rb = tierBack(t);
  const top = tierTop(t);
  if (lower) {
    // front wall (hoarding) below the first row
    for (const g of cut) {
      if (tunnelGap > 0 && Math.abs(g.a0 + g.a1) < 1e-6 && g.a1 - g.a0 < 2 * tunnelGap + 0.01)
        continue;
      shell.quad(
        P(s, 0, 0, g.a0),
        P(s, 0, FRONT_WALL, g.a0),
        P(s, 0, FRONT_WALL, g.a1),
        P(s, 0, 0, g.a1),
        d.toPitch,
        COL.front,
      );
    }
    // back wall (the concourse side), round the tunnel
    if (tunnelGap > 0) {
      const g = tunnelGap;
      shell.quad(
        P(s, rb, 0, -s.half),
        P(s, rb, top, -s.half),
        P(s, rb, top, -g),
        P(s, rb, 0, -g),
        d.back,
        COL.concrete,
      );
      shell.quad(
        P(s, rb, 0, g),
        P(s, rb, top, g),
        P(s, rb, top, s.half),
        P(s, rb, 0, s.half),
        d.back,
        COL.concrete,
      );
      shell.quad(
        P(s, rb, TUNNEL.height, -g),
        P(s, rb, top, -g),
        P(s, rb, top, g),
        P(s, rb, TUNNEL.height, g),
        d.back,
        COL.concrete,
      );
    } else
      shell.quad(
        P(s, rb, 0, -s.half),
        P(s, rb, top, -s.half),
        P(s, rb, top, s.half),
        P(s, rb, 0, s.half),
        d.back,
        COL.concrete,
      );
  } else {
    // upper tier: front fascia + sloped soffit
    shell.quad(
      P(s, t.r0, t.y0 - 1.6, -s.half),
      P(s, t.r0, t.y0, -s.half),
      P(s, t.r0, t.y0, s.half),
      P(s, t.r0, t.y0 - 1.6, s.half),
      d.toPitch,
      COL.fascia,
    );
    shell.quad(
      P(s, t.r0, base(t.r0), -s.half),
      P(s, rb, base(rb), -s.half),
      P(s, rb, base(rb), s.half),
      P(s, t.r0, base(t.r0), s.half),
      [d.toPitch[0] * 0.3, -1, d.toPitch[2] * 0.3],
      COL.roofUnder,
    );
  }
  // walkway on top, back to the facade
  const rf = (s.axis === 'x' ? STADIUM.halfX : STADIUM.halfZ) - FACADE.thick - s.front;
  if (rf > rb + 0.05)
    shell.quad(
      P(s, rb, top, -s.half),
      P(s, rf, top, -s.half),
      P(s, rf, top, s.half),
      P(s, rb, top, s.half),
      d.up,
      COL.concreteDark,
    );
}

/** The glass boxes between the tiers, the lower tier's top. */
export function buildBoxes(s: StandDef, shell: Geo) {
  const t0 = s.tiers[0]!;
  const t1 = s.tiers[1];
  if (t1 === undefined) return;
  const d = dirs(s);
  const y0 = tierTop(t0) + 0.4;
  const y1 = t1.y0 - 1.6;
  shell.quad(
    P(s, LOWER_BACK, y0, -s.half),
    P(s, LOWER_BACK, y1, -s.half),
    P(s, LOWER_BACK, y1, s.half),
    P(s, LOWER_BACK, y0, s.half),
    d.toPitch,
    COL.glass,
  );
  shell.quad(
    P(s, LOWER_BACK, y1, -s.half),
    P(s, t1.r0, y1, -s.half),
    P(s, t1.r0, y1, s.half),
    P(s, LOWER_BACK, y1, s.half),
    [0, -1, 0],
    COL.roofUnder,
  );
  // mullions
  for (let a = -s.half + 3; a < s.half; a += 6)
    shell.quad(
      P(s, LOWER_BACK - 0.06, y0, a - 0.08),
      P(s, LOWER_BACK - 0.06, y1, a - 0.08),
      P(s, LOWER_BACK - 0.06, y1, a + 0.08),
      P(s, LOWER_BACK - 0.06, y0, a + 0.08),
      d.toPitch,
      COL.fascia,
    );
}

/** A stand's roof (top, underside, edges) + its masts and ties. */
export function buildRoof(s: StandDef, shell: Geo) {
  const d = dirs(s);
  const rf = -s.roofReach;
  const rb = (s.axis === 'x' ? STADIUM.halfX : STADIUM.halfZ) - s.front + 0.4;
  const a0 = -s.half - 0.5;
  const a1 = s.half + 0.5;
  const th = 1.1;
  const yF = s.roofFront;
  const yB = s.roofBack;
  const up: V3 = [d.toPitch[0] * 0.08, 1, d.toPitch[2] * 0.08];
  shell.quad(
    P(s, rf, yF + th, a0),
    P(s, rb, yB + th, a0),
    P(s, rb, yB + th, a1),
    P(s, rf, yF + th, a1),
    up,
    COL.roofTop,
  );
  shell.quad(
    P(s, rf, yF, a0),
    P(s, rb, yB, a0),
    P(s, rb, yB, a1),
    P(s, rf, yF, a1),
    [-up[0], -1, -up[2]],
    COL.roofUnder,
  );
  shell.quad(
    P(s, rf, yF, a0),
    P(s, rf, yF + th, a0),
    P(s, rf, yF + th, a1),
    P(s, rf, yF, a1),
    d.toPitch,
    COL.steel,
  );
  for (const sa of [-1, 1]) {
    const a = sa > 0 ? a1 : a0;
    shell.quad(
      P(s, rf, yF, a),
      P(s, rb, yB, a),
      P(s, rb, yB + th, a),
      P(s, rf, yF + th, a),
      [d.along[0] * sa, 0, d.along[2] * sa],
      COL.steel,
    );
  }
  // masts just outside the facade, ties down to the roof's front edge
  const rm = rb + 0.8;
  const top = yB + 12;
  for (
    let a = -s.half + 8;
    a <= s.half - 8 + 0.01;
    a += (2 * s.half - 16) / Math.round((2 * s.half - 16) / 26)
  ) {
    shell.beam(P(s, rm, 0, a), P(s, rm, top, a), 1.1, COL.steel);
    shell.beam(P(s, rm, top, a), P(s, rf + 1, yF + th, a), 0.32, COL.steel);
    shell.beam(P(s, rm, top - 4, a), P(s, (rf + rb) / 2, (yF + yB) / 2 + th, a), 0.26, COL.steel);
  }
}

/** The facade ring with pilasters, a top band and the main entrance. */
export function buildFacade(shell: Geo) {
  const X = STADIUM.halfX;
  const Z = STADIUM.halfZ;
  const T = FACADE.thick;
  const hS = FACADE.side;
  const hE = FACADE.end;
  // walls (skip bottoms)
  shell.box(X - T, 0, -Z, X, hS, Z, COL.facade, '-y');
  shell.box(-X, 0, -Z, -X + T, hS, -ENTRANCE.half, COL.facade, '-y');
  shell.box(-X, 0, ENTRANCE.half, -X + T, hS, Z, COL.facade, '-y');
  shell.box(-X, ENTRANCE.height, -ENTRANCE.half, -X + T, hS, ENTRANCE.half, COL.facade, '');
  shell.box(-X + T, 0, Z - T, X - T, hE, Z, COL.facade, '-y');
  shell.box(-X + T, 0, -Z, X - T, hE, -Z + T, COL.facade, '-y');
  // pilasters on the outside
  const pil = (x0: number, z0: number, x1: number, z1: number, h: number) =>
    shell.box(x0, 0, z0, x1, h, z1, COL.pilaster, '-y');
  for (let z = -Z + 4; z <= Z - 4; z += 8) {
    pil(X, z - 0.4, X + 0.5, z + 0.4, hS);
    if (Math.abs(z) > ENTRANCE.half + 1) pil(-X - 0.5, z - 0.4, -X, z + 0.4, hS);
  }
  for (let x = -X + 4; x <= X - 4; x += 8) {
    pil(x - 0.4, Z, x + 0.4, Z + 0.5, hE);
    pil(x - 0.4, -Z - 0.5, x + 0.4, -Z, hE);
  }
  // top band
  shell.box(X - 0.1, hS - 2, -Z - 0.6, X + 0.7, hS, Z + 0.6, COL.band, '');
  shell.box(-X - 0.7, hS - 2, -Z - 0.6, -X + 0.1, hS, Z + 0.6, COL.band, '');
  shell.box(-X + 0.1, hE - 2, Z - 0.1, X - 0.1, hE, Z + 0.7, COL.band, '');
  shell.box(-X + 0.1, hE - 2, -Z - 0.7, X - 0.1, hE, -Z + 0.1, COL.band, '');
  // entrance frame
  shell.box(
    -X - 1.2,
    0,
    -ENTRANCE.half - 1.2,
    -X + T,
    ENTRANCE.height + 1.2,
    -ENTRANCE.half,
    COL.pilaster,
    '-y',
  );
  shell.box(
    -X - 1.2,
    0,
    ENTRANCE.half,
    -X + T,
    ENTRANCE.height + 1.2,
    ENTRANCE.half + 1.2,
    COL.pilaster,
    '-y',
  );
  shell.box(
    -X - 1.2,
    ENTRANCE.height,
    -ENTRANCE.half,
    -X,
    ENTRANCE.height + 1.2,
    ENTRANCE.half,
    COL.pilaster,
    '',
  );
  // canopy over the entrance
  shell.box(
    -X - 7,
    ENTRANCE.height + 1.2,
    -ENTRANCE.half - 4,
    -X,
    ENTRANCE.height + 1.6,
    ENTRANCE.half + 4,
    COL.steel,
    '',
  );
}

/** Corner blocks + the four floodlight pylons (masts into shell, lamp heads into lamps). */
export function buildCorners(shell: Geo, lamps: Geo) {
  const X = STADIUM.halfX - FACADE.thick;
  const Z = STADIUM.halfZ - FACADE.thick;
  const side = STANDS[0]!;
  const end = STANDS[2]!;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const xa = end.half;
      const za = side.half;
      const x0 = sx < 0 ? -X : xa;
      const x1 = sx < 0 ? -xa : X;
      const z0 = sz < 0 ? -Z : za;
      const z1 = sz < 0 ? -za : Z;
      shell.box(x0, 0, z0, x1, CORNER.height, z1, COL.concreteDark, '-y');
      shell.box(
        x0 - 0.2,
        CORNER.height - 1.4,
        z0 - 0.2,
        x1 + 0.2,
        CORNER.height - 0.6,
        z1 + 0.2,
        COL.fascia,
        '-y',
      );
      // pylon on the block's inner corner
      const px = sx * (xa + 5);
      const pz = sz * (za + 5);
      const top = CORNER.pylon;
      shell.beam([px, CORNER.height, pz], [px, top - 2, pz], 1.6, COL.steel);
      shell.beam([px - sx * 2.5, CORNER.height, pz - sz * 2.5], [px, top - 10, pz], 0.5, COL.steel);
      // head: faces the centre spot, tilted down
      const head: V3 = [px, top, pz];
      lampHead(head, shell, lamps);
    }
}

function lampHead(c: V3, shell: Geo, lamps: Geo) {
  // n: from the head toward a point near the centre spot
  let nx = -c[0] * 0.75;
  let ny = -c[1] + 4;
  let nz = -c[2] * 0.75;
  const l = Math.hypot(nx, ny, nz);
  nx /= l;
  ny /= l;
  nz /= l;
  // u: horizontal, perpendicular to n; v = n × u
  let ux = nz;
  let uz = -nx;
  const ul = Math.hypot(ux, uz);
  ux /= ul;
  uz /= ul;
  const vx = ny * uz;
  const vy = nz * ux - nx * uz;
  const vz = -ny * ux;
  const W = CORNER.headW / 2;
  const H = CORNER.headH / 2;
  const at = (a: number, b: number, o: number): V3 => [
    c[0] + ux * a + vx * b + nx * o,
    c[1] + vy * b + ny * o,
    c[2] + uz * a + vz * b + nz * o,
  ];
  // frame (back plate + rim)
  shell.quad(
    at(-W, -H, -0.3),
    at(W, -H, -0.3),
    at(W, H, -0.3),
    at(-W, H, -0.3),
    [-nx, -ny, -nz],
    COL.lampFrame,
  );
  shell.quad(at(-W, -H, 0), at(W, -H, 0), at(W, H, 0), at(-W, H, 0), [nx, ny, nz], COL.lampFrame);
  // lamps: 4 × 3
  const cols = 4;
  const rows = 3;
  const cw = (2 * W) / cols;
  const ch = (2 * H) / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a0 = -W + i * cw + 0.25;
      const a1 = -W + (i + 1) * cw - 0.25;
      const b0 = -H + j * ch + 0.25;
      const b1 = -H + (j + 1) * ch - 0.25;
      lamps.quad(
        at(a0, b0, 0.08),
        at(a1, b0, 0.08),
        at(a1, b1, 0.08),
        at(a0, b1, 0.08),
        [nx, ny, nz],
        COL.lamp,
      );
    }
}

/** The players' tunnel through the main stand + the dugouts beside it. */
export function buildTunnel(shell: Geo) {
  const s = STANDS[0]!;
  const t0 = s.tiers[0]!;
  const rb = tierBack(t0);
  const g = TUNNEL.half + TUNNEL.wall;
  const top = TUNNEL.height + TUNNEL.slab;
  const r8 = rowR(t0, TUNNEL_ROW0);
  const d = dirs(s);
  for (const sa of [-1, 1]) {
    const ai = sa * TUNNEL.half;
    const ao = sa * g;
    // inner face (into the tunnel), outer face (the mouth), top
    shell.quad(
      P(s, -1.5, 0, ai),
      P(s, rb, 0, ai),
      P(s, rb, TUNNEL.height, ai),
      P(s, -1.5, TUNNEL.height, ai),
      [-d.along[0] * sa, 0, -d.along[2] * sa],
      COL.tunnel,
    );
    shell.quad(
      P(s, -1.5, 0, ao),
      P(s, r8, 0, ao),
      P(s, r8, top, ao),
      P(s, -1.5, top, ao),
      [d.along[0] * sa, 0, d.along[2] * sa],
      COL.concrete,
    );
    shell.quad(
      P(s, -1.5, 0, ai),
      P(s, -1.5, top, ai),
      P(s, -1.5, top, ao),
      P(s, -1.5, 0, ao),
      d.toPitch,
      COL.front,
    );
  }
  // ceiling (inside), slab top + front over the mouth
  shell.quad(
    P(s, -1.5, TUNNEL.height, -TUNNEL.half),
    P(s, rb, TUNNEL.height, -TUNNEL.half),
    P(s, rb, TUNNEL.height, TUNNEL.half),
    P(s, -1.5, TUNNEL.height, TUNNEL.half),
    [0, -1, 0],
    COL.tunnel,
  );
  shell.quad(
    P(s, -1.5, top, -g),
    P(s, r8, top, -g),
    P(s, r8, top, g),
    P(s, -1.5, top, g),
    [0, 1, 0],
    COL.concreteDark,
  );
  shell.quad(
    P(s, -1.5, TUNNEL.height, -g),
    P(s, -1.5, top, -g),
    P(s, -1.5, top, g),
    P(s, -1.5, TUNNEL.height, g),
    d.toPitch,
    COL.band,
  );
  // dugouts: back, roof, ends, a bench
  for (const sz of [-1, 1]) {
    const z0 = sz < 0 ? -DUGOUT.z1 : DUGOUT.z0;
    const z1 = sz < 0 ? -DUGOUT.z0 : DUGOUT.z1;
    const xb = DUGOUT.x - DUGOUT.depth;
    shell.box(xb - 0.15, 0, z0, xb, DUGOUT.height, z1, COL.fascia, '-y');
    shell.box(xb, DUGOUT.height - 0.12, z0, DUGOUT.x + 0.2, DUGOUT.height, z1, COL.glass, '');
    shell.box(xb, 0, z0, DUGOUT.x, DUGOUT.height - 0.12, z0 + 0.06, COL.glass, '-y');
    shell.box(xb, 0, z1 - 0.06, DUGOUT.x, DUGOUT.height - 0.12, z1, COL.glass, '-y');
    shell.box(xb + 0.1, 0, z0 + 0.3, xb + 0.75, 0.48, z1 - 0.3, COL.neutralSeat, '-y');
  }
}

/** Ad board backs + tops into shell, fronts (uv'd) into ads. */
export function buildAds(shell: Geo, ads: Geo) {
  const H = ADS.height;
  const tile = 16; // metres of board per canvas width
  const board = (a: V3, b: V3, n: V3) => {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const t = 0.25;
    const bx = -n[0] * t;
    const bz = -n[2] * t;
    ads.quad(a, b, [b[0], H, b[2]], [a[0], H, a[2]], n, 0xffffff, [
      [0, 0],
      [L / tile, 0],
      [L / tile, 1],
      [0, 1],
    ]);
    const a2: V3 = [a[0] + bx, 0, a[2] + bz];
    const b2: V3 = [b[0] + bx, 0, b[2] + bz];
    shell.quad(a2, b2, [b2[0], H, b2[2]], [a2[0], H, a2[2]], [-n[0], 0, -n[2]], COL.fascia);
    shell.quad(
      [a[0], H, a[2]],
      [b[0], H, b[2]],
      [b2[0], H, b2[2]],
      [a2[0], H, a2[2]],
      [0, 1, 0],
      COL.fascia,
    );
  };
  const X = ADS.sideX;
  const Z = ADS.endZ;
  // far side (+x), facing the pitch (−x)
  board([X, 0, -ADS.sideHalf], [X, 0, ADS.sideHalf], [-1, 0, 0]);
  // main side (−x), round the dugouts + tunnel
  // (each board runs left to right as seen from the pitch, so the text reads)
  board([-X, 0, -ADS.mainGap], [-X, 0, -ADS.sideHalf], [1, 0, 0]);
  board([-X, 0, ADS.sideHalf], [-X, 0, ADS.mainGap], [1, 0, 0]);
  // ends
  board([ADS.endHalf, 0, Z], [-ADS.endHalf, 0, Z], [0, 0, -1]);
  board([-ADS.endHalf, 0, -Z], [ADS.endHalf, 0, -Z], [0, 0, 1]);
}

/** The big screen (under the west roof) + the NOUN STADIUM sign over the entrance. */
export function buildScreen(shell: Geo, screen: Geo) {
  const { z, y, w, h } = SCREEN;
  // frame + hangers
  shell.box(
    -w / 2 - 0.6,
    y - h / 2 - 0.6,
    z - 0.8,
    w / 2 + 0.6,
    y + h / 2 + 0.6,
    z - 0.2,
    COL.fascia,
    '',
  );
  const roofY = STANDS[2]!.roofFront;
  for (const x of [-w / 2 + 1, w / 2 - 1])
    shell.beam([x, y + h / 2 + 0.6, z - 0.5], [x, roofY, z - 0.5], 0.25, COL.steel);
  screen.quad(
    [-w / 2, y - h / 2, z - 0.15],
    [w / 2, y - h / 2, z - 0.15],
    [w / 2, y + h / 2, z - 0.15],
    [-w / 2, y + h / 2, z - 0.15],
    [0, 0, 1],
    0xffffff,
    [
      [0, 0.5],
      [1, 0.5],
      [1, 1],
      [0, 1],
    ],
  );
  // sign: on the facade's outside, over the entrance (faces −x)
  const X = STADIUM.halfX + 0.75;
  const y0 = ENTRANCE.height + 2.4;
  const y1 = y0 + 4.6;
  shell.box(-X - 0.1, y0 - 0.4, -14.4, -X + 0.6, y1 + 0.4, 14.4, COL.fascia, '');
  screen.quad(
    [-X - 0.15, y0, -14],
    [-X - 0.15, y0, 14],
    [-X - 0.15, y1, 14],
    [-X - 0.15, y1, -14],
    [-1, 0, 0],
    0xffffff,
    [
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0, 0.5],
    ],
  );
}

/** Ground: grass with mown stripes, the surround, the concourse floor, the plaza. */
export function buildGround(ground: Geo) {
  const gw = GRASS.width / 2;
  const gl = GRASS.length / 2;
  const up: V3 = [0, 1, 0];
  // stripes across the length; each split across for a hint of tint
  const N = 20;
  const sl = (2 * gl) / N;
  for (let i = 0; i < N; i++) {
    const z0 = -gl + i * sl;
    const z1 = z0 + sl;
    ground.quad(
      [-gw, 0, z0],
      [gw, 0, z0],
      [gw, 0, z1],
      [-gw, 0, z1],
      up,
      i % 2 === 0 ? COL.grassA : COL.grassB,
    );
  }
  // surround out to the stand fronts (non-overlapping ring)
  const sx = STANDS[0]!.front;
  const sz = STANDS[2]!.front;
  ground.quad([-sx, 0, -sz], [sx, 0, -sz], [sx, 0, -gl], [-sx, 0, -gl], up, COL.surround);
  ground.quad([-sx, 0, gl], [sx, 0, gl], [sx, 0, sz], [-sx, 0, sz], up, COL.surround);
  ground.quad([-sx, 0, -gl], [-gw, 0, -gl], [-gw, 0, gl], [-sx, 0, gl], up, COL.surround);
  ground.quad([gw, 0, -gl], [sx, 0, -gl], [sx, 0, gl], [gw, 0, gl], up, COL.surround);
  // main side concourse (under the upper tier, from the tunnel to the entrance)
  const s = STANDS[0]!;
  const x0 = -(STADIUM.halfX - FACADE.thick);
  const x1 = -(s.front + LOWER_BACK);
  ground.quad(
    [x0, 0, -s.half],
    [x1, 0, -s.half],
    [x1, 0, s.half],
    [x0, 0, s.half],
    up,
    COL.concourse,
  );
  // tunnel floor
  ground.quad(
    [-s.front + 1.5, 0, -TUNNEL.half],
    [x1, 0, -TUNNEL.half],
    [x1, 0, TUNNEL.half],
    [-s.front + 1.5, 0, TUNNEL.half],
    up,
    COL.concourse,
  );
  // the plaza round the outside (ring out to the pad's edge)
  const X = STADIUM.halfX;
  const Z = STADIUM.halfZ;
  const PX = X + STADIUM.apron - 4;
  const PZ = Z + STADIUM.apron - 4;
  ground.quad([-PX, 0, -PZ], [PX, 0, -PZ], [PX, 0, -Z], [-PX, 0, -Z], up, COL.plaza);
  ground.quad([-PX, 0, Z], [PX, 0, Z], [PX, 0, PZ], [-PX, 0, PZ], up, COL.plaza);
  ground.quad([-PX, 0, -Z], [-X, 0, -Z], [-X, 0, Z], [-PX, 0, Z], up, COL.plaza);
  ground.quad([X, 0, -Z], [PX, 0, -Z], [PX, 0, Z], [X, 0, Z], up, COL.plaza);
  // entrance threshold (through the facade)
  ground.quad(
    [-X, 0, -ENTRANCE.half],
    [x0, 0, -ENTRANCE.half],
    [x0, 0, ENTRANCE.half],
    [-X, 0, ENTRANCE.half],
    up,
    COL.concourse,
  );
}

// ── The pitch kit (rebuilt by setPitch) ──

const LINE_W = 0.12;
const LINE_Y = 0.004;

function line(g: Geo, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * (LINE_W / 2);
  const nz = (dx / l) * (LINE_W / 2);
  // run the ends out by half a width so corners close
  const ex = (dx / l) * (LINE_W / 2);
  const ez = (dz / l) * (LINE_W / 2);
  g.quad(
    [x0 - ex + nx, LINE_Y, z0 - ez + nz],
    [x1 + ex + nx, LINE_Y, z1 + ez + nz],
    [x1 + ex - nx, LINE_Y, z1 + ez - nz],
    [x0 - ex - nx, LINE_Y, z0 - ez - nz],
    [0, 1, 0],
    COL.line,
  );
}

/** An arc round (cx, cz), radius r, from angle a0 to a1 (rad; angle 0 = +z). */
function arc(g: Geo, cx: number, cz: number, r: number, a0: number, a1: number) {
  const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * r) / 0.9));
  let px = cx + Math.sin(a0) * r;
  let pz = cz + Math.cos(a0) * r;
  for (let i = 1; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    line(g, px, pz, x, z);
    px = x;
    pz = z;
  }
}

function spot(g: Geo, x: number, z: number, r: number) {
  const n = 10;
  for (let i = 0; i < n; i += 2) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    const c = ((i + 2) / n) * Math.PI * 2;
    g.quad(
      [x, LINE_Y, z],
      [x + Math.sin(a) * r, LINE_Y, z + Math.cos(a) * r],
      [x + Math.sin(b) * r, LINE_Y, z + Math.cos(b) * r],
      [x + Math.sin(c) * r, LINE_Y, z + Math.cos(c) * r],
      [0, 1, 0],
      COL.line,
    );
  }
}

/** Markings, goal frames and corner flags for a pitch. */
export function buildKit(kit: Geo, p: PitchSpec) {
  const W = p.width / 2;
  const L = p.length / 2;
  // boundary + halfway
  line(kit, -W, -L, W, -L);
  line(kit, -W, L, W, L);
  line(kit, -W, -L, -W, L);
  line(kit, W, -L, W, L);
  line(kit, -W, 0, W, 0);
  arc(kit, 0, 0, p.centreRadius, 0, Math.PI * 2);
  spot(kit, 0, 0, 0.15);
  for (const e of [-1, 1]) {
    const gl = e * L;
    // penalty area + goal area
    const bw = p.boxWidth / 2;
    const bz = gl - e * p.boxDepth;
    line(kit, -bw, gl, -bw, bz);
    line(kit, bw, gl, bw, bz);
    line(kit, -bw, bz, bw, bz);
    const sw = p.sixWidth / 2;
    const sz = gl - e * p.sixDepth;
    line(kit, -sw, gl, -sw, sz);
    line(kit, sw, gl, sw, sz);
    line(kit, -sw, sz, sw, sz);
    // penalty spot + the arc outside the area
    const ps = gl - e * p.penaltySpot;
    spot(kit, 0, ps, 0.12);
    const dz = p.boxDepth - p.penaltySpot;
    if (dz < p.centreRadius) {
      const half = Math.acos(dz / p.centreRadius);
      const mid = e > 0 ? Math.PI : 0;
      arc(kit, 0, ps, p.centreRadius, mid - half, mid + half);
    }
    // corner arcs: the quarter between the two inward directions
    for (const sx of [-1, 1]) {
      const a0 = Math.atan2(-sx, 0);
      let a1 = Math.atan2(0, -e);
      while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      while (a0 - a1 > Math.PI) a1 += Math.PI * 2;
      arc(kit, sx * W, gl, 1, a0, a1);
    }
    goal(kit, p, e);
    // corner flags
    for (const sx of [-1, 1]) {
      const x = sx * W;
      kit.cyl([x, 0, gl], [x, 1.5, gl], 0.02, COL.flag, 6);
      kit.quad(
        [x, 1.5, gl],
        [x - sx * 0.01, 1.5, gl - e * 0.42],
        [x - sx * 0.01, 1.2, gl - e * 0.42],
        [x, 1.2, gl],
        [sx, 0, 0],
        COL.flagCloth,
      );
      kit.quad(
        [x, 1.5, gl],
        [x - sx * 0.01, 1.5, gl - e * 0.42],
        [x - sx * 0.01, 1.2, gl - e * 0.42],
        [x, 1.2, gl],
        [-sx, 0, 0],
        COL.flagCloth,
      );
    }
  }
}

/** Goal frame shape (shared with the net): rear top height + where the top bends. */
export function goalShape(p: PitchSpec) {
  return { rearTop: p.goalHeight * 0.82, bend: p.goalDepth * 0.45 };
}

function goal(kit: Geo, p: PitchSpec, e: number) {
  const r = p.postRadius;
  const gw = p.goalWidth / 2 + r;
  const gh = p.goalHeight + r;
  const z0 = e * (p.length / 2 + r);
  const zB = e * (p.length / 2 + p.goalDepth);
  const { rearTop, bend } = goalShape(p);
  const zT = e * (p.length / 2 + bend);
  kit.cyl([-gw, 0, z0], [-gw, gh + r, z0], r, COL.post, 10);
  kit.cyl([gw, 0, z0], [gw, gh + r, z0], r, COL.post, 10);
  kit.cyl([-gw - r, gh, z0], [gw + r, gh, z0], r, COL.post, 10);
  // the net's support frame (thin, behind)
  const t = 0.022;
  for (const sx of [-1, 1]) {
    const x = sx * gw;
    kit.cyl([x, gh, z0], [x, rearTop, zT], t, COL.post, 6);
    kit.cyl([x, rearTop, zT], [x, 0, zB], t, COL.post, 6);
    kit.cyl([x, 0.02, z0], [x, 0.02, zB], t, COL.post, 6);
  }
  kit.cyl([-gw, rearTop, zT], [gw, rearTop, zT], t, COL.post, 6);
  kit.cyl([-gw, 0.02, zB], [gw, 0.02, zB], t, COL.post, 6);
}

// ── Loon Lake: the pine-forest lake town, 14.6 km down the +Z line ───────
//
// Main street runs along the shore. The near side is log cabins and shops
// (bait & tackle, the fish fry, the lodge, a trading post, the pancake
// kitchen, the ranger station); the far side is the lake itself (cut into
// the pad like Puerto Noun's lagoon, pads.ts PINES_LAKE), with a
// boardwalk along the shore, three docks with canoes, a boathouse and a
// fire lookout on the far point. The Big Loon stands at the gate. Pines
// (instanced) all round. Fish is caught here: cheap. Everything else comes
// a long way.

import * as THREE from 'three';

import { NOUN, sub } from '../../world/landmarks/parts';
import { boxAt, cyl, prismX, rod, v3, type SignSpec, type TownBuilder } from '../kit';
import { board, gateSigns } from '../weirdKit';

import { type PartCtx, type RoadLook, type RoadPart } from './look';
import { PINES_LAKE } from './pads';
import { cabin, canoe, pineGeometry } from './props';
import { SPUR_GAP, sideSite, spurSigns, streetParts } from './sideKit';

const C = {
  needles: 0x6b5a3a,
  dirt: 0x8a7350,
  walk: 0x9c8460,
  curb: 0x6e5c40,
  log: 0x9a6a3e,
  logDark: 0x7a4f2c,
  roof: 0x3f5a3a,
  roofRed: 0x8a3b2c,
  plank: 0xa8845a,
  water: 0x3f7f9a,
} as const;

export function pinesSigns(): SignSpec[] {
  const w = (key: string, text: string) =>
    board(key, 7, 1.2, text, '#3b2412', '#f3e2b8', '#f3e2b8');
  return [
    ...gateSigns(
      'LOON LAKE',
      '⌐◨-◨  FISH · PADDLE · PANCAKES  ⌐◨-◨',
      'PIZZA ↑  ICE CREAM ↑',
      'POP. 6 NOUNS & 1 LOON',
      {
        bg: '#24402c',
        fg: '#f3e2b8',
        accent: '#ffc110',
      },
    ),
    ...spurSigns('LOON LAKE', { bg: '#24402c', fg: '#f3e2b8', accent: '#ffc110' }),
    w('bait', 'BAIT & TACKLE SHOP'),
    w('fry', 'FISH FRY'),
    board('lodge', 10, 1.4, 'LOON LAKE LODGE', '#24402c', '#f3e2b8', '#ffc110'),
    w('trading', 'TRADING POST'),
    w('pancake', 'PANCAKE KITCHEN'),
    w('ranger', 'RANGER STATION'),
    w('boathouse', 'BOAT HOUSE'),
  ];
}

interface Cabin {
  u: number;
  w: number;
  d: number;
  wall: number;
  roof: number;
  sign: string;
}

const NEAR: Cabin[] = [
  { u: 22, w: 11, d: 10, wall: C.log, roof: C.roof, sign: 'bait' },
  { u: 42, w: 12, d: 11, wall: C.logDark, roof: C.roofRed, sign: 'fry' },
  { u: 64, w: 16, d: 14, wall: C.log, roof: C.roof, sign: 'lodge' },
  { u: 112, w: 12, d: 11, wall: C.logDark, roof: C.roof, sign: 'trading' },
  { u: 134, w: 12, d: 10, wall: C.log, roof: C.roofRed, sign: 'pancake' },
  { u: 158, w: 11, d: 10, wall: C.logDark, roof: C.roof, sign: 'ranger' },
];

function cabins(b: TownBuilder, list: Cabin[]) {
  for (const c of list) cabin(b, b.at(-13, c.u, 0, 1, 0), c.w, c.d, c.wall, c.roof, c.sign);
}

/** Boardwalk along the shore + docks out into the lake + canoes. */
function shore(b: TownBuilder) {
  const f = b.f;
  // Shore boardwalk (between the sidewalk and the lake rim)
  b.add(boxAt(-2.5, 2.5, 0, 0.3, -(f.Lf - 20) / 2, (f.Lf - 20) / 2), C.plank, b.at(14, f.Lf / 2), {
    collide: true,
  });
  for (const [i, u] of [50, 90, 130].entries()) {
    const m = b.at(16.5, u, 0, 1, 0);
    // Dock: decking out over the water on posts
    b.add(boxAt(-1.6, 1.6, 0.0, 0.3, 0, 22), C.plank, m, { collide: true });
    for (let z = 2; z <= 22; z += 4)
      for (const x of [-1.5, 1.5]) b.add(cyl(0.12, 0.12, 2.4, 5, x, -1.0, z), C.logDark, m);
    canoe(b, sub(m, 2.6, -0.62, 8 + i * 3, 0.1 * i), [NOUN.red, NOUN.yellow, NOUN.green][i]!);
    canoe(b, sub(m, -2.6, -0.62, 15, -0.05), NOUN.blue);
  }
}

/** Boathouse on stilts over the water at the far end of the shore. */
function boathouse(b: TownBuilder) {
  const m = b.at(30, 160, 0, -1, 0);
  for (const x of [-5, 5])
    for (const z of [-7, 0]) b.add(cyl(0.2, 0.2, 3, 5, x, -1.5, z), C.logDark, m);
  b.add(boxAt(-6, 6, 0, 0.3, -9, 1), C.plank, m, { collide: true });
  b.add(boxAt(-5.6, 5.6, 0.3, 4, -8.6, 0), 0xa8452f, m, { collide: true });
  b.add(
    prismX(
      [
        [1, 3.8],
        [-4.3, 6.6],
        [-9.6, 3.8],
      ],
      12.6,
    ),
    C.roof,
    m,
    { collide: true },
  );
  b.add(boxAt(-3.5, 3.5, 0.3, 3, 0, 0.08), 0x2b3640, m);
  b.sign('boathouse', m, 0, 3.4, 0.1, 0.8);
}

/** Fire lookout on the point past the lake's far end. */
function lookout(b: TownBuilder) {
  const m = b.at(58, 166, 0, -1, 0);
  for (const [x, z] of [
    [-2.4, -2.4],
    [2.4, -2.4],
    [-2.4, 2.4],
    [2.4, 2.4],
  ] as const)
    b.add(rod(v3(x, 0, z), v3(x * 0.55, 15, z * 0.55), 0.16), C.logDark, m, { bucket: 'thin' });
  b.add(boxAt(-2.2, 2.2, 15, 15.3, -2.2, 2.2), C.plank, m, { collide: true });
  b.add(boxAt(-1.9, 1.9, 15.3, 17.4, -1.9, 1.9), 0xe0d2b0, m);
  b.add(cyl(0, 2.7, 1.4, 4, 0, 17.4 + 0.7, 0).rotateY(Math.PI / 4), C.roofRed, m);
  // Stairs zig-zagging up one side (thin)
  for (let y = 1; y < 15; y += 1.6)
    b.add(boxAt(-1.4, 1.4, y, y + 0.12, 2.6, 3.4), C.plank, m, { bucket: 'thin' });
}

/** The Big Loon: a fibreglass loon the size of a house, at the gate. */
function bigLoon(b: TownBuilder) {
  const m = b.at(-28, 77, 0, 1, -0.25);
  b.add(boxAt(-1.6, 1.6, 0, 2.2, -1.6, 1.6), 0x8f8a80, m, { collide: true });
  const body = sub(m, 0, 2.2, 0);
  b.add(
    new THREE.SphereGeometry(3, 12, 8).scale(1, 0.75, 1.7).translate(0, 2.3, 0),
    0x1b1d20,
    body,
    {
      collide: true,
    },
  );
  // White checker band, neck, head, red eye, beak
  for (let i = -3; i <= 3; i++)
    b.add(boxAt(i * 0.8 - 0.25, i * 0.8 + 0.25, 2.6, 3.4, 2.4, 3.2), 0xf1efe8, body);
  b.add(cyl(0.75, 0.9, 3, 8, 0, 4.4, 3.4), 0x1b1d20, body);
  b.add(
    new THREE.SphereGeometry(1.2, 10, 8).scale(1, 0.9, 1.3).translate(0, 6.6, 3.9),
    0x1b1d20,
    body,
  );
  for (const x of [-0.95, 0.95])
    b.add(boxAt(x - 0.08, x + 0.08, 6.7, 7.0, 4.2, 4.5), NOUN.red, body);
  b.add(
    cyl(0, 0.38, 1.8, 6, 0, 0, 0)
      .rotateX(Math.PI / 2)
      .translate(0, 6.4, 5.8),
    0x2a2f36,
    body,
  );
  b.add(boxAt(-1.4, 1.4, 4.9, 5.2, 4.6, 4.8), 0xf1efe8, body);
}

function trees(b: TownBuilder, ctx: PartCtx, u0: number, u1: number) {
  const f = b.f;
  let i = 0;
  for (let u = u0; u < u1; u += 7) {
    for (const vp of [f.vmin + 3, f.vmin - 8, f.vmin - 20, f.vmax - 3, f.vmax + 10, f.vmax + 22]) {
      if (
        vp > PINES_LAKE.v0 - 2 &&
        vp < PINES_LAKE.v3 + 2 &&
        u > PINES_LAKE.uIn0 &&
        u < f.Lf - PINES_LAKE.uIn0
      )
        continue;
      const jit = ((i * 41) % 13) - 6;
      const uu = u + jit * 0.5;
      const v = vp + jit * 0.5;
      const y = v > f.vmax || v < f.vmin ? ctx.ground(v, uu) - 0.3 : f.P - 0.1;
      b.plant(v, uu, y, i * 1.7, 1.0 + ((i * 7) % 6) * 0.12);
      i++;
    }
  }
}

function parts(): RoadPart[] {
  const site = sideSite('pines');
  return [
    ...streetParts(site, {
      street: C.dirt,
      walk: C.walk,
      curb: C.curb,
      spur: C.dirt,
      post: C.logDark,
      beam: 0xffc110,
    }),
    {
      vp: -20,
      u: 40,
      build(b) {
        const f = b.f;
        b.decal(f.vmin + 0.5, -11, 1, f.Lf - 1, C.needles, 0.012);
        cabins(
          b,
          NEAR.filter(c => c.u < 90 - SPUR_GAP),
        );
      },
    },
    {
      vp: -20,
      u: 140,
      build(b) {
        cabins(
          b,
          NEAR.filter(c => c.u > 90 + SPUR_GAP),
        );
        bigLoon(b);
      },
    },
    {
      vp: 20,
      u: 90,
      build(b) {
        shore(b);
      },
    },
    {
      vp: 40,
      u: 166,
      build(b) {
        boathouse(b);
        lookout(b);
      },
    },
    {
      vp: 0,
      u: 30,
      build(b, ctx) {
        trees(b, ctx, 2, 90);
      },
    },
    {
      vp: 0,
      u: 150,
      build(b, ctx) {
        trees(b, ctx, 90, 180);
      },
    },
  ];
}

export const PINES_LOOK: RoadLook = {
  signs: pinesSigns,
  parts,
  plant: () => pineGeometry(false),
  water: () => ({
    v0: PINES_LAKE.v0 + 2,
    v1: PINES_LAKE.v3 - 2,
    u0: PINES_LAKE.uIn0 + 2,
    u1: sideSite('pines').len - PINES_LAKE.uIn0 - 2,
    y: -0.7,
    color: C.water,
  }),
};

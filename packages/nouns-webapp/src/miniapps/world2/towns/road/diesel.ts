// ── Diesel Flats: the desert truck-stop town, 20.5 km down the −X line ───
//
// Halfway down the longest empty road on the mountain (nothing else on the
// −X line until the Noggle Bowl at ~42 km), a town that grew round a truck
// stop. Near side: Mom's Diner, the motor inn, the truck wash, a tyre
// shop, the CB radio shack and the roadhouse bar. Far side: the travel
// center under a huge diesel canopy, a lot full of parked rigs, and the
// water tower. Rusty Rex, a scrap-metal dinosaur, stands at the gate.
// Cacti (instanced, Dry Gulch's). Fries and pizza come cheap off the grill;
// water and anything cold are worth a lot out here.

import { noggles } from '../../world/landmarks/models';
import { NOUN, sub } from '../../world/landmarks/parts';
import { cactusGeometry } from '../cowboy';
import { boxAt, type SignSpec, type TownBuilder } from '../kit';
import { board, gateSigns } from '../weirdKit';

import { type PartCtx, type RoadLook, type RoadPart } from './look';
import { ROAD_C, canopy, diner, motel, pickup, pumpIsland, semi, shop, waterTower } from './props';
import { sideSite, spurSigns, streetParts } from './sideKit';

const C = {
  sand: 0xd9b47a,
  sandDark: 0xc49a5f,
  asphalt: 0x3a3a40,
  walk: 0xb9a888,
  curb: 0x8f8470,
  rust: 0x9a4a24,
  rustDark: 0x6e3216,
  teal: 0x5aa8a0,
  cream: 0xeedcb3,
} as const;

export function dieselSigns(): SignSpec[] {
  const w = (key: string, text: string, bg = '#2b83f6', fg = '#ffffff') =>
    board(key, 8, 1.2, text, bg, fg, fg);
  return [
    ...gateSigns(
      'DIESEL FLATS',
      '⌐◨-◨  OPEN ALL NIGHT · TRUCKERS WELCOME  ⌐◨-◨',
      'WATER ↑↑  ICE CREAM ↑',
      'POP. 6 NOUNS · 40 RIGS',
      {
        bg: '#2a1c10',
        fg: '#ffc110',
        accent: '#e8352b',
      },
    ),
    ...spurSigns('DIESEL FLATS', { bg: '#2a1c10', fg: '#ffc110', accent: '#e8352b' }),
    board('diner', 7, 1.6, "MOM'S DINER", '#15181c', '#ff638d', '#ff638d'),
    w('motel', 'DIESEL MOTOR INN', '#a8452f', '#ffe9b0'),
    w('wash', 'TRUCK WASH'),
    w('tyre', 'TIRE SUPPLY STORE', '#ffc110', '#111111'),
    w('cb', 'CB RADIO SHACK', '#2a2f36', '#7cf2c8'),
    w('roadhouse', 'ROADHOUSE BAR', '#3b2412', '#ffcf4a'),
    board('travel', 14, 1.6, 'TRAVEL CENTER STORE', '#2b83f6', '#ffffff', '#ffc110'),
    board('tower', 6, 1.4, 'DIESEL FLATS', '#d9d4c7', '#2a1c10'),
    board('dieselcan', 12, 1.3, 'DIESEL · 24 HRS', '#ffc110', '#111111', '#111111'),
  ];
}

/** Near side: fronts at v' = −13 facing main street. */
function nearRow(b: TownBuilder, ctx: PartCtx, first: boolean) {
  if (first) {
    shop(b, b.at(-13, 22, 0, 1, 0), 12, 10, 5, 0xd9d4c7, NOUN.yellow, 'tyre');
    diner(b, b.at(-13, 44, 0, 1, 0), 16, NOUN.pink, 'diner');
    // Motor inn, end-on to the street: rooms face the diner's lot
    motel(b, b.at(-13, 68, 0, 1, 0), 3, C.cream, C.teal, 'motel');
    if (!ctx.low) pickup(b, b.at(-9.8, 56, 0, 0, 1), NOUN.red);
  } else {
    // Truck wash: a long open-ended shed
    const m = b.at(-13, 116, 0, 1, 0);
    b.add(boxAt(-9, 9, 0, 7, -16, -14.5), 0x8f8a80, m, { collide: true });
    b.add(boxAt(-9, 9, 0, 7, -1.5, 0), 0x8f8a80, m, { collide: true });
    b.add(boxAt(-9.2, 9.2, 7, 7.6, -16.2, 0.2), NOUN.blue, m, { collide: true });
    for (let x = -7; x <= 7; x += 3.5)
      b.add(boxAt(x - 0.15, x + 0.15, 1.5, 6.8, -14.4, -1.6), 0x7cc6ff, m, { bucket: 'thin' });
    b.sign('wash', m, 0, 6.2, 0.06);
    shop(b, b.at(-13, 138, 0, 1, 0), 10, 9, 4.6, 0x3b3f46, 0x7cf2c8, 'cb');
    // The CB shack's antenna
    b.add(boxAt(-0.08, 0.08, 4.6, 16, -6, -5.8), ROAD_C.darkSteel, b.at(-13, 138, 0, 1, 0), {
      bucket: 'thin',
    });
    shop(b, b.at(-13, 160, 0, 1, 0), 14, 11, 5.4, 0x6e4826, 0xffcf4a, 'roadhouse');
  }
}

/** The travel center's pump islands (town coords), for fuel.ts. */
export const DIESEL_PUMPS = [-5, 0, 5].map(a => ({ vp: 28 + a, u: 50 }));

/** Far side: the travel center under its canopy. */
function travelCenter(b: TownBuilder) {
  const m = b.at(28, 50, 0, -1, 0);
  canopy(b, m, 42, 18, 7.6, NOUN.blue, [-18, -6, 6, 18]);
  b.sign('dieselcan', m, 0, 8.05, 9.04);
  for (const a of [-5, 0, 5]) pumpIsland(b, b.at(28 + a, 50, 0, -1, 0), 16, 3, NOUN.yellow);
  const sm = b.at(42, 50, 0, -1, 0);
  shop(b, sm, 30, 12, 6, 0xd9d4c7, NOUN.blue, 'travel');
}

/** The rig lot: rows of parked trucks, nose to the street. */
function rigLot(b: TownBuilder, ctx: PartCtx) {
  b.decal(14, 58, 96, 176, C.asphalt, 0.018);
  for (let u = 98; u <= 174; u += 5.5) b.decal(30.8, 31.2, u - 0.2, u + 0.2, ROAD_C.line, 0.025);
  const cabs = [NOUN.red, NOUN.blue, NOUN.yellow, NOUN.green, 0xf1efe8, NOUN.purple, NOUN.orange];
  const n = ctx.low ? 5 : 9;
  for (let i = 0; i < n; i++) {
    const u = 101 + i * 8.2;
    // Facing −v' (toward main street), trailer behind
    semi(b, b.at(35, u, 0, -1, 0), cabs[i % cabs.length]!, 0xd9d4c7, {
      stripe: i % 3 === 0 ? NOUN.red : undefined,
    });
  }
  waterTower(b, b.at(54, 172, 0, -1, 0), 0xd9d4c7, 'tower');
}

/** Rusty Rex: a dinosaur welded out of scrap, by the gate. */
function rex(b: TownBuilder) {
  const m = b.at(-32, 78, 0, 1, 0.4);
  const r = C.rust;
  const d = C.rustDark;
  for (const [x, z] of [
    [-1.4, -1],
    [1.4, -1],
  ] as const)
    b.add(boxAt(x - 0.7, x + 0.7, 0, 5, z - 0.8, z + 0.8), d, m, { collide: true });
  b.add(boxAt(-2.2, 2.2, 4.5, 8.5, -4, 3), r, m, { collide: true });
  // Tail
  b.add(boxAt(-1.2, 1.2, 5.2, 7.2, -9, -4), r, m);
  b.add(boxAt(-0.6, 0.6, 5.6, 6.6, -13, -9), d, m);
  // Neck + head + jaw
  b.add(boxAt(-1.3, 1.3, 7.5, 12, 2, 4.6), r, m);
  b.add(boxAt(-1.8, 1.8, 11, 14, 3, 9), r, m, { collide: true });
  b.add(boxAt(-1.6, 1.6, 10.2, 11, 4, 8.6), d, m);
  for (let z = 4.6; z < 8.6; z += 0.8) b.add(boxAt(-1.4, 1.4, 10.9, 11.3, z, z + 0.3), 0xf1efe8, m);
  // Little arms
  for (const x of [-2.4, 2.4]) b.add(boxAt(x - 0.25, x + 0.25, 6.5, 7.1, 2.8, 4.4), d, m);
  // Noggles, of course
  noggles(b, sub(m, 0, 12.8, 9.05), 3.8, NOUN.red, { depth: 0.25 });
}

function cacti(b: TownBuilder, ctx: PartCtx, u0: number, u1: number) {
  const f = b.f;
  let i = 0;
  for (let u = u0; u < u1; u += 11) {
    for (const vp of [f.vmin + 3, f.vmax - 2, f.vmax + 14, f.vmin - 12]) {
      const jit = ((i * 29) % 9) - 4;
      const uu = u + jit;
      const y = vp > f.vmax || vp < f.vmin ? ctx.ground(vp, uu) - 0.2 : f.P;
      b.plant(vp + jit * 0.3, uu, y, i * 2.1, 0.8 + ((i * 5) % 5) * 0.12);
      i++;
    }
  }
}

function parts(): RoadPart[] {
  const site = sideSite('diesel');
  return [
    ...streetParts(site, {
      street: C.asphalt,
      walk: C.walk,
      curb: C.curb,
      spur: C.asphalt,
      post: 0x2a1c10,
      beam: 0xe8352b,
    }),
    {
      vp: -20,
      u: 44,
      build(b, ctx) {
        const f = b.f;
        b.decal(f.vmin + 0.5, -11, 1, f.Lf - 1, C.sand, 0.012);
        b.decal(11, f.vmax - 0.5, 1, 94, C.sand, 0.012);
        b.decal(11, f.vmax - 0.5, 178, f.Lf - 1, C.sand, 0.012);
        nearRow(b, ctx, true);
      },
    },
    {
      vp: -20,
      u: 140,
      build(b, ctx) {
        nearRow(b, ctx, false);
        rex(b);
      },
    },
    {
      vp: 30,
      u: 50,
      build(b) {
        b.decal(14, 58, 22, 80, C.asphalt, 0.018);
        travelCenter(b);
      },
    },
    {
      vp: 36,
      u: 136,
      build(b, ctx) {
        rigLot(b, ctx);
      },
    },
    {
      vp: 0,
      u: 40,
      build(b, ctx) {
        cacti(b, ctx, 4, 90);
      },
    },
    {
      vp: 0,
      u: 140,
      build(b, ctx) {
        cacti(b, ctx, 90, 178);
      },
    },
  ];
}

export const DIESEL_LOOK: RoadLook = {
  signs: dieselSigns,
  parts,
  plant: cactusGeometry,
};

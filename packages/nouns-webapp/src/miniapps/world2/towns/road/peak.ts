// ── Powder Peak: the ski village, 3.6 km down the +X line ────────────────
//
// The highest town on the mountain, on a snowfield beside the line. Snowy
// A-frame chalets on the near side (ski rental, fondue, the après bar, the
// goggle shop, a snowboard school), the Powder Lodge and an ice rink on the
// far side, and a chairlift running from the rink up past the top of town
// onto the open slope. Snowmen, snowy pines (instanced). Its market makes
// meltwater and pays for anything hot or fried, and for goggles (NOGGLES).

import * as THREE from 'three';

import { noggles } from '../../world/landmarks/models';
import { NOUN, sub } from '../../world/landmarks/parts';
import { BLOCK_FONT, boxAt, cyl, prismX, rod, v3, type SignSpec, type TownBuilder } from '../kit';
import { board, gateSigns, windows } from '../weirdKit';

import { type PartCtx, type RoadLook, type RoadPart } from './look';
import { ROAD_C, aframe, pineGeometry, snowman } from './props';
import { SPUR_GAP, sideSite, spurSigns, streetParts } from './sideKit';

const C = {
  snow: 0xf4f7fa,
  packed: 0xd5dde4,
  walk: 0xb9c3cc,
  curb: 0x8d98a3,
  ice: 0xa9e3f5,
  wood: 0x8a5a34,
  red: 0xb8382c,
  green: 0x2f5d3a,
  blue: 0x3b5f8a,
  cream: 0xf3e6c8,
  dark: 0x2a2f36,
} as const;

export function peakSigns(): SignSpec[] {
  const w = (key: string, text: string, bg = '#b8382c', fg = '#ffffff') =>
    board(key, 7, 1.2, text, bg, fg, fg);
  return [
    ...gateSigns(
      'POWDER PEAK',
      '⌐◨-◨  SKI · SNOWBOARD · FONDUE  ⌐◨-◨',
      'NOGGLES ↑  FRIES ↑',
      'ALT. HIGH · POP. 6 NOUNS',
      {
        bg: '#1d3557',
        fg: '#ffffff',
        accent: '#a9e3f5',
      },
    ),
    ...spurSigns('POWDER PEAK', { bg: '#1d3557', fg: '#ffffff', accent: '#a9e3f5' }),
    w('rental', 'SKI RENTAL SHOP'),
    w('fondue', 'FONDUE CAFE', '#f3e6c8', '#8a3b12'),
    w('apres', 'APRÈS BAR', '#2a2f36', '#ffc110'),
    w('goggle', 'GOGGLE SHOP', '#ffffff', '#e8352b'),
    w('school', 'SNOWBOARD SCHOOL', '#3b5f8a', '#ffffff'),
    board('lodge', 12, 1.6, 'POWDER LODGE', '#1d3557', '#ffffff', '#a9e3f5'),
    board('cocoa', 5, 1, 'HOT COCOA CAFE', '#8a3b12', '#ffe9b0', '#ffe9b0'),
    {
      key: 'lift',
      w: 5,
      h: 1.4,
      bg: '#ffc110',
      fg: '#111111',
      border: '#111111',
      lines: [{ text: 'CHAIR 1 · SUMMIT', size: 0.42, y: 0.55, font: BLOCK_FONT }],
    },
  ];
}

interface Chalet {
  u: number;
  w: number;
  d: number;
  h: number;
  wall: number;
  sign: string;
}

const NEAR: Chalet[] = [
  { u: 24, w: 11, d: 12, h: 10, wall: C.wood, sign: 'rental' },
  { u: 44, w: 10, d: 11, h: 9, wall: C.cream, sign: 'fondue' },
  { u: 64, w: 9, d: 10, h: 8.5, wall: C.red, sign: 'goggle' },
  { u: 114, w: 12, d: 12, h: 10.5, wall: C.dark, sign: 'apres' },
  { u: 136, w: 10, d: 11, h: 9, wall: C.blue, sign: 'school' },
  { u: 158, w: 10, d: 10, h: 9, wall: C.wood, sign: 'cocoa' },
];

/** Near-side chalets face main street (+v'), fronts at v' = −13. */
function chalets(b: TownBuilder, list: Chalet[]) {
  for (const c of list) {
    const m = b.at(-13, c.u, 0, 1, 0);
    aframe(b, m, c.w, c.d, c.h, c.wall, C.snow, c.sign);
    // Snow-laden porch rail + skis leaning by the door
    b.add(boxAt(-c.w / 2 + 0.6, c.w / 2 - 0.6, 0.9, 1.0, 0.9, 1.0), C.wood, m);
    for (let i = 0; i < 3; i++) {
      const x = c.w / 2 - 1.4 - i * 0.35;
      b.add(
        boxAt(x - 0.05, x + 0.05, 0, 1.7, 0.4, 0.5),
        [NOUN.red, NOUN.yellow, NOUN.blue][i]!,
        m,
        { bucket: 'thin' },
      );
    }
  }
}

function lodge(b: TownBuilder) {
  const m = b.at(14, 66, 0, -1, 0);
  // Two storeys, a deep snowy roof, a balcony across the front
  b.add(boxAt(-17, 17, 0, 9, -16, 0), C.wood, m, { collide: true });
  b.add(
    prismX(
      [
        [1.8, 8.6],
        [-8, 15],
        [-17.8, 8.6],
      ],
      36,
    ),
    C.snow,
    m,
    { collide: true },
  );
  b.add(boxAt(-15, 15, 3.6, 3.85, 0, 2.2), C.wood, m, { collide: true });
  b.add(boxAt(-15, 15, 4.6, 4.7, 2.1, 2.2), C.dark, m);
  windows(b, m, 34, 9, 0xffe9a8, {
    y0: 1.2,
    step: 3.4,
    size: 1.6,
    glow: true,
    skip: (i, j) => j === 0 && i === 4,
  });
  b.add(boxAt(-1.4, 1.4, 0, 2.8, 0, 0.1), C.dark, m);
  b.sign('lodge', m, 0, 6.6, 0.12);
  // Chimney with a noggles plaque
  b.add(boxAt(9, 11, 10, 16, -9, -7), 0x8f8a80, m);
  noggles(b, sub(m, 0, 7.6, 2.25), 3.6, NOUN.red, { depth: 0.2 });
}

/** Ice rink: blue-white ice, low boards round it, benches. */
function rink(b: TownBuilder) {
  b.decal(17, 41, 108, 146, C.ice, 0.025);
  const m = b.at(29, 127, 0, -1, 0);
  for (const [x0, x1, z0, z1] of [
    [-12.3, 12.3, -19.3, -19],
    [-12.3, 12.3, 19, 19.3],
    [-12.3, -12, -19, 19],
    [12, 12.3, -19, 19],
  ] as const)
    b.add(boxAt(x0, x1, 0, 1.0, z0, z1), C.snow, m, { collide: true });
  for (const z of [-10, 0, 10])
    b.add(boxAt(13.2, 14, 0, 0.5, z - 1.5, z + 1.5), C.wood, m, { collide: true });
}

/** Chairlift: base at the rink, pylons up the slope past the top of town. */
function chairlift(b: TownBuilder, ctx: PartCtx) {
  const vp = 52;
  const us = [172, 136, 100, 64, 28, -8, -40, -66];
  const top: THREE.Vector3[] = [];
  for (const u of us) {
    const gy = ctx.ground(vp, u) - b.f.P;
    const m = b.at(vp, u, gy, 0, -1);
    b.add(cyl(0.35, 0.5, 11.5, 6, 0, -1.5 + 11.5 / 2, 0), ROAD_C.darkSteel, m, { bucket: 'thin' });
    b.add(boxAt(-3, 3, 9.6, 10.1, -0.25, 0.25), ROAD_C.darkSteel, m, { bucket: 'thin' });
    // Pylon top (pad-relative y, u): the cables run between them
    top.push(v3(0, gy + 9.6, u));
  }
  for (const side of [-2.6, 2.6]) {
    for (let i = 0; i < top.length - 1; i++) {
      const a = b.at(vp + side, top[i]!.z, top[i]!.y, 0, 1);
      const ea = v3(0, 0, 0).applyMatrix4(a);
      const bm = b.at(vp + side, top[i + 1]!.z, top[i + 1]!.y, 0, 1);
      const eb = v3(0, 0, 0).applyMatrix4(bm);
      b.add(rod(ea, eb, 0.05, 4), 0x1c1c1f, IDENTITY, { bucket: 'thin' });
      // Chairs every ~12 m, hanging under the cable
      const n = Math.floor(Math.hypot(eb.x - ea.x, eb.z - ea.z) / 12);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const cu = top[i]!.z + (top[i + 1]!.z - top[i]!.z) * t;
        const cy = top[i]!.y + (top[i + 1]!.y - top[i]!.y) * t;
        const cm = b.at(vp + side, cu, cy, 0, side < 0 ? -1 : 1);
        b.add(boxAt(-0.04, 0.04, -1.6, 0, -0.04, 0.04), 0x1c1c1f, cm, { bucket: 'thin' });
        b.add(boxAt(-0.8, 0.8, -1.9, -1.6, -0.4, 0.3), side < 0 ? NOUN.red : NOUN.blue, cm);
        b.add(boxAt(-0.8, 0.8, -1.9, -1.1, -0.45, -0.35), side < 0 ? NOUN.red : NOUN.blue, cm);
      }
    }
  }
  // Base station hut + the lift sign
  const hm = b.at(vp - 6, 176, 0, -1, 0);
  // (narrow: a shelter, not a building with a door)
  b.add(boxAt(-1.4, 1.4, 0, 4, -3, 3), C.red, hm, { collide: true });
  b.add(boxAt(-3, 3, 4, 4.5, -3.6, 3.6), C.snow, hm, { collide: true });
  b.sign('lift', hm, 0, 5.4, 3.62, 0.9);
}

const IDENTITY = new THREE.Matrix4();

function trees(b: TownBuilder, ctx: PartCtx, u0: number, u1: number) {
  const f = b.f;
  let i = 0;
  for (let u = u0; u < u1; u += 9) {
    for (const vp of [f.vmin + 4, f.vmax - 3, f.vmax + 12, f.vmin - 14]) {
      const jit = ((i * 37) % 11) - 5;
      const uu = u + jit * 0.6;
      const y = vp > f.vmax || vp < f.vmin ? ctx.ground(vp, uu) - 0.3 : f.P - 0.1;
      b.plant(vp + jit * 0.4, uu, y, i * 1.3, 0.85 + ((i * 7) % 5) * 0.1);
      i++;
    }
  }
}

function parts(): RoadPart[] {
  const site = sideSite('peak');
  return [
    ...streetParts(site, {
      street: C.packed,
      walk: C.walk,
      curb: C.curb,
      spur: C.packed,
      post: 0x1d3557,
      beam: 0xa9e3f5,
    }),
    {
      // The snowfield: the whole pad white (under everything else)
      vp: 10,
      u: 90,
      build(b) {
        const f = b.f;
        b.decal(f.vmin + 0.5, -11, 1, f.Lf - 1, C.snow, 0.012);
        b.decal(11, f.vmax - 0.5, 1, f.Lf - 1, C.snow, 0.012);
      },
    },
    {
      vp: -20,
      u: 44,
      build(b) {
        chalets(
          b,
          NEAR.filter(c => c.u < 90 - SPUR_GAP),
        );
      },
    },
    {
      vp: -20,
      u: 136,
      build(b, ctx) {
        chalets(
          b,
          NEAR.filter(c => c.u > 90 + SPUR_GAP),
        );
        for (const [vp, u] of [
          [-9.5, 100],
          [9.5, 30],
          [20, 160],
        ] as const)
          snowman(b, b.at(vp, u, 0, 0, 1));
        if (!ctx.low) snowman(b, b.at(-30, 176, 0, 1, 0));
      },
    },
    {
      vp: 30,
      u: 66,
      build(b) {
        lodge(b);
      },
    },
    {
      vp: 30,
      u: 127,
      build(b, ctx) {
        rink(b);
        chairlift(b, ctx);
      },
    },
    {
      vp: 0,
      u: 20,
      build(b, ctx) {
        trees(b, ctx, 4, 90);
      },
    },
    {
      vp: 0,
      u: 150,
      build(b, ctx) {
        trees(b, ctx, 90, 178);
      },
    },
  ];
}

export const PEAK_LOOK: RoadLook = {
  signs: peakSigns,
  parts,
  plant: () => pineGeometry(true),
};

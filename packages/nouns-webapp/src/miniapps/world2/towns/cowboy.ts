// ── Dry Gulch: the western town ~10 km down the +X line ──────────────────
//
// Main street is the dirt line itself. Either side: a raised boardwalk
// under porch awnings, false-front shops (saloon with a balcony and swing
// doors, general store, bank, hotel, sheriff, ice house…), then back lots
// with a water tower, a windmill, a corral, a covered wagon and cacti, on
// a dusty pad. An arch over the road at the top of town. Tumbleweeds roll
// across (animated in build.ts). Original geometry and names only.

import * as THREE from 'three';

import { WALK_EDGE, WALK_Y } from './cast';
import {
  BLOCK_FONT,
  WEST_FONT,
  box,
  boxAt,
  cyl,
  prismX,
  rod,
  v3,
  type SignSpec,
  type TownBuilder,
} from './kit';
import { mulberry32 } from './orders';

export const COWBOY_C = {
  dust: 0xd9b47a,
  dustDark: 0xc49a5f,
  plank: 0x9a6a3e,
  plankDark: 0x6e4826,
  wood: 0xb08050,
  roof: 0x5b3d26,
  tin: 0x8f8a80,
  cream: 0xeedcb3,
  red: 0xa8452f,
  teal: 0x6fa59a,
  mustard: 0xd6a33c,
  blue: 0x7e8fa6,
  white: 0xece6d6,
  glass: 0x2b3640,
  door: 0x4a2c16,
  cactus: 0x4f8f3e,
  cactusDark: 0x3c7631,
  canvas: 0xefe4c8,
  iron: 0x3d3a36,
  tumble: 0xa8844e,
} as const;

const C = COWBOY_C;

const hand = (key: string, w: number, h: number, text: string, opts: Partial<SignSpec> = {}) =>
  ({
    key,
    w,
    h,
    bg: '#3b2412',
    fg: '#f3e2b8',
    hand: true,
    lines: [{ text, size: 0.62, y: 0.54, font: WEST_FONT }],
    ...opts,
  }) as SignSpec;

export function cowboySigns(): SignSpec[] {
  return [
    {
      key: 'arch',
      w: 12,
      h: 2.2,
      bg: '#5a3416',
      fg: '#ffd27a',
      border: '#ffd27a',
      hand: true,
      lines: [
        { text: 'DRY GULCH', size: 0.56, y: 0.42, font: WEST_FONT },
        { text: '⌐◨-◨  EST. 2026  ⌐◨-◨', size: 0.17, y: 0.8, font: BLOCK_FONT },
      ],
    },
    {
      key: 'welcome',
      w: 6,
      h: 3,
      bg: '#e8d3a2',
      fg: '#5a2d10',
      hand: true,
      lines: [
        { text: 'DRY GULCH', size: 0.26, y: 0.24, font: WEST_FONT },
        { text: 'POP. 6 NOUNS', size: 0.14, y: 0.5, font: BLOCK_FONT },
        { text: 'ICE CREAM ↑  WATER ↑', size: 0.12, y: 0.72, font: BLOCK_FONT, color: '#a8452f' },
      ],
    },
    {
      key: 'saloon',
      w: 9,
      h: 1.5,
      bg: '#1d120a',
      fg: '#ffcf4a',
      border: '#ffcf4a',
      lines: [{ text: 'SALOON', size: 0.7, y: 0.55, font: WEST_FONT }],
    },
    hand('store', 9, 1.2, 'GENERAL STORE'),
    hand('bank', 6, 1.2, 'BANK', { bg: '#1f3b2e', fg: '#f0d78a' }),
    hand('hotel', 8, 1.3, 'HOTEL'),
    hand('barber', 5, 1, 'BARBER'),
    hand('sheriff', 6.5, 1.2, 'SHERIFF', { bg: '#2a1c10', fg: '#e8c25a' }),
    hand('icehouse', 7, 1.2, 'ICE HOUSE', { bg: '#dfe9ee', fg: '#2c5e86' }),
    hand('feed', 7, 1.2, 'FEED & SEED'),
    hand('post', 6, 1.1, 'POST'),
    hand('smith', 7, 1.2, 'BLACKSMITH'),
    hand('cantina', 7, 1.2, 'CANTINA', { bg: '#a8452f', fg: '#ffe9b0' }),
    hand('opera', 8, 1.2, 'OPERA HOUSE'),
    hand('trading', 8, 1.2, 'TRADING POST'),
  ];
}

interface Shop {
  u: number;
  w: number;
  h: number;
  d: number;
  wall: number;
  trim: number;
  sign: string;
  kind?: 'saloon' | 'chapel';
}

const NEAR: Shop[] = [
  { u: 38, w: 13, h: 5.2, d: 11, wall: C.wood, trim: C.cream, sign: 'store' },
  { u: 56, w: 10, h: 6, d: 10, wall: C.blue, trim: C.white, sign: 'bank' },
  { u: 79, w: 16, h: 7.6, d: 12, wall: C.mustard, trim: C.cream, sign: 'hotel' },
  { u: 99, w: 8, h: 4.6, d: 8, wall: C.red, trim: C.white, sign: 'barber' },
  { u: 120, w: 11, h: 5, d: 10, wall: C.plank, trim: C.cream, sign: 'sheriff' },
  { u: 144, w: 12, h: 5, d: 10, wall: C.white, trim: C.blue, sign: 'icehouse' },
  { u: 168, w: 12, h: 5.4, d: 11, wall: C.teal, trim: C.cream, sign: 'feed' },
  { u: 190, w: 10, h: 4.8, d: 9, wall: C.wood, trim: C.cream, sign: 'trading' },
];

const FAR: Shop[] = [
  { u: 46, w: 18, h: 7.8, d: 14, wall: C.red, trim: C.cream, sign: 'saloon', kind: 'saloon' },
  { u: 72, w: 10, h: 5, d: 9, wall: C.white, trim: C.red, sign: 'post' },
  { u: 94, w: 12, h: 5.2, d: 11, wall: C.plank, trim: C.cream, sign: 'smith' },
  { u: 118, w: 12, h: 5.4, d: 10, wall: C.mustard, trim: C.red, sign: 'cantina' },
  { u: 146, w: 14, h: 7, d: 12, wall: C.blue, trim: C.cream, sign: 'opera' },
  { u: 196, w: 9, h: 5, d: 12, wall: C.white, trim: C.white, sign: '', kind: 'chapel' },
];

/** Back of the boardwalk: shop fronts stand here. */
const FRONT = WALK_EDGE + 3;

function shop(b: TownBuilder, s: Shop, near: boolean) {
  const vp = near ? -FRONT : FRONT;
  const m = b.at(vp, s.u, 0, near ? 1 : -1, 0);
  const { w, h, d } = s;
  if (s.kind === 'chapel') return chapel(b, m, s);
  // Body + false front (stepped parapet), all solid
  b.add(boxAt(-w / 2, w / 2, 0, h, -d, 0), s.wall, m, { collide: true });
  b.add(boxAt(-w / 2 - 0.2, w / 2 + 0.2, 0, h + 1.8, -0.05, 0.25), s.wall, m, { collide: true });
  b.add(boxAt(-w / 2 - 0.3, w / 2 + 0.3, h + 1.8, h + 2.0, -0.12, 0.36), s.trim, m);
  b.add(boxAt(-w / 4, w / 4, h + 1.95, h + 2.6, -0.05, 0.25), s.wall, m);
  b.add(boxAt(-w / 4 - 0.1, w / 4 + 0.1, h + 2.6, h + 2.75, -0.12, 0.34), s.trim, m);
  b.add(boxAt(-w / 2, w / 2, h, h + 0.2, -d, -0.05), C.roof, m);
  // Corner boards
  for (const x of [-w / 2 - 0.1, w / 2 + 0.1])
    b.add(boxAt(x - 0.12, x + 0.12, 0, h + 1.8, 0.2, 0.3), s.trim, m);
  // Door, windows (2 storeys on tall fronts)
  const saloon = s.kind === 'saloon';
  b.add(boxAt(-0.8, 0.8, WALK_Y, 2.6, 0.24, 0.3), saloon ? 0x120a05 : C.door, m);
  for (const x of w >= 9 ? [-w / 4 - 0.4, w / 4 + 0.4] : [w / 4 + 0.3]) {
    b.add(boxAt(x - 0.85, x + 0.85, 1.0, 2.4, 0.24, 0.3), C.glass, m);
    b.add(boxAt(x - 1.0, x + 1.0, 0.92, 1.02, 0.24, 0.36), s.trim, m);
  }
  if (h > 6.5)
    for (const x of [-w / 3, 0, w / 3]) {
      b.add(boxAt(x - 0.6, x + 0.6, 4.4, 5.7, 0.24, 0.3), C.glass, m);
      b.add(boxAt(x - 0.75, x + 0.75, 5.7, 5.85, 0.24, 0.34), s.trim, m);
    }
  if (saloon) {
    // Swing doors: two louvred half-doors, a little ajar
    for (const sx of [-1, 1]) {
      const g = boxAt(0, 0.74 * -sx, 0.9, 2.0, -0.03, 0.03).rotateY(sx * 0.35);
      b.add(g.translate(sx * 0.78, 0, 0.62), C.mustard, m);
      for (let k = 0; k < 4; k++)
        b.add(
          boxAt(0, 0.74 * -sx, 1.05 + k * 0.24, 1.12 + k * 0.24, -0.05, 0.05)
            .rotateY(sx * 0.35)
            .translate(sx * 0.78, 0, 0.62),
          C.plankDark,
          m,
        );
    }
    // Balcony on posts over the boardwalk, with a railing
    b.add(boxAt(-w / 2, w / 2, 3.5, 3.72, 0.25, 2.9), C.plankDark, m);
    for (let x = -w / 2 + 0.2; x <= w / 2 - 0.1; x += 0.6)
      b.add(boxAt(x - 0.04, x + 0.04, 3.72, 4.6, 2.78, 2.86), C.cream, m, { bucket: 'thin' });
    b.add(boxAt(-w / 2, w / 2, 4.55, 4.68, 2.72, 2.92), C.cream, m);
    for (const x of [-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2])
      b.add(boxAt(x - 0.1, x + 0.1, 0, 3.5, 2.7, 2.9), C.plankDark, m);
  } else {
    // Porch awning over the boardwalk, on posts
    b.add(
      prismX(
        [
          [0.25, 3.35],
          [3.0, 3.0],
          [3.0, 3.12],
          [0.25, 3.5],
        ],
        w,
      ),
      C.roof,
      m,
    );
    const posts = w > 11 ? [-w / 2 + 0.2, 0, w / 2 - 0.2] : [-w / 2 + 0.2, w / 2 - 0.2];
    for (const x of posts) b.add(boxAt(x - 0.09, x + 0.09, 0, 3.05, 2.72, 2.9), C.plankDark, m);
  }
  b.sign(s.sign, m, 0, h + 0.9, 0.27);
}

function chapel(b: TownBuilder, m: THREE.Matrix4, s: Shop) {
  const { w, d } = s;
  b.add(boxAt(-w / 2, w / 2, 0, 4.6, -d, 0), C.white, m, { collide: true });
  b.add(
    prismX(
      [
        [-d - 0.4, 4.6],
        [0.4, 4.6],
        [0.4, 4.7],
        [-d / 2, 8],
        [-d - 0.4, 4.7],
      ],
      w + 0.8,
    ).translate(0, 0, 0),
    C.roof,
    m,
  );
  // Steeple + cross over the door
  b.add(boxAt(-1.2, 1.2, 4.6, 9.6, -1.6, 0.6), C.white, m, { collide: true });
  b.add(new THREE.ConeGeometry(1.8, 3, 4).rotateY(Math.PI / 4).translate(0, 11.1, -0.5), C.roof, m);
  b.add(boxAt(-0.08, 0.08, 12.4, 14.0, -0.58, -0.42), C.iron, m, { bucket: 'thin' });
  b.add(boxAt(-0.45, 0.45, 13.3, 13.45, -0.58, -0.42), C.iron, m, { bucket: 'thin' });
  b.add(boxAt(-0.9, 0.9, 0, 2.8, 0.55, 0.65), C.door, m);
  b.add(boxAt(-0.5, 0.5, 6.4, 7.8, 0.58, 0.66), 0x5e9ad6, m);
}

function boardwalks(b: TownBuilder, Lf: number) {
  const u0 = 26;
  const u1 = Math.min(Lf - 26, 212);
  for (const sgn of [-1, 1]) {
    // One long deck per side (+ a step strip at the street edge)
    const mid = (WALK_EDGE + FRONT) / 2;
    const m = b.at(sgn * mid, (u0 + u1) / 2, 0, 0, 1);
    b.add(box(FRONT - WALK_EDGE, WALK_Y, u1 - u0), C.plank, m, { collide: true });
    // Plank seams (thin dark strips on top, merged into the ground bucket)
    for (let u = u0 + 1.2; u < u1; u += 1.2)
      b.add(
        new THREE.PlaneGeometry(FRONT - WALK_EDGE, 0.06).rotateX(-Math.PI / 2),
        C.plankDark,
        b.at(sgn * mid, u, WALK_Y + 0.004),
        { bucket: 'ground' },
      );
    b.add(box(FRONT - WALK_EDGE + 0.1, 0.12, u1 - u0 + 0.1, 0, WALK_Y - 0.06), C.plankDark, m);
  }
}

function arch(b: TownBuilder, u: number) {
  const m = b.at(0, u, 0, 0, -1);
  for (const x of [-9.4, 9.4]) {
    b.add(cyl(0.32, 0.38, 8.2, 8, x, 4.1, 0), C.plankDark, m, { collide: true });
    b.add(cyl(0.42, 0.42, 0.4, 8, x, 0.2, 0), C.iron, m);
  }
  b.add(boxAt(-10.4, 10.4, 7.6, 8.2, -0.3, 0.3), C.plank, m);
  // Hanging board (chains as thin rods), lettered both ways
  for (const x of [-5.4, 5.4])
    b.add(rod(v3(x, 7.6, 0), v3(x, 7.0, 0), 0.04), C.iron, m, { bucket: 'thin' });
  b.add(boxAt(-6.1, 6.1, 5.8, 7.0, -0.08, 0.08), C.plankDark, m);
  b.sign('arch', m, 0, 6.4, 0.1, 0.98);
  b.sign('arch', b.at(0, u, 0, 0, 1), 0, 6.4, 0.1, 0.98);
}

function welcome(b: TownBuilder) {
  const m = b.at(-12.5, 6, 0, 0.45, -1);
  for (const x of [-2.4, 2.4])
    b.add(boxAt(x - 0.12, x + 0.12, 0, 3.4, -0.2, -0.05), C.plankDark, m);
  b.add(boxAt(-3.05, 3.05, 1.3, 4.4, -0.05, 0), C.plank, m);
  b.sign('welcome', m, 0, 2.85, 0.02, 0.98);
}

function waterTower(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, Math.sign(-vp), 0);
  for (const [x, z] of [
    [-1.9, -1.9],
    [1.9, -1.9],
    [-1.9, 1.9],
    [1.9, 1.9],
  ])
    b.add(boxAt(x - 0.16, x + 0.16, 0, 9, z - 0.16, z + 0.16), C.plankDark, m, { collide: true });
  for (const y of [3, 6])
    for (const [a, c] of [
      [v3(-1.9, y, -1.9), v3(1.9, y + 2.4, -1.9)],
      [v3(-1.9, y, 1.9), v3(1.9, y + 2.4, 1.9)],
      [v3(-1.9, y, -1.9), v3(-1.9, y + 2.4, 1.9)],
      [v3(1.9, y, -1.9), v3(1.9, y + 2.4, 1.9)],
    ] as const)
      b.add(rod(a, c, 0.06, 4), C.plankDark, m, { bucket: 'thin' });
  b.add(boxAt(-2.6, 2.6, 9, 9.25, -2.6, 2.6), C.plank, m);
  b.add(cyl(2.55, 2.55, 3.6, 12, 0, 11.05, 0), C.wood, m);
  for (const y of [9.8, 11, 12.2]) b.add(cyl(2.62, 2.62, 0.12, 12, 0, y, 0), C.iron, m);
  b.add(new THREE.ConeGeometry(2.85, 1.5, 12).translate(0, 13.6, 0), C.roof, m);
  b.add(rod(v3(2.4, 9.6, 0), v3(3.6, 7.4, 0), 0.12), C.iron, m, { bucket: 'thin' });
  b.add(rod(v3(3.6, 7.4, 0), v3(3.6, 1.2, 0), 0.12), C.iron, m, { bucket: 'thin' });
}

function windmill(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, Math.sign(-vp), 0);
  for (const [x, z] of [
    [-1.2, -1.2],
    [1.2, -1.2],
    [-1.2, 1.2],
    [1.2, 1.2],
  ])
    b.add(rod(v3(x, 0, z), v3(x * 0.15, 10, z * 0.15), 0.07, 4), C.iron, m, { bucket: 'thin' });
  // Wheel: a thin disc of blades facing the street, plus the tail vane
  const wheel = new THREE.CylinderGeometry(1.7, 1.7, 0.08, 12, 1, false).rotateX(Math.PI / 2);
  b.add(wheel.translate(0, 10.4, 0.5), C.white, m);
  b.add(cyl(0.25, 0.25, 0.5, 8, 0, 10.4, 0.3).rotateX(Math.PI / 2), C.iron, m);
  b.add(boxAt(-0.04, 0.04, 9.9, 10.9, -2.6, -0.4), C.red, m);
}

function wagon(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, 0.3, 1);
  b.add(boxAt(-1, 1, 0.75, 1.55, -2.2, 2.2), C.plank, m, { collide: true });
  const hood = new THREE.CylinderGeometry(1.15, 1.15, 3.8, 10, 1, true, -Math.PI / 2, Math.PI);
  b.add(hood.rotateX(Math.PI / 2).translate(0, 1.55, 0), C.canvas, m);
  for (const [x, z] of [
    [-1.1, -1.5],
    [1.1, -1.5],
    [-1.1, 1.5],
    [1.1, 1.5],
  ])
    b.add(
      cyl(0.68, 0.68, 0.1, 10, 0, 0, 0)
        .rotateZ(Math.PI / 2)
        .translate(x, 0.7, z),
      C.plankDark,
      m,
    );
  b.add(rod(v3(0, 0.8, 2.2), v3(0, 0.3, 4.4), 0.06, 4), C.plankDark, m, { bucket: 'thin' });
}

function corral(b: TownBuilder, vp: number, u0: number, u1: number, depth: number) {
  const s = Math.sign(vp);
  const pts: [number, number][] = [
    [vp, u0],
    [vp + s * depth, u0],
    [vp + s * depth, u1],
    [vp, u1],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [va, ua] = pts[i];
    const [vb, ub] = pts[i + 1];
    const len = Math.hypot(vb - va, ub - ua);
    const n = Math.max(1, Math.round(len / 3));
    const m = b.at((va + vb) / 2, (ua + ub) / 2, 0, vb - va, ub - ua);
    for (let k = 0; k <= n; k++)
      b.add(
        boxAt(-0.1, 0.1, 0, 1.3, -len / 2 + (k * len) / n - 0.1, -len / 2 + (k * len) / n + 0.1),
        C.plankDark,
        m,
      );
    for (const y of [0.55, 1.1])
      b.add(boxAt(-0.05, 0.05, y, y + 0.14, -len / 2, len / 2), C.plank, m);
  }
}

function props(b: TownBuilder, Lf: number) {
  const rnd = mulberry32(0xd27);
  // Barrels + crates on the boardwalks (between customer spots)
  for (const [vp, u] of [
    [-9.8, 44],
    [9.8, 63],
    [-9.8, 90],
    [9.8, 100],
    [-9.8, 132],
    [9.8, 124],
    [-9.8, 180],
    [9.8, 160],
  ]) {
    const m = b.at(vp, u, WALK_Y, 0, 1);
    b.add(cyl(0.34, 0.3, 0.9, 8), rnd() < 0.5 ? C.plankDark : C.wood, m);
    b.add(cyl(0.35, 0.35, 0.06, 8, 0, 0.62), C.iron, m);
    if (rnd() < 0.6) b.add(box(0.8, 0.7, 0.8, 0, 0.35, 1.1), C.plank, m);
  }
  // Hitching rails + a water trough at the street edge
  for (const [vp, u] of [
    [-7.1, 64],
    [7.1, 88],
    [-7.1, 152],
    [7.1, 178],
  ]) {
    const m = b.at(vp, u, 0, 0, 1);
    for (const z of [-1.6, 1.6])
      b.add(boxAt(-0.08, 0.08, 0, 1.1, z - 0.08, z + 0.08), C.plankDark, m);
    b.add(boxAt(-0.06, 0.06, 1.0, 1.12, -1.8, 1.8), C.plank, m, { bucket: 'thin' });
    b.add(boxAt(-0.45, 0.45, 0, 0.55, -1.3, 1.3), C.plank, m);
    b.add(boxAt(-0.36, 0.36, 0.5, 0.52, -1.2, 1.2), 0x5f9fc0, m);
  }
  wagon(b, 30, 64);
  corral(b, 26, 102, 134, 16);
  waterTower(b, -32, 112);
  windmill(b, -30, 156);
  void Lf;
}

/** Saguaro: trunk + two arms (one geometry, vertex-coloured, instanced). */
export function cactusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: number) => {
    const p = g.index !== null ? g.toNonIndexed() : g;
    const col = new THREE.Color(c);
    const n = p.attributes.position.count;
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(ca, i * 3);
    p.deleteAttribute('uv');
    p.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    parts.push(p);
  };
  add(cyl(0.3, 0.34, 3.4, 7), C.cactus);
  add(
    new THREE.SphereGeometry(0.3, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.4, 0),
    C.cactus,
  );
  add(rod(v3(0.2, 1.5, 0), v3(0.85, 1.5, 0), 0.19, 6), C.cactusDark);
  add(cyl(0.19, 0.19, 1.2, 6, 0.85, 2.1, 0), C.cactusDark);
  add(
    new THREE.SphereGeometry(0.19, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.85, 2.7, 0),
    C.cactusDark,
  );
  add(rod(v3(-0.2, 2.0, 0), v3(-0.75, 2.0, 0), 0.17, 6), C.cactus);
  add(cyl(0.17, 0.17, 0.9, 6, -0.75, 2.45, 0), C.cactus);
  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  return merged;
}

export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Everything static in Dry Gulch. `ground(x, z)` = terrain height (props off the pad). */
export function buildCowboy(b: TownBuilder, ground: (vp: number, u: number) => number) {
  const f = b.f;
  // Dusty pad either side of the street, a darker wheel-rut tint down the line
  b.decal(6.2, f.vmax - 0.5, 0, f.Lf, C.dust);
  b.decal(f.vmin + 0.5, -6.2, 0, f.Lf, C.dust);
  for (const [v0, v1, u0, u1] of [
    [16, 40, 140, 190],
    [-44, -24, 30, 70],
    [-40, -22, 180, 228],
  ])
    b.decal(v0, v1, u0, u1, C.dustDark, 0.02);
  boardwalks(b, f.Lf);
  for (const s of NEAR) shop(b, s, true);
  for (const s of FAR) shop(b, s, false);
  arch(b, 16);
  welcome(b);
  props(b, f.Lf);
  // Cacti: on the pad's back lots, then out on the open slope around town
  const rnd = mulberry32(0xcac7);
  for (let i = 0; i < 46; i++) {
    const far = i >= 22;
    const sgn = rnd() < 0.5 ? -1 : 1;
    const vp = far ? sgn * (52 + rnd() * 70) : sgn * (25 + rnd() * 19);
    const u = far ? -40 + rnd() * (f.Lf + 80) : 8 + rnd() * (f.Lf - 16);
    // Keep the back-lot props clear (tower, windmill, corral, wagon)
    if (!far && ((vp < -24 && Math.abs(u - 112) < 8) || (vp < -24 && Math.abs(u - 156) < 5)))
      continue;
    if (!far && vp > 24 && ((u > 98 && u < 138) || Math.abs(u - 64) < 6)) continue;
    const y = far ? ground(vp, u) : f.P;
    b.plant(vp, u, y - 0.1, rnd() * Math.PI * 2, 0.75 + rnd() * 0.7);
  }
}

/** Tumbleweed geometry (a lumpy low-poly ball). */
export function tumbleweedGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.55, 0);
  const p = g.toNonIndexed();
  g.dispose();
  p.deleteAttribute('uv');
  const col = new THREE.Color(C.tumble);
  const n = p.attributes.position.count;
  const ca = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(ca, i * 3);
  p.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  p.computeVertexNormals();
  return p;
}

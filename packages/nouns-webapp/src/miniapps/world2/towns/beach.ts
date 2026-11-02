// ── Puerto Noun: the beach town ~25 km down the +X line ──────────────────
//
// A Caribbean-coast surf village (the real icecreamvan.eth parks in Puerto
// Viejo, Costa Rica): main street is the dirt line; on the near side a
// row of pastel surf shacks, a fish market hall, a drip boutique, an ice
// cream parlour and a hostel; on the far side sand, palms, umbrellas, a
// lifeguard tower and a wooden pier out over the lagoon cut into the pad
// (site.ts → lagoonDepth; the water plane is added in build.ts).

import * as THREE from 'three';

import { mergeParts } from './cowboy';
import {
  BLOCK_FONT,
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
import { LAGOON, townGround } from './site';

export const BEACH_C = {
  sand: 0xead7a4,
  sandWet: 0xd8c08a,
  wood: 0xa7794c,
  woodDark: 0x6f4b2c,
  tin: 0xb9c3c9,
  thatch: 0xc9a45c,
  turquoise: 0x2ec4b6,
  coral: 0xff6f61,
  yellow: 0xffd23f,
  lime: 0x7ac74f,
  pink: 0xffb3c7,
  navy: 0x1b4965,
  white: 0xf4f1ea,
  dark: 0x2a2320,
  trunk: 0x8a6a48,
  frond: 0x3f9a4a,
  frondDark: 0x2f7f3c,
  coconut: 0x5a3b22,
  water: 0x2fb8c9,
  fish: 0xc3ccd6,
  ice: 0xe8f6ff,
  crate: 0x7fb8d6,
} as const;

const C = BEACH_C;

const board = (key: string, w: number, h: number, text: string, bg: string, fg: string) =>
  ({ key, w, h, bg, fg, lines: [{ text, size: 0.6, y: 0.55, font: BLOCK_FONT }] }) as SignSpec;

export function beachSigns(): SignSpec[] {
  return [
    {
      key: 'arch',
      w: 12,
      h: 2.2,
      bg: '#1aa5b8',
      fg: '#fff3c4',
      border: '#ff6f61',
      lines: [
        { text: 'PUERTO NOUN', size: 0.5, y: 0.42 },
        { text: '⌐◨-◨  PURA VIDA  ⌐◨-◨', size: 0.18, y: 0.8, color: '#ffd23f' },
      ],
    },
    {
      key: 'welcome',
      w: 6,
      h: 3,
      bg: '#fff3c4',
      fg: '#1b4965',
      border: '#ff6f61',
      lines: [
        { text: 'PUERTO NOUN', size: 0.22, y: 0.24 },
        { text: 'FISH ↓   DRIP ↑↑', size: 0.15, y: 0.52, color: '#ff6f61' },
        { text: 'NO SHOES · NO PROBLEM', size: 0.1, y: 0.76 },
      ],
    },
    board('surf', 7, 1.1, 'SURF SHACK', '#ff6f61', '#fff3c4'),
    board('ceviche', 6, 1.1, 'CEVICHE', '#ffd23f', '#1b4965'),
    board('cocos', 6, 1.1, 'COCOS FRÍOS', '#7ac74f', '#ffffff'),
    {
      key: 'fish',
      w: 12,
      h: 2,
      bg: '#1b4965',
      fg: '#ffffff',
      border: '#2ec4b6',
      lines: [
        { text: 'FISH MARKET', size: 0.42, y: 0.4 },
        { text: 'MERCADO DE PESCADO', size: 0.2, y: 0.78, color: '#ffd23f' },
      ],
    },
    {
      key: 'drip',
      w: 7,
      h: 1.2,
      bg: '#111111',
      fg: '#ff3d8b',
      border: '#ff3d8b',
      lines: [{ text: 'DRIP BOUTIQUE', size: 0.48, y: 0.55 }],
    },
    board('helados', 6, 1.1, 'HELADOS', '#ffb3c7', '#7a1f3d'),
    board('hostel', 9, 1.2, 'HOSTEL PURA VIDA', '#2ec4b6', '#ffffff'),
    board('pulperia', 6, 1.1, 'PULPERÍA', '#f4a259', '#2a2320'),
    board('muelle', 5, 1, 'MUELLE', '#f4f1ea', '#1b4965'),
    // The sea front (beachFront below, ocean/)
    {
      key: 'surfshop',
      w: 8,
      h: 1.6,
      bg: '#ff6f61',
      fg: '#fff3c4',
      border: '#1b4965',
      lines: [
        { text: 'SURF SHOP', size: 0.5, y: 0.42 },
        { text: 'PURA VIDA SURF CO. · RENTALS', size: 0.17, y: 0.8, color: '#ffd23f' },
      ],
    },
    board('ola', 6, 1.1, 'BAR LA OLA', '#2ec4b6', '#fff3c4'),
    board('coco', 6, 1.1, 'COCO LOCO', '#ffd23f', '#7a1f3d'),
    {
      key: 'break',
      w: 3.4,
      h: 2.2,
      bg: '#fff3c4',
      fg: '#1b4965',
      border: '#ff6f61',
      lines: [
        { text: 'SURF BREAK', size: 0.17, y: 0.28 },
        { text: 'PADDLE OUT ↑', size: 0.13, y: 0.55, color: '#ff6f61' },
        { text: 'LINE-UP AT THE BUOYS', size: 0.08, y: 0.8 },
      ],
    },
  ];
}

interface Shack {
  u: number;
  w: number;
  d: number;
  h: number;
  wall: number;
  roof: number;
  sign: string;
  kind?: 'market' | 'hostel';
}

const SHACKS: Shack[] = [
  { u: 32, w: 9, d: 7, h: 3.6, wall: C.turquoise, roof: C.tin, sign: 'surf' },
  { u: 49, w: 8, d: 6, h: 3.4, wall: C.yellow, roof: C.thatch, sign: 'ceviche' },
  { u: 66, w: 7, d: 6, h: 3.4, wall: C.lime, roof: C.tin, sign: 'cocos' },
  { u: 98, w: 20, d: 12, h: 4.6, wall: C.white, roof: C.tin, sign: 'fish', kind: 'market' },
  { u: 126, w: 9, d: 7, h: 3.8, wall: C.dark, roof: C.tin, sign: 'drip' },
  { u: 145, w: 8, d: 6, h: 3.4, wall: C.pink, roof: C.thatch, sign: 'helados' },
  { u: 168, w: 13, d: 9, h: 7, wall: C.coral, roof: C.tin, sign: 'hostel', kind: 'hostel' },
  { u: 194, w: 8, d: 7, h: 3.4, wall: 0xf4a259, roof: C.thatch, sign: 'pulperia' },
];

const FRONT = 10.5;

function shack(b: TownBuilder, s: Shack) {
  const m = b.at(-FRONT, s.u, 0, 1, 0);
  const { w, d, h } = s;
  if (s.kind === 'market') return market(b, m, s);
  b.add(boxAt(-w / 2, w / 2, 0, h, -d, 0), s.wall, m, { collide: true });
  // Flat roof overhanging the front as an awning (on two posts) + a sign board
  b.add(boxAt(-w / 2 - 0.3, w / 2 + 0.3, h, h + 0.22, -d - 0.3, 2.2), s.roof, m);
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2])
    b.add(boxAt(x - 0.1, x + 0.1, 0, h, 2.0, 2.2), C.woodDark, m);
  b.add(boxAt(-w / 2 + 0.3, w / 2 - 0.3, h + 0.2, h + 1.4, -0.12, 0), C.woodDark, m);
  b.sign(s.sign, m, 0, h + 0.8, 0.02, Math.min(1, (w - 0.8) / 7));
  // Serving hatch over a counter, and a door
  b.add(boxAt(-w / 2 + 0.7, w / 4, 1.15, 2.6, 0, 0.04), C.dark, m);
  b.add(boxAt(-w / 2 + 0.5, w / 4 + 0.2, 1.0, 1.15, 0, 0.6), C.wood, m);
  b.add(boxAt(w / 4 + 0.6, w / 4 + 1.6, 0, 2.3, 0, 0.05), C.woodDark, m);
  if (s.kind === 'hostel') {
    // Second storey windows + a balcony rail across the front
    for (const x of [-w / 3, 0, w / 3])
      b.add(boxAt(x - 0.6, x + 0.6, 4.4, 5.6, 0, 0.05), C.navy, m);
    b.add(boxAt(-w / 2, w / 2, 3.6, 3.75, 0, 1.4), C.wood, m);
    b.add(boxAt(-w / 2, w / 2, 4.55, 4.65, 1.3, 1.4), C.white, m);
    for (let x = -w / 2 + 0.3; x < w / 2; x += 0.7)
      b.add(boxAt(x - 0.035, x + 0.035, 3.75, 4.55, 1.32, 1.38), C.white, m, { bucket: 'thin' });
  }
}

function market(b: TownBuilder, m: THREE.Matrix4, s: Shack) {
  const { w, d, h } = s;
  // Open hall: posts, a big gable roof, three long stalls of fish on ice
  for (const x of [-w / 2 + 0.3, -w / 6, w / 6, w / 2 - 0.3])
    for (const z of [-d + 0.3, -0.3])
      b.add(boxAt(x - 0.16, x + 0.16, 0, h, z - 0.16, z + 0.16), C.woodDark, m, { collide: true });
  b.add(boxAt(-w / 2, w / 2, 0, 2.2, -d, -d + 0.2), C.white, m, { collide: true });
  b.add(
    prismX(
      [
        [-d - 1, h - 0.2],
        [-d / 2, h + 2.6],
        [1.2, h - 0.2],
        [1.2, h - 0.4],
        [-d / 2, h + 2.4],
        [-d - 1, h - 0.4],
      ],
      w + 1,
    ),
    s.roof,
    m,
  );
  // Gable front board for the sign
  b.add(boxAt(-6.3, 6.3, h + 0.1, h + 2.3, 0.6, 0.75), C.navy, m);
  b.sign(s.sign, m, 0, h + 1.2, 0.77, 1);
  for (const x of [-w / 3, 0, w / 3]) {
    b.add(boxAt(x - 2.4, x + 2.4, 0, 0.95, -d / 2 - 1.4, -d / 2 + 1.4), C.wood, m, {
      collide: true,
    });
    b.add(boxAt(x - 2.3, x + 2.3, 0.95, 1.05, -d / 2 - 1.3, -d / 2 + 1.3), C.ice, m);
    for (let k = 0; k < 5; k++) {
      const fx = x - 1.8 + k * 0.9;
      b.add(
        boxAt(fx - 0.32, fx + 0.32, 1.05, 1.2, -d / 2 - 0.5, -d / 2 + 0.5),
        k % 2 === 0 ? C.fish : C.coral,
        m,
      );
    }
    b.add(box(0.7, 0.5, 0.7, x + 2.9, 0.25, -d / 2 + 0.6), C.crate, m);
  }
}

function arch(b: TownBuilder, u: number) {
  const m = b.at(0, u, 0, 0, -1);
  for (const x of [-9.4, 9.4]) {
    b.add(cyl(0.3, 0.36, 8.2, 8, x, 4.1, 0), C.turquoise, m, { collide: true });
    b.add(cyl(0.45, 0.45, 0.5, 8, x, 8.3, 0), C.coral, m);
  }
  b.add(boxAt(-10.2, 10.2, 7.5, 8.1, -0.3, 0.3), C.yellow, m);
  b.add(boxAt(-6.1, 6.1, 5.2, 7.5, -0.1, 0.1), C.woodDark, m);
  b.sign('arch', m, 0, 6.35, 0.12, 0.98);
  b.sign('arch', b.at(0, u, 0, 0, 1), 0, 6.35, 0.12, 0.98);
}

function welcome(b: TownBuilder) {
  const m = b.at(-12.5, 6, 0, 0.45, -1);
  for (const x of [-2.4, 2.4]) b.add(boxAt(x - 0.12, x + 0.12, 0, 3.4, -0.2, -0.05), C.woodDark, m);
  b.add(boxAt(-3.05, 3.05, 1.3, 4.4, -0.05, 0), C.wood, m);
  b.sign('welcome', m, 0, 2.85, 0.02, 0.98);
}

/** The pier: a ramp up off the sand, a deck on posts out over the lagoon, a hut at the end. */
export const PIER = { u: 124, v0: 26, v1: 104, top: 0.9, half: 1.8 } as const;

function pier(b: TownBuilder) {
  const { u, v0, v1, top, half } = PIER;
  const m = b.at(v0, u, 0, 1, 0);
  const len = v1 - v0;
  b.add(
    prismX(
      [
        [0, 0],
        [4, top - 0.2],
        [4, top],
        [0, 0.12],
      ],
      half * 2,
    ),
    C.wood,
    m,
    { collide: true },
  );
  b.add(boxAt(-half, half, top - 0.2, top, 4, len), C.wood, m, { collide: true });
  for (let z = 6; z <= len; z += 6)
    for (const x of [-half + 0.15, half - 0.15]) {
      b.add(cyl(0.15, 0.15, 3.2, 6, x, top - 1.6, z), C.woodDark, m);
      b.add(boxAt(x - 0.05, x + 0.05, top, top + 1.0, z - 0.05, z + 0.05), C.woodDark, m, {
        bucket: 'thin',
      });
    }
  for (const x of [-half + 0.15, half - 0.15])
    b.add(boxAt(x - 0.05, x + 0.05, top + 0.95, top + 1.05, 6, len), C.white, m, {
      bucket: 'thin',
    });
  // Hut at the end
  b.add(boxAt(-2.2, 2.2, top, top + 2.8, len - 3.6, len), C.turquoise, m, { collide: true });
  b.add(boxAt(-2.6, 2.6, top + 2.8, top + 3.0, len - 4, len + 0.4), C.tin, m);
  b.add(boxAt(-0.6, 0.6, top, top + 2.2, len - 3.62, len - 3.58), C.dark, m);
  b.sign('muelle', b.at(v0 + len - 3.6, u, 0, -1, 0), 0, top + 2.5, 0.06, 0.6);
}

function umbrella(b: TownBuilder, vp: number, u: number, color: number, rnd: () => number) {
  const m = b.at(vp, u, 0, rnd() - 0.5, 1);
  b.add(rod(v3(0, 0, 0), v3(0.25, 2.4, 0), 0.05, 4), C.white, m, { bucket: 'thin' });
  b.add(new THREE.ConeGeometry(1.7, 0.6, 8).translate(0.25, 2.55, 0), color, m);
  b.add(boxAt(-0.4, 0.4, 0, 0.32, 0.6, 2.4), color === C.white ? C.coral : C.white, m);
}

function lifeguard(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, 1, 0);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.add(boxAt(x - 0.1, x + 0.1, 0, 2.4, z - 0.1, z + 0.1), C.white, m, { collide: true });
  b.add(boxAt(-1.3, 1.3, 2.4, 2.55, -1.3, 1.3), C.wood, m);
  b.add(boxAt(-1.0, 1.0, 2.55, 4.2, -1.0, 0.4), C.coral, m);
  b.add(boxAt(-1.3, 1.3, 4.2, 4.35, -1.4, 0.8), C.white, m);
  b.add(
    prismX(
      [
        [-3.4, 0],
        [-1.3, 2.4],
        [-1.3, 2.5],
        [-3.4, 0.1],
      ],
      0.9,
    ),
    C.wood,
    m,
  );
}

function surfRack(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, -1, 0);
  const cols = [C.coral, C.yellow, C.turquoise, C.pink, C.lime];
  b.add(boxAt(-2.6, 2.6, 1.2, 1.32, -0.1, 0.1), C.woodDark, m, { bucket: 'thin' });
  cols.forEach((c, i) => {
    const x = -2 + i;
    b.add(box(0.55, 2.3, 0.08).rotateX(-0.22).translate(x, 1.1, 0.3), c, m);
  });
}

function canoe(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, 0.4, 1);
  const g = new THREE.CylinderGeometry(0.5, 0.5, 5, 8, 1, false, Math.PI / 2, Math.PI);
  b.add(
    g
      .rotateX(Math.PI / 2)
      .rotateZ(Math.PI)
      .translate(0, 0.5, 0),
    C.coral,
    m,
  );
}

/** Palm: curved trunk, a crown of fronds, coconuts (one vertex-coloured geometry, instanced). */
export function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: number) => {
    const p = g.index !== null ? g.toNonIndexed() : g;
    const col = new THREE.Color(c);
    const n = p.attributes.position.count;
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(ca, i * 3);
    p.deleteAttribute('uv');
    if (p.attributes.normal !== undefined) p.deleteAttribute('normal');
    p.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    parts.push(p);
  };
  let prev = v3(0, 0, 0);
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    const p = v3(0.9 * t * t, 7 * t, 0);
    add(rod(prev, p, 0.24 - 0.08 * t, 6), C.trunk);
    prev = p;
  }
  const top = prev;
  for (let k = 0; k < 7; k++) {
    const g = new THREE.BoxGeometry(0.55, 0.05, 3.2).translate(0, 0, 1.6);
    g.rotateX(0.5 + (k % 2) * 0.2);
    g.rotateY((k / 7) * Math.PI * 2);
    add(g.translate(top.x, top.y, top.z), k % 2 === 0 ? C.frond : C.frondDark);
  }
  for (let k = 0; k < 3; k++)
    add(
      new THREE.IcosahedronGeometry(0.2, 0).translate(
        top.x + Math.cos(k * 2.1) * 0.3,
        top.y - 0.3,
        Math.sin(k * 2.1) * 0.3,
      ),
      C.coconut,
    );
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

/** Everything static in Puerto Noun. `ground(vp, u)` = terrain height (palms off the pad). */
export function buildBeach(b: TownBuilder, ground: (vp: number, u: number) => number) {
  const f = b.f;
  // Sand: flat on the near side, a ground-following sheet down into the lagoon on the far side
  b.decal(f.vmin + 0.5, -6.2, 0, f.Lf, C.sand);
  const vs = [
    6.2,
    14,
    24,
    34,
    44,
    50,
    52,
    55,
    58,
    61,
    64,
    67,
    70,
    72,
    80,
    90,
    100,
    102,
    105,
    108,
    111,
    114,
    f.vmax - 0.5,
  ];
  const us: number[] = [];
  for (let u = 0; u < f.Lf; ) {
    us.push(u);
    const fine =
      (u >= LAGOON.uIn0 - 1 && u < LAGOON.uIn1 + 1) ||
      (u >= f.Lf - LAGOON.uIn1 - 1 && u < f.Lf - LAGOON.uIn0 + 1);
    u = Math.min(f.Lf, u + (fine ? 2.5 : 12));
  }
  us.push(f.Lf);
  b.sheet(vs, us, (u, vp) => townGround(f, u, vp) + 0.06, C.sand);
  // Wet sand strip at the waterline
  b.decal(46, 52, 10, f.Lf - 10, C.sandWet, 0.02);
  for (const s of SHACKS) shack(b, s);
  arch(b, 16);
  welcome(b);
  pier(b);
  const rnd = mulberry32(0xbeac);
  const cols = [C.coral, C.yellow, C.turquoise, C.white, C.pink];
  for (let i = 0; i < 9; i++) {
    const u = 40 + i * 20 + rnd() * 6;
    if (Math.abs(u - PIER.u) < 6) continue;
    umbrella(b, 32 + rnd() * 12, u, cols[i % cols.length], rnd);
  }
  lifeguard(b, 44, 72);
  beachFront(b);
  surfRack(b, 15, 62);
  canoe(b, 42, 186);
  // Palms: along the beach, behind the shacks, then out on the slope around town
  for (let i = 0; i < 44; i++) {
    let vp: number;
    let u: number;
    let y = f.P;
    if (i < 16) {
      vp = 13 + rnd() * 30;
      u = 10 + (i / 16) * (f.Lf - 20) + rnd() * 8;
      if (Math.abs(u - PIER.u) < 5) continue;
    } else if (i < 26) {
      vp = -24 - rnd() * 18;
      u = 10 + rnd() * (f.Lf - 20);
    } else {
      const sgn = rnd() < 0.4 ? -1 : 1;
      // (the far side past the lagoon is the ocean's beach now: palms on its dune rim)
      vp = sgn < 0 ? -(50 + rnd() * 50) : 114.5 + rnd() * 3;
      u = -30 + rnd() * (f.Lf + 60);
      y = ground(vp, u);
    }
    b.plant(vp, u, y - 0.1, rnd() * Math.PI * 2, 0.8 + rnd() * 0.5);
  }
}

// ── The sea front (ocean/: the ocean's beach is past the lagoon) ─────────
//
// Between the lagoon and the sea runs a dune rim (v' 114–118, pad level)
// and then the beach falls to the water at v' 132. Along the rim: a
// boardwalk on posts the length of town, a footbridge across the lagoon to
// it, the surf shop and two beach bars out on stilts over the sand, and the
// lifeguard flags. `SEA_FRONT` is read by ocean/ (the shop's spot, the
// boardwalk height).

export const SEA_FRONT = {
  /** Boardwalk: v' span, deck height over the pad, u span. */
  walk0: 114.5,
  walk1: 119,
  deck: 0.55,
  u0: 18,
  u1Back: 18,
  /** The lagoon bridge (u) and its landing on the beach side (v'). */
  bridgeU: 58,
  bridgeV0: 44,
  /** The surf shop: centre (u, v'), it faces the boardwalk (−v'). */
  shopU: 70,
  shopV: 123,
  /** Beach bars (u). */
  bars: [140, 192],
} as const;

function boardwalk(b: TownBuilder) {
  const f = b.f;
  const { walk0, walk1, deck } = SEA_FRONT;
  const u0 = SEA_FRONT.u0;
  const u1 = f.Lf - SEA_FRONT.u1Back;
  const w = walk1 - walk0;
  const mid = (walk0 + walk1) / 2;
  const m = b.at(mid, u0, 0, 0, 1);
  // deck (x across = v', z along = u)
  b.add(boxAt(-w / 2, w / 2, deck - 0.14, deck, 0, u1 - u0), C.wood, m, { collide: true });
  // planks: darker seams every 1.2 m
  for (let z = 0.6; z < u1 - u0; z += 1.2)
    b.add(boxAt(-w / 2, w / 2, deck, deck + 0.004, z - 0.03, z + 0.03), C.woodDark, m, {
      bucket: 'thin',
    });
  // posts down into the sand
  for (let z = 0; z <= u1 - u0; z += 4)
    for (const x of [-w / 2 + 0.15, w / 2 - 0.15])
      b.add(boxAt(x - 0.1, x + 0.1, -2.4, deck - 0.14, z - 0.1, z + 0.1), C.woodDark, m);
  // a rail on the sea side
  b.add(boxAt(w / 2 - 0.08, w / 2, deck + 0.95, deck + 1.05, 0, u1 - u0), C.white, m, {
    bucket: 'thin',
  });
  for (let z = 0; z <= u1 - u0; z += 3)
    b.add(boxAt(w / 2 - 0.07, w / 2 - 0.01, deck, deck + 0.95, z - 0.03, z + 0.03), C.white, m, {
      bucket: 'thin',
    });
  // ramps down onto the rim at both ends
  for (const [u, dir] of [
    [u0, -1],
    [u1, 1],
  ] as const) {
    const r = b.at(mid, u, 0, 0, dir);
    b.add(
      prismX(
        [
          [0, deck],
          [3.2, 0.02],
          [3.2, 0],
          [0, deck - 0.14],
        ],
        w,
      ),
      C.wood,
      r,
      { collide: true },
    );
  }
}

function lagoonBridge(b: TownBuilder) {
  const { bridgeU, bridgeV0, walk0, deck } = SEA_FRONT;
  const half = 1.4;
  const m = b.at(bridgeV0, bridgeU, 0, 1, 0);
  const len = walk0 - bridgeV0;
  // ramp up off the beach, then the span (local +z = +v')
  b.add(
    prismX(
      [
        [0, 0],
        [3, deck - 0.14],
        [3, deck],
        [0, 0.08],
      ],
      half * 2,
    ),
    C.wood,
    m,
    { collide: true },
  );
  b.add(boxAt(-half, half, deck - 0.14, deck, 3, len + 0.2), C.wood, m, { collide: true });
  for (let z = 6; z < len; z += 5)
    for (const x of [-half + 0.12, half - 0.12]) {
      b.add(cyl(0.12, 0.12, 2.6, 6, x, deck - 1.4, z), C.woodDark, m);
      b.add(boxAt(x - 0.04, x + 0.04, deck, deck + 0.9, z - 0.04, z + 0.04), C.woodDark, m, {
        bucket: 'thin',
      });
    }
  for (const x of [-half + 0.12, half - 0.12])
    b.add(boxAt(x - 0.04, x + 0.04, deck + 0.86, deck + 0.94, 4, len), C.white, m, {
      bucket: 'thin',
    });
}

/** A hut on stilts out over the sand, facing the boardwalk (−v'). */
function stiltHut(
  b: TownBuilder,
  u: number,
  vp: number,
  w: number,
  d: number,
  wall: number,
  roof: number,
  sign: string,
  open: boolean,
) {
  const { deck, walk1 } = SEA_FRONT;
  // local: +z = toward the boardwalk (−v'), x along u
  const m = b.at(vp, u, 0, -1, 0);
  // platform from the boardwalk edge (local z = vp − walk1) out over the sand
  b.add(boxAt(-w / 2, w / 2, deck - 0.14, deck, -d / 2, vp - walk1), C.wood, m, { collide: true });
  const z0 = -(d / 2);
  const z1 = d / 2;
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2])
    for (const z of [z0 + 0.2, z1 - 0.2])
      b.add(boxAt(x - 0.12, x + 0.12, -2.6, deck, z - 0.12, z + 0.12), C.woodDark, m);
  const h = 3.1;
  if (!open) {
    // walls (back + sides), the front open over a counter
    b.add(boxAt(-w / 2, w / 2, deck, deck + h, z0, z0 + 0.15), wall, m, { collide: true });
    for (const x of [-w / 2, w / 2 - 0.15])
      b.add(boxAt(x, x + 0.15, deck, deck + h, z0, z1), wall, m, { collide: true });
    b.add(boxAt(-w / 2, -1, deck, deck + h, z1 - 0.15, z1), wall, m, { collide: true });
    b.add(boxAt(1, w / 2, deck, deck + h, z1 - 0.15, z1), wall, m, { collide: true });
    b.add(boxAt(-1, 1, deck + 2.3, deck + h, z1 - 0.15, z1), wall, m);
  } else {
    // a palapa: posts, an open bar counter, stools
    for (const x of [-w / 2 + 0.25, w / 2 - 0.25])
      for (const z of [z0 + 0.25, z1 - 0.25])
        b.add(cyl(0.11, 0.13, h, 6, x, deck + h / 2, z), C.trunk, m, { collide: true });
    b.add(boxAt(-w / 2 + 0.8, w / 2 - 0.8, deck, deck + 1.1, -0.4, 0.2), C.wood, m, {
      collide: true,
    });
    b.add(boxAt(-w / 2 + 0.7, w / 2 - 0.7, deck + 1.1, deck + 1.18, -0.5, 0.35), C.woodDark, m);
    for (let x = -w / 2 + 1.3; x < w / 2 - 1; x += 1.1) {
      b.add(cyl(0.2, 0.2, 0.08, 8, x, deck + 0.75, 0.9), C.coral, m);
      b.add(cyl(0.04, 0.04, 0.72, 4, x, deck + 0.36, 0.9), C.dark, m, { bucket: 'thin' });
    }
    // bottles on a shelf at the back
    for (let x = -w / 2 + 1; x < w / 2 - 1; x += 0.35)
      b.add(
        cyl(0.05, 0.05, 0.28, 5, x, deck + 1.32, -1.2),
        (x * 7) % 2 > 1 ? C.lime : C.turquoise,
        m,
      );
    b.add(boxAt(-w / 2 + 0.8, w / 2 - 0.8, deck + 1.16, deck + 1.2, -1.35, -1.05), C.woodDark, m);
  }
  // thatch / tin roof overhanging the front
  b.add(
    prismX(
      [
        [z0 - 0.6, deck + h - 0.05],
        [0, deck + h + 1.5],
        [z1 + 1.0, deck + h - 0.05],
        [z1 + 1.0, deck + h - 0.2],
        [0, deck + h + 1.35],
        [z0 - 0.6, deck + h - 0.2],
      ],
      w + 0.8,
    ),
    roof,
    m,
  );
  b.add(boxAt(-3.1, 3.1, deck + h - 0.9, deck + h + 0.25, z1 + 0.95, z1 + 1.05), C.navy, m);
  b.sign(sign, m, 0, deck + h - 0.32, z1 + 1.07, sign === 'surfshop' ? 0.75 : 1);
}

function surfShop(b: TownBuilder) {
  const { shopU, shopV, deck } = SEA_FRONT;
  stiltHut(b, shopU, shopV, 9, 7, C.turquoise, C.tin, 'surfshop', false);
  // boards stacked out front on the boardwalk side, and a rack inside
  const m = b.at(shopV, shopU, 0, -1, 0);
  const cols = [C.coral, C.yellow, 0x5ec8f2, C.pink, C.white, C.lime, 0xf4ead2];
  cols.forEach((c, i) => {
    const x = -4.2 + i * 0.32;
    b.add(
      box(0.5, 2.5, 0.07)
        .rotateX(0.12)
        .translate(x, deck + 1.25, 3.9),
      c,
      m,
    );
  });
  for (let i = 0; i < 6; i++) {
    const x = 2.2 + (i % 3) * 0.55;
    b.add(
      box(0.48, 2.2, 0.07)
        .rotateX(-0.1)
        .translate(x, deck + 1.1, -3.1 + Math.floor(i / 3) * 0.12),
      cols[(i + 2) % cols.length],
      m,
    );
  }
  // wax + a counter
  b.add(boxAt(-2, 1.2, deck, deck + 1.05, 1.2, 1.8), C.wood, m, { collide: true });
  b.add(box(0.3, 0.12, 0.3, -1.2, deck + 1.11, 1.5), C.yellow, m);
}

function flags(b: TownBuilder, u: number) {
  const m = b.at(121, u, 0, -1, 0);
  for (const [x, c] of [
    [-0.8, C.coral],
    [0.8, C.yellow],
  ] as const) {
    b.add(rod(v3(x, -1.2, 0), v3(x, 3.6, 0), 0.04, 4), C.white, m, { bucket: 'thin' });
    b.add(boxAt(x + 0.04, x + 1.0, 2.9, 3.55, -0.01, 0.01), c, m);
  }
  // the break sign at the top of the beach
  const s = b.at(SEA_FRONT.walk0 - 0.6, u + 6, 0, 1, 0);
  b.add(boxAt(-0.08, 0.08, 0, 2.4, -0.05, 0.05), C.woodDark, s);
  b.add(boxAt(-1.75, 1.75, 2.3, 4.55, -0.06, 0), C.wood, s);
  b.sign('break', s, 0, 3.42, 0.01, 1);
}

function beachFront(b: TownBuilder) {
  boardwalk(b);
  lagoonBridge(b);
  surfShop(b);
  stiltHut(b, SEA_FRONT.bars[0], 124, 8, 7, C.white, C.thatch, 'ola', true);
  stiltHut(b, SEA_FRONT.bars[1], 124, 8, 7, C.white, C.thatch, 'coco', true);
  flags(b, 104);
}

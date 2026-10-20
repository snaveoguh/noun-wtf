// ── Noggle City: the shades capital, past Puerto Noun on the +X line ────
//
// You ride in under the Noggle Arch (a 46 m ⌐◨-◨, world/landmarks) and down
// a main street of primary-coloured blocks, every one wearing a pair of
// noggles for a facade; a taller back row wears them on the roof. The Lens
// Works (where the town's NOGGLES come from) puffs away behind the far row,
// and at the bottom of town the Dragon Roost sells dragons (dragon/): a
// tower with a perch, a dragon sat on it. Lollipop trees in between.

import * as THREE from 'three';

import { dragonBody, dragonWing, WING_ROOT } from '../dragon/model';
import { noggles } from '../world/landmarks/models';
import { NOUN, sub } from '../world/landmarks/parts';

import { mergeParts } from './cowboy';
import { BLOCK_FONT, box, boxAt, cyl, type SignSpec, type TownBuilder } from './kit';
import {
  SIDEWALK,
  blockAt,
  board,
  door,
  gate,
  gateSigns,
  hash01,
  sidewalks,
  townLandmarks,
  welcomeBoard,
  windows,
} from './weirdKit';

const C = {
  pad: 0xe9e4da,
  walk: 0xd5d7e1,
  curb: 0x9aa0b4,
  street: 0xc8a979,
  glass: 0x1c2a3a,
  trunk: 0x6b4a2b,
  leaf: 0x4bea69,
  leafDark: 0x2fb04c,
} as const;

const WALLS = [
  NOUN.red,
  NOUN.blue,
  NOUN.yellow,
  NOUN.green,
  NOUN.pink,
  NOUN.orange,
  NOUN.purple,
  NOUN.teal,
];
const FRAMES = [NOUN.black, NOUN.red, NOUN.blue, NOUN.white];

/** The Dragon Roost: where the shop prompt is (town coords, far side sidewalk). */
export const ROOST = { vp: 9.4, u: 204 } as const;

export function noggleSigns(): SignSpec[] {
  return [
    ...gateSigns(
      'NOGGLE CITY',
      '⌐◨-◨  SEE THE WORLD DIFFERENTLY  ⌐◨-◨',
      'FISH ↑  ICE CREAM ↑',
      'POP. 6 NOUNS · ∞ SHADES',
      {
        bg: '#e8352b',
        fg: '#fcfcfc',
        accent: '#ffc110',
      },
    ),
    {
      key: 'roost',
      w: 9,
      h: 2,
      bg: '#14131a',
      fg: '#4bea69',
      border: '#9f59ff',
      lines: [
        { text: 'DRAGON ROOST', size: 0.42, y: 0.42, font: BLOCK_FONT },
        { text: 'DRAGONS · 2500 🪙 · E TO BUY', size: 0.2, y: 0.8, color: '#ffc110' },
      ],
    },
    board('lens', 10, 1.6, 'LENS WORKS', '#14131a', '#ffc110', '#ffc110'),
    board('optic', 6, 1.1, 'OPTICIAN', '#2b83f6', '#fcfcfc'),
    board('frames', 6, 1.1, 'FRAMES', '#fcfcfc', '#e8352b'),
    board('tint', 6, 1.1, 'TINT SHOP', '#9f59ff', '#fcfcfc'),
    board('squares', 6, 1.1, '◨ SQUARES ◨', '#ffc110', '#14131a'),
    board('fish', 6, 1.1, 'FISH WANTED', '#2ac7b6', '#14131a'),
    board('pizza', 6, 1.1, 'PIZZA', '#ff7f1f', '#fcfcfc'),
  ];
}

const FRONT_SIGNS = ['optic', 'frames', 'tint', 'squares', 'fish', 'pizza'];

/** Lollipop tree: trunk + a cube canopy and a smaller one on top (instanced). */
export function lollipopGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: number) => {
    const p = g.index !== null ? g.toNonIndexed() : g;
    p.deleteAttribute('uv');
    const col = new THREE.Color(c);
    const n = p.attributes.position.count;
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(ca, i * 3);
    p.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    parts.push(p);
  };
  add(cyl(0.18, 0.24, 3.2, 6), C.trunk);
  add(box(2.6, 2.6, 2.6, 0, 4.3, 0), C.leaf);
  add(box(1.4, 1.4, 1.4, 0.4, 6.1, -0.3), C.leafDark);
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

function frontRow(b: TownBuilder, near: boolean, salt: number) {
  const Lf = b.f.Lf;
  let u = 52;
  let i = 0;
  while (u < Lf - 14) {
    const w = 12 + Math.round(hash01(i, salt) * 6);
    const cu = u + w / 2;
    // The far side's bottom stretch is the Dragon Roost
    if (!near && cu > ROOST.u - 18 && cu < ROOST.u + 18) {
      u = ROOST.u + 20;
      i++;
      continue;
    }
    const h = 9 + Math.round(hash01(i, salt + 1) * 15);
    const wall = WALLS[(i + salt) % WALLS.length];
    const s = {
      u: cu,
      w,
      d: 12,
      h,
      wall,
      sign: FRONT_SIGNS[(i + salt) % FRONT_SIGNS.length],
    };
    const m = blockAt(b, { ...s, sign: undefined }, SIDEWALK.out + 2, near);
    // The noggles facade: lenses for the top floors
    const L = w * 0.235;
    const frame = FRAMES[(i + salt) % FRAMES.length];
    noggles(b, sub(m, L * 0.6, h - L * 0.75, 0.35), L, frame === wall ? NOUN.black : frame, {
      depth: 0.5,
    });
    windows(b, m, w, h - L * 1.5, C.glass, { y0: 3.6, step: 3, size: 1.2 });
    door(b, m, NOUN.black, 0, 2.2, 3);
    b.sign(s.sign, m, 0, 3.6 + 0.0, 0.12, 0.9);
    // Awning
    b.add(boxAt(-w / 2 + 0.6, w / 2 - 0.6, 3.1, 3.3, 0, 1.6), NOUN.white, m);
    u += w + 3;
    i++;
  }
}

function backRow(b: TownBuilder, near: boolean, salt: number) {
  const Lf = b.f.Lf;
  const front = near ? b.f.vmax : b.f.vmax;
  void front;
  let u = 40;
  let i = 0;
  while (u < Lf - 20) {
    const w = 16 + Math.round(hash01(i, salt) * 8);
    const cu = u + w / 2;
    // Lens Works sits in the far back row's middle
    if (!near && cu > 105 && cu < 150) {
      u = 152;
      i++;
      continue;
    }
    const h = 26 + Math.round(hash01(i, salt + 3) * 22);
    const wall = WALLS[(i * 3 + salt) % WALLS.length];
    const m = blockAt(b, { u: cu, w, d: 16, h, wall }, 44, near);
    windows(b, m, w, h, C.glass, { y0: 3, step: 3.4, size: 1.6 });
    // Roof noggles, standing up
    const L = w * 0.2;
    noggles(
      b,
      sub(m, L * 0.5, h + L * 0.6 + 0.4, -6),
      L,
      (i + salt) % 2 === 0 ? NOUN.red : NOUN.black,
      {
        depth: 0.6,
      },
    );
    b.add(box(w - 1, 0.8, 15, 0, h + 0.4, -8), NOUN.grey, m);
    u += w + 6;
    i++;
  }
}

function lensWorks(b: TownBuilder) {
  const m = b.at(40, 128, 0, -1, 0);
  b.add(boxAt(-20, 20, 0, 12, -22, 0), 0x55596b, m, { collide: true });
  // Saw-tooth roof
  for (let x = -18; x < 20; x += 6)
    b.add(
      new THREE.CylinderGeometry(0.01, 3.4, 3, 3)
        .rotateZ(Math.PI / 2)
        .rotateY(Math.PI / 2)
        .translate(x, 13.2, -11),
      NOUN.yellow,
      m,
    );
  for (const [x, h] of [
    [-12, 26],
    [-4, 32],
    [6, 22],
  ])
    b.add(cyl(1.4, 1.8, h, 10, x, h / 2, -17), 0x3b3e4c, m, { collide: true });
  b.sign('lens', m, 0, 8.6, 0.06, 1.6);
  windows(b, m, 38, 7, 0xffc110, { y0: 2, step: 4, size: 2 });
  // A crate of noggles by the loading door
  noggles(b, sub(m, 14, 2.4, 1.6, -0.3), 1.2, NOUN.red, { depth: 0.4 });
  noggles(b, sub(m, 14.5, 1.0, 2.0, 0.2), 1.2, NOUN.blue, { depth: 0.4 });
}

function roost(b: TownBuilder) {
  // Shop front on the far side, the tower behind it, the perch up top
  const m = b.at(SIDEWALK.out + 2, ROOST.u, 0, -1, 0);
  b.add(boxAt(-9, 9, 0, 8, -14, 0), 0x2a2733, m, { collide: true });
  b.add(boxAt(-9.4, 9.4, 8, 8.6, -14.4, 0.4), NOUN.purple, m);
  door(b, m, NOUN.black, 0, 4, 5);
  b.sign('roost', m, 0, 6.4, 0.1, 1.15);
  // Tower + perch
  b.add(boxAt(-4, 4, 8, 26, -12, -4), 0x2a2733, m, { collide: true });
  b.add(boxAt(-7, 7, 26, 27, -15, -1), NOUN.purple, m, { collide: true });
  for (const x of [-6.5, 6.5])
    for (const z of [-14.5, -1.5])
      b.add(cyl(0.12, 0.12, 1.4, 5, x, 27.7, z), NOUN.yellow, m, { bucket: 'thin' });
  // The dragon on the perch, wings half up
  const dm = sub(m, 0, 27, -8, Math.PI * 0.85, 0, 0, 1.3);
  dragonBody(b, dm);
  dragonWing(b, sub(dm, WING_ROOT.x, WING_ROOT.y, WING_ROOT.z, 0, 0, 0.6), 1);
  dragonWing(b, sub(dm, -WING_ROOT.x, WING_ROOT.y, WING_ROOT.z, 0, 0, -0.6), -1);
  // Glowing eggs in a nest by the door
  for (let i = 0; i < 3; i++)
    b.add(
      new THREE.SphereGeometry(0.55, 8, 6).scale(1, 1.3, 1).translate(-6 + i * 1.3, 0.7, 2.2),
      [NOUN.green, NOUN.pink, NOUN.yellow][i],
      m,
      { bucket: 'glow' },
    );
  b.add(cyl(2.4, 2.2, 0.5, 10, -4.7, 0.25, 2.2), 0x8b6a3e, m);
}

export function buildNoggle(b: TownBuilder, ground: (vp: number, u: number) => number) {
  const f = b.f;
  b.decal(SIDEWALK.out, f.vmax - 0.5, 0, f.Lf, C.pad);
  b.decal(f.vmin + 0.5, -SIDEWALK.out, 0, f.Lf, C.pad);
  // Painted lens squares on the plaza at the top of town
  for (const sgn of [-1, 1]) {
    b.decal(sgn * 18 - 5, sgn * 18 + 5, 50, 60, NOUN.white, 0.02);
    b.decal(sgn * 18 - 2.5, sgn * 18 + 5, 52, 58, NOUN.black, 0.025);
  }
  sidewalks(b, C.walk, C.curb, 20);
  gate(b, 12, NOUN.black, NOUN.red);
  welcomeBoard(b, NOUN.black);
  townLandmarks(b, 'noggle');
  frontRow(b, true, 3);
  frontRow(b, false, 11);
  backRow(b, true, 5);
  backRow(b, false, 17);
  lensWorks(b);
  roost(b);
  // Lollipop trees: along the sidewalks between blocks, and out round town
  for (let i = 0; i < 60; i++) {
    const out = i >= 26;
    const sgn = hash01(i, 71) < 0.5 ? -1 : 1;
    const vp = out ? sgn * (b.f.vmax + 8 + hash01(i, 72) * 60) : sgn * (SIDEWALK.out - 0.9);
    const u = out ? -30 + hash01(i, 73) * (f.Lf + 60) : 60 + (i % 13) * 14 + hash01(i, 74) * 3;
    if (!out && u > f.Lf - 12) continue;
    if (!out && sgn > 0 && Math.abs(u - ROOST.u) < 12) continue;
    const y = out ? ground(vp, u) : f.P + 0.22;
    b.plant(vp, u, y - 0.05, hash01(i, 75) * 6.28, 0.9 + hash01(i, 76) * 0.5);
  }
}

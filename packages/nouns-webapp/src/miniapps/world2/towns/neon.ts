// ── Neon Nouns: the city that never sleeps, the end of the +X line's towns ─
//
// Black asphalt, towers 25–70 m tall in night colours, every one striped
// with neon (unlit 'glow' geometry, so it reads at any time of day) and
// lit windows. Billboards on the street front, Boom Tower (a boombox the
// size of a block, world/landmarks) on the near side, the Drip Mill where
// the town's cheap DRIP comes from, and street lamps (instanced).

import * as THREE from 'three';

import { noggles } from '../world/landmarks/models';
import { NOUN, sub } from '../world/landmarks/parts';

import { mergeParts } from './cowboy';
import { BLOCK_FONT, box, boxAt, cyl, type SignSpec, type TownBuilder } from './kit';
import { townYaw } from './site';
import {
  SIDEWALK,
  blockAt,
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
  asphalt: 0x2a2833,
  lane: 0xffc110,
  walk: 0x4a4757,
  curb: 0x77738a,
  pole: 0x1d1c24,
  lamp: 0xfff1b3,
} as const;

const WALLS = [0x1f1b33, 0x2b1f3d, 0x18263a, 0x2e2a3a, 0x1b2d2d, 0x33203a];
const NEONS = [0xff3d8b, 0x2af0ff, 0xffe14d, 0x9dff4a, 0xb05cff, 0xff7a1a];

const neonSign = (key: string, w: number, text: string, color: string): SignSpec => ({
  key,
  w,
  h: w * 0.22,
  bg: '#0d0b14',
  fg: color,
  border: color,
  lines: [{ text, size: 0.56, y: 0.55, font: BLOCK_FONT }],
});

export function neonSigns(): SignSpec[] {
  return [
    ...gateSigns(
      'NEON NOUNS',
      '⌐◨-◨  NO SLEEP · ALL DRIP  ⌐◨-◨',
      'PIZZA ↑↑  FRIES ↑↑',
      'POP. 6 NOUNS · OPEN 24/7',
      {
        bg: '#0d0b14',
        fg: '#ff3d8b',
        accent: '#2af0ff',
      },
    ),
    neonSign('pizza', 7, 'PIZZA 24/7', '#ff7a1a'),
    neonSign('fries', 7, 'FRY DAY', '#ffe14d'),
    neonSign('drip', 7, 'DRIP MILL', '#ff3d8b'),
    neonSign('club', 7, 'CLUB ◨-◨', '#b05cff'),
    neonSign('arcade', 7, 'ARCADE', '#9dff4a'),
    neonSign('hotel', 7, 'HOTEL NOUN', '#2af0ff'),
    neonSign('bb1', 10, 'STAY NOUNISH', '#ff3d8b'),
    neonSign('bb2', 10, 'BID WITH YOUR HEART', '#2af0ff'),
  ];
}

const FRONT_SIGNS = ['pizza', 'fries', 'club', 'arcade', 'hotel'];

/** Street lamp (instanced): pole, arm, glowing-ish head. */
export function lampGeometry(): THREE.BufferGeometry {
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
  add(cyl(0.1, 0.14, 7, 6), C.pole);
  add(box(0.12, 0.12, 1.6, 0, 6.9, 0.7), C.pole);
  add(box(0.5, 0.25, 0.9, 0, 6.7, 1.4), C.lamp);
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

/** Neon trim on a tower: vertical bars at the front corners + bands every few floors. */
function neonTrim(
  b: TownBuilder,
  m: THREE.Matrix4,
  w: number,
  d: number,
  h: number,
  c: number,
  bands: number,
) {
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2])
    b.add(boxAt(x - 0.15, x + 0.15, 1, h - 0.5, 0.02, 0.3), c, m, { bucket: 'glow' });
  const step = h / (bands + 1);
  for (let i = 1; i <= bands; i++) {
    const y = i * step;
    b.add(boxAt(-w / 2, w / 2, y - 0.12, y + 0.12, 0.02, 0.3), c, m, { bucket: 'glow' });
  }
  // Roof edge
  b.add(boxAt(-w / 2, w / 2, h - 0.1, h + 0.25, -d, 0.3), c, m, { bucket: 'glow' });
}

function towers(b: TownBuilder, near: boolean, front: number, salt: number, tall: boolean) {
  const Lf = b.f.Lf;
  let u = tall ? 30 : 46;
  let i = 0;
  while (u < Lf - 16) {
    const w = (tall ? 16 : 12) + Math.round(hash01(i, salt) * (tall ? 10 : 6));
    const cu = u + w / 2;
    // Boom Tower's lot (near side, back row) and the Drip Mill (far side, back row)
    if (tall && near && cu > 130 && cu < 172) {
      u = 174;
      i++;
      continue;
    }
    if (tall && !near && cu > 82 && cu < 120) {
      u = 122;
      i++;
      continue;
    }
    const h = tall
      ? 34 + Math.round(hash01(i, salt + 1) * 38)
      : 10 + Math.round(hash01(i, salt + 1) * 12);
    const d = tall ? 18 : 12;
    const wall = WALLS[(i + salt) % WALLS.length];
    const neon = NEONS[(i * 2 + salt) % NEONS.length];
    const m = blockAt(b, { u: cu, w, d, h, wall }, front, near);
    windows(b, m, w, h, (i + salt) % 3 === 0 ? 0xffe9a8 : 0x9fe8ff, {
      y0: 4,
      step: 3,
      size: 1.1,
      glow: true,
      skip: (a, c) => hash01(a * 31 + c, salt + i) < 0.45,
    });
    neonTrim(b, m, w, d, h, neon, tall ? 3 : 1);
    if (!tall) {
      door(b, m, 0x0d0b14, 0, 2.4, 3);
      b.sign(FRONT_SIGNS[(i + salt) % FRONT_SIGNS.length], m, 0, 4.2, 0.35, 1);
    } else if (i % 3 === 1) {
      // A rooftop billboard
      const bm = sub(m, 0, h + 1, -d / 2);
      for (const x of [-4, 4]) b.add(box(0.3, 3.4, 0.3, x, 1.7, 0), C.pole, bm);
      b.add(box(11, 2.6, 0.4, 0, 4.4, -0.25), 0x0d0b14, bm);
      b.sign(i % 2 === 0 ? 'bb1' : 'bb2', bm, 0, 4.4, 0.0, 1);
    } else if (i % 3 === 2) {
      // Giant neon noggles up the side
      noggles(b, sub(m, w * 0.12, h * 0.7, 0.45), w * 0.22, neon, { depth: 0.3 });
    }
    u += w + (tall ? 4 : 2);
    i++;
  }
}

function dripMill(b: TownBuilder) {
  const m = b.at(36, 100, 0, -1, 0);
  b.add(boxAt(-17, 17, 0, 16, -24, 0), 0x241f33, m, { collide: true });
  neonTrim(b, m, 34, 24, 16, 0xff3d8b, 2);
  b.sign('drip', m, 0, 11.5, 0.35, 2.2);
  // Giant T-shirt on a hanger over the door
  const tm = sub(m, 0, 4.5, 0.6);
  b.add(boxAt(-2.4, 2.4, 0, 4, 0, 0.3), NOUN.pink, tm);
  for (const x of [-1, 1]) b.add(boxAt(x * 2.4, x * 4.0, 2.4, 4, 0, 0.3), NOUN.pink, tm);
  b.add(boxAt(-1, 1, 3.6, 4, 0.29, 0.34), NOUN.yellow, tm);
  door(b, m, 0x0d0b14, 0, 4, 4);
}

export function buildNeon(b: TownBuilder, ground: (vp: number, u: number) => number) {
  const f = b.f;
  b.decal(SIDEWALK.out, f.vmax - 0.5, 0, f.Lf, C.asphalt);
  b.decal(f.vmin + 0.5, -SIDEWALK.out, 0, f.Lf, C.asphalt);
  // Painted parking bays / crossings on the asphalt
  for (let u = 40; u < f.Lf - 20; u += 30)
    for (const sgn of [-1, 1]) b.decal(sgn * 20 - 0.15, sgn * 20 + 0.15, u, u + 18, C.lane, 0.02);
  sidewalks(b, C.walk, C.curb, 20);
  gate(b, 12, 0x0d0b14, 0xff3d8b);
  welcomeBoard(b, 0x0d0b14);
  townLandmarks(b, 'neon');
  towers(b, true, SIDEWALK.out + 2, 2, false);
  towers(b, false, SIDEWALK.out + 2, 9, false);
  towers(b, true, 34, 4, true);
  towers(b, false, 34, 13, true);
  dripMill(b);
  // Street lamps along both sidewalks, facing the street
  for (let u = 24; u < f.Lf - 12; u += 16)
    for (const sgn of [-1, 1]) {
      const vp = sgn * (SIDEWALK.out - 0.6);
      // (plant turns are world yaws: the head points over the street)
      b.plant(vp, u, f.P + 0.22, townYaw(f, -sgn, 0), 1);
    }
  void ground;
}

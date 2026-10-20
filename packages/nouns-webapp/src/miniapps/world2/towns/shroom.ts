// ── Shroom Hollow: a forest town of giant mushrooms, ~22 km down +Z ──────
//
// Past Noun Jersey the +Z line drops into a hollow where everyone lives in
// mushrooms: houses with fat cream stems and spotted caps, a moss-green
// pad, lanterns strung between them (glowing), the town spring (where the
// cheap WATER comes from) and the Elder Shroom, a 40 m mushroom tower,
// behind the far row. Wild giant mushrooms (instanced) fill the woods.

import * as THREE from 'three';

import { noggles } from '../world/landmarks/models';
import { NOUN, sub } from '../world/landmarks/parts';

import { mergeParts } from './cowboy';
import { boxAt, cyl, rod, v3, type SignSpec, type TownBuilder } from './kit';
import {
  SIDEWALK,
  board,
  gate,
  gateSigns,
  hash01,
  sidewalks,
  townLandmarks,
  welcomeBoard,
} from './weirdKit';

const C = {
  moss: 0x6f9e48,
  mossDark: 0x557d36,
  path: 0xb79a6b,
  curb: 0x7d6a4a,
  stem: 0xf3e6c8,
  stemDark: 0xd8c7a1,
  spot: 0xfcfcfc,
  door: 0x6b3f22,
  window: 0xffd36b,
  water: 0x58c7e6,
  rock: 0x8a8f86,
  lantern: 0xffcf5a,
} as const;

const CAPS = [0xd8322b, 0xe8742b, 0x9f59ff, 0xc9469a, 0x3f86d6, 0xd8a72b];

export function shroomSigns(): SignSpec[] {
  return [
    ...gateSigns(
      'SHROOM HOLLOW',
      '🍄  GROW SLOW · STAY WEIRD  🍄',
      'DRIP ↑  NOGGLES ↑  FRIES ↑',
      'POP. 6 NOUNS · 1000 SPORES',
      {
        bg: '#3d5a2a',
        fg: '#f3e6c8',
        accent: '#ff7f1f',
      },
    ),
    board('spring', 6, 1.1, 'THE SPRING', '#58c7e6', '#14131a'),
    board('pizza', 7, 1.1, 'SPORE PIZZA', '#d8322b', '#f3e6c8'),
    board('inn', 6, 1.1, 'THE CAP INN', '#9f59ff', '#f3e6c8'),
    board('tea', 6, 1.1, 'MOSS TEA', '#6f9e48', '#f3e6c8'),
    board('elder', 8, 1.3, 'THE ELDER SHROOM', '#3d2416', '#ffcf5a'),
  ];
}

/** Mushroom house: stem with door + windows, a domed cap with spots. */
function shroomHouse(
  b: TownBuilder,
  m: THREE.Matrix4,
  r: number,
  h: number,
  cap: number,
  sign?: string,
  spots = 7,
) {
  b.add(cyl(r * 0.85, r, h, 12, 0, h / 2, 0), C.stem, m, { collide: true });
  b.add(cyl(r * 1.02, r * 1.06, 0.6, 12, 0, 0.3, 0), C.stemDark, m);
  // Door + round-ish windows on the front (+Z)
  b.add(boxAt(-0.9, 0.9, 0, 2.6, r - 0.05, r + 0.1), C.door, m);
  b.add(
    new THREE.CylinderGeometry(0.9, 0.9, 0.15, 10, 1, false, 0, Math.PI)
      .rotateX(Math.PI / 2)
      .rotateZ(Math.PI / 2)
      .translate(0, 2.6, r + 0.03),
    C.door,
    m,
  );
  for (const [x, y] of [
    [-r * 0.5, h * 0.55],
    [r * 0.45, h * 0.7],
  ])
    b.add(
      new THREE.CylinderGeometry(0.55, 0.55, 0.2, 8).rotateX(Math.PI / 2).translate(x, y, r * 0.9),
      C.window,
      m,
      {
        bucket: 'glow',
      },
    );
  // Cap: a squashed dome + a flat underside (gills)
  const R = r * 2.3;
  b.add(
    new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 0.62, 1)
      .translate(0, h, 0),
    cap,
    m,
    {
      collide: true,
    },
  );
  b.add(cyl(R, R * 0.4, 0.5, 16, 0, h - 0.25, 0), 0xe9d6b8, m);
  for (let i = 0; i < spots; i++) {
    const a = hash01(i, r * 100) * Math.PI * 2;
    const t = 0.25 + hash01(i, h * 7) * 0.55;
    const sx = Math.cos(a) * R * t;
    const sz = Math.sin(a) * R * t;
    const sy = h + R * 0.62 * Math.sqrt(Math.max(0, 1 - t * t));
    b.add(
      new THREE.SphereGeometry(R * 0.13, 5, 3).scale(1, 0.35, 1).translate(sx, sy, sz),
      C.spot,
      m,
    );
  }
  if (sign !== undefined) b.sign(sign, m, 0, 3.4, r + 0.12, 0.85);
}

/** Wild giant mushroom (instanced): stem + cap, two tones. */
export function giantMushroomGeometry(): THREE.BufferGeometry {
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
  add(cyl(0.55, 0.7, 4, 8), C.stem);
  add(
    new THREE.SphereGeometry(2.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 0.6, 1)
      .translate(0, 4, 0),
    0xd8322b,
  );
  add(cyl(2.2, 0.8, 0.3, 10, 0, 3.9, 0), 0xe9d6b8);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(
      new THREE.SphereGeometry(0.3, 5, 3)
        .scale(1, 0.4, 1)
        .translate(Math.cos(a) * 1.3, 5.0, Math.sin(a) * 1.3),
      C.spot,
    );
  }
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

function lanterns(b: TownBuilder, Lf: number) {
  // Strings across the street every 24 m, lanterns glowing under them
  for (let u = 30; u < Lf - 20; u += 24) {
    const a = v3(-SIDEWALK.out + 0.5, 7, 0);
    const z = v3(SIDEWALK.out - 0.5, 7, 0);
    const m = b.at(0, u, 0, 1, 0);
    for (const x of [-SIDEWALK.out + 0.5, SIDEWALK.out - 0.5])
      b.add(cyl(0.12, 0.14, 7.2, 5, x, 3.6, 0), C.door, m, { bucket: 'thin' });
    b.add(rod(a, z, 0.03, 3), 0x2b2b2b, m, { bucket: 'thin' });
    for (let x = -8; x <= 8; x += 2.7) {
      const sag = 6.6 - 0.35 * (1 - (x / 10) ** 2);
      b.add(
        new THREE.SphereGeometry(0.32, 6, 4).translate(x, sag, 0),
        x % 2 === 0 ? C.lantern : 0xff8fb8,
        m,
        {
          bucket: 'glow',
        },
      );
    }
  }
}

function spring(b: TownBuilder) {
  const m = b.at(-26, 70, 0, 1, 0);
  b.add(cyl(7, 7.4, 0.9, 16, 0, 0.45, 0), C.rock, m, { collide: true });
  b.add(cyl(6.2, 6.2, 0.2, 16, 0, 0.82, 0), C.water, m);
  b.add(cyl(0.8, 1.2, 3.4, 8, 0, 1.7, 0), C.rock, m, { collide: true });
  b.add(new THREE.SphereGeometry(1.0, 8, 6).translate(0, 3.8, 0), C.water, m, { bucket: 'glow' });
  b.sign('spring', m, 0, 1.6, 7.45, 0.9);
  // A frog sat on the rim, in noggles
  b.add(
    new THREE.SphereGeometry(0.7, 8, 6).scale(1.2, 0.8, 1).translate(4.8, 1.4, 4.6),
    0x4bea69,
    m,
  );
  noggles(b, sub(m, 5.0, 1.75, 5.35, 0.6), 0.32, NOUN.red, { depth: 0.12 });
}

function elder(b: TownBuilder) {
  const m = b.at(54, 150, 0, -1, 0);
  shroomHouse(b, m, 5.2, 32, 0xd8322b, undefined, 14);
  b.sign('elder', m, 0, 4.2, 5.35, 1.1);
  // Balcony rings up the stem
  for (const y of [12, 22]) b.add(cyl(6.4, 6.4, 0.4, 14, 0, y, 0), 0x8b6a3e, m, { collide: true });
}

const SIGNED = ['pizza', 'inn', 'tea'];

export function buildShroom(b: TownBuilder, ground: (vp: number, u: number) => number) {
  const f = b.f;
  b.decal(SIDEWALK.out, f.vmax - 0.5, 0, f.Lf, C.moss);
  b.decal(f.vmin + 0.5, -SIDEWALK.out, 0, f.Lf, C.moss);
  for (const [v0, v1, u0, u1] of [
    [16, 44, 90, 120],
    [-60, -30, 150, 200],
    [30, 60, 30, 60],
  ])
    b.decal(v0, v1, u0, u1, C.mossDark, 0.02);
  sidewalks(b, C.path, C.curb, 20);
  gate(b, 12, 0x6b4a2b, 0x9f59ff);
  welcomeBoard(b, 0x6b4a2b);
  townLandmarks(b, 'shroom');
  lanterns(b, f.Lf);
  spring(b);
  elder(b);
  // Houses: a front row each side (facing the street), a scattered back row
  let k = 0;
  for (const near of [true, false]) {
    for (let u = 40, i = 0; u < f.Lf - 16; i++) {
      const r = 2.6 + hash01(i, near ? 3 : 4) * 1.6;
      const h = 6 + hash01(i, near ? 5 : 6) * 7;
      const vp = (near ? -1 : 1) * (SIDEWALK.out + 2.4 + r);
      if (!near || Math.abs(u - 70) > 14) {
        const m = b.at(vp, u, 0, near ? 1 : -1, 0);
        shroomHouse(
          b,
          m,
          r,
          h,
          CAPS[(i + (near ? 0 : 3)) % CAPS.length],
          i % 3 === 0 ? SIGNED[k++ % 3] : undefined,
        );
      }
      u += r * 4.6 + 4;
    }
    for (let i = 0; i < 9; i++) {
      const r = 2.6 + hash01(i, near ? 9 : 10) * 1.8;
      const h = 9 + hash01(i, near ? 11 : 12) * 10;
      const vp = (near ? -1 : 1) * (30 + hash01(i, near ? 13 : 14) * (near ? 12 : 24));
      const u = 30 + i * ((f.Lf - 50) / 8);
      if (!near && Math.abs(u - 150) < 20 && vp > 34) continue;
      const m = b.at(vp, u, 0, near ? 1 : -1, 0);
      shroomHouse(b, m, r, h, CAPS[(i * 2 + 1) % CAPS.length]);
    }
  }
  // Wild giant mushrooms on the pad's edges and out in the woods
  for (let i = 0; i < 70; i++) {
    const out = i >= 30;
    const sgn = hash01(i, 81) < 0.5 ? -1 : 1;
    const span = sgn < 0 ? -f.vmin : f.vmax;
    const vp = out ? sgn * (span + 6 + hash01(i, 82) * 70) : sgn * (span - 8 - hash01(i, 83) * 10);
    const u = out ? -40 + hash01(i, 84) * (f.Lf + 80) : 10 + hash01(i, 85) * (f.Lf - 20);
    const y = out ? ground(vp, u) : f.P;
    b.plant(vp, u, y - 0.1, hash01(i, 86) * 6.28, 0.8 + hash01(i, 87) * 1.6);
  }
}

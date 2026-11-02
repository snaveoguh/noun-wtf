// ── Road trip props: trucks, pumps, canopies, motels, cabins, signs ──────
//
// Every prop is built in its own local frame (+Z = its front, y up from the
// ground it stands on) under a matrix from TownBuilder.at / look.on, like
// the town kits. Plain boxes and cylinders, vertex coloured, merged by the
// builder; only the big solid bits collide.

import * as THREE from 'three';

import { noggles } from '../../world/landmarks/models';
import { NOUN, sub } from '../../world/landmarks/parts';
import { mergeParts } from '../cowboy';
import { box, boxAt, cyl, prismX, rod, v3, type TownBuilder } from '../kit';

export const ROAD_C = {
  asphalt: 0x3a3a40,
  asphaltLight: 0x55555c,
  line: 0xf2f2ea,
  yellow: 0xffc110,
  concrete: 0xb9b6ad,
  curb: 0x8f8c84,
  steel: 0x9aa0a6,
  darkSteel: 0x4a4f55,
  tyre: 0x1c1c1f,
  glass: 0x2b3640,
  glassLit: 0xffe9a8,
  white: 0xf1efe8,
  red: NOUN.red,
  blue: NOUN.blue,
  green: 0x2f8a4a,
  signGreen: 0x1f6b3a,
  wood: 0x8a5a34,
  woodDark: 0x5e3b20,
  roofRed: 0xa8452f,
  pine: 0x2f5d3a,
  snow: 0xf4f7fa,
} as const;

const C = ROAD_C;

/** A wheel (axle along local x) centred at (x, y, z). */
function wheel(r: number, w: number, x: number, y: number, z: number) {
  return cyl(r, r, w, 10, 0, 0, 0)
    .rotateZ(Math.PI / 2)
    .translate(x, y, z);
}

/** A semi: cab at +z, trailer behind (≈ 16.5 m long, local z from −12.5 to 4). */
export function semi(
  b: TownBuilder,
  m: THREE.Matrix4,
  cab: number,
  trailer: number,
  opts: { trailer?: boolean; stripe?: number; collide?: boolean } = {},
) {
  const collide = opts.collide ?? true;
  // Cab: sleeper box, hood, bumper, windscreen, stacks
  b.add(boxAt(-1.25, 1.25, 1.0, 3.6, -0.6, 1.6), cab, m, { collide });
  b.add(boxAt(-1.2, 1.2, 1.0, 2.5, 1.6, 3.7), cab, m, { collide });
  b.add(boxAt(-1.3, 1.3, 0.6, 1.1, 3.6, 4.0), C.steel, m);
  b.add(boxAt(-1.05, 1.05, 2.6, 3.3, 1.58, 1.62), C.glass, m);
  for (const x of [-1.32, 1.32]) b.add(cyl(0.09, 0.09, 2.6, 6, x, 2.3, -0.4), C.steel, m);
  // Chassis + wheels
  b.add(boxAt(-0.6, 0.6, 0.55, 0.95, -12.2, 3.6), C.darkSteel, m);
  for (const z of [2.8, -1.4, -2.8])
    for (const x of [-1.05, 1.05]) b.add(wheel(0.55, 0.5, x, 0.55, z), C.tyre, m);
  if (opts.trailer !== false) {
    b.add(boxAt(-1.3, 1.3, 1.2, 4.0, -12.5, -0.9), trailer, m, { collide });
    if (opts.stripe !== undefined) b.add(boxAt(-1.32, 1.32, 2.0, 2.4, -12.4, -1.0), opts.stripe, m);
    for (const z of [-10.6, -11.9])
      for (const x of [-1.05, 1.05]) b.add(wheel(0.55, 0.5, x, 0.55, z), C.tyre, m);
  }
}

/** A pickup truck (≈ 5.2 m, local z −2.6 … 2.6). */
export function pickup(b: TownBuilder, m: THREE.Matrix4, color: number) {
  b.add(boxAt(-0.95, 0.95, 0.45, 1.25, -2.6, 2.6), color, m, { collide: true });
  b.add(boxAt(-0.9, 0.9, 1.25, 2.0, 0.0, 1.6), color, m, { collide: true });
  b.add(boxAt(-0.85, 0.85, 1.35, 1.9, 1.58, 1.62), C.glass, m);
  for (const z of [-1.7, 1.7])
    for (const x of [-0.92, 0.92]) b.add(wheel(0.42, 0.32, x, 0.42, z), C.tyre, m);
}

/** A hatchback (≈ 4 m). */
export function car(b: TownBuilder, m: THREE.Matrix4, color: number) {
  b.add(boxAt(-0.85, 0.85, 0.35, 1.0, -2.0, 2.0), color, m, { collide: true });
  b.add(boxAt(-0.8, 0.8, 1.0, 1.55, -1.5, 0.9), color, m);
  b.add(boxAt(-0.75, 0.75, 1.05, 1.5, 0.88, 0.92), C.glass, m);
  for (const z of [-1.3, 1.3])
    for (const x of [-0.82, 0.82]) b.add(wheel(0.33, 0.25, x, 0.33, z), C.tyre, m);
}

/** A gas pump on its island slot. */
export function pump(b: TownBuilder, m: THREE.Matrix4, color: number) {
  b.add(boxAt(-0.42, 0.42, 0, 1.75, -0.28, 0.28), C.white, m, { collide: true });
  b.add(boxAt(-0.44, 0.44, 1.75, 2.05, -0.3, 0.3), color, m);
  b.add(boxAt(-0.3, 0.3, 1.05, 1.5, 0.28, 0.31), 0x1b2a33, m);
  b.add(boxAt(-0.3, 0.3, 1.2, 1.4, 0.31, 0.32), 0x7cf2c8, m, { bucket: 'glow' });
  b.add(rod(v3(0.46, 1.5, 0), v3(0.6, 0.6, 0.2), 0.04), C.tyre, m, { bucket: 'thin' });
}

/** A pump island (curb + pumps along local x). */
export function pumpIsland(
  b: TownBuilder,
  m: THREE.Matrix4,
  len: number,
  n: number,
  color: number,
) {
  b.add(boxAt(-len / 2, len / 2, 0, 0.18, -0.6, 0.6), C.concrete, m, { collide: true });
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len * (i + 0.5)) / n;
    pump(b, sub(m, x, 0.18, 0), color);
    // Bollards at the ends
  }
  for (const x of [-len / 2 + 0.25, len / 2 - 0.25])
    b.add(cyl(0.12, 0.12, 1, 6, x, 0.68, 0), C.yellow, m);
}

/**
 * Canopy over the pumps: posts on a grid, a slab roof (you can land on it),
 * a coloured fascia band and a lit underside. w across, d deep, roof at h.
 */
export function canopy(
  b: TownBuilder,
  m: THREE.Matrix4,
  w: number,
  d: number,
  h: number,
  fascia: number,
  postsX: number[],
) {
  for (const x of postsX)
    for (const z of [-d / 2 + 2, d / 2 - 2])
      b.add(boxAt(x - 0.25, x + 0.25, 0, h, z - 0.25, z + 0.25), C.white, m, { collide: true });
  b.add(boxAt(-w / 2, w / 2, h, h + 0.9, -d / 2, d / 2), C.white, m, { collide: true });
  for (const z of [-d / 2 - 0.02, d / 2 + 0.02])
    b.add(boxAt(-w / 2, w / 2, h + 0.15, h + 0.75, z - 0.01, z + 0.01), fascia, m);
  for (const x of [-w / 2 - 0.02, w / 2 + 0.02])
    b.add(boxAt(x - 0.01, x + 0.01, h + 0.15, h + 0.75, -d / 2, d / 2), fascia, m);
  // Lights under the roof
  for (let x = -w / 2 + 3; x <= w / 2 - 3; x += 4)
    b.add(boxAt(x - 0.8, x + 0.8, h - 0.04, h, -0.3, 0.3), 0xfff6d8, m, { bucket: 'glow' });
}

/** A tall pole sign (brand + prices): pole, cabinet, sign face both ways. */
export function pylon(
  b: TownBuilder,
  m: THREE.Matrix4,
  key: string,
  h: number,
  w: number,
  sh: number,
) {
  b.add(boxAt(-0.3, 0.3, 0, h - sh, -0.3, 0.3), C.darkSteel, m, { collide: true });
  b.add(boxAt(-w / 2 - 0.15, w / 2 + 0.15, h - sh - 0.15, h + 0.15, -0.35, 0.35), C.darkSteel, m);
  b.sign(key, m, 0, h - sh / 2, 0.37);
  b.sign(key, sub(m, 0, 0, 0, Math.PI), 0, h - sh / 2, 0.37);
}

/** A flat-roofed shop: body, glass front, door, awning, sign over the door. */
export function shop(
  b: TownBuilder,
  m: THREE.Matrix4,
  w: number,
  d: number,
  h: number,
  wall: number,
  trim: number,
  key: string,
) {
  b.add(boxAt(-w / 2, w / 2, 0, h, -d, 0), wall, m, { collide: true });
  b.add(boxAt(-w / 2 - 0.1, w / 2 + 0.1, h, h + 0.5, -d - 0.1, 0.25), trim, m);
  b.add(boxAt(-w / 2 + 0.8, w / 2 - 0.8, 0.5, 2.6, 0, 0.06), C.glass, m);
  b.add(boxAt(-0.9, 0.9, 0, 2.5, 0.06, 0.12), 0x1b2228, m);
  b.add(boxAt(-w / 2, w / 2, 2.9, 3.05, 0, 1.6), trim, m);
  b.sign(key, m, 0, h - 0.85, 0.27);
}

/**
 * A motel: one long storey of rooms facing +Z, a walkway roof on posts, a
 * door + window per room, and its pole sign at the end.
 */
export function motel(
  b: TownBuilder,
  m: THREE.Matrix4,
  rooms: number,
  wall: number,
  doorC: number,
  key: string,
) {
  const rw = 4.2;
  const w = rooms * rw;
  b.add(boxAt(-w / 2, w / 2, 0, 3.4, -9, 0), wall, m, { collide: true });
  b.add(boxAt(-w / 2 - 0.3, w / 2 + 0.3, 3.4, 3.8, -9.3, 2.4), C.roofRed, m, { collide: true });
  b.add(boxAt(-w / 2, w / 2, 0, 0.15, 0, 2.4), C.concrete, m, { collide: true });
  for (let i = 0; i < rooms; i++) {
    const x = -w / 2 + rw * (i + 0.5);
    b.add(boxAt(x - 1.5, x - 0.5, 0.15, 2.3, 0.0, 0.08), doorC, m);
    b.add(boxAt(x + 0.1, x + 1.6, 1.0, 2.1, 0.0, 0.07), i % 3 === 1 ? C.glassLit : C.glass, m, {
      bucket: i % 3 === 1 ? 'glow' : 'solid',
    });
  }
  for (let x = -w / 2 + 0.3; x <= w / 2; x += rw)
    b.add(boxAt(x - 0.1, x + 0.1, 0.15, 3.4, 2.15, 2.35), C.white, m);
  b.sign(key, m, 0, 2.9, 0.1, 0.9);
}

/** A diner: a rounded-ish chrome box with a stripe, big windows, sign on the roof. */
export function diner(b: TownBuilder, m: THREE.Matrix4, w: number, stripe: number, key: string) {
  const d = 9;
  b.add(boxAt(-w / 2, w / 2, 0, 4.2, -d, 0), 0xd8dde2, m, { collide: true });
  b.add(boxAt(-w / 2 - 0.05, w / 2 + 0.05, 1.0, 1.4, -d - 0.05, 0.05), stripe, m);
  b.add(boxAt(-w / 2 + 1, w / 2 - 1, 1.6, 3.2, 0, 0.06), C.glassLit, m, { bucket: 'glow' });
  b.add(boxAt(-1, 1, 0, 2.6, 0.06, 0.14), 0x2a2f36, m);
  b.add(boxAt(-w / 2 - 0.2, w / 2 + 0.2, 4.2, 4.6, -d - 0.2, 0.4), stripe, m);
  for (const x of [-w / 2 + 1.5, w / 2 - 1.5])
    b.add(boxAt(x - 0.12, x + 0.12, 4.6, 6.2, -1.2, -1), C.darkSteel, m);
  b.add(boxAt(-w / 2 + 1.2, w / 2 - 1.2, 5.6, 7.6, -1.25, -1.0), 0x15181c, m);
  b.sign(key, m, 0, 6.6, -0.98);
}

/** An A-frame chalet (front +Z, ridge along z). */
export function aframe(
  b: TownBuilder,
  m: THREE.Matrix4,
  w: number,
  d: number,
  h: number,
  wall: number,
  roof: number,
  key?: string,
) {
  // Walls stand clear inside the roof slopes (and read as a building: interiors/townDoors.ts)
  b.add(boxAt(-w / 2 + 1.6, w / 2 - 1.6, 0, 3.2, -d, 0), wall, m, { collide: true });
  // The roof: two slopes, eaves to the ground-ish
  const half = w / 2 + 0.5;
  const g = new THREE.BufferGeometry();
  const P = (x: number, y: number, z: number) => [x, y, z];
  const zs = [0.6, -d - 0.6];
  const pts: number[] = [];
  for (const s of [-1, 1]) {
    const a = P(s * half, 1.2, zs[0]);
    const bb = P(s * half, 1.2, zs[1]);
    const c = P(0, h, zs[0]);
    const dd = P(0, h, zs[1]);
    if (s < 0) pts.push(...a, ...c, ...bb, ...bb, ...c, ...dd);
    else pts.push(...a, ...bb, ...c, ...c, ...bb, ...dd);
  }
  // Thickness: duplicate flipped for the underside
  const under = pts.slice();
  for (let i = 0; i < under.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = under[i + 3 + k];
      under[i + 3 + k] = under[i + 6 + k];
      under[i + 6 + k] = t;
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pts, ...under], 3));
  g.computeVertexNormals();
  b.add(g, roof, m, { collide: true });
  // Gable front: glass triangle-ish (stacked bars) + door
  for (let y = 2.8; y < h - 1.2; y += 1.1) {
    const hw = half * (1 - (y - 1.2) / (h - 1.2)) - 0.5;
    if (hw > 0.4) b.add(boxAt(-hw, hw, y, y + 0.8, 0, 0.05), C.glassLit, m, { bucket: 'glow' });
  }
  b.add(boxAt(-0.8, 0.8, 0, 2.3, 0.0, 0.1), C.woodDark, m);
  if (key !== undefined) b.sign(key, m, 0, 2.3 + 0.55, 0.12, 0.8);
}

/** A log cabin: stacked log walls, a pitched roof, a porch. */
export function cabin(
  b: TownBuilder,
  m: THREE.Matrix4,
  w: number,
  d: number,
  wall: number,
  roof: number,
  key?: string,
) {
  b.add(boxAt(-w / 2, w / 2, 0, 3.2, -d, 0), wall, m, { collide: true });
  for (let y = 0.4; y < 3.2; y += 0.55)
    b.add(boxAt(-w / 2 - 0.08, w / 2 + 0.08, y, y + 0.1, -d - 0.08, 0.08), C.woodDark, m);
  b.add(
    prismX(
      [
        [1.2, 3.0],
        [-d / 2, 5.6],
        [-d - 0.6, 3.0],
      ],
      w + 0.8,
    ),
    roof,
    m,
    { collide: true },
  );
  b.add(boxAt(-w / 2, w / 2, 0, 0.3, 0, 1.6), C.wood, m, { collide: true });
  b.add(boxAt(-0.7, 0.7, 0.3, 2.4, 0, 0.08), C.woodDark, m);
  for (const x of [-1.8, 1.8])
    b.add(boxAt(x - 0.6, x + 0.6, 1.1, 2.1, 0, 0.07), C.glassLit, m, { bucket: 'glow' });
  if (key !== undefined) b.sign(key, m, 0, 2.75, 0.1, 0.8);
}

/** A water tower: legs, tank, the town's name on it. */
export function waterTower(b: TownBuilder, m: THREE.Matrix4, tank: number, key: string) {
  for (const [x, z] of [
    [-2.2, -2.2],
    [2.2, -2.2],
    [-2.2, 2.2],
    [2.2, 2.2],
  ] as const)
    b.add(rod(v3(x, 0, z), v3(x * 0.6, 12, z * 0.6), 0.18), C.darkSteel, m, { bucket: 'thin' });
  b.add(cyl(2.4, 2.4, 0.4, 12, 0, 0, 0).translate(0, 0, 0), C.darkSteel, m, { collide: true });
  b.add(cyl(3.2, 3.2, 5, 14, 0, 12 + 2.5, 0), tank, m, { collide: true });
  b.add(cyl(0.2, 3.4, 1.6, 14, 0, 17.8, 0), tank, m);
  b.sign(key, m, 0, 14.6, 3.25, 0.9);
}

/** A picnic table (local x along its length). */
export function picnic(b: TownBuilder, m: THREE.Matrix4) {
  b.add(boxAt(-1, 1, 0.72, 0.8, -0.4, 0.4), C.wood, m, { collide: true });
  for (const z of [-0.75, 0.75]) b.add(boxAt(-1, 1, 0.42, 0.48, z - 0.15, z + 0.15), C.wood, m);
  for (const x of [-0.8, 0.8]) b.add(boxAt(x - 0.06, x + 0.06, 0, 0.72, -0.5, 0.5), C.woodDark, m);
}

/** A shade shelter over picnic tables. */
export function shelter(b: TownBuilder, m: THREE.Matrix4, roof: number) {
  for (const x of [-3, 3])
    for (const z of [-2, 2])
      b.add(boxAt(x - 0.12, x + 0.12, 0, 2.8, z - 0.12, z + 0.12), C.wood, m);
  b.add(
    prismX(
      [
        [2.8, 2.7],
        [0, 3.7],
        [-2.8, 2.7],
      ],
      7.4,
    ),
    roof,
    m,
    { collide: true },
  );
  picnic(b, sub(m, -1.5, 0, 0));
  picnic(b, sub(m, 1.7, 0, 0));
}

/** A street lamp (pole + arm + lit head), arm toward local +Z. */
export function lamp(b: TownBuilder, m: THREE.Matrix4, h = 7) {
  b.add(cyl(0.1, 0.14, h, 6), C.darkSteel, m, { bucket: 'thin' });
  b.add(box(0.12, 0.12, 1.6, 0, h - 0.1, 0.7), C.darkSteel, m, { bucket: 'thin' });
  b.add(box(0.5, 0.2, 0.9, 0, h - 0.3, 1.4), 0xfff1b3, m, { bucket: 'glow' });
}

/** A billboard: two legs, a frame, the face (`key`) toward local +Z, a catwalk. */
export function billboard(
  b: TownBuilder,
  m: THREE.Matrix4,
  key: string,
  w: number,
  h: number,
  leg: number,
) {
  for (const x of [-w * 0.3, w * 0.3])
    b.add(boxAt(x - 0.25, x + 0.25, -2, leg + h * 0.5, -0.6, -0.1), C.darkSteel, m, {
      collide: true,
    });
  b.add(boxAt(-w / 2 - 0.2, w / 2 + 0.2, leg - 0.2, leg + h + 0.2, -0.3, -0.05), C.white, m);
  b.add(boxAt(-w / 2, w / 2, leg - 0.4, leg - 0.3, -0.1, 0.9), C.darkSteel, m, { bucket: 'thin' });
  b.sign(key, m, 0, leg + h / 2, 0.0);
}

/** A big Noun head on a pole: the truck stops' roadside landmark. */
export function nounHead(
  b: TownBuilder,
  m: THREE.Matrix4,
  head: number,
  glasses: number,
  size: number,
) {
  b.add(boxAt(-0.5, 0.5, 0, size * 2.2, -0.5, 0.5), C.darkSteel, m, { collide: true });
  const hm = sub(m, 0, size * 2.2, 0);
  b.add(boxAt(-size / 2, size / 2, 0, size, -size / 2, size / 2), head, hm, { collide: true });
  noggles(b, sub(hm, 0, size * 0.62, size / 2 + 0.05), size * 0.95, glasses, {
    depth: size * 0.12,
  });
}

/** A snowman (≈ 2.4 m). */
export function snowman(b: TownBuilder, m: THREE.Matrix4) {
  b.add(new THREE.SphereGeometry(0.8, 8, 6).translate(0, 0.75, 0), C.snow, m, { collide: true });
  b.add(new THREE.SphereGeometry(0.6, 8, 6).translate(0, 1.85, 0), C.snow, m);
  b.add(new THREE.SphereGeometry(0.42, 8, 6).translate(0, 2.65, 0), C.snow, m);
  b.add(
    cyl(0.02, 0.08, 0.5, 5, 0, 0, 0)
      .rotateX(Math.PI / 2)
      .translate(0, 2.65, 0.6),
    NOUN.orange,
    m,
  );
  noggles(b, sub(m, 0, 2.75, 0.43), 0.75, NOUN.red, { depth: 0.08 });
}

/** A canoe on the ground / a dock (≈ 5 m along local z). */
export function canoe(b: TownBuilder, m: THREE.Matrix4, color: number) {
  b.add(boxAt(-0.42, 0.42, 0.05, 0.42, -1.9, 1.9), color, m);
  for (const z of [-1, 1])
    b.add(
      cyl(0, 0.42, 0.7, 4, 0, 0, 0)
        .rotateX((z * Math.PI) / 2)
        .translate(0, 0.25, z * 2.2),
      color,
      m,
    );
}

/** Instanced pine (cone tiers on a trunk); `snow` caps the tiers white. */
export function pineGeometry(snow: boolean): THREE.BufferGeometry {
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
  add(cyl(0.22, 0.3, 2.2, 6), 0x5a3b22);
  const tiers: [number, number, number][] = [
    [2.6, 3.0, 1.4],
    [2.0, 2.6, 3.0],
    [1.3, 2.2, 4.5],
  ];
  for (const [r, h, y] of tiers) {
    add(cyl(0, r, h, 7, 0, y + h / 2, 0), ROAD_C.pine);
    if (snow) add(cyl(0, r * 0.55, h * 0.5, 7, 0, y + h * 0.75 + 0.05, 0), ROAD_C.snow);
  }
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

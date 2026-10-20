// ── Crater Lil: a meteor-crater town past the Noggle Bowl (−X, ~45 km) ───
//
// Main street runs across the floor of an old impact crater: a ring of
// tumbled boulders round the pad, domed habitats in white and orange,
// radio dishes pointed up, glowing crystal clusters (instanced), the
// Landed Saucer (world/landmarks) on the far side, and above it all the Lil
// archipelago: little grassy islands, each with a tiny house and a lil
// Noun's noggles, hovering 30–50 m up and bobbing (TownExtras animates them).

import type { TownExtras } from './weird';
import type { ChunkContext } from '../world/mountain/MountainStream';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { toonify } from '../render/Toon';
import { noggles } from '../world/landmarks/models';
import { NOUN, PartBuilder, sub } from '../world/landmarks/parts';

import { mergeParts } from './cowboy';
import { boxAt, cyl, rod, v3, type SignSpec, type TownBuilder } from './kit';
import {
  SIDEWALK,
  board,
  door,
  gate,
  gateSigns,
  hash01,
  sidewalks,
  townLandmarks,
  welcomeBoard,
} from './weirdKit';

const C = {
  regolith: 0xc98f5e,
  regolithDark: 0xa86f44,
  walk: 0x9b8f86,
  curb: 0x6b625c,
  rock: 0x7d6c63,
  rockDark: 0x5e5049,
  dome: 0xf2f0ea,
  domeBand: 0xff7f1f,
  glass: 0x7fd7ff,
  dish: 0xe6e6ee,
  crystal: 0xb05cff,
  crystal2: 0x2af0ff,
  grass: 0x6fd36a,
  dirt: 0x8a6a4a,
} as const;

export function craterSigns(): SignSpec[] {
  return [
    ...gateSigns(
      'CRATER LIL',
      '☄  IT CAME FROM SPACE  ☄',
      'WATER ↑↑↑  ICE CREAM ↑↑',
      'POP. 6 NOUNS · 1 SAUCER',
      {
        bg: '#3a2a4a',
        fg: '#ffe9c9',
        accent: '#ff7f1f',
      },
    ),
    board('lens', 7, 1.1, 'METEOR GLASS', '#14131a', '#2af0ff'),
    board('hab', 6, 1.1, 'HAB 1', '#ff7f1f', '#fcfcfc'),
    board('labs', 6, 1.1, 'LIL LABS', '#9f59ff', '#fcfcfc'),
    board('h2o', 7, 1.1, 'WATER WANTED', '#2b83f6', '#fcfcfc'),
  ];
}

/** Crystal cluster (instanced): three tilted prisms. */
export function crystalGeometry(): THREE.BufferGeometry {
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
  add(new THREE.ConeGeometry(0.55, 3.2, 5).translate(0, 1.5, 0), C.crystal);
  add(new THREE.ConeGeometry(0.4, 2.2, 5).rotateZ(0.5).translate(0.7, 0.9, 0.2), C.crystal2);
  add(
    new THREE.ConeGeometry(0.35, 1.8, 5).rotateZ(-0.6).rotateY(1).translate(-0.6, 0.7, -0.3),
    C.crystal,
  );
  add(new THREE.DodecahedronGeometry(0.7, 0).scale(1.3, 0.5, 1).translate(0, 0.1, 0), C.rockDark);
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

function dome(b: TownBuilder, m: THREE.Matrix4, r: number, sign?: string) {
  b.add(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.dome, m, {
    collide: true,
  });
  b.add(cyl(r + 0.05, r + 0.05, 0.6, 16, 0, r * 0.32, 0), C.domeBand, m);
  // Airlock porch on the front
  b.add(boxAt(-1.4, 1.4, 0, 2.8, r - 0.6, r + 1.6), C.dome, m, { collide: true });
  door(b, sub(m, 0, 0, r + 1.62), C.rockDark, 0, 1.6, 2.4);
  b.add(
    new THREE.SphereGeometry(r * 0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(
      0,
      r * 0.93,
      0,
    ),
    C.glass,
    m,
  );
  if (sign !== undefined) b.sign(sign, m, 0, 3.4, r + 1.7, 0.85);
}

function dish(b: TownBuilder, m: THREE.Matrix4) {
  b.add(cyl(0.4, 0.6, 5, 8, 0, 2.5, 0), C.rock, m, { collide: true });
  b.add(
    new THREE.SphereGeometry(4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3)
      .rotateX(Math.PI)
      .rotateX(-0.6)
      .translate(0, 7.6, 0.4),
    C.dish,
    m,
  );
  b.add(rod(v3(0, 5.6, 0.2), v3(0, 8.8, 2.4), 0.08, 4), C.rock, m, { bucket: 'thin' });
  b.add(new THREE.SphereGeometry(0.3, 6, 4).translate(0, 8.9, 2.5), NOUN.red, m, {
    bucket: 'glow',
  });
}

/** Boulders round the pad's rim: the crater wall. */
function rim(b: TownBuilder) {
  const f = b.f;
  const ring: [number, number][] = [];
  for (let u = -10; u <= f.Lf + 10; u += 9) {
    ring.push([f.vmin - 2, u]);
    ring.push([f.vmax + 2, u]);
  }
  for (let v = f.vmin; v <= f.vmax; v += 9) {
    if (Math.abs(v) < 14) continue; // keep the street open at both ends
    ring.push([v, -8]);
    ring.push([v, f.Lf + 8]);
  }
  ring.forEach(([vp, u], i) => {
    const s = 3 + hash01(i, 91) * 4;
    const g = new THREE.DodecahedronGeometry(s, 0).scale(1.3, 0.75 + hash01(i, 92) * 0.6, 1.1);
    b.add(g, i % 3 === 0 ? C.rockDark : C.rock, b.at(vp, u, s * 0.25, hash01(i, 93) - 0.5, 1), {
      collide: true,
    });
  });
}

export function buildCrater(b: TownBuilder, ground: (vp: number, u: number) => number) {
  const f = b.f;
  b.decal(SIDEWALK.out, f.vmax - 0.5, 0, f.Lf, C.regolith);
  b.decal(f.vmin + 0.5, -SIDEWALK.out, 0, f.Lf, C.regolith);
  for (const [v0, v1, u0, u1] of [
    [20, 50, 160, 210],
    [-60, -30, 40, 90],
  ])
    b.decal(v0, v1, u0, u1, C.regolithDark, 0.02);
  sidewalks(b, C.walk, C.curb, 20);
  gate(b, 12, C.rockDark, 0xff7f1f);
  welcomeBoard(b, C.rockDark);
  townLandmarks(b, 'crater');
  rim(b);
  // Habitat domes along both sides, bigger ones behind
  const signs = ['hab', 'labs', 'lens', 'h2o'];
  let k = 0;
  for (const near of [true, false])
    for (let u = 40, i = 0; u < f.Lf - 16; i++) {
      const r = 5 + hash01(i, near ? 21 : 22) * 3;
      if (!near && u > 96 && u < 148) {
        u = 150;
        continue;
      }
      const vp = (near ? -1 : 1) * (SIDEWALK.out + 3.4 + r);
      dome(
        b,
        b.at(vp, u + r, 0, near ? 1 : -1, 0),
        r,
        i % 2 === 0 ? signs[k++ % signs.length] : undefined,
      );
      u += r * 2 + 7;
    }
  for (let i = 0; i < 6; i++) {
    const near = i % 2 === 0;
    const r = 8 + hash01(i, 31) * 3;
    const u = 40 + i * 34;
    if (!near && u > 90 && u < 154) continue;
    dome(
      b,
      b.at((near ? -1 : 1) * (near ? 40 : 46 + hash01(i, 32) * 10), u, 0, near ? 1 : -1, 0),
      r,
    );
  }
  for (const [vp, u] of [
    [-34, 30],
    [40, 200],
    [-50, 180],
  ])
    dish(b, b.at(vp, u, 0, 0.3, 1));
  // Crystal clusters on the floor and out on the slopes
  for (let i = 0; i < 60; i++) {
    const out = i >= 28;
    const sgn = hash01(i, 41) < 0.5 ? -1 : 1;
    const span = sgn < 0 ? -f.vmin : f.vmax;
    const vp = out
      ? sgn * (span + 10 + hash01(i, 42) * 60)
      : sgn * (24 + hash01(i, 43) * (span - 34));
    const u = out ? -40 + hash01(i, 44) * (f.Lf + 80) : 10 + hash01(i, 45) * (f.Lf - 20);
    if (!out && sgn > 0 && Math.abs(u - 122) < 20 && vp > 44) continue;
    const y = out ? ground(vp, u) : f.P;
    b.plant(vp, u, y - 0.1, hash01(i, 46) * 6.28, 0.8 + hash01(i, 47) * 1.4);
  }
}

/** The Lil archipelago: floating islands over town, bobbing (one mesh each, ≤ 2 draw calls). */
export function craterExtras(b: TownBuilder, ctx: ChunkContext, root: THREE.Group): TownExtras {
  const f = b.f;
  const k = new PartBuilder();
  const isles: { y0: number; phase: number; geo: THREE.BufferGeometry[] }[] = [];
  const spots: [number, number, number][] = [
    [-30, 60, 38],
    [24, 96, 46],
    [-10, 150, 34],
    [40, 190, 52],
    [-48, 210, 42],
  ];
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  solid.name = 'CraterIsles';
  const meshes: THREE.Mesh[] = [];
  spots.forEach(([vp, u, y], i) => {
    const before = k.geo.solid.length;
    const m = b.at(vp, u, y, 0, 1);
    const r = 6 + hash01(i, 51) * 4;
    // Underside: an upside-down rock cone; top: a grass disc; a tiny house
    k.add(
      new THREE.ConeGeometry(r, r * 1.4, 7).rotateX(Math.PI).translate(0, -r * 0.7, 0),
      C.dirt,
      m,
    );
    k.add(cyl(r, r, 0.8, 9, 0, 0, 0), C.grass, m);
    k.add(
      boxAt(-1.6, 1.6, 0.4, 3.2, -1.6, 1.6),
      [NOUN.pink, NOUN.blue, NOUN.yellow, NOUN.green, NOUN.orange][i],
      m,
    );
    k.add(
      new THREE.ConeGeometry(2.6, 1.8, 4).rotateY(Math.PI / 4).translate(0, 4.1, 0),
      NOUN.red,
      m,
    );
    // A lil Noun stood by the door: body block, square head, noggles
    k.add(boxAt(2.2, 3.0, 0.4, 1.4, 1.0, 1.8), NOUN.teal, m);
    k.add(
      boxAt(2.0, 3.2, 1.4, 2.6, 0.8, 2.0),
      [NOUN.yellow, NOUN.pink, NOUN.green, NOUN.blue, NOUN.purple][i],
      m,
    );
    noggles(k, sub(m, 2.68, 2.1, 2.1), 0.32, NOUN.red, { depth: 0.1 });
    isles.push({ y0: y, phase: i * 1.7, geo: k.geo.solid.slice(before) });
  });
  let tris = 0;
  for (const isle of isles) {
    // Each island its own mesh (they bob out of step), positions chunk-local
    const g = mergeGeometries(isle.geo, false)!;
    for (const q of isle.geo) q.dispose();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, solid);
    mesh.castShadow = ctx.quality !== 'low';
    mesh.name = 'craterIsle';
    root.add(mesh);
    meshes.push(mesh);
    tris += g.attributes.position.count / 3;
  }
  if (ctx.toon) for (const mesh of meshes) toonify(mesh);
  let t = 0;
  void f;
  return {
    animate: (dt: number) => {
      t += dt;
      for (let i = 0; i < meshes.length; i++) {
        meshes[i].position.y = Math.sin(t * 0.5 + isles[i].phase) * 1.6;
      }
    },
    disposables: [...meshes.map(q => q.geometry), solid],
    triangles: Math.round(tris),
    drawCalls: meshes.length,
  };
}

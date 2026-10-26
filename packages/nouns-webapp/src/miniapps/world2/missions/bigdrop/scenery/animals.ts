// ── Low-poly Noun beasts for the Big Drop's basin ───────────────────────
//
// Box-built, vertex-coloured and flat-shaded like the slope's trees
// (models.ts), every one in red noggles: a shaggy NOGGLE YAK (~3.4 m long,
// horns, a fringe), a SNOW HARE (~0.8 m, tall ears) and a PENGUIN (~1.1 m,
// white front, orange beak and feet). Origin at the feet, forward +Z, up +Y.

import type { AnimalKind } from './basinLifeSim';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const RED = 0xf3322c;

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < p.count; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Noggles across a face at (x, y, z) (the lenses' centre), `s` = lens width. */
function noggles(y: number, z: number, s: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const t = s * 0.18;
  for (const side of [-1, 1]) {
    const cx = side * s * 0.62;
    out.push(box(s, s * 0.8, t, cx, y, z, RED));
    out.push(box(s * 0.36, s * 0.56, t, cx - s * 0.18, y, z + t * 0.6, 0xffffff));
    out.push(box(s * 0.36, s * 0.56, t, cx + s * 0.18, y, z + t * 0.6, 0x0b0b0f));
  }
  out.push(box(s * 0.3, s * 0.16, t, 0, y + s * 0.1, z, RED));
  // Arms back round the head
  for (const side of [-1, 1])
    out.push(box(s * 0.14, s * 0.16, s * 0.9, side * s * 1.12, y + s * 0.1, z - s * 0.45, RED));
  return out;
}

export function yakGeometry(): THREE.BufferGeometry {
  const FUR = 0x6b4a33;
  const DARK = 0x4a3222;
  const p: THREE.BufferGeometry[] = [
    box(1.9, 1.6, 2.8, 0, 1.75, 0, FUR),
    // A hump and a shaggy skirt
    box(1.5, 0.6, 1.4, 0, 2.75, 0.5, FUR),
    box(2.05, 0.5, 2.9, 0, 1.0, 0, DARK),
  ];
  for (const sx of [-0.6, 0.6])
    for (const sz of [-0.95, 0.95]) p.push(box(0.42, 1.0, 0.42, sx, 0.5, sz, DARK));
  // Head, fringe, horns, nose
  p.push(box(1.1, 1.0, 1.0, 0, 1.95, 1.75, FUR));
  p.push(box(1.15, 0.35, 0.3, 0, 2.4, 2.15, DARK));
  for (const side of [-1, 1]) {
    p.push(box(0.6, 0.18, 0.18, side * 0.8, 2.45, 1.75, 0xf2ead8));
    p.push(box(0.18, 0.45, 0.18, side * 1.05, 2.75, 1.75, 0xf2ead8));
  }
  p.push(box(0.6, 0.35, 0.3, 0, 1.6, 2.3, 0x3a2a20));
  p.push(...noggles(2.05, 2.32, 0.42));
  // A tail
  p.push(box(0.2, 0.7, 0.2, 0, 1.9, -1.5, DARK));
  return merge(p);
}

export function hareGeometry(): THREE.BufferGeometry {
  const W = 0xf4f7fc;
  const p: THREE.BufferGeometry[] = [
    box(0.42, 0.4, 0.62, 0, 0.32, 0, W),
    box(0.34, 0.32, 0.32, 0, 0.6, 0.32, W),
    box(0.08, 0.38, 0.06, -0.09, 0.95, 0.28, W),
    box(0.08, 0.38, 0.06, 0.09, 0.95, 0.28, W),
    box(0.05, 0.28, 0.02, -0.09, 0.95, 0.31, 0xf2b6c4),
    box(0.05, 0.28, 0.02, 0.09, 0.95, 0.31, 0xf2b6c4),
    box(0.18, 0.12, 0.3, -0.13, 0.08, 0.05, W),
    box(0.18, 0.12, 0.3, 0.13, 0.08, 0.05, W),
    box(0.16, 0.16, 0.12, 0, 0.42, -0.36, 0xffffff),
  ];
  p.push(...noggles(0.63, 0.49, 0.11));
  return merge(p);
}

export function penguinGeometry(): THREE.BufferGeometry {
  const BLACK = 0x1c2230;
  const ORANGE = 0xffa630;
  const p: THREE.BufferGeometry[] = [
    box(0.62, 0.8, 0.5, 0, 0.5, 0, BLACK),
    box(0.46, 0.66, 0.06, 0, 0.48, 0.25, 0xf4f7fc),
    box(0.5, 0.36, 0.44, 0, 1.06, 0.02, BLACK),
    box(0.16, 0.08, 0.2, 0, 1.0, 0.32, ORANGE),
    box(0.08, 0.5, 0.26, -0.36, 0.58, 0, BLACK),
    box(0.08, 0.5, 0.26, 0.36, 0.58, 0, BLACK),
    box(0.18, 0.06, 0.26, -0.13, 0.03, 0.08, ORANGE),
    box(0.18, 0.06, 0.26, 0.13, 0.03, 0.08, ORANGE),
  ];
  p.push(...noggles(1.1, 0.27, 0.15));
  return merge(p);
}

export function animalGeometry(kind: AnimalKind): THREE.BufferGeometry {
  return kind === 'yak' ? yakGeometry() : kind === 'hare' ? hareGeometry() : penguinGeometry();
}

// ── Low-poly toon models for the Big Drop's slopes ──────────────────────
//
// Built once per visit from primitives, vertex-coloured and flat-shaded so
// toonify turns them into crisp JSR-style cut-outs: a tiered pine, a
// snow-laden pine, a dead silver snag, a snow-capped boulder, and a
// one-cone pine for the far stands. Origin at the base, y up; about 12 m tall
// at scale 1 (rocks about 2 m).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { hash2 } from '../../../world/mountain/config';

import { Kind } from './placement';

const BARK = 0x5a3b2a;
const NEEDLES = [0x2c6a52, 0x3a845e, 0x4f9c6a];
const SNOW = 0xf2f7ff;
const SNOW_SHADE = 0xcfdcf0;
const SNAG = 0x9a8f88;
const ROCK = 0x6d7890;

/** Paint every vertex of `g` (position-only geometry in, colour attribute added). */
function paint(
  g: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, c: THREE.Color) => void,
) {
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Non-indexed, position + flat normals only (so merges line up). */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index !== null ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  n.deleteAttribute('normal');
  n.computeVertexNormals();
  return n;
}

function solid(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex);
  return paint(prep(g), (_x, _y, _z, o) => o.copy(c));
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Tiered pine; `snowy` piles snow on every tier. */
export function pineGeometry(snowy: boolean, seg = 7): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, 3, 5);
  trunk.translate(0, 1.5, 0);
  parts.push(solid(trunk, BARK));
  const tiers = [
    { y: 2.0, r: 3.1, h: 4.6 },
    { y: 4.3, r: 2.5, h: 4.1 },
    { y: 6.5, r: 1.85, h: 3.6 },
    { y: 8.6, r: 1.15, h: 3.2 },
  ];
  const green = new THREE.Color(NEEDLES[1]!);
  const dark = new THREE.Color(NEEDLES[0]!);
  const snow = new THREE.Color(SNOW);
  const snowShade = new THREE.Color(SNOW_SHADE);
  tiers.forEach((t, i) => {
    const cone = new THREE.ConeGeometry(t.r, t.h, seg, 1, true);
    // Skew the tiers a little so no two trees are perfect
    cone.rotateY(i * 0.7);
    cone.translate(0, t.y + t.h / 2, 0);
    const top = t.y + t.h;
    parts.push(
      paint(prep(cone), (_x, y, _z, c) => {
        const f = (y - t.y) / t.h;
        if (snowy) c.copy(f > 0.25 ? snow : snowShade).lerp(dark, f > 0.25 ? 0 : 0.25);
        else c.copy(dark).lerp(green, f);
        // A dusting at the tip of the plain ones
        if (!snowy && y > top - 0.01) c.copy(snow);
      }),
    );
    // A skirt under each tier: the dark underside (and snow-laden lip)
    const skirt = new THREE.ConeGeometry(t.r * 1.02, t.h * 0.18, seg, 1, true);
    skirt.rotateX(Math.PI);
    skirt.rotateY(i * 0.7);
    skirt.translate(0, t.y + t.h * 0.09, 0);
    parts.push(solid(skirt, snowy ? SNOW_SHADE : NEEDLES[0]!));
  });
  return merge(parts);
}

/** A dead, silvered snag with a few broken branches. */
export function deadGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.07, 0.32, 9, 5);
  trunk.translate(0, 4.5, 0);
  parts.push(solid(trunk, SNAG));
  for (let i = 0; i < 6; i++) {
    const len = 1.2 + hash2(i, 1, 51) * 1.8;
    const b = new THREE.CylinderGeometry(0.03, 0.09, len, 4);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.9 + hash2(i, 2, 51) * 0.6);
    b.rotateY(i * 2.1);
    b.translate(0, 2.6 + i * 0.95, 0);
    parts.push(solid(b, SNAG));
  }
  // Snow on the stump's shoulders
  const cap = new THREE.ConeGeometry(0.4, 0.5, 5, 1, true);
  cap.translate(0, 0.25, 0);
  parts.push(solid(cap, SNOW));
  return merge(parts);
}

/** A faceted boulder with snow on top. */
export function rockGeometry(): THREE.BufferGeometry {
  const g0 = new THREE.IcosahedronGeometry(1.2, 0);
  const g = prep(g0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // Jitter by position (shared corners move together) and squash
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k =
      0.8 + 0.4 * hash2(Math.round(x * 10), Math.round(y * 10) * 31 + Math.round(z * 10), 77);
    p.setXYZ(i, x * k * 1.25, y * k * 0.72 + 0.35, z * k);
  }
  g.computeVertexNormals();
  const rock = new THREE.Color(ROCK);
  const snow = new THREE.Color(SNOW);
  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    // Per face: snow on the up-facing ones
    const up = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    c.copy(up > 0.55 ? snow : rock);
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = c.r;
      col[(i + k) * 3 + 1] = c.g;
      col[(i + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** One cone and a stub: a pine seen from a kilometre away. */
export function farPineGeometry(snowy: boolean): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 2.4, 4);
  trunk.translate(0, 1.2, 0);
  const cone = new THREE.ConeGeometry(2.8, 11, 5, 1, true);
  cone.translate(0, 2 + 5.5, 0);
  const dark = new THREE.Color(NEEDLES[0]!);
  const green = new THREE.Color(NEEDLES[2]!);
  const snow = new THREE.Color(SNOW);
  return merge([
    solid(trunk, BARK),
    paint(prep(cone), (_x, y, _z, c) => {
      const f = (y - 2) / 11;
      if (snowy) c.copy(dark).lerp(snow, Math.min(1, f * 2.2));
      else
        c.copy(dark)
          .lerp(green, f)
          .lerp(snow, f > 0.99 ? 1 : 0);
    }),
  ]);
}

/** Geometry for each near kind. */
export function nearGeometries(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  out[Kind.Pine] = pineGeometry(false);
  out[Kind.SnowyPine] = pineGeometry(true);
  out[Kind.Dead] = deadGeometry();
  out[Kind.Rock] = rockGeometry();
  return out;
}

/** The shared material: vertex colours, flat facets. */
export function sceneryMaterial(name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0,
    // A little cool self-light so the shaded side reads as snow and pine, not mud
    emissive: 0x24324a,
  });
  m.name = name;
  return m;
}

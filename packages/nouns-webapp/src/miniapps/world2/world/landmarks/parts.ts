// ── Landmark parts: a tiny merge-by-material builder ─────────────────────
//
// Landmarks are modelled against `Parts`, the same `add(geometry, colour,
// matrix, opts)` call as the towns' TownBuilder (towns/kit.ts), so a model
// drops into a town build unchanged. Out in the wilds PartBuilder collects
// them instead: solid (vertex colours, casts shadow), thin rods (kept out of
// the ink pass), glow (unlit) and collision triangles.

import * as THREE from 'three';

import { painted, type Bucket } from '../../towns/kit';

export interface Parts {
  add(
    g: THREE.BufferGeometry,
    color: number,
    m: THREE.Matrix4,
    opts?: { collide?: boolean; bucket?: Bucket },
  ): unknown;
}

export class PartBuilder implements Parts {
  readonly geo: Record<Bucket, THREE.BufferGeometry[]> = {
    solid: [],
    ground: [],
    thin: [],
    glow: [],
  };
  readonly col: THREE.BufferGeometry[] = [];

  add(
    g: THREE.BufferGeometry,
    color: number,
    m: THREE.Matrix4,
    opts: { collide?: boolean; bucket?: Bucket } = {},
  ) {
    const geo = painted(g, color, m);
    this.geo[opts.bucket ?? 'solid'].push(geo);
    if (opts.collide === true) {
      const c = new THREE.BufferGeometry();
      c.setAttribute('position', geo.attributes.position.clone());
      this.col.push(c);
    }
    return geo;
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** m · (translate(x, y, z) · rotate(rx, ry, rz) · scale(sc)) — a sub-frame of a model. */
export function sub(
  m: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  ry = 0,
  rx = 0,
  rz = 0,
  sc = 1,
) {
  const local = new THREE.Matrix4().compose(
    _v.set(x, y, z),
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')),
    _s.setScalar(sc),
  );
  return new THREE.Matrix4().multiplyMatrices(m, local);
}

/** The Nouns palette (CC0 trait colours). */
export const NOUN = {
  red: 0xe8352b,
  blue: 0x2b83f6,
  yellow: 0xffc110,
  green: 0x4bea69,
  pink: 0xff638d,
  orange: 0xff7f1f,
  purple: 0x9f59ff,
  teal: 0x2ac7b6,
  cream: 0xf6e7c8,
  black: 0x14131a,
  white: 0xfcfcfc,
  grey: 0xd5d7e1,
  cool: 0xd5d7e1,
  warm: 0xe1d7d5,
} as const;

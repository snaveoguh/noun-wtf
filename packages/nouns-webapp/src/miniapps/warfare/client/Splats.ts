// ── Paint decals: a capped ring buffer of instanced splat quads ────────
//
// Four InstancedMeshes (one per atlas shape) share the splat atlas. Each
// new splat overwrites the oldest slot, so the paint keeps piling up but
// the cost is fixed. Splats are toon-lit (alpha-tested for crisp edges)
// and pushed off the surface with polygon offset + a tiny per-slot lift
// so overlapping splats don't z-fight.

import * as THREE from 'three';

import { inkExcluded } from '@/miniapps/world2/render/Toon';

import { getSplatAtlas } from './textures';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

export class Splats {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private next: number[] = [];
  private cap: number;
  private count = 0;
  private dirty = new Set<number>();

  constructor(capacity: number) {
    this.cap = Math.max(8, Math.floor(capacity / 4));
    const mat = new THREE.MeshLambertMaterial({
      map: getSplatAtlas(),
      alphaTest: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    for (let k = 0; k < 4; k++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const u0 = (k % 2) * 0.5;
      const v0 = Math.floor(k / 2) * 0.5;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
      const mesh = new THREE.InstancedMesh(geo, mat, this.cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      mesh.renderOrder = 1;
      this.meshes.push(mesh);
      this.next.push(0);
      this.group.add(mesh);
      inkExcluded.add(mesh);
    }
  }

  /** Stick a splat at p facing along normal n. */
  add(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    color: number,
    size: number,
  ) {
    const k = Math.floor(Math.random() * 4);
    const mesh = this.meshes[k];
    const slot = this.next[k];
    this.next[k] = (slot + 1) % this.cap;
    if (mesh.count < this.cap) mesh.count = Math.max(mesh.count, slot + 1);
    _n.set(nx, ny, nz);
    if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
    _n.normalize();
    _q.setFromUnitVectors(_z, _n);
    _q2.setFromAxisAngle(_z, Math.random() * Math.PI * 2);
    _q.multiply(_q2);
    const lift = 0.006 + (this.count++ % 16) * 0.0007;
    _p.set(x + _n.x * lift, y + _n.y * lift, z + _n.z * lift);
    const s = size * (0.8 + Math.random() * 0.45);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(slot, _m);
    _c.setHex(color);
    mesh.setColorAt(slot, _c);
    this.dirty.add(k);
  }

  flush() {
    for (const k of this.dirty) {
      const m = this.meshes[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.dirty.clear();
  }

  clear() {
    for (let k = 0; k < 4; k++) {
      this.meshes[k].count = 0;
      this.next[k] = 0;
    }
  }

  get total() {
    return this.meshes.reduce((a, m) => a + m.count, 0);
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      inkExcluded.delete(m);
    }
    (this.meshes[0].material as THREE.Material).dispose();
  }
}

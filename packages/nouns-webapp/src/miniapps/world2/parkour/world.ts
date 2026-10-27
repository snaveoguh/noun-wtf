// ── PkWorld over the game's CollisionWorld (no allocation per query) ─────

import type { PkHit, PkWorld, V3 } from './contract';
import type { CollisionWorld, RayHit } from '../physics/Collision';

import * as THREE from 'three';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class CollisionPkWorld implements PkWorld {
  private hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };
  private out: PkHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, d: 0 };
  private corr: V3 = { x: 0, y: 0, z: 0 };
  /** Rays cast (perf counter for the dev overlay / tests). */
  rays = 0;

  constructor(private world: CollisionWorld) {}

  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number) {
    this.rays++;
    if (!this.world.raycastInto(_o.set(ox, oy, oz), _d.set(dx, dy, dz), far, this.hit)) return null;
    const h = this.hit;
    const o = this.out;
    o.x = h.point.x;
    o.y = h.point.y;
    o.z = h.point.z;
    o.nx = h.normal.x;
    o.ny = h.normal.y;
    o.nz = h.normal.z;
    o.d = h.distance;
    return o;
  }

  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) {
    this.world.capsulePushout(_a.set(ax, ay, az), _b.set(bx, by, bz), r, undefined, _c);
    this.corr.x = _c.x;
    this.corr.y = _c.y;
    this.corr.z = _c.z;
    return this.corr;
  }
}

// ── The van's view of the world: CollisionWorld → VanGround ──────────────
//
// Rays go through CollisionWorld.raycastInto (the level BVH, streamed chunk
// colliders like ramps and rocks, and the analytic mountain), walls through
// capsulePushout, all into scratch objects: nothing allocated per call on
// our side. Grip comes from the surface under the van (set once a frame).

import type { GroundHit, VanGround, WallPush } from './physics';
import type { RayHit, CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';

/** Tyre grip per surface (the city's concrete is 1). */
export const SURFACE_GRIP: Record<'track' | 'grass' | 'alley' | 'city', number> = {
  city: 1,
  alley: 1,
  track: 0.92,
  grass: 0.78,
};

export class WorldGround implements VanGround {
  /** Grip under the van this frame. */
  grip = 1;
  private o = new THREE.Vector3();
  private d = new THREE.Vector3();
  private b = new THREE.Vector3();
  private n = new THREE.Vector3();
  private corr = new THREE.Vector3();
  private hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

  constructor(private world: CollisionWorld) {}

  ray(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    far: number,
    out: GroundHit,
  ): boolean {
    if (!this.world.raycastInto(this.o.set(ox, oy, oz), this.d.set(dx, dy, dz), far, this.hit))
      return false;
    const h = this.hit;
    out.x = h.point.x;
    out.y = h.point.y;
    out.z = h.point.z;
    out.nx = h.normal.x;
    out.ny = h.normal.y;
    out.nz = h.normal.z;
    out.d = h.distance;
    out.grip = this.grip;
    return true;
  }

  push(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    out: WallPush,
  ): boolean {
    this.n.set(0, 0, 0);
    const c = this.world.capsulePushout(
      this.o.set(ax, ay, az),
      this.b.set(bx, by, bz),
      r,
      this.n,
      this.corr,
    );
    if (c.lengthSq() < 1e-8) return false;
    out.x = c.x;
    out.y = c.y;
    out.z = c.z;
    const nl = this.n.length();
    if (nl < 1e-6) {
      const cl = c.length();
      out.nx = c.x / cl;
      out.ny = c.y / cl;
      out.nz = c.z / cl;
    } else {
      out.nx = this.n.x / nl;
      out.ny = this.n.y / nl;
      out.nz = this.n.z / nl;
    }
    return true;
  }
}

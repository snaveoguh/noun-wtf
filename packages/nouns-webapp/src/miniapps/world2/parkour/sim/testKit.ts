// Test kit: box / pole levels on the real CollisionWorld, and a small body
// that walks, jumps and falls like the Player's on-foot code (so the motor
// can be tested without the whole Player). Tests only.

import type { PkBody, PkEvent, PkInput } from '../contract';

import * as THREE from 'three';

import { CollisionWorld } from '../../physics/Collision';
import { CollisionPkWorld } from '../world';

import { ParkourMotor } from './motor';

/** [cx, cy, cz, sx, sy, sz] */
export type Box = [number, number, number, number, number, number];
/** [x, z, radius, height] standing on y = 0 */
export type Post = [number, number, number, number];

export function level(boxes: Box[], posts: Post[] = [], floor = true) {
  const meshes: THREE.Mesh[] = [];
  const all: Box[] = floor ? [[0, -0.5, 0, 200, 1, 200], ...boxes] : boxes;
  for (const [cx, cy, cz, sx, sy, sz] of all) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz));
    m.position.set(cx, cy, cz);
    meshes.push(m);
  }
  for (const [x, z, r, h] of posts) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12));
    m.position.set(x, h / 2, z);
    meshes.push(m);
  }
  const cw = new CollisionWorld();
  cw.build(meshes);
  return { cw, w: new CollisionPkWorld(cw) };
}

export function input(over: Partial<PkInput> = {}): PkInput {
  return {
    moveX: 0,
    moveY: 0,
    wishX: 0,
    wishZ: 0,
    sprint: false,
    jump: false,
    jumpHeld: false,
    duck: false,
    duckPressed: false,
    release: false,
    ...over,
  };
}

export class TestBody implements PkBody {
  pos = { x: 0, y: 0, z: 0 };
  vel = { x: 0, y: 0, z: 0 };
  yaw = 0;
  grounded = true;
  climbing = false;
  vaulting = false;
  respawns = 0;
  events: PkEvent[] = [];
  climbs: [number, number][] = [];
  vaults: [number, number][] = [];
  /** Allow startClimb / startVault to succeed. */
  canClimb = true;
  canVault = true;

  startClimb(nx: number, nz: number) {
    this.climbs.push([nx, nz]);
    if (this.canClimb) this.climbing = true;
    return this.canClimb;
  }
  startVault(nx: number, nz: number) {
    this.vaults.push([nx, nz]);
    return this.canVault;
  }
  emit(e: PkEvent) {
    this.events.push(e);
  }
  has(t: PkEvent['type']) {
    return this.events.some(e => e.type === t);
  }
}

/**
 * A rig: motor + body + world, stepped at 60 Hz. When the motor doesn't
 * drive, the body runs simple on-foot physics: steer toward the wished
 * direction at `speed`, jump on `jump` when grounded, gravity, ground snap,
 * capsule push out of walls.
 */
export class Rig {
  motor: ParkourMotor;
  b = new TestBody();
  t = 0;
  log: string[] = [];

  constructor(
    public w: CollisionPkWorld,
    x = 0,
    y = 0,
    z = 0,
    yaw = 0,
  ) {
    this.motor = new ParkourMotor(w);
    this.b.pos = { x, y, z };
    this.b.yaw = yaw;
  }

  get move() {
    return this.motor.move?.k ?? (this.b.climbing ? 'climb' : 'none');
  }

  /** One 60 Hz step. `speed` = run speed when walking (sprint 6.5). */
  step(i: PkInput, speed = 0) {
    const dt = 1 / 60;
    this.t += dt;
    const b = this.b;
    if (b.climbing) return;
    const drove = this.motor.step(dt, b, i);
    this.log.push(this.move);
    if (drove) return;
    const wl = Math.hypot(i.wishX, i.wishZ);
    if (b.grounded) {
      const tx = wl > 0.05 ? (i.wishX / wl) * speed : 0;
      const tz = wl > 0.05 ? (i.wishZ / wl) * speed : 0;
      const k = 1 - Math.exp(-11 * dt);
      b.vel.x += (tx - b.vel.x) * k;
      b.vel.z += (tz - b.vel.z) * k;
      if (wl > 0.05) b.yaw = Math.atan2(i.wishX, i.wishZ);
      if (i.jump) {
        b.vel.y = 5;
        b.grounded = false;
      }
    }
    b.vel.y -= 12.5 * dt;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.pos.z += b.vel.z * dt;
    const c = this.w.push(b.pos.x, b.pos.y + 0.6, b.pos.z, b.pos.x, b.pos.y + 1.08, b.pos.z, 0.32);
    b.pos.x += c.x;
    b.pos.z += c.z;
    const h = this.w.ray(
      b.pos.x,
      b.pos.y + 0.6,
      b.pos.z,
      0,
      -1,
      0,
      0.6 + (b.grounded ? 0.35 : 0.05),
    );
    if (h !== null && h.ny > 0.55 && b.vel.y <= 0.5) {
      b.pos.y = h.y;
      b.vel.y = 0;
      b.grounded = true;
    } else b.grounded = false;
  }

  run(n: number, i: PkInput | ((t: number) => PkInput), speed = 0) {
    for (let k = 0; k < n; k++) this.step(typeof i === 'function' ? i(this.t) : i, speed);
  }

  /** Step until the motor is in `move` (true) or `n` steps pass (false). */
  until(move: string, n: number, i: PkInput | ((t: number) => PkInput), speed = 0) {
    for (let k = 0; k < n; k++) {
      this.step(typeof i === 'function' ? i(this.t) : i, speed);
      if (this.move === move) return true;
    }
    return false;
  }
}

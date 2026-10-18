// ── Van chase camera: behind the line of travel, speed-opened FOV ──────
//
// Sits behind and above the van, following the direction it's travelling
// (so a drift swings the van across the frame instead of whipping the view)
// and the nose at low speed / in reverse. A critically damped spring
// smooths it; walls pull it in; the field of view opens with speed and
// keeps a minimum horizontal view on portrait phones (like SkateCamera).
// Allocation-free per frame.

import type { RayHit, CollisionWorld } from '../physics/Collision';
import type { CamMode } from '../render/SkateCamera';

import * as THREE from 'three';

const MIN_VIEW_ASPECT = 1.4;
const MAX_PORTRAIT_FOV = 100;

const PRESETS: Record<CamMode, { d: number; h: number }> = {
  follow: { d: 8.6, h: 3.3 },
  low: { d: 6.4, h: 2.0 },
  far: { d: 12.5, h: 5.2 },
};

export class VanCamera {
  yaw = 0;
  orbitYaw = 0;
  orbitPitch = 0;
  fov = 64;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private look = new THREE.Vector3();
  private ready = false;
  private lastInputAt = 0;
  private shake = 0;
  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private down = new THREE.Vector3(0, -1, 0);
  private hit: RayHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

  constructor(
    private camera: THREE.PerspectiveCamera,
    private world: CollisionWorld,
  ) {}

  snap(heading: number) {
    this.yaw = heading;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.ready = false;
  }

  addShake(a: number) {
    this.shake = Math.min(1, this.shake + a);
  }

  /**
   * `origin`: the van's model origin; `vel`: its velocity; `heading`: nose yaw;
   * `fwdSpeed`: signed speed along the nose.
   */
  update(
    dt: number,
    origin: THREE.Vector3,
    vel: THREE.Vector3,
    heading: number,
    fwdSpeed: number,
    mode: CamMode,
    lookX: number,
    lookY: number,
    now: number,
    shakeScale: number,
  ) {
    if (Math.abs(lookX) + Math.abs(lookY) > 1e-4) this.lastInputAt = now;
    this.orbitYaw -= lookX;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch - lookY * 0.8, -0.25, 0.7);
    const hs = Math.hypot(vel.x, vel.z);
    if (now - this.lastInputAt > 1400 && hs > 2) {
      const k = 1 - Math.exp(-2.2 * dt);
      this.orbitYaw *= 1 - k;
      this.orbitPitch *= 1 - k;
    }
    // Heading to sit behind: travel direction when moving forward, else the nose
    let want = heading;
    if (hs > 4 && fwdSpeed > 2) {
      const tv = Math.atan2(vel.x, vel.z);
      // Mostly the line of travel, a little of the nose (shows the drift angle)
      want = tv + wrap(heading - tv) * 0.3;
    }
    this.yaw += wrap(want - this.yaw) * (1 - Math.exp(-(hs > 4 ? 3.2 : 2) * dt));
    const p = PRESETS[mode];
    const yaw = this.yaw + this.orbitYaw;
    const dist = p.d + Math.min(4, hs * 0.07);
    const lift = p.h + this.orbitPitch * dist * 0.6;

    const target = this.target.copy(origin);
    target.y += 1.7;
    this.desired.set(
      target.x - Math.sin(yaw) * dist,
      origin.y + lift,
      target.z - Math.cos(yaw) * dist,
    );
    // Walls between the van and the camera: pull in
    this.dir.subVectors(this.desired, target);
    const len = this.dir.length();
    if (len > 1e-3 && this.world.raycastInto(target, this.dir, len, this.hit)) {
      this.desired
        .copy(target)
        .addScaledVector(this.dir.normalize(), Math.max(1.2, this.hit.distance - 0.3));
    }
    // Keep above the ground under the camera
    this.tmp.copy(this.desired);
    this.tmp.y += 3;
    if (this.world.raycastInto(this.tmp, this.down, 6, this.hit))
      this.desired.y = Math.max(this.desired.y, this.hit.point.y + 0.6);

    if (!this.ready) {
      this.pos.copy(this.desired);
      this.vel.set(0, 0, 0);
      this.look.copy(target);
      this.ready = true;
    } else {
      // Feed-forward at speed so the spring doesn't trail metres behind
      this.pos.addScaledVector(vel, dt * THREE.MathUtils.smoothstep(hs, 10, 30) * 0.85);
      this.look.addScaledVector(vel, dt * 0.85);
    }
    springTo(this.pos, this.vel, this.desired, hs > 25 ? 9 : 7, dt);
    this.tmp.copy(target).addScaledVector(vel, 0.12);
    this.look.lerp(this.tmp, 1 - Math.exp(-12 * dt));

    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.12 * shakeScale;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-6 * dt);
    }
    cam.lookAt(this.look);

    // Speed FOV: 64° parked → ~84° at 140 km/h → ~92° on boost
    let fov = 64 + 28 * (1 - Math.exp(-hs / 34));
    const aspect = cam.aspect;
    if (aspect < MIN_VIEW_ASPECT) {
      const half = Math.atan(
        (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * MIN_VIEW_ASPECT) / aspect,
      );
      fov = Math.min(MAX_PORTRAIT_FOV, THREE.MathUtils.radToDeg(half * 2));
    }
    this.fov += (fov - this.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Exact critically damped spring step (no allocation). */
function springTo(
  x: THREE.Vector3,
  v: THREE.Vector3,
  target: THREE.Vector3,
  omega: number,
  dt: number,
) {
  const exp = Math.exp(-omega * dt);
  let dx = x.x - target.x;
  let temp = (v.x + omega * dx) * dt;
  v.x = (v.x - omega * temp) * exp;
  x.x = target.x + (dx + temp) * exp;
  dx = x.y - target.y;
  temp = (v.y + omega * dx) * dt;
  v.y = (v.y - omega * temp) * exp;
  x.y = target.y + (dx + temp) * exp;
  dx = x.z - target.z;
  temp = (v.z + omega * dx) * dt;
  v.z = (v.z - omega * temp) * exp;
  x.z = target.z + (dx + temp) * exp;
}

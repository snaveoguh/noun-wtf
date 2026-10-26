// ── Skate-style chase camera + on-foot orbit camera ─────────────────────
//
// Board: low, tight, behind the line of travel (not the board heading, so
// spins don't whip the view). Freezes heading on vert airs. Mouse/right
// stick orbit offsets ease back to centre while rolling.
// Foot: free orbit around the character.

import type { CollisionWorld } from '../physics/Collision';
import type { Player } from '../skate/Player';

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
// Per-frame scratch (update runs every frame; no garbage on weak phones)
const _hv = new THREE.Vector3();
const _f = new THREE.Vector3();
const _target = new THREE.Vector3();
const _back = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _moved = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const MIN_VIEW_ASPECT = 1.4;
const MAX_PORTRAIT_FOV = 100;

export type CamMode = 'follow' | 'low' | 'far';

export class SkateCamera {
  yaw = 0; // heading the camera sits behind (world yaw, 0 = looking +Z)
  pitch = 0.12;
  orbitYaw = 0;
  orbitPitch = 0;
  private lastInputAt = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  mode: CamMode = 'follow';
  fov = 70;
  /** 0..1 blend into the climbing framing (pulled back, low, looking up the wall). */
  private climbK = 0;
  /** Rider position last frame (camera feed-forward at speed). */
  private lastRider = new THREE.Vector3();
  private hasLastRider = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private world: CollisionWorld,
  ) {}

  /**
   * Lead the look target down (and up) with the rider's vertical speed too,
   * so a 49° fall line fills the view instead of the sky (the Big Drop).
   */
  leadVertical = false;

  /**
   * A set piece's camera (the Big Drop's loops): while set, the camera sits
   * at `pos` looking at `look` (local coordinates) with this vertical FOV,
   * and the chase waits; it picks up behind the rider once it's cleared.
   */
  rig: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;

  /** 0 turns camera shake off (reduce motion). */
  shakeScale = 1;

  addShake(a: number) {
    this.shake = Math.min(1, this.shake + a * this.shakeScale);
  }

  cycleMode() {
    this.mode = this.mode === 'follow' ? 'low' : this.mode === 'low' ? 'far' : 'follow';
  }

  /** Forward yaw the player controls are relative to (on foot). */
  get controlYaw() {
    return this.yaw + this.orbitYaw;
  }

  update(dt: number, p: Player, lookX: number, lookY: number, now: number) {
    const onBoard = p.mode === 'board';
    if (Math.abs(lookX) + Math.abs(lookY) > 1e-4) this.lastInputAt = now;
    const rig = this.rig;
    if (rig !== null) {
      this.camera.position.copy(rig.pos);
      this.camera.lookAt(rig.look);
      if (Math.abs(this.camera.fov - rig.fov) > 0.01) {
        this.camera.fov = rig.fov;
        this.camera.updateProjectionMatrix();
      }
      this.lastRider.copy(p.pos);
      this.initialized = false;
      return;
    }

    if (onBoard) {
      this.orbitYaw -= lookX * 1.0;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch - lookY * 0.8, -0.35, 0.9);
      // Recentre after a moment without input when moving
      if (now - this.lastInputAt > 1200 && p.speed > 1.5) {
        const k = 1 - Math.exp(-2.5 * dt);
        this.orbitYaw *= 1 - k;
        this.orbitPitch *= 1 - k;
      }
      // Travel heading (horizontal velocity), falls back to board nose
      const hv = _hv.set(p.vel.x, 0, p.vel.z);
      const hs = hv.length();
      let targetYaw = this.yaw;
      if (p.state === 'grind' || p.state === 'ground' || p.state === 'manual') {
        if (hs > 0.8) targetYaw = Math.atan2(hv.x, hv.z);
        else {
          const f = _f.set(p.fwd.x, 0, p.fwd.z);
          if (f.lengthSq() > 0.1) targetYaw = Math.atan2(f.x, f.z) + (p.fakie ? Math.PI : 0);
        }
      } else if (p.state === 'air' && !p.vertLip && hs > 2) {
        targetYaw = Math.atan2(hv.x, hv.z);
      }
      const rate = p.state === 'air' ? 1.5 : p.state === 'bail' ? 0.6 : 5.5;
      this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-rate * dt));
    } else {
      this.yaw -= lookX * 1.2;
      this.orbitYaw = lerpAngle(this.orbitYaw, 0, 1 - Math.exp(-3 * dt));
      this.pitch = THREE.MathUtils.clamp(this.pitch + lookY * 0.9, -0.5, 1.1);
      // Climbing: swing round behind the climber (square to the wall) unless
      // the player is steering the camera themselves.
      if (p.climb !== null && now - this.lastInputAt > 700) {
        const n = p.climb.normal;
        // Slightly off-square (3/4 view) so the reaching arms read past the big head
        this.yaw = lerpAngle(this.yaw, Math.atan2(-n.x, -n.z) + 0.42, 1 - Math.exp(-3.5 * dt));
      }
      // Keyboard walking turns like the board: keep the camera in behind the
      // heading once the player stops steering it themselves
      else if (p.climb === null && p.footTank && now - this.lastInputAt > 600) {
        this.yaw = lerpAngle(this.yaw, p.footYaw, 1 - Math.exp(-4 * dt));
      }
    }
    this.climbK = THREE.MathUtils.lerp(
      this.climbK,
      p.climb !== null ? 1 : 0,
      1 - Math.exp(-(p.climb !== null ? 3 : 2) * dt),
    );
    const ck = this.climbK;

    const yaw = this.yaw + this.orbitYaw;
    const preset =
      this.mode === 'low'
        ? { d: 2.4, h: 0.55, la: 0.7 }
        : this.mode === 'far'
          ? { d: 5.6, h: 2.0, la: 1.0 }
          : { d: 3.3, h: 1.05, la: 0.95 };
    const speedPull = onBoard ? Math.min(1.2, p.speed * 0.045) : 0;
    const dist = (onBoard ? preset.d : THREE.MathUtils.lerp(3.6, 6.8, ck)) + speedPull;
    // Climbing pulls the camera below the climber, looking up the facade
    const pitch = onBoard ? 0.1 + this.orbitPitch : THREE.MathUtils.lerp(this.pitch, -0.3, ck);

    const target = _target.copy(p.pos);
    // On vert, frame the ramp + rider instead of chasing straight up
    if (onBoard && p.state === 'air' && p.vertLip) target.y = Math.min(target.y, this.look.y + 0.5);
    target.y += onBoard ? preset.la : 1.25 + ck * 0.9;

    const back = _back.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const desired = _desired
      .copy(target)
      .addScaledVector(back, dist * Math.cos(pitch))
      .addScaledVector(UP, (onBoard ? preset.h - preset.la + 0.35 : 0.2) + dist * Math.sin(pitch));

    // Collision: pull in toward the target
    const blocked = this.world.obstruction(target, desired);
    if (blocked >= 0) {
      const dir = _dir.copy(desired).sub(target).normalize();
      desired.copy(target).addScaledVector(dir, Math.max(0.6, blocked - 0.25));
    }
    // Keep above the ground under the camera
    const g = this.world.raycast(_probe.copy(desired).addScaledVector(UP, 2), DOWN, 4);
    if (g && desired.y < g.point.y + 0.25) desired.y = g.point.y + 0.25;

    // Feed-forward: carry the camera along with the rider at mountain speeds
    // so the spring doesn't trail metres behind (a critically damped spring
    // lags 2v/ω). At city speeds (≤ 17 m/s) the original chase feel is untouched.
    if (this.hasLastRider && this.initialized) {
      const moved = _moved.subVectors(p.pos, this.lastRider);
      if (moved.lengthSq() > 60 * 60) this.initialized = false;
      else if (onBoard) {
        const k = THREE.MathUtils.smoothstep(p.speed, 17, 35);
        this.pos.addScaledVector(moved, k);
        this.look.addScaledVector(moved, k);
      }
    }
    this.lastRider.copy(p.pos);
    this.hasLastRider = true;
    if (!this.initialized) {
      this.pos.copy(desired);
      this.look.copy(target);
      this.initialized = true;
    }
    // Critically damped spring for position, tighter for look target
    const stiffness = onBoard ? (p.state === 'air' ? 7 : 11) : 10;
    springTo(this.pos, this.vel, desired, stiffness, dt);
    const lookTarget = _lookTarget.copy(target);
    if (onBoard) lookTarget.x += p.vel.x * 0.12;
    if (onBoard) lookTarget.z += p.vel.z * 0.12;
    if (onBoard && this.leadVertical) lookTarget.y += p.vel.y * 0.12;
    this.look.lerp(lookTarget, 1 - Math.exp(-14 * dt));

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-7 * dt);
    }
    this.camera.lookAt(this.look);

    // Speed FOV
    // Speed FOV: the original ramp to 82° by ~16 m/s, then keeps opening up
    // as mountain runs build past the city's top speed — capped at 110°
    // (speed itself is unbounded)
    const fast = Math.max(0, p.speed - 17);
    let targetFov = onBoard
      ? 68 + Math.min(14, p.speed * 0.9) + 28 * (1 - Math.exp(-fast / 45))
      : 62;
    // These are vertical FOVs tuned on landscape screens. On a portrait phone
    // the same vertical FOV leaves a sliver of the world either side, so
    // keep at least the horizontal view a 1.4:1 screen would get (capped)
    const aspect = this.camera.aspect;
    if (aspect < MIN_VIEW_ASPECT) {
      const half = Math.atan(
        (Math.tan(THREE.MathUtils.degToRad(targetFov / 2)) * MIN_VIEW_ASPECT) / aspect,
      );
      targetFov = Math.min(MAX_PORTRAIT_FOV, THREE.MathUtils.radToDeg(half * 2));
    }
    this.fov = THREE.MathUtils.lerp(this.fov, targetFov, 1 - Math.exp(-3 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Move the camera and its smoothing state by `d` (a floating-origin shift). */
  shift(d: THREE.Vector3) {
    this.pos.add(d);
    this.look.add(d);
    this.lastRider.add(d);
    this.camera.position.add(d);
  }

  snap(p: Player) {
    this.yaw = Math.atan2(p.fwd.x, p.fwd.z);
    this.initialized = false;
  }
}

function springTo(
  x: THREE.Vector3,
  v: THREE.Vector3,
  target: THREE.Vector3,
  omega: number,
  dt: number,
) {
  // Exact critically damped spring step
  const exp = Math.exp(-omega * dt);
  const dx = _springDx.subVectors(x, target);
  const temp = _springTemp.copy(v).addScaledVector(dx, omega).multiplyScalar(dt);
  v.addScaledVector(temp, -omega).multiplyScalar(exp);
  x.copy(target).add(dx.add(temp).multiplyScalar(exp));
}
const _springDx = new THREE.Vector3();
const _springTemp = new THREE.Vector3();

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

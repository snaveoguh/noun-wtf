// ── Pool cameras: behind the cue, top down, following the roll ──────────
//
// Every mode is a goal (eye + look-at, in the table's frame) that the real
// camera eases toward, so switching is always a smooth move:
//   aim     low behind the cue ball, looking down the shot
//   top     straight down over the cloth, the whole table filling the
//           screen (the length runs the long way of the screen: across on
//           a laptop, up and down on a phone)
//   follow  while the balls roll: up and back along the shot, tracking
//           the lead ball
//   orbit   the menu: a slow circle round the table
// Pure maths on top of a THREE.PerspectiveCamera; the table group's matrix
// takes the goal to the world.

import * as THREE from 'three';

import { HX, HZ } from './table';

export type CamMode = 'aim' | 'top' | 'follow' | 'orbit';

const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();

export class PoolCamera {
  mode: CamMode = 'orbit';
  readonly eye = new THREE.Vector3(0, 2, 3);
  readonly look = new THREE.Vector3();
  /** Screen-up for the top view, eased (local frame). */
  private topUp = new THREE.Vector3(0, 0, -1);
  private orbitT = 0;
  private first = true;
  /** For follow: the shot's direction and the lead ball (local). */
  private lead = new THREE.Vector3();

  constructor(private feltY: number) {}

  snap() {
    this.first = true;
  }

  /**
   * Work out this frame's goal and ease the camera there.
   * `cue`: the cue ball (local; null when in hand off the table),
   * `dir`: the aim (local x, z), `lead`: the ball to follow while rolling.
   */
  update(
    cam: THREE.PerspectiveCamera,
    table: THREE.Object3D,
    dt: number,
    cue: THREE.Vector3 | null,
    dx: number,
    dz: number,
    lead: THREE.Vector3 | null,
  ) {
    const fy = this.feltY;
    let rate = 4.5;
    const portrait = cam.aspect < 1;
    switch (this.mode) {
      case 'aim': {
        const c = cue ?? _look.set(0, fy, 0);
        const back = portrait ? 1.0 : 0.85;
        _eye.set(c.x - dx * back, fy + (portrait ? 0.42 : 0.34), c.z - dz * back);
        _look.set(c.x + dx * 0.55, fy, c.z + dz * 0.55);
        rate = 7;
        break;
      }
      case 'top': {
        const v = THREE.MathUtils.degToRad(cam.fov) / 2;
        const tan = Math.tan(v);
        // The table's long side along the screen's long side
        const along = portrait ? HZ : HX;
        const across = portrait ? HX : HZ;
        const h = Math.max(across / tan, along / (tan * cam.aspect)) * 1.06;
        _eye.set(0, fy + h, 0.0001);
        _look.set(0, fy, 0);
        rate = 5;
        break;
      }
      case 'follow': {
        if (lead !== null) this.lead.lerp(lead, 1 - Math.exp(-6 * dt));
        const l = this.lead;
        _eye.set(l.x - dx * 1.1, fy + 1.15, l.z - dz * 1.1);
        // Keep it over (or just outside) the table
        _eye.x = THREE.MathUtils.clamp(_eye.x, -HX - 0.6, HX + 0.6);
        _eye.z = THREE.MathUtils.clamp(_eye.z, -HZ - 0.8, HZ + 0.8);
        _look.set(l.x, fy, l.z);
        rate = 2.6;
        break;
      }
      case 'orbit': {
        this.orbitT += dt * 0.12;
        const r = portrait ? 3.3 : 2.9;
        _eye.set(Math.cos(this.orbitT) * r, fy + 1.85, Math.sin(this.orbitT) * r * 0.78);
        _look.set(0, fy - 0.1, 0);
        rate = 2;
        break;
      }
    }
    const k = this.first ? 1 : 1 - Math.exp(-rate * dt);
    this.first = false;
    this.eye.lerp(_eye, k);
    this.look.lerp(_look, k);
    // Screen-up: straight down needs an explicit up (table +X on a phone, −Z on a laptop)
    const wantUp =
      this.mode === 'top' ? (portrait ? _up.set(1, 0, 0) : _up.set(0, 0, -1)) : _up.set(0, 1, 0);
    this.topUp.lerp(wantUp, k).normalize();
    // To the world
    table.updateMatrixWorld();
    const e = _eye.copy(this.eye).applyMatrix4(table.matrixWorld);
    const l = _look.copy(this.look).applyMatrix4(table.matrixWorld);
    const up = _up.copy(this.topUp).transformDirection(table.matrixWorld);
    cam.position.copy(e);
    _m.lookAt(e, l, up);
    _q.setFromRotationMatrix(_m);
    cam.quaternion.copy(_q);
  }

  /** Start following from here. */
  follow(from: THREE.Vector3) {
    this.lead.copy(from);
    this.mode = 'follow';
  }
}

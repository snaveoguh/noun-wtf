// ── Hoops cameras: broadcast, on-court chase, slow-mo zoom, shake ───────
//
// Works in court space and writes the game's PerspectiveCamera in world
// space through the court matrix.

import type { CourtSpec } from '../contract';

import * as THREE from 'three';

export type HoopsCameraMode = 'broadcast' | 'chase';

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();

export interface CameraFrame {
  /** Ball (court space). */
  ball: THREE.Vector3;
  /** Local player (court space) + facing, or null when spectating. */
  me: THREE.Vector3 | null;
  meYaw: number;
  /** The basket in play (rim centre, court space). */
  rim: THREE.Vector3;
  halfCourt: boolean;
}

export class HoopsCamera {
  mode: HoopsCameraMode = 'broadcast';
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  private fov = 40;
  private first = true;
  private shakeAmt = 0;
  private shakeT = 0;
  /** Slow-mo / hero zoom: focus point + how long it lasts. */
  private zoom: { at: THREE.Vector3; t: number; dur: number; side: number } | null = null;
  private zoomBlend = 0;
  /** −1 / +1: which sideline the broadcast camera sits on. */
  side = -1;
  baseFov = { broadcast: 44, chase: 62 };
  /** Broadcast camera: metres out from the play (height follows). */
  broadcastDist = 12;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly court: CourtSpec,
  ) {}

  setMode(m: HoopsCameraMode) {
    this.mode = m;
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + amount);
  }

  /** Swoop in on `at` (court space) for `dur` seconds of view time. */
  heroZoom(at: THREE.Vector3, dur: number) {
    this.zoom = { at: at.clone(), t: 0, dur, side: this.side };
  }

  get zooming() {
    return this.zoom !== null;
  }

  /** Place the camera. `m` = court → world. */
  update(dt: number, f: CameraFrame, m: THREE.Matrix4) {
    const K = this.court;
    const k = (rate: number) => (this.first ? 1 : 1 - Math.exp(-rate * dt));
    let fov: number;
    if (this.mode === 'broadcast') {
      // Side-on from the stands, a little above: follows the ball down the
      // floor, leaning toward the basket in play
      const bz = THREE.MathUtils.clamp(
        f.ball.z * 0.75 + f.rim.z * 0.18,
        -K.length / 2 + 3,
        K.length / 2 - 3,
      );
      _t.set(f.ball.x * 0.45, 1.1 + Math.min(f.ball.y, 4) * 0.25, bz);
      _p.set(_t.x + this.side * this.broadcastDist, this.broadcastDist * 0.5, bz * 0.94);
      fov = this.baseFov.broadcast;
    } else {
      // Behind your player, looking up the floor at the rim
      const me = f.me ?? f.ball;
      _d.subVectors(f.rim, me).setY(0);
      if (_d.lengthSq() < 0.5) _d.set(Math.sin(f.meYaw), 0, Math.cos(f.meYaw));
      _d.normalize();
      _p.copy(me).addScaledVector(_d, -6.2);
      _p.y = 3.4 + Math.max(0, me.y) * 0.5;
      _t.copy(me).addScaledVector(_d, 3.2);
      _t.y = 1.6;
      // Keep the ball in shot when it's away from you
      _t.lerp(f.ball, 0.25);
      fov = this.baseFov.chase;
    }
    // Hero zoom: low and tight on the rim / dunker
    if (this.zoom !== null) {
      const z = this.zoom;
      z.t += dt;
      const inK = THREE.MathUtils.smoothstep(z.t, 0, 0.35);
      const outK = 1 - THREE.MathUtils.smoothstep(z.t, z.dur - 0.5, z.dur);
      this.zoomBlend = Math.min(inK, outK);
      const zp = new THREE.Vector3(
        z.at.x + this.side * 5.4,
        Math.max(1.4, z.at.y + 0.1),
        z.at.z - Math.sign(z.at.z || 1) * 2.2,
      );
      // Slow orbit while it lasts
      const ang = (z.t / z.dur - 0.5) * 0.5;
      zp.sub(z.at)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), ang)
        .add(z.at);
      _p.lerp(zp, this.zoomBlend);
      _t.lerp(z.at, this.zoomBlend);
      fov = THREE.MathUtils.lerp(fov, 50, this.zoomBlend);
      if (z.t >= z.dur) this.zoom = null;
    } else this.zoomBlend = 0;
    const rate = this.zoomBlend > 0 ? 9 : this.mode === 'broadcast' ? 3.2 : 5;
    this.pos.lerp(_p, k(rate));
    this.look.lerp(_t, k(rate * 1.6));
    if (this.first) {
      this.pos.copy(_p);
      this.look.copy(_t);
    }
    this.fov += (fov - this.fov) * k(4);
    this.first = false;
    // Shake
    this.shakeT += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    const s = this.shakeAmt * this.shakeAmt * 0.18;
    _p.copy(this.pos);
    _t.copy(this.look);
    if (s > 0) {
      const q = this.shakeT;
      _p.x += (Math.sin(q * 57) + Math.sin(q * 91) * 0.5) * s;
      _p.y += (Math.sin(q * 73 + 1) + Math.sin(q * 39) * 0.5) * s;
      _t.y += Math.sin(q * 64 + 2) * s * 0.6;
    }
    _p.applyMatrix4(m);
    _t.applyMatrix4(m);
    this.camera.position.copy(_p);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_t);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap next frame (mode switches, teleports). */
  cut() {
    this.first = true;
  }
}

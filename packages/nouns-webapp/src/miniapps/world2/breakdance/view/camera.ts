// ── Battle camera: orbits the dancer, punches in, wide crowd shots ──────
//
// Works in cypher space (cypher.ts) and writes the game's
// PerspectiveCamera in world space through the cypher matrix. It only
// writes while a battle view is mounted; the view saves the camera on
// mount and puts it back on unmount, so the skate camera picks up exactly
// where it left off.

import * as THREE from 'three';

import { JUDGES_AT } from './cypher';

export type ShotKind = 'intro' | 'dancer' | 'punch' | 'wide' | 'judges' | 'winner';

export interface ShotFrame {
  shot: ShotKind;
  /** Subject (cypher space): the dancer's hips (its height frames the shot), the winner. */
  focus: THREE.Vector3;
  beat: number;
  /** Slower orbit (the local player is dancing and needs to read their Noun). */
  calm: boolean;
}

/**
 * Close shots orbit on the judges' side of the circle (−z, looking at the DJ
 * booth), sweeping ±`span` rad: the crews wait at x = ±3.8 m, right on a
 * close orbit's radius, so the camera never swings round through them.
 */
export function closeAngle(orbit: number, span: number) {
  return Math.PI + Math.sin(orbit) * span;
}

/** Orbit position for a shot (cypher space). Pure, for tests. */
export function shotPose(
  f: ShotFrame,
  orbit: number,
  out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number },
) {
  const fc = f.focus;
  switch (f.shot) {
    case 'intro': {
      // High crane, swinging round the whole cypher
      const a = orbit * 0.6 + 0.6;
      // (high enough to clear the light poles and the crowd's heads)
      out.pos.set(Math.sin(a) * 9.5, 6.6, Math.cos(a) * 9.5);
      out.look.set(0, 0.9, 0);
      out.fov = 46;
      break;
    }
    case 'wide': {
      const a = orbit * 0.4 + 2.2;
      out.pos.set(Math.sin(a) * 10.5, 6.2, Math.cos(a) * 10.5);
      out.look.set(0, 1.1, 0);
      out.fov = 48;
      break;
    }
    case 'judges': {
      out.pos.set(JUDGES_AT.x + Math.sin(orbit * 0.3) * 0.6, 1.75, JUDGES_AT.z + 3.6);
      out.look.set(JUDGES_AT.x, 1.45, JUDGES_AT.z);
      out.fov = 50;
      break;
    }
    case 'winner': {
      const a = closeAngle(orbit * 0.5, 0.8);
      out.pos.set(fc.x + Math.sin(a) * 4.4, 1.6, fc.z + Math.cos(a) * 4.4);
      out.look.set(fc.x, 1.0 + 0.4 * fc.y, fc.z);
      out.fov = 44;
      break;
    }
    case 'punch': {
      // Low and tight on the floor work
      const a = closeAngle(orbit * 1.3 + 0.6, 0.7);
      out.pos.set(fc.x + Math.sin(a) * 4.1, 0.95 + 0.35 * fc.y, fc.z + Math.cos(a) * 4.1);
      out.look.set(fc.x, 0.45 + 0.6 * fc.y, fc.z);
      out.fov = 46;
      break;
    }
    default: {
      // Three-quarter on the dancer, slowly orbiting
      const a = closeAngle(orbit, 0.9);
      out.pos.set(fc.x + Math.sin(a) * 5.2, 1.55 + 0.35 * fc.y, fc.z + Math.cos(a) * 5.2);
      out.look.set(fc.x, 0.75 + 0.6 * fc.y, fc.z);
      out.fov = 44;
    }
  }
  return out;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

export class BattleCamera {
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  private fov = 46;
  private orbit = 0;
  private lastBeat = 0;
  private first = true;
  private shot: ShotKind = 'intro';
  private shotT = 0;
  private punch = 0;
  private shakeAmt = 0;
  private time = 0;
  private want = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 46 };

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Snap next frame (mount, a hard cut). */
  cut() {
    this.first = true;
  }

  /** A beat-synced zoom kick (downbeats, freezes). */
  kick(k = 1) {
    this.punch = Math.max(this.punch, k);
  }

  shake(k = 1) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + k);
  }

  get current() {
    return this.shot;
  }

  update(dt: number, f: ShotFrame, m: THREE.Matrix4) {
    this.time += dt;
    if (f.shot !== this.shot) {
      // Wide ↔ close changes are cuts; the rest swoop
      const far = (s: ShotKind) => s === 'wide' || s === 'intro' || s === 'judges';
      if (far(f.shot) !== far(this.shot)) this.first = true;
      this.shot = f.shot;
      this.shotT = 0;
    }
    this.shotT += dt;
    // Orbit on the beat clock: ~a lap every 23 bars (slower while the local player is up)
    const rate0 = f.calm ? 0.35 : 0.7;
    this.orbit += ((Math.PI * 2) / 64) * rate0 * Math.max(0, f.beat - this.lastBeat);
    if (Math.abs(f.beat - this.lastBeat) > 4) this.orbit = 0;
    this.lastBeat = f.beat;
    shotPose(f, this.orbit, this.want);
    const k = (rate: number) => (this.first ? 1 : 1 - Math.exp(-rate * dt));
    const rate = this.shot === 'punch' ? 4 : this.shot === 'dancer' ? 2.6 : 1.8;
    this.pos.lerp(this.want.pos, k(rate));
    this.look.lerp(this.want.look, k(rate * 1.7));
    this.fov += (this.want.fov - this.fov) * k(3);
    this.first = false;
    this.punch = Math.max(0, this.punch - dt * 4);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    const fov = this.fov - this.punch * 3.5;
    _p.copy(this.pos);
    _t.copy(this.look);
    const s = this.shakeAmt * this.shakeAmt * 0.08;
    if (s > 0) {
      const q = this.time;
      _p.x += Math.sin(q * 53) * s;
      _p.y += Math.sin(q * 71 + 1) * s;
      _t.y += Math.sin(q * 61 + 2) * s * 0.5;
    }
    _p.applyMatrix4(m);
    _t.applyMatrix4(m);
    this.camera.position.copy(_p);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_t);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }
}

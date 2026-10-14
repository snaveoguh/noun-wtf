// ── Instant replay: a ghost of your rider along a recorded ride ──
//
// Plays a RideRun back in slow motion (0.25× / 0.5× / 1×) while the real
// game is paused: a see-through copy of the rider follows the trace
// (sampleRun interpolates it), posed from its state (ground / air / grind /
// manual / bail), with a chase camera. The camera is put back exactly where
// it was on exit; the game itself never moved.

import type { RideRun } from '../net/Stats';

import * as THREE from 'three';

import { runLength, sampleRun, STATE_NAMES, type RunFrame } from './sampleRun';

/** What a replay needs from the game. */
export interface ReplayHost {
  scene(): THREE.Scene;
  camera(): THREE.PerspectiveCamera;
  /** A fresh copy of the player's rider (null before the assets load). */
  makeRider(): ReplayRider | null;
}

/** The parts of NounCharacter a ghost uses. */
export interface ReplayRider {
  root: THREE.Object3D;
  board: THREE.Object3D;
  play(p: { clip: string; once?: boolean; fade?: number; timeScale?: number }): void;
  update(
    dt: number,
    opts: { lean: number; travelled: number; riding?: boolean; grounded?: boolean },
  ): void;
  dispose(): void;
}

export const REPLAY_RATES = [0.25, 0.5, 1] as const;
export type ReplayRate = (typeof REPLAY_RATES)[number];

export interface ReplayReadout {
  /** What's playing. */
  title: string;
  t: number;
  length: number;
  rate: ReplayRate;
  playing: boolean;
  kmh: number;
  state: (typeof STATE_NAMES)[number];
  airM: number;
  airS: number;
  /** Best air of the run so far (height, time). */
  peakM: number;
  peakS: number;
}

const CLIPS: Record<number, { clip: string; once?: boolean; fade: number }> = {
  0: { clip: 'skate_idle', fade: 0.25 },
  1: { clip: 'skate_air', fade: 0.2 },
  2: { clip: 'skate_grind', fade: 0.1 },
  3: { clip: 'skate_manual', fade: 0.15 },
  4: { clip: 'skate_bail', once: true, fade: 0.08 },
};

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();

export class ReplayView {
  active = false;
  run: RideRun | null = null;
  title = '';
  t = 0;
  rate: ReplayRate = 0.25;
  playing = true;
  /** Where the replay is (the world streams around it instead of the player). */
  focus = new THREE.Vector3();
  focusVel = new THREE.Vector3();
  private ghost: ReplayRider | null = null;
  private yaw = 0;
  private camPos = new THREE.Vector3();
  private saved: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;
  private frame: RunFrame | null = null;
  private lastState = -1;
  private ghostlyAt = -1;
  private peakM = 0;
  private peakS = 0;
  private listeners = new Set<() => void>();
  private emitAcc = 0;
  /** Stopped (by the overlay, Esc or the end): the game picks up from here. */
  onStop?: () => void;

  constructor(private host: ReplayHost) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  start(run: RideRun, title: string, rate?: ReplayRate) {
    if (run.samples.length < 12) return false;
    this.stopGhost();
    this.run = run;
    this.title = title;
    this.t = 0;
    this.playing = true;
    if (rate !== undefined) this.rate = rate;
    this.peakM = 0;
    this.peakS = 0;
    this.lastState = -1;
    const cam = this.host.camera();
    if (!this.active)
      this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    this.active = true;
    this.ghost = this.host.makeRider();
    if (this.ghost) this.host.scene().add(this.ghost.root);
    this.place(0, true);
    this.emit();
    return true;
  }

  stop() {
    if (!this.active) return;
    this.stopGhost();
    const cam = this.host.camera();
    if (this.saved) {
      cam.position.copy(this.saved.pos);
      cam.quaternion.copy(this.saved.quat);
      cam.fov = this.saved.fov;
      cam.updateProjectionMatrix();
    }
    this.saved = null;
    this.active = false;
    this.run = null;
    this.onStop?.();
    this.emit();
  }

  private stopGhost() {
    const g = this.ghost;
    if (!g) return;
    // The see-through materials are this ghost's own copies
    g.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.ghost !== true) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
    g.dispose();
    this.ghost = null;
  }

  setRate(r: ReplayRate) {
    this.rate = r;
    this.emit();
  }
  togglePlay() {
    // At the end, play starts over
    if (!this.playing && this.run && this.t >= runLength(this.run.samples)) this.t = 0;
    this.playing = !this.playing;
    this.emit();
  }
  seek(t: number) {
    if (!this.run) return;
    this.t = Math.max(0, Math.min(t, runLength(this.run.samples)));
    this.place(0, true);
    this.emit();
  }

  get length() {
    return this.run ? runLength(this.run.samples) : 0;
  }

  readout(): ReplayReadout | null {
    const f = this.frame;
    if (!this.active || f === null) return null;
    return {
      title: this.title,
      t: this.t,
      length: this.length,
      rate: this.rate,
      playing: this.playing,
      kmh: f.speed * 3.6,
      state: STATE_NAMES[f.state] ?? 'GROUND',
      airM: f.airM,
      airS: f.airS,
      peakM: this.peakM,
      peakS: this.peakS,
    };
  }

  /** One frame of real time (`dt` s): advance at the chosen rate, place the ghost + camera. */
  step(dt: number) {
    if (!this.active || !this.run) return;
    const len = this.length;
    const sdt = this.playing ? dt * this.rate : 0;
    if (this.playing) {
      this.t += sdt;
      if (this.t >= len) {
        this.t = len;
        this.playing = false;
      }
    }
    this.place(sdt, false);
    this.emitAcc += dt;
    if (this.emitAcc > 1 / 15) {
      this.emitAcc = 0;
      this.emit();
    }
  }

  private place(sdt: number, snap: boolean) {
    const run = this.run!;
    const f = sampleRun(run.samples, this.t);
    this.frame = f;
    if (f.state === 1) {
      this.peakM = Math.max(this.peakM, f.airM);
      this.peakS = Math.max(this.peakS, f.airS);
    }
    this.focus.set(f.x, f.y, f.z);
    this.focusVel.set(f.vx, f.vy, f.vz).multiplyScalar(this.rate);

    // Heading from the velocity (kept while near-stopped), eased so a
    // jittery sample doesn't whip the rider round
    const h = Math.hypot(f.vx, f.vz);
    if (h > 0.3) {
      const want = Math.atan2(f.vx, f.vz);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw = snap ? want : this.yaw + d * (1 - Math.exp(-10 * Math.max(sdt, 1 / 240)));
    }
    // Nose follows the slope on the ground; level-ish in the air
    const pitch =
      f.state === 1 ? -0.25 * Math.atan2(f.vy, Math.max(h, 1)) : -Math.atan2(f.vy, Math.max(h, 1));

    const g = this.ghost;
    if (g) {
      g.root.position.copy(this.focus);
      _e.set(pitch, this.yaw, 0);
      g.root.quaternion.setFromEuler(_e);
      g.board.visible = true;
      if (f.state !== this.lastState) {
        g.play(CLIPS[f.state] ?? CLIPS[0]);
        this.lastState = f.state;
      }
      g.update(sdt, {
        lean: 0,
        travelled: f.state === 1 || f.state === 4 ? 0 : f.speed * sdt,
        riding: f.state !== 4,
        grounded: f.state === 0 || f.state === 3,
      });
      // See-through (its materials are its own copies; the head loads late)
      if (this.ghostlyAt < 0 || performance.now() - this.ghostlyAt > 500) {
        this.ghostlyAt = performance.now();
        ghostly(g.root);
      }
    }

    // Chase camera: behind the line of travel, a little above, further back at speed
    const cam = this.host.camera();
    const back = 6 + Math.min(10, f.speed * 0.04);
    _v.set(-Math.sin(this.yaw) * back, 2.4 + back * 0.15, -Math.cos(this.yaw) * back).add(
      this.focus,
    );
    if (snap) this.camPos.copy(_v);
    else this.camPos.lerp(_v, 1 - Math.exp(-12 * Math.max(sdt, 1 / 120)));
    cam.position.copy(this.camPos);
    cam.lookAt(this.focus.x, this.focus.y + 1, this.focus.z);
  }
}

/** Give every mesh under `root` its own see-through material (once). */
function ghostly(root: THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.ghost === true) return;
    m.userData.ghost = true;
    const make = (mat: THREE.Material) => {
      const c = mat.clone();
      c.transparent = true;
      c.opacity = 0.55;
      c.depthWrite = true;
      if ('emissive' in c) {
        (c as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x66ccff);
        (c as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
      }
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(make) : make(m.material);
  });
}

// ── The cue stick, and its stroke ───────────────────────────────────────
//
// Tip at the group's origin, the stick running back along −Z, the butt
// raised a few degrees. While aiming it sits back from the cue ball by the
// power you've pulled; on a shot it pulls back a touch more, drives through
// the ball (STROKE seconds, the moment the sim's playback starts), follows
// through and fades away while the balls roll.

import * as THREE from 'three';

export const CUE_LEN = 1.45;
/** Seconds from the start of the forward stroke to the tip meeting the ball. */
export const STROKE = 0.12;
const ELEV = 0.07;

export class CueStick {
  readonly group = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private shaft = new THREE.Group();
  /** −1 idle, else seconds since the stroke began. */
  private strokeT = -1;
  private strokeFrom = 0;
  private fade = 1;

  constructor() {
    const parts: [number, number, number, number, number][] = [
      // [length, r0 (tip end), r1, colour, roughness]
      [0.012, 0.0062, 0.0062, 0x2f6fd0, 0.9], // chalked tip
      [0.022, 0.0064, 0.0066, 0xf4f0e6, 0.4], // ferrule
      [0.72, 0.0066, 0.0098, 0xe8cf9a, 0.5], // maple shaft
      [0.03, 0.0098, 0.0102, 0x1a1a1a, 0.4], // joint
      [0.44, 0.0102, 0.0132, 0x5a2410, 0.45], // butt
      [0.03, 0.0132, 0.0135, 0xd9b44a, 0.3], // ring
      [0.196, 0.0135, 0.0145, 0x161616, 0.6], // wrap
    ];
    let z = 0;
    for (const [len, r0, r1, col, rough] of parts) {
      const g = new THREE.CylinderGeometry(r0, r1, len, 10, 1).rotateX(Math.PI / 2);
      g.translate(0, 0, -(z + len / 2));
      const m = new THREE.MeshStandardMaterial({ color: col, roughness: rough, transparent: true });
      this.geos.push(g);
      this.mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      this.shaft.add(mesh);
      z += len;
    }
    this.shaft.rotation.x = ELEV;
    this.group.add(this.shaft);
    this.group.visible = false;
  }

  /** Has the stroke reached the ball? */
  get striking(): boolean {
    return this.strokeT >= 0;
  }

  /** Begin the forward stroke from the current pull. */
  stroke(pull: number) {
    this.strokeT = 0;
    this.strokeFrom = pull;
  }

  /**
   * Place it: tip `gap` behind the cue ball (local frame point `at`, unit
   * direction (dx, dz) in the table plane).
   */
  aim(at: THREE.Vector3, dx: number, dz: number, pull: number, ballR: number) {
    this.strokeT = -1;
    this.fade = 1;
    this.place(at, dx, dz, ballR + 0.012 + pull);
    this.setOpacity(1);
    this.group.visible = true;
  }

  private place(at: THREE.Vector3, dx: number, dz: number, back: number) {
    this.group.position.set(at.x - dx * back, at.y, at.z - dz * back);
    this.group.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  /** Per frame during a shot (after aim set the line). */
  update(dt: number, at: THREE.Vector3 | null, dx: number, dz: number, ballR: number) {
    if (this.strokeT < 0) return;
    this.strokeT += dt;
    const t = this.strokeT;
    let back: number;
    if (t < STROKE) {
      // Accelerating into the ball
      const k = t / STROKE;
      back = this.strokeFrom * (1 - k * k) + 0.012 * (1 - k);
    } else {
      // Follow through, then fade out
      const k = Math.min(1, (t - STROKE) / 0.18);
      back = -0.07 * Math.sin(k * Math.PI * 0.5);
      this.fade = Math.max(0, 1 - (t - STROKE - 0.35) / 0.35);
      if (this.fade <= 0) {
        // Done: put away until the next shot's lined up
        this.strokeT = -1;
        this.group.visible = false;
        return;
      }
    }
    if (at !== null) this.place(at, dx, dz, ballR + back);
    this.setOpacity(this.fade);
    this.group.visible = this.fade > 0.01;
  }

  hide() {
    this.strokeT = -1;
    this.group.visible = false;
  }

  private setOpacity(o: number) {
    for (const m of this.mats) {
      m.opacity = o;
      m.depthWrite = o > 0.99;
    }
  }

  /** Where the hands go (local frame of the table): bridge near the tip, back hand on the wrap. */
  hands(out: { bridge: THREE.Vector3; back: THREE.Vector3 }) {
    const g = this.group;
    g.updateMatrix();
    const m = new THREE.Matrix4().makeRotationX(ELEV).premultiply(g.matrix);
    out.bridge.set(0, 0, -0.24).applyMatrix4(m);
    out.back.set(0, 0, -1.2).applyMatrix4(m);
    return out;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.group.removeFromParent();
  }
}

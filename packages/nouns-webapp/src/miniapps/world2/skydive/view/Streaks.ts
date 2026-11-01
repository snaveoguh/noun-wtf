// ── Wind streaks: still specks of air the rider falls through ────────────
//
// Points scattered in a box round the rider, fixed in the world, drawn as
// short lines along the rider's velocity, so at speed they streak past. A
// speck that leaves the box wraps to its far side. One LineSegments.

import * as THREE from 'three';

const N = 70;
const HALF = 14;

export class Streaks {
  readonly lines: THREE.LineSegments;
  private pts = new Float32Array(N * 3);
  private seeded = false;
  private mat: THREE.LineBasicMaterial;

  constructor(parent: THREE.Object3D) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.name = 'skydive-streaks';
    parent.add(this.lines);
  }

  /** `k` 0..1 strength (0 hides), around `at`, streaking along `vel`. */
  update(k: number, at: THREE.Vector3, vel: THREE.Vector3) {
    this.lines.visible = k > 0.01;
    if (!this.lines.visible) {
      this.seeded = false;
      return;
    }
    this.mat.opacity = 0.45 * k;
    const p = this.pts;
    if (!this.seeded) {
      for (let i = 0; i < N; i++) {
        p[i * 3] = at.x + (Math.random() * 2 - 1) * HALF;
        p[i * 3 + 1] = at.y + (Math.random() * 2 - 1) * HALF;
        p[i * 3 + 2] = at.z + (Math.random() * 2 - 1) * HALF;
      }
      this.seeded = true;
    }
    const a = this.lines.geometry.attributes.position as THREE.BufferAttribute;
    const len = 0.045;
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < 3; c++) {
        const o = c === 0 ? at.x : c === 1 ? at.y : at.z;
        let v = p[i * 3 + c]!;
        if (v - o > HALF) v -= 2 * HALF;
        else if (v - o < -HALF) v += 2 * HALF;
        p[i * 3 + c] = v;
      }
      const x = p[i * 3]!;
      const y = p[i * 3 + 1]!;
      const z = p[i * 3 + 2]!;
      a.setXYZ(i * 2, x, y, z);
      a.setXYZ(i * 2 + 1, x + vel.x * len, y + vel.y * len, z + vel.z * len);
    }
    a.needsUpdate = true;
  }

  dispose() {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.mat.dispose();
  }
}

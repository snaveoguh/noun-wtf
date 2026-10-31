// ── Birds round NOUNS CAMP: a small flock circling the tower top ─────────
//
// Dark silhouettes against the sunset, wheeling past the window (they're
// in the opening shot, and out of the window after). One InstancedMesh, a
// V of two triangles each that flaps by flipping its y scale. Animated
// only while the camera is near. Where each bird is (`birdAt`) is pure.

import type { CampSite } from './site';

import * as THREE from 'three';

export const BIRDS = 14;

export interface BirdPose {
  x: number;
  y: number;
  z: number;
  /** Heading (yaw, radians). */
  yaw: number;
  /** Wing beat, −1…1. */
  flap: number;
}

/**
 * Bird `i` at time `t` (s): an ellipse out in front of the plaza face
 * (never inside the tower), each bird its own lap time, height and bob.
 */
export function birdAt(site: CampSite, i: number, t: number): BirdPose {
  const k = (i * 0.618034) % 1;
  const cx = site.origin.x + (k - 0.5) * 6;
  const cz = site.faceZ - 30;
  const rx = 22 + k * 8;
  const rz = 12 + ((i * 7) % 5);
  const speed = 0.12 + k * 0.05;
  const a = t * speed + i * 0.45;
  const x = cx + Math.cos(a) * rx;
  const z = cz + Math.sin(a) * rz;
  const y = site.floorY + 1 + ((i * 5) % 9) + Math.sin(t * 0.7 + i) * 1.2;
  // Moving along the ellipse: d/da (cos a·rx, sin a·rz)
  const yaw = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
  const flap = Math.sin(t * (7 + k * 3) + i * 1.7);
  return { x, y, z, yaw, flap };
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private static readonly Y = new THREE.Vector3(0, 1, 0);

  constructor(private readonly site: CampSite) {
    // A V of two wings, tips raised, nose along +z
    const g = new THREE.BufferGeometry();
    // prettier-ignore
    const v = [
      0, 0, 0.18, -0.48, 0.16, -0.08, 0, 0, -0.14,
      0, 0, 0.18, 0, 0, -0.14, 0.48, 0.16, -0.08,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2b1a26, side: THREE.DoubleSide });
    mat.name = 'camp_birds';
    this.mesh = new THREE.InstancedMesh(g, mat, BIRDS);
    this.mesh.name = 'CampBirds';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.update(0);
    // Bounds over the whole flight (they never leave it)
    const o = site.origin;
    this.mesh.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(o.x, site.floorY + 5, site.faceZ - 30),
      45,
    );
  }

  update(t: number) {
    for (let i = 0; i < BIRDS; i++) {
      const b = birdAt(this.site, i, t);
      this.q.setFromAxisAngle(Birds.Y, b.yaw);
      this.s.set(1, 0.25 + 0.75 * b.flap, 1);
      this.m.compose(this.p.set(b.x, b.y, b.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}

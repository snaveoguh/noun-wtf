// ── Noun Golf: the ball, its trail, the aim guide and the cup marker ─────
//
// Everything a shot needs on screen besides the course itself, drawn with
// a handful of cheap, unlit materials (built once and warmed with the
// rest of the scene, so nothing links mid-round):
//
//   ball      a white sphere (drawn ~3× real size: a 43 mm ball is a speck
//             at 20 m) and a soft beacon over it when it's far
//   trail     the flight so far (a line, grown with setDrawRange)
//   aim       a dashed ribbon of dots along the aim to the predicted carry,
//             a landing ring there; on the green, the putt line and dots
//             showing which way the green falls round the hole
//   cup       a ring round the hole while you're putting

import type { V3 } from '../contract';

import * as THREE from 'three';

const TRAIL_MAX = 1400;
const DOTS = 48;
const SLOPE_DOTS = 169;

export class BallView {
  readonly group = new THREE.Group();
  readonly ball: THREE.Mesh;
  private beacon: THREE.Mesh;
  private trail: THREE.Line;
  private trailPos: Float32Array;
  private dots: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private cup: THREE.Mesh;
  private slope: THREE.InstancedMesh;
  private mats: THREE.Material[] = [];
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3();
  private _p = new THREE.Vector3();
  private _c = new THREE.Color();

  constructor(parent: THREE.Object3D) {
    this.group.name = 'golf-play';
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xfff3a0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe14a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const slopeMat = new THREE.MeshBasicMaterial({
      vertexColors: false,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.mats.push(white, beaconMat, trailMat, dotMat, ringMat, slopeMat);

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), white);
    this.ball.name = 'golf-ball';
    this.group.add(this.ball);

    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true), beaconMat);
    this.beacon.geometry.translate(0, 15, 0);
    this.beacon.renderOrder = 3;
    this.group.add(this.beacon);

    this.trailPos = new Float32Array(TRAIL_MAX * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, trailMat);
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    this.dots = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.22, 10).rotateX(-Math.PI / 2),
      dotMat,
      DOTS,
    );
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    this.dots.renderOrder = 4;
    this.group.add(this.dots);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 32).rotateX(-Math.PI / 2), ringMat);
    this.ring.renderOrder = 4;
    this.group.add(this.ring);

    this.cup = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.24, 24).rotateX(-Math.PI / 2),
      ringMat,
    );
    this.cup.renderOrder = 4;
    this.group.add(this.cup);

    // A little arrowhead per dot (pointing down the slope), coloured by steepness
    const arrow = new THREE.BufferGeometry();
    arrow.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0.32, -0.16, 0, -0.16, 0.16, 0, -0.16]), 3),
    );
    this.slope = new THREE.InstancedMesh(arrow, slopeMat, SLOPE_DOTS);
    this.slope.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(SLOPE_DOTS * 3),
      3,
    );
    this.slope.frustumCulled = false;
    this.slope.count = 0;
    this.slope.renderOrder = 4;
    this.group.add(this.slope);

    this.hideGuides();
    parent.add(this.group);
  }

  /** Every mesh, for shader warm-up. */
  get meshes(): THREE.Object3D[] {
    return [this.ball, this.beacon, this.trail, this.dots, this.ring, this.cup, this.slope];
  }

  setBall(p: V3, camDist: number) {
    this.ball.position.set(p.x, p.y + 0.065, p.z);
    // A real-size-ish ball near the camera, bigger far away so you can follow it
    const s = THREE.MathUtils.clamp(camDist / 14, 1, 6);
    this.ball.scale.setScalar(s);
    this.beacon.position.set(p.x, p.y, p.z);
    this.beacon.visible = camDist > 45;
    this.beacon.scale.set(Math.min(4, camDist / 60), 1, Math.min(4, camDist / 60));
  }

  showBall(on: boolean) {
    this.ball.visible = on;
    if (!on) this.beacon.visible = false;
  }

  clearTrail() {
    this.trail.geometry.setDrawRange(0, 0);
  }

  /** Trail along path[0..k] (+ the in-between point `tip`). */
  setTrail(path: V3[], k: number, tip: V3) {
    const n = Math.min(TRAIL_MAX - 1, k + 1);
    const a = this.trailPos;
    for (let i = 0; i < n; i++) {
      const p = path[Math.max(0, k + 1 - n + i)];
      a[i * 3] = p.x;
      a[i * 3 + 1] = p.y + 0.065;
      a[i * 3 + 2] = p.z;
    }
    a[n * 3] = tip.x;
    a[n * 3 + 1] = tip.y + 0.065;
    a[n * 3 + 2] = tip.z;
    const g = this.trail.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, n + 1);
  }

  hideGuides() {
    this.dots.count = 0;
    this.ring.visible = false;
    this.cup.visible = false;
    this.slope.count = 0;
  }

  /** Dots from the ball along `pts` (ground points), a ring at the last. */
  setGuide(pts: V3[], ring: boolean, ringR = 2.4) {
    const n = Math.min(DOTS, pts.length);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const s = 0.55 + 0.45 * (1 - i / Math.max(1, n));
      this._m.compose(this._p.set(p.x, p.y + 0.06, p.z), this._q.identity(), this._s.set(s, 1, s));
      this.dots.setMatrixAt(i, this._m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.ring.visible = ring && n > 0;
    if (this.ring.visible) {
      const p = pts[n - 1];
      this.ring.position.set(p.x, p.y + 0.08, p.z);
      this.ring.scale.setScalar(ringR / 2.4);
    }
  }

  /** Where the landing ring is (null when hidden). */
  ringAt(): V3 | null {
    return this.ring.visible
      ? { x: this.ring.position.x, y: this.ring.position.y, z: this.ring.position.z }
      : null;
  }

  setCup(pin: V3 | null) {
    this.cup.visible = pin !== null;
    if (pin !== null) this.cup.position.set(pin.x, pin.y + 0.03, pin.z);
  }

  /**
   * Slope dots round the hole: each points downhill, yellow → red with
   * steepness (`fall` returns the fall vector and its size at a point).
   */
  setSlope(points: { x: number; y: number; z: number; dx: number; dz: number; g: number }[]) {
    const n = Math.min(SLOPE_DOTS, points.length);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const yaw = Math.atan2(p.dx, p.dz);
      const s = 0.7 + Math.min(1.6, p.g * 30);
      this._q.setFromAxisAngle(this._s.set(0, 1, 0), yaw);
      this._m.compose(this._p.set(p.x, p.y + 0.05, p.z), this._q, this._s.set(s, 1, s));
      this.slope.setMatrixAt(i, this._m);
      const k = Math.min(1, p.g / 0.05);
      this._c.setRGB(1, 1 - k * 0.8, 0.25 * (1 - k));
      this.slope.setColorAt(i, this._c);
    }
    this.slope.count = n;
    this.slope.instanceMatrix.needsUpdate = true;
    if (this.slope.instanceColor) this.slope.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    for (const m of this.mats) m.dispose();
  }
}

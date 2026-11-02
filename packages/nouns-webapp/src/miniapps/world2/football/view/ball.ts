// ── The football: a low-poly panelled ball, its spin, a blob shadow, a
//    trail on hard shots. Three draws (the trail only while it shows). ──

import type { BallState } from '../contract';

import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Black pentagon patches round the 12 icosahedron vertices on a subdivided ball (vertex colours). */
export function ballGeometry(r: number, detail = 2): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail).toNonIndexed();
  const base = new THREE.IcosahedronGeometry(1, 0);
  const pos = base.getAttribute('position');
  const verts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    if (!verts.some(u => u.distanceToSquared(v) < 1e-6)) verts.push(v);
  }
  base.dispose();
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const a = new THREE.Vector3();
  for (let f = 0; f < p.count; f += 3) {
    a.set(0, 0, 0);
    for (let k = 0; k < 3; k++) a.add(_c.fromBufferAttribute(p, f + k));
    a.normalize();
    const black = verts.some(v => v.dot(a) > 0.93);
    const c = black ? 0.06 : 0.96;
    for (let k = 0; k < 3; k++) colors.set([c, c, black ? 0.08 : 0.94], (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

let blobTex: THREE.CanvasTexture | null = null;
let blobUsers = 0;

/** A soft round shadow (64 px, shared). Call releaseBlob() for each blobTexture(). */
export function blobTexture(): THREE.CanvasTexture {
  blobUsers++;
  if (blobTex !== null) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export function releaseBlob() {
  blobUsers = Math.max(0, blobUsers - 1);
  if (blobUsers === 0 && blobTex !== null) {
    blobTex.dispose();
    blobTex = null;
  }
}

const TRAIL_N = 18;
/** Ball speed (m/s) a trail starts to show at. */
export const TRAIL_SPEED = 21;

export class BallView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  private trailFade = 0;
  private lastPos = new THREE.Vector3(NaN, 0, 0);

  constructor(
    readonly r: number,
    low: boolean,
  ) {
    this.group.name = 'football-ball';
    const geo = ballGeometry(r, low ? 1 : 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, name: 'fb-ball' }),
    );
    this.mesh.castShadow = !low;
    this.group.add(this.mesh);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        name: 'fb-ball-shadow',
      }),
    );
    this.shadow.renderOrder = 2;
    this.group.add(this.shadow);
    // Trail: a camera-facing ribbon through the last positions
    const g = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_N * 2 * 3);
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.trail = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        name: 'fb-ball-trail',
        userData: { noToon: true },
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.group.add(this.trail);
  }

  /**
   * Draw the ball (pitch space). `at`: where it is (the hands for a held
   * ball, else the state's position); `eye`: the camera in pitch space (the trail faces it).
   */
  update(b: BallState, at: THREE.Vector3, dt: number, eye: THREE.Vector3) {
    const r = this.r;
    this.mesh.position.copy(at);
    const jump = Number.isNaN(this.lastPos.x) || this.lastPos.distanceTo(at) > 6;
    // Spin: the sim's, else rolling (ω = up × v / r) when it's on the grass
    _w.set(b.wx, b.wy, b.wz);
    if (_w.lengthSq() < 1e-4 && at.y < r + 0.05 && b.mode !== 'held')
      _w.set(b.vz / r, 0, -b.vx / r);
    if (b.mode === 'held') _w.set(0, 0, 0);
    const ang = _w.length() * Math.min(dt, 0.1);
    if (ang > 1e-5) {
      _q.setFromAxisAngle(_w.normalize(), ang);
      this.mesh.quaternion.premultiply(_q);
    }
    // Blob shadow on the grass, softer and smaller with height
    const h = Math.max(0, at.y - r);
    const k = 1 / (1 + h * 0.35);
    this.shadow.position.set(at.x, 0.012, at.z);
    this.shadow.scale.setScalar(r * 2.6 * (1 + h * 0.12));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
    // Trail
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const want =
      b.mode === 'free' && speed > TRAIL_SPEED ? Math.min(1, (speed - TRAIL_SPEED) / 10 + 0.4) : 0;
    this.trailFade +=
      (want - this.trailFade) * (1 - Math.exp(-(want > this.trailFade ? 20 : 4) * dt));
    if (jump) this.trailPts.length = 0;
    if (this.trailFade > 0.02) {
      this.trailPts.unshift(at.clone());
      if (this.trailPts.length > TRAIL_N) this.trailPts.length = TRAIL_N;
      this.writeTrail(eye);
      this.trail.visible = this.trailPts.length > 2;
    } else {
      this.trailPts.length = 0;
      this.trail.visible = false;
    }
    this.lastPos.copy(at);
  }

  private writeTrail(eye: THREE.Vector3) {
    const pts = this.trailPts;
    const n = pts.length;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = pts[Math.min(i, n - 1)];
      // Direction along the trail at this point (the last segment past its end)
      const j = Math.min(i, n - 2);
      if (j >= 0) _d.subVectors(pts[j], pts[j + 1]);
      else _d.set(0, 0, 0);
      if (_d.lengthSq() < 1e-8) _d.set(0, 0, 1);
      _s.subVectors(eye, p).cross(_d).normalize();
      const u = i / (TRAIL_N - 1);
      const w = this.r * 0.9 * (1 - u) * (i < n ? 1 : 0);
      const o = i * 6;
      this.trailPos[o] = p.x + _s.x * w;
      this.trailPos[o + 1] = p.y + _s.y * w;
      this.trailPos[o + 2] = p.z + _s.z * w;
      this.trailPos[o + 3] = p.x - _s.x * w;
      this.trailPos[o + 4] = p.y - _s.y * w;
      this.trailPos[o + 5] = p.z - _s.z * w;
      const c = (1 - u) * (1 - u) * this.trailFade;
      // Warm white → yellow
      this.trailCol.set([c, c * 0.92, c * 0.6, c, c * 0.92, c * 0.6], o);
    }
    const g = this.trail.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    releaseBlob();
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}

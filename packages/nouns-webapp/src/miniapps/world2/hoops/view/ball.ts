// ── The ball: toon basketball with seams, spin, a contact shadow ────────

import * as THREE from 'three';

import { glowTexture } from './fx';

let ballTex: THREE.CanvasTexture | null = null;

/**
 * Equirectangular basketball skin: pebbled orange, two crossing great-circle
 * seams and the two curved side seams (small circles round the x poles).
 */
function basketballTexture(): THREE.CanvasTexture {
  if (ballTex !== null) return ballTex;
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let j = 0; j < H; j++) {
    const th = (j / (H - 1)) * Math.PI;
    for (let i = 0; i < W; i++) {
      const ph = (i / W) * Math.PI * 2;
      // three.js SphereGeometry: x = −cos φ sin θ, y = cos θ, z = sin φ sin θ
      const x = -Math.cos(ph) * Math.sin(th);
      const y = Math.cos(th);
      const z = Math.sin(ph) * Math.sin(th);
      const w = 0.035;
      const seam = Math.abs(y) < w || Math.abs(z) < w || Math.abs(Math.abs(x) - 0.72) < w * 0.9;
      const o = (j * W + i) * 4;
      if (seam) {
        img.data[o] = 28;
        img.data[o + 1] = 14;
        img.data[o + 2] = 8;
      } else {
        const pebble = 0.9 + rnd() * 0.12;
        img.data[o] = Math.min(255, 232 * pebble);
        img.data[o + 1] = Math.min(255, 104 * pebble);
        img.data[o + 2] = Math.min(255, 32 * pebble);
      }
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  ballTex = new THREE.CanvasTexture(c);
  ballTex.colorSpace = THREE.SRGBColorSpace;
  ballTex.anisotropy = 4;
  return ballTex;
}

const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class BallView {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  /** Hot glow while on fire (additive sprite round the ball). */
  readonly glow: THREE.Sprite;
  readonly radius: number;
  readonly pos = new THREE.Vector3();
  /** Smoothed velocity (court space), for trails and the camera. */
  readonly vel = new THREE.Vector3();
  private last = new THREE.Vector3();
  private first = true;
  hot = 0;

  constructor(radius: number, low: boolean) {
    this.radius = radius;
    const mat = new THREE.MeshStandardMaterial({
      map: basketballTexture(),
      roughness: 0.75,
      emissive: new THREE.Color(0xff5a00),
      emissiveIntensity: 0,
    });
    mat.name = 'HoopsBall';
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, low ? 14 : 24, low ? 10 : 16), mat);
    this.mesh.castShadow = true;
    this.mesh.name = 'HoopsBall';
    const sm = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), sm);
    this.shadow.renderOrder = 2;
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color(1, 0.45, 0.1).multiplyScalar(2),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.scale.setScalar(radius * 7);
    this.glow.visible = false;
  }

  /** Place the ball (court space) and spin it by angular velocity w (rad / s). */
  set(p: THREE.Vector3, dt: number, w?: { x: number; y: number; z: number }) {
    this.pos.copy(p);
    if (this.first) {
      this.last.copy(p);
      this.first = false;
    }
    if (dt > 0) {
      _w.subVectors(p, this.last).divideScalar(dt);
      if (_w.lengthSq() < 900) this.vel.lerp(_w, 1 - Math.exp(-20 * dt));
    }
    this.last.copy(p);
    this.mesh.position.copy(p);
    if (w !== undefined && dt > 0) {
      _w.set(w.x, w.y, w.z);
      const a = _w.length() * dt;
      if (a > 1e-5) {
        _q.setFromAxisAngle(_w.normalize(), a);
        this.mesh.quaternion.premultiply(_q);
      }
    }
    // Contact shadow: tighter + darker as the ball nears the floor
    const h = Math.max(0, p.y - this.radius);
    this.shadow.position.set(p.x, 0.045, p.z);
    const s = this.radius * (2.4 + h * 0.5);
    this.shadow.scale.set(s, 1, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.6 / (1 + h * 0.6);
    this.glow.position.copy(p);
    this.glow.visible = this.hot > 0.01;
    this.glow.material.opacity = this.hot;
    const m = this.mesh.material as THREE.MeshStandardMaterial | THREE.MeshToonMaterial;
    if ('emissiveIntensity' in m) m.emissiveIntensity = this.hot * 0.9;
  }

  /** Roll / spin by travelled distance (dribbles, rolling on the floor). */
  roll(axis: THREE.Vector3, angle: number) {
    _q.setFromAxisAngle(axis, angle);
    this.mesh.quaternion.premultiply(_q);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.glow.material.dispose();
  }
}

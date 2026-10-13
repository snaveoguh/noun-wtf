// ── Hoops particles: flames, sparks, confetti (one draw call per pool) ──

import * as THREE from 'three';

let glowTex: THREE.Texture | null = null;

/** Soft round sprite (white, alpha falls off to the edge). */
export function glowTexture(): THREE.Texture {
  if (glowTex !== null) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const vert = /* glsl */ `
attribute float size;
attribute vec4 tint;
varying vec4 vTint;
uniform float scale;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform sampler2D map;
uniform float square;
varying vec4 vTint;
void main() {
  vec4 t = square > 0.5 ? vec4(1.0) : texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint.rgb * t.rgb, vTint.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}
`;

interface Part {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  gravity: number;
  drag: number;
}

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /** Size multiplier reached at the end of life. */
  grow?: number;
  color: THREE.Color;
  /** Colour at the end of life (defaults to `color`). */
  end?: THREE.Color;
  gravity?: number;
  drag?: number;
}

/** A fixed-size pool of point sprites in the parent's space. */
export class SpritePool {
  readonly points: THREE.Points;
  private parts: Part[] = [];
  private free: Part[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private tint: Float32Array;
  private size: Float32Array;
  readonly mat: THREE.ShaderMaterial;

  constructor(
    readonly max: number,
    opts: { additive?: boolean; square?: boolean } = {},
  ) {
    this.pos = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'tint',
      new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'size',
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        map: { value: glowTexture() },
        scale: { value: 600 },
        square: { value: opts.square === true ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  get count() {
    return this.parts.length;
  }

  emit(e: Emit) {
    if (this.parts.length >= this.max) return;
    const p = this.free.pop() ?? ({} as Part);
    const end = e.end ?? e.color;
    Object.assign(p, {
      x: e.x,
      y: e.y,
      z: e.z,
      vx: e.vx ?? 0,
      vy: e.vy ?? 0,
      vz: e.vz ?? 0,
      life: e.life,
      max: e.life,
      size: e.size,
      grow: e.grow ?? 1,
      r0: e.color.r,
      g0: e.color.g,
      b0: e.color.b,
      r1: end.r,
      g1: end.g,
      b1: end.b,
      gravity: e.gravity ?? 0,
      drag: e.drag ?? 0,
    });
    this.parts.push(p);
  }

  /** Pixel height of the viewport (point sizes are in metres at 1 m). */
  setViewport(heightPx: number, fov: number) {
    this.mat.uniforms.scale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  update(dt: number) {
    let n = 0;
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = 1 - p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.tint[n * 4] = p.r0 + (p.r1 - p.r0) * k;
      this.tint[n * 4 + 1] = p.g0 + (p.g1 - p.g0) * k;
      this.tint[n * 4 + 2] = p.b0 + (p.b1 - p.b0) * k;
      this.tint[n * 4 + 3] = Math.min(1, (p.life / p.max) * 2.2) * Math.min(1, k * 8 + 0.2);
      this.size[n] = p.size * (1 + (p.grow - 1) * k);
      ps[n++] = p;
    }
    ps.length = n;
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.tint as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.free.push(...this.parts);
    this.parts.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const FIRE_A = new THREE.Color(1.0, 0.85, 0.35).multiplyScalar(1.6);
const FIRE_B = new THREE.Color(0.95, 0.18, 0.02).multiplyScalar(0.9);
const _c = new THREE.Color();

/** Flames, sparks and confetti for the court. */
export class HoopsFx {
  readonly group = new THREE.Group();
  readonly fire: SpritePool;
  readonly confetti: SpritePool;
  private low: boolean;

  constructor(low: boolean) {
    this.low = low;
    this.fire = new SpritePool(low ? 160 : 700);
    this.confetti = new SpritePool(low ? 60 : 260, { additive: false, square: true });
    this.group.add(this.fire.points, this.confetti.points);
  }

  /** One puff of flame (call per frame per emitter; `rate` puffs / s). */
  flame(x: number, y: number, z: number, scale = 1, vx = 0, vz = 0) {
    this.fire.emit({
      x: x + (Math.random() - 0.5) * 0.08 * scale,
      y: y + (Math.random() - 0.5) * 0.05 * scale,
      z: z + (Math.random() - 0.5) * 0.08 * scale,
      vx: vx * 0.2 + (Math.random() - 0.5) * 0.4,
      vy: 0.8 + Math.random() * 1.1,
      vz: vz * 0.2 + (Math.random() - 0.5) * 0.4,
      life: 0.28 + Math.random() * 0.3,
      size: (0.16 + Math.random() * 0.12) * scale,
      grow: 0.25,
      color: FIRE_A,
      end: FIRE_B,
      drag: 1.5,
    });
  }

  /** Burst of hot sparks (dunks, rim hits). */
  sparks(x: number, y: number, z: number, n: number, power = 1) {
    const count = this.low ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 3.5) * power;
      _c.setHSL(0.08 + Math.random() * 0.07, 1, 0.6).multiplyScalar(2.2);
      this.fire.emit({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: (Math.random() * 3 + 0.5) * power,
        vz: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.45,
        size: 0.06 + Math.random() * 0.05,
        color: _c,
        end: FIRE_B,
        gravity: 9.8,
        drag: 1.2,
      });
    }
  }

  /** Ring of flame bursting off a burning net. */
  netBurn(x: number, y: number, z: number) {
    const n = this.low ? 10 : 36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.fire.emit({
        x: x + Math.cos(a) * 0.2,
        y: y - Math.random() * 0.4,
        z: z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * 1.4,
        vy: 1 + Math.random() * 2,
        vz: Math.sin(a) * 1.4,
        life: 0.5 + Math.random() * 0.4,
        size: 0.22 + Math.random() * 0.15,
        grow: 0.4,
        color: FIRE_A,
        end: FIRE_B,
        drag: 2,
      });
    }
  }

  /** Confetti shower over a point. */
  confettiAt(x: number, y: number, z: number, n: number) {
    const count = this.low ? Math.ceil(n / 4) : n;
    const cols = [0xd22209, 0xffd400, 0x3ddc84, 0x2f8bff, 0xffffff, 0xff5ec4];
    for (let i = 0; i < count; i++) {
      _c.setHex(cols[i % cols.length]);
      this.confetti.emit({
        x: x + (Math.random() - 0.5) * 6,
        y: y + Math.random() * 2,
        z: z + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 2,
        vy: 1 + Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 2,
        life: 2.5 + Math.random() * 2,
        size: 0.05 + Math.random() * 0.04,
        color: _c,
        gravity: 2.2,
        drag: 1.4,
      });
    }
  }

  setViewport(h: number, fov: number) {
    this.fire.setViewport(h, fov);
    this.confetti.setViewport(h, fov);
  }

  update(dt: number) {
    this.fire.update(dt);
    this.confetti.update(dt);
  }

  dispose() {
    this.fire.dispose();
    this.confetti.dispose();
  }
}

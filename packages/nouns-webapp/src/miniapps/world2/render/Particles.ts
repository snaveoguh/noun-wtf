// ── Lightweight GPU-point particles: grind sparks + landing dust ────────

import * as THREE from 'three';

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
}

function makeSprite(soft: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft ? 0.4 : 0.15, soft ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class PointPool {
  points: THREE.Points;
  private parts: Particle[] = [];
  private geo = new THREE.BufferGeometry();
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor(
    private max: number,
    additive: boolean,
    soft: boolean,
  ) {
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 4);
    this.sizes = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSprite(soft) }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p: Particle) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push(p);
  }

  update(dt: number, groundY: (p: THREE.Vector3) => number | null) {
    const alive: Particle[] = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const gy = p.gravity > 0 ? groundY(p.pos) : null;
      if (gy !== null && p.pos.y < gy) {
        p.pos.y = gy;
        p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      alive.push(p);
    }
    this.parts = alive;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p !== undefined) {
        const k = p.life / p.maxLife;
        this.positions[i * 3] = p.pos.x;
        this.positions[i * 3 + 1] = p.pos.y;
        this.positions[i * 3 + 2] = p.pos.z;
        this.colors[i * 4] = p.color.r;
        this.colors[i * 4 + 1] = p.color.g;
        this.colors[i * 4 + 2] = p.color.b;
        this.colors[i * 4 + 3] = k;
        this.sizes[i] = p.size * (0.4 + 0.6 * k);
      } else {
        this.sizes[i] = 0;
        this.colors[i * 4 + 3] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(1, this.parts.length));
  }
}

export class Particles {
  group = new THREE.Group();
  private sparks = new PointPool(400, true, false);
  private dust = new PointPool(250, false, true);

  constructor() {
    this.group.add(this.sparks.points, this.dust.points);
  }

  sparksAt(pos: THREE.Vector3, vel: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const v = vel
        .clone()
        .multiplyScalar(-0.25 + Math.random() * 0.3)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            Math.random() * 2.5,
            (Math.random() - 0.5) * 3,
          ),
        );
      const life = 0.25 + Math.random() * 0.35;
      this.sparks.emit({
        pos: pos.clone(),
        vel: v,
        life,
        maxLife: life,
        size: 0.035 + Math.random() * 0.03,
        color: new THREE.Color()
          .setHSL(0.09 + Math.random() * 0.05, 1, 0.6 + Math.random() * 0.3)
          .multiplyScalar(4),
        gravity: 9.8,
        drag: 1.5,
      });
    }
  }

  dustAt(pos: THREE.Vector3, amount: number, tint = new THREE.Color(0xcbbfae)) {
    const n = Math.round(6 + amount * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 1.6 * (0.5 + amount);
      const life = 0.6 + Math.random() * 0.6;
      this.dust.emit({
        pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15)),
        vel: new THREE.Vector3(Math.cos(a) * s, 0.3 + Math.random() * 0.6, Math.sin(a) * s),
        life,
        maxLife: life,
        size: 0.25 + Math.random() * 0.25,
        color: tint.clone().multiplyScalar(0.55),
        gravity: 0,
        drag: 3.5,
      });
    }
  }

  update(dt: number, groundY: (p: THREE.Vector3) => number | null) {
    this.sparks.update(dt, groundY);
    this.dust.update(dt, () => null);
  }
}

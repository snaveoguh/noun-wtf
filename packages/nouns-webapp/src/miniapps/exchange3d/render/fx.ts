// ── 3D Grand Exchange: trade effects ────────────────────────────────────
//
// Goods icons fly seller → buyer and COIN flies back on an arc (pooled
// sprites, one texture per good); big trades throw a confetti burst
// (one Points object, pooled particles).

import type { GoodId } from '../../world2/trade/contract';

import * as THREE from 'three';

import { PIT_GOODS } from '../sim/layout';

import { drawGoodIcon, GOOD_COLOR } from './boards';

type Icon = GoodId | 'COIN';

function iconTexture(icon: Icon): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = icon === 'COIN' ? '#ffcf4a' : '#ffffff';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = icon === 'COIN' ? '#9c6a12' : GOOD_COLOR[icon];
  ctx.stroke();
  if (icon === 'COIN') {
    ctx.fillStyle = '#9c6a12';
    ctx.font = '900 64px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', 64, 68);
  } else drawGoodIcon(ctx, icon, 64, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Flight {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  size: number;
  live: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const POOL = 48;
const CONFETTI = 900;

export class Fx {
  readonly group = new THREE.Group();
  private mats = new Map<Icon, THREE.SpriteMaterial>();
  private flights: Flight[] = [];
  private points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private col: Float32Array;
  private nextP = 0;

  constructor() {
    this.group.name = 'gx3d-fx';
    for (const g of [...PIT_GOODS, 'COIN' as const]) {
      this.mats.set(
        g,
        new THREE.SpriteMaterial({ map: iconTexture(g), depthTest: true, transparent: true }),
      );
    }
    for (let k = 0; k < POOL; k++) {
      const s = new THREE.Sprite(this.mats.get('COIN'));
      s.visible = false;
      this.group.add(s);
      this.flights.push({
        sprite: s,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        t: 0,
        dur: 1,
        arc: 1,
        size: 0.8,
        live: false,
      });
    }
    this.pos = new Float32Array(CONFETTI * 3);
    this.vel = new Float32Array(CONFETTI * 3);
    this.life = new Float32Array(CONFETTI);
    this.col = new Float32Array(CONFETTI * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.28, vertexColors: true, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    this.pos.fill(-9999);
    this.group.add(this.points);
  }

  /** An icon flies from a to b (world points, head height). */
  fly(icon: Icon, a: Vec3, b: Vec3, dur = 0.85, size = 0.85) {
    const f = this.flights.find(x => !x.live) ?? this.flights[0]!;
    f.live = true;
    f.t = 0;
    f.dur = dur;
    f.size = size;
    f.from.set(a.x, a.y, a.z);
    f.to.set(b.x, b.y, b.z);
    f.arc = 1 + f.from.distanceTo(f.to) * 0.25;
    f.sprite.material = this.mats.get(icon)!;
    f.sprite.visible = true;
    f.sprite.scale.setScalar(size);
    f.sprite.position.copy(f.from);
  }

  /** Confetti burst at a point (a big trade). */
  burst(
    at: Vec3,
    n = 120,
    colors: string[] = ['#ffd400', '#ff3b2f', '#3fa9ff', '#3ddc84', '#ff7ac8'],
  ) {
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.nextP;
      this.nextP = (this.nextP + 1) % CONFETTI;
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * s * 0.6, 5 + Math.random() * 6, Math.sin(a) * s * 0.6], i * 3);
      this.life[i] = 1.6 + Math.random() * 1.2;
      c.set(colors[k % colors.length]!);
      this.col.set([c.r, c.g, c.b], i * 3);
    }
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }

  get busy() {
    return this.flights.filter(f => f.live).length;
  }

  update(dt: number) {
    for (const f of this.flights) {
      if (!f.live) continue;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k * k * (3 - 2 * k);
      f.sprite.position.lerpVectors(f.from, f.to, e);
      f.sprite.position.y += Math.sin(Math.PI * k) * f.arc;
      f.sprite.scale.setScalar(f.size * (1 + Math.sin(Math.PI * k) * 0.5));
      if (k >= 1) {
        f.live = false;
        f.sprite.visible = false;
      }
    }
    let any = false;
    for (let i = 0; i < CONFETTI; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i]! -= dt;
      const o = i * 3;
      if (this.life[i]! <= 0) {
        this.pos[o + 1] = -9999;
        continue;
      }
      this.vel[o + 1]! -= 9 * dt;
      this.vel[o]! *= 1 - dt * 0.8;
      this.vel[o + 2]! *= 1 - dt * 0.8;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      if (this.pos[o + 1]! < 0.05) {
        this.pos[o + 1] = 0.05;
        this.vel[o + 1] = 0;
      }
    }
    if (any) this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose() {
    for (const m of this.mats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

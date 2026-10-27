// ── The fountain's secret, in the world: the loose tile, its sparkle, and
// the basin water draining open for the descent ─────────────────────────

import * as THREE from 'three';

import { drawNoggles } from '../render/boards';

import { BASIN, HOLE, TILE } from './secret';

function tileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9dfcb';
  ctx.fillRect(0, 0, 128, 72);
  ctx.strokeStyle = 'rgba(90,70,40,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 124, 68);
  // A crack, and a tiny noggle: you'd only see it if you looked
  ctx.beginPath();
  ctx.moveTo(96, 4);
  ctx.lineTo(88, 30);
  ctx.lineTo(100, 52);
  ctx.stroke();
  drawNoggles(ctx, 34, 26, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,240,170,1)');
  g.addColorStop(0.3, 'rgba(255,210,60,0.6)');
  g.addColorStop(1, 'rgba(255,200,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SPARKS = 7;

export class FountainHatch {
  readonly group = new THREE.Group();
  /** What a knock has to hit (a little bigger than the tile). */
  readonly hit: THREE.Mesh;
  readonly tile: THREE.Mesh;
  private sparks: THREE.Sprite[] = [];
  private drain: THREE.Mesh;
  private drainK = -1;
  private shaft: THREE.Sprite;
  private t = 0;

  constructor() {
    this.group.name = 'gx3d-fountain-secret';
    const tileMat = new THREE.MeshLambertMaterial({ map: tileTexture() });
    this.tile = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.4, 0.07), tileMat);
    this.tile.position.set(TILE.x, TILE.y, TILE.z);
    // Loose: a touch skew
    this.tile.rotation.set(0.04, TILE.yaw, -0.03);
    this.group.add(this.tile);
    this.hit = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 0.5),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hit.position.copy(this.tile.position);
    // Hidden as an object, not only by its material: the ink outline's
    // normal pass renders with its own material and drew this box as a
    // black square in the fountain. Raycasts still hit invisible meshes.
    this.hit.visible = false;
    this.group.add(this.hit);

    const glow = glowTexture();
    for (let k = 0; k < SPARKS; k++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      s.scale.setScalar(0.12);
      this.sparks.push(s);
      this.group.add(s);
    }

    // The basin's water drains open from the hole outward
    this.drain = new THREE.Mesh(
      new THREE.RingGeometry(BASIN.inner, BASIN.outer, 8),
      new THREE.MeshBasicMaterial({
        color: '#05070a',
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
    this.drain.position.y = 0.36;
    this.drain.visible = false;
    this.group.add(this.drain);
    this.shaft = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shaft.position.set(HOLE.x, 0.5, HOLE.z);
    this.shaft.scale.set(2.6, 2.6, 1);
    this.group.add(this.shaft);
  }

  /** Sparkle strength 0 … 1 (proximity, or always a little once found). */
  update(dt: number, sparkle: number) {
    this.t += dt;
    for (let k = 0; k < this.sparks.length; k++) {
      const s = this.sparks[k]!;
      const ph = this.t * (1.3 + k * 0.17) + k * 2.1;
      const tw = Math.max(0, Math.sin(ph)) ** 6;
      (s.material as THREE.SpriteMaterial).opacity = sparkle * tw;
      s.visible = sparkle > 0.01;
      s.position.set(
        TILE.x + Math.sin(k * 1.9) * 0.32,
        TILE.y + Math.cos(k * 2.7) * 0.16 + 0.05,
        TILE.z + 0.06,
      );
    }
  }

  /** The water drained open (0 = full basin, 1 = all open). */
  setDrain(k: number) {
    const v = Math.max(0, Math.min(1, k));
    if (Math.abs(v - this.drainK) < 1e-3) return;
    this.drainK = v;
    this.drain.visible = v > 0.001;
    (this.shaft.material as THREE.SpriteMaterial).opacity = v;
    if (!this.drain.visible) return;
    // Sweep out both ways from the hole's angle (the ring lies in xz after
    // rotation; the hole on +z is theta = −π/2)
    const len = Math.max(0.05, v * Math.PI * 2);
    this.drain.geometry.dispose();
    this.drain.geometry = new THREE.RingGeometry(
      BASIN.inner,
      BASIN.outer,
      Math.max(8, Math.round(64 * v)),
      1,
      -Math.PI / 2 - len / 2,
      len,
    ).rotateX(-Math.PI / 2);
    // Lift and slide the tile as if the hatch released
    this.tile.position.z = TILE.z + v * 0.06;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    });
  }
}

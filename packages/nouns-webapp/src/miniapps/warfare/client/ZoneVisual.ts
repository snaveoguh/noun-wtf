// ── Turf zones: a floor disc that physically gets painted ──────────────
//
// Each zone owns a small canvas. As capture progress moves toward a crew,
// blobs of that crew's paint are slapped onto the canvas (covering the
// other colour), so a held zone reads as a puddle of team paint. A ring
// and a floating letter show ownership; contested zones pulse.

import type { ZoneState } from '../sim/types';

import * as THREE from 'three';

import { inkExcluded } from '@/miniapps/world2/render/Toon';

import { TEAM_COLORS } from '../sim/types';

import { letterBadge } from './textures';

const S = 256;

export class ZoneVisual {
  group = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private badge: THREE.Sprite;
  private badgeMat: THREE.SpriteMaterial;
  private painted: [number, number] = [0, 0];
  private mats: THREE.Material[] = [];

  constructor(z: ZoneState) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = S;
    this.g = this.canvas.getContext('2d')!;
    this.reset();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const discMat = new THREE.MeshLambertMaterial({
      map: this.tex,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 48), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(z.x, z.y + 0.012, z.z);
    disc.receiveShadow = true;
    disc.renderOrder = 1;
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      transparent: true,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.18, z.r, 64), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(z.x, z.y + 0.02, z.z);
    this.ring.renderOrder = 2;
    this.badgeMat = new THREE.SpriteMaterial({
      map: letterBadge(z.id),
      depthTest: false,
      toneMapped: false,
    });
    this.badge = new THREE.Sprite(this.badgeMat);
    this.badge.position.set(z.x, z.y + 3.4, z.z);
    this.badge.scale.set(0.9, 0.9, 0.9);
    this.badge.renderOrder = 10;
    this.group.add(disc, this.ring, this.badge);
    for (const o of [disc, this.ring, this.badge]) inkExcluded.add(o);
    this.mats.push(discMat, this.ringMat, this.badgeMat);
  }

  private reset() {
    const g = this.g;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(40,40,52,0.35)';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 3;
    g.setLineDash([10, 10]);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 18, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  private blob(team: 0 | 1) {
    const g = this.g;
    const col = `#${TEAM_COLORS[team].toString(16).padStart(6, '0')}`;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (S / 2 - 16);
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const r = 14 + Math.random() * 18;
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const b = Math.random() * Math.PI * 2;
      const dd = r * (0.8 + Math.random() * 0.9);
      g.beginPath();
      g.arc(
        x + Math.cos(b) * dd,
        y + Math.sin(b) * dd,
        r * (0.15 + Math.random() * 0.3),
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    const area = (Math.PI * r * r * 1.6) / (Math.PI * (S / 2) * (S / 2));
    this.painted[team] = Math.min(1, this.painted[team] + area * 0.75);
    const other = team === 0 ? 1 : 0;
    this.painted[other] = Math.max(0, this.painted[other] - area * 0.75 * this.painted[other]);
  }

  update(z: ZoneState, t: number) {
    const target: [number, number] = [Math.max(0, -z.progress), Math.max(0, z.progress)];
    let changed = false;
    if (this.painted[0] > target[0] + 0.35 || this.painted[1] > target[1] + 0.35) {
      this.reset();
      this.painted = [0, 0];
      changed = true;
    }
    for (let i = 0; i < 4; i++) {
      for (const team of [0, 1] as const) {
        if (this.painted[team] < target[team] - 0.02) {
          this.blob(team);
          changed = true;
        }
      }
    }
    if (changed) this.tex.needsUpdate = true;
    const owner = z.owner;
    const col = owner === -1 ? 0xffffff : TEAM_COLORS[owner];
    this.ringMat.color.setHex(col);
    this.ringMat.opacity = z.contested ? 0.5 + 0.5 * Math.abs(Math.sin(t * 8)) : 0.95;
    this.badgeMat.color.setHex(owner === -1 ? 0xdddddd : col);
    this.badge.position.y = z.y + 3.4 + Math.sin(t * 2 + z.x) * 0.12;
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
      inkExcluded.delete(o);
    });
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}

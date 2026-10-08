// ── Persistent 3D graffiti ───────────────────────────────────────────────
//
// Spray onto any flat surface. Surfaces are carved into deterministic
// 6 m × 3 m "cells" (from the plane + position), so every client derives
// the same wall id from the same hit. Each cell owns a transparent canvas
// decal. Tags are stored as compact vector dabs (5 bytes each), which keeps
// them small enough for the existing PartyKit graffiti storage
// (`world:graffiti:save/load`, last 20 tags per wall). A handful of index
// buckets remember which walls have paint so late joiners can load them.

import type { CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';

export const SPRAY_COLORS = [
  '#ffffff',
  '#0b0b0b',
  '#d22209',
  '#ffd400',
  '#3ddc84',
  '#2b83f6',
  '#ff5fa2',
  '#8f5bff',
  '#ff8a00',
  '#00e5ff',
  '#a3ff12',
  '#8b5a2b',
  '#c0c0c0',
  '#ff2d2d',
  '#1e3a8a',
  '#f5e6c8',
] as const;

const CELL_W = 6;
const CELL_H = 3;
const TEX_W = 512;
const TEX_H = 256;
const MAX_DABS = 900;
const INDEX_BUCKETS = 8;
const RANGE = 7;

export interface Dab {
  u: number; // 0..1 across the cell
  v: number; // 0..1 up the cell (0 = bottom)
  r: number; // radius as a fraction of cell height
  c: number; // colour index
}

interface Cell {
  id: string;
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  origin: THREE.Vector3; // world position of the cell's bottom-left corner
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
  dirty: boolean;
  /** Tag payloads already painted (so re-broadcasts don't double-draw). */
  painted: Set<string>;
}

export interface GraffitiNet {
  save(wallId: string, data: string): void;
  load(wallId: string): void;
}

// ── Compact encoding: 5 bytes per dab (u12 v12 r8 c4 + 4 spare) ─────────

export function encodeDabs(dabs: Dab[]): string {
  const bytes = new Uint8Array(dabs.length * 5);
  dabs.forEach((d, i) => {
    const u = Math.round(THREE.MathUtils.clamp(d.u, 0, 1) * 4095);
    const v = Math.round(THREE.MathUtils.clamp(d.v, 0, 1) * 4095);
    const r = Math.round(THREE.MathUtils.clamp(d.r / 0.25, 0, 1) * 255);
    const o = i * 5;
    bytes[o] = u >> 4;
    bytes[o + 1] = ((u & 15) << 4) | (v >> 8);
    bytes[o + 2] = v & 255;
    bytes[o + 3] = r;
    bytes[o + 4] = (d.c & 15) << 4;
  });
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'g2:' + btoa(bin);
}

export function decodeDabs(s: string): Dab[] | null {
  if (!s.startsWith('g2:')) return null;
  let bin: string;
  try {
    bin = atob(s.slice(3));
  } catch {
    return null;
  }
  const out: Dab[] = [];
  for (let o = 0; o + 4 < bin.length; o += 5) {
    const b0 = bin.charCodeAt(o);
    const b1 = bin.charCodeAt(o + 1);
    const b2 = bin.charCodeAt(o + 2);
    const b3 = bin.charCodeAt(o + 3);
    const b4 = bin.charCodeAt(o + 4);
    out.push({
      u: ((b0 << 4) | (b1 >> 4)) / 4095,
      v: (((b1 & 15) << 8) | b2) / 4095,
      r: (b3 / 255) * 0.25,
      c: b4 >> 4,
    });
  }
  return out;
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const _ray = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Graffiti {
  group = new THREE.Group();
  cells = new Map<string, Cell>();
  color = 2;
  spraying = false;
  /** Dabs sprayed into each cell since the last save. */
  private pending = new Map<string, Dab[]>();
  private sinceSpray = 0;
  private dabAcc = 0;
  private indexed = new Set<string>();
  /** Aim point for the HUD crosshair (null when nothing in range). */
  aim: { point: THREE.Vector3; normal: THREE.Vector3 } | null = null;
  private hiss: { gain: GainNode } | null = null;

  constructor(
    private world: CollisionWorld,
    private levelKey: string,
    private net: GraffitiNet | null,
  ) {
    this.group.name = 'graffiti';
  }

  /** Ask the server which walls have paint (index buckets → walls). */
  loadAll() {
    if (this.net === null) return;
    for (let i = 0; i < INDEX_BUCKETS; i++) this.net.load(this.indexId(i));
  }

  private indexId(i: number) {
    return `w2idx:${this.levelKey}:${i}`;
  }

  /** Handle a `world:graffiti:tags` broadcast. */
  onTags(wallId: string, tags: { imageData: string }[]) {
    if (wallId.startsWith(`w2idx:${this.levelKey}:`)) {
      for (const t of tags) {
        const id = t.imageData;
        if (typeof id === 'string' && id.startsWith(`${this.levelKey}|`) && !this.cells.has(id)) {
          this.net?.load(id);
        }
      }
      return;
    }
    if (!wallId.startsWith(`${this.levelKey}|`)) return;
    const cell = this.cellFromId(wallId);
    if (cell === null) return;
    for (const t of tags) {
      if (typeof t.imageData !== 'string' || cell.painted.has(t.imageData)) continue;
      const dabs = decodeDabs(t.imageData);
      if (dabs === null) continue;
      cell.painted.add(t.imageData);
      for (const d of dabs) this.drawDab(cell, d);
    }
  }

  // ── Cells ─────────────────────────────────────────────────────────────

  private basis(n: THREE.Vector3) {
    const nq = new THREE.Vector3(
      Math.round(n.x * 20) / 20,
      Math.round(n.y * 20) / 20,
      Math.round(n.z * 20) / 20,
    ).normalize();
    let u: THREE.Vector3;
    let v: THREE.Vector3;
    if (Math.abs(nq.y) > 0.85) {
      // Floor / ceiling: u = +X, v = -Z so text reads from the south
      u = new THREE.Vector3(1, 0, 0);
      v = new THREE.Vector3().crossVectors(nq, u).normalize();
    } else {
      u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), nq).normalize();
      v = new THREE.Vector3().crossVectors(nq, u).normalize();
    }
    return { n: nq, u, v };
  }

  private cellFor(point: THREE.Vector3, normal: THREE.Vector3): Cell {
    const { n, u, v } = this.basis(normal);
    const d = Math.round(n.dot(point) * 20) / 20;
    const cu = Math.floor(u.dot(point) / CELL_W);
    const cv = Math.floor(v.dot(point) / CELL_H);
    const id = `${this.levelKey}|${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}|${d.toFixed(2)}|${cu}|${cv}`;
    return this.ensureCell(id, n, u, v, d, cu, cv);
  }

  private cellFromId(id: string): Cell | null {
    const existing = this.cells.get(id);
    if (existing !== undefined) return existing;
    const parts = id.split('|');
    if (parts.length !== 5) return null;
    const nn = parts[1].split(',').map(Number);
    if (nn.length !== 3 || nn.some(x => !Number.isFinite(x))) return null;
    const { n, u, v } = this.basis(new THREE.Vector3(nn[0], nn[1], nn[2]));
    const d = Number(parts[2]);
    const cu = Number(parts[3]);
    const cv = Number(parts[4]);
    if (![d, cu, cv].every(Number.isFinite)) return null;
    return this.ensureCell(id, n, u, v, d, cu, cv);
  }

  private ensureCell(
    id: string,
    n: THREE.Vector3,
    u: THREE.Vector3,
    v: THREE.Vector3,
    d: number,
    cu: number,
    cv: number,
  ): Cell {
    const hit = this.cells.get(id);
    if (hit !== undefined) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      roughness: 0.75,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W, CELL_H), mat);
    const origin = n
      .clone()
      .multiplyScalar(d)
      .addScaledVector(u, cu * CELL_W)
      .addScaledVector(v, cv * CELL_H);
    // Plane frame: X = u, Y = v, Z = n
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    mesh.position
      .copy(origin)
      .addScaledVector(u, CELL_W / 2)
      .addScaledVector(v, CELL_H / 2)
      .addScaledVector(n, 0.012);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const cell: Cell = {
      id,
      mesh,
      canvas,
      ctx,
      texture,
      origin,
      u,
      v,
      n,
      dirty: false,
      painted: new Set(),
    };
    this.cells.set(id, cell);
    return cell;
  }

  private drawDab(cell: Cell, d: Dab) {
    const x = d.u * TEX_W;
    const y = (1 - d.v) * TEX_H;
    const r = Math.max(1.5, d.r * TEX_H);
    const col = SPRAY_COLORS[d.c] ?? '#ffffff';
    const g = cell.ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexA(col, 0.55));
    g.addColorStop(0.45, hexA(col, 0.35));
    g.addColorStop(1, hexA(col, 0));
    cell.ctx.fillStyle = g;
    cell.ctx.beginPath();
    cell.ctx.arc(x, y, r, 0, Math.PI * 2);
    cell.ctx.fill();
    // Overspray speckle
    cell.ctx.fillStyle = hexA(col, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = r * (1 + Math.random() * 0.6);
      cell.ctx.fillRect(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 1.2, 1.2);
    }
    cell.dirty = true;
  }

  // ── Spraying ──────────────────────────────────────────────────────────

  /**
   * Per-frame update. `from` = spray origin (camera), `dir` = aim direction.
   * Returns true while paint is landing.
   */
  update(
    dt: number,
    active: boolean,
    from: THREE.Vector3,
    dir: THREE.Vector3,
    playerPos: THREE.Vector3,
  ): boolean {
    this.aim = null;
    let landed = false;
    // Aim from the camera, but only accept hits within reach of the player
    const hit = this.world.raycast(from, dir, 40);
    if (hit !== null && hit.point.distanceTo(playerPos) < RANGE) {
      this.aim = { point: hit.point, normal: hit.normal };
      if (active) {
        this.dabAcc += dt * 70;
        const cell = this.cellFor(hit.point, hit.normal);
        _p.subVectors(hit.point, cell.origin);
        const dist = from.distanceTo(hit.point);
        while (this.dabAcc >= 1) {
          this.dabAcc -= 1;
          const jitter = 0.05 + dist * 0.01;
          const du = _p.dot(cell.u) / CELL_W + (Math.random() - 0.5) * (jitter / CELL_W);
          const dv = _p.dot(cell.v) / CELL_H + (Math.random() - 0.5) * (jitter / CELL_H);
          if (du < 0 || du > 1 || dv < 0 || dv > 1) continue;
          const dab: Dab = { u: du, v: dv, r: 0.02 + Math.min(0.06, dist * 0.008), c: this.color };
          this.drawDab(cell, dab);
          let list = this.pending.get(cell.id);
          if (list === undefined) {
            list = [];
            this.pending.set(cell.id, list);
          }
          if (list.length < MAX_DABS) list.push(dab);
          landed = true;
        }
      }
    }
    void _ray;
    this.spraying = active;
    this.sinceSpray = active ? 0 : this.sinceSpray + dt;
    // Flush after a short pause so one tag = one save per wall
    if (!active && this.sinceSpray > 0.8 && this.pending.size > 0) this.flush();
    for (const c of this.cells.values()) {
      if (c.dirty) {
        c.texture.needsUpdate = true;
        c.dirty = false;
      }
    }
    return landed;
  }

  flush() {
    for (const [id, dabs] of this.pending) {
      if (dabs.length === 0) continue;
      const data = encodeDabs(dabs);
      this.cells.get(id)?.painted.add(data);
      this.net?.save(id, data);
      if (!this.indexed.has(id)) {
        this.indexed.add(id);
        this.net?.save(this.indexId(hashStr(id) % INDEX_BUCKETS), id);
      }
    }
    this.pending.clear();
  }

  cycleColor(dir = 1) {
    this.color = (this.color + dir + SPRAY_COLORS.length) % SPRAY_COLORS.length;
  }

  /** Spray-can hiss, driven by `spraying`. */
  updateAudio(ctx: AudioContext | null, master: AudioNode | null, noise: AudioBuffer | null) {
    if (ctx === null || master === null || noise === null) return;
    if (this.hiss === null) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(gain).connect(master);
      src.start();
      this.hiss = { gain };
    }
    this.hiss.gain.gain.setTargetAtTime(
      this.spraying && this.aim !== null ? 0.18 : 0,
      ctx.currentTime,
      0.03,
    );
  }

  dispose() {
    this.flush();
    for (const c of this.cells.values()) {
      c.texture.dispose();
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
    }
    this.cells.clear();
    this.group.removeFromParent();
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

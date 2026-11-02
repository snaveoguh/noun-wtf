// ── A stand-in StadiumViewApi: a striped pitch, its lines and two goals ──
//
// The real stadium (stands, crowd, floodlights) is football/view/stadium/
// StadiumView.ts, built by another part. This one lets the match view be
// shown and tested without it: four draws, no textures.

import type { PitchSpec, StadiumFrame, StadiumViewApi, TeamId, TeamKit } from '../contract';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { GRASS, PITCH_11 } from '../contract';

function lineGeometry(p: PitchSpec): THREE.BufferGeometry {
  const w = 0.12;
  const parts: THREE.BufferGeometry[] = [];
  const seg = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2);
    g.rotateY(Math.atan2(x1 - x0, z1 - z0));
    g.translate((x0 + x1) / 2, 0.015, (z0 + z1) / 2);
    parts.push(g);
  };
  const ring = (cx: number, cz: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 40) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const b = a0 + ((a1 - a0) * (i + 1)) / n;
      seg(cx + Math.sin(a) * r, cz + Math.cos(a) * r, cx + Math.sin(b) * r, cz + Math.cos(b) * r);
    }
  };
  const L = p.length / 2;
  const W = p.width / 2;
  seg(-W, -L, W, -L);
  seg(-W, L, W, L);
  seg(-W, -L, -W, L);
  seg(W, -L, W, L);
  seg(-W, 0, W, 0);
  ring(0, 0, p.centreRadius);
  for (const s of [-1, 1]) {
    const gl = s * L;
    const bx = p.boxWidth / 2;
    const bz = gl - s * p.boxDepth;
    seg(-bx, gl, -bx, bz);
    seg(bx, gl, bx, bz);
    seg(-bx, bz, bx, bz);
    const sx = p.sixWidth / 2;
    const sz = gl - s * p.sixDepth;
    seg(-sx, gl, -sx, sz);
    seg(sx, gl, sx, sz);
    seg(-sx, sz, sx, sz);
    // The D outside the box
    const spot = gl - s * p.penaltySpot;
    const d = Math.abs(p.boxDepth - p.penaltySpot);
    const half = Math.acos(Math.min(1, d / p.centreRadius));
    const mid = s > 0 ? Math.PI : 0;
    ring(0, spot, p.centreRadius, mid - half, mid + half, 14);
  }
  const g = mergeGeometries(parts)!;
  for (const x of parts) x.dispose();
  return g;
}

function goalGeometry(p: PitchSpec): { frame: THREE.BufferGeometry; net: THREE.BufferGeometry } {
  const r = p.postRadius;
  const parts: THREE.BufferGeometry[] = [];
  const nets: THREE.BufferGeometry[] = [];
  const gw = p.goalWidth / 2 + r;
  const gh = p.goalHeight + r;
  for (const s of [-1, 1]) {
    const z = s * (p.length / 2 + r);
    for (const x of [-gw, gw]) {
      const post = new THREE.CylinderGeometry(r, r, gh, 8);
      post.translate(x, gh / 2, z);
      parts.push(post);
    }
    const bar = new THREE.CylinderGeometry(r, r, gw * 2, 8).rotateZ(Math.PI / 2);
    bar.translate(0, gh, z);
    parts.push(bar);
    const net = new THREE.BoxGeometry(gw * 2, gh, p.goalDepth, 12, 5, 4);
    net.translate(0, gh / 2, z + (s * p.goalDepth) / 2);
    nets.push(net);
  }
  const frame = mergeGeometries(parts)!;
  const net = mergeGeometries(nets)!;
  for (const x of [...parts, ...nets]) x.dispose();
  return { frame, net };
}

export class StubStadium implements StadiumViewApi {
  readonly root = new THREE.Group();
  built = false;
  private step = 0;
  private grass: THREE.Mesh | null = null;
  private lines: THREE.Mesh | null = null;
  private goals: THREE.Mesh | null = null;
  private nets: THREE.Mesh | null = null;
  private pitch: PitchSpec = PITCH_11;
  /** Last calls (tests / dev). */
  lastBoard: Parameters<StadiumViewApi['board']>[0] | null = null;
  excite = 0;
  end: TeamId | null = null;
  netHits: { px: number; py: number; pz: number; strength: number }[] = [];
  live = false;
  kits: [TeamKit, TeamKit] | null = null;
  private mats: THREE.Material[] = [];

  constructor(frame: StadiumFrame) {
    this.root.name = 'football-stub-stadium';
    this.root.position.set(frame.x, frame.y, frame.z);
    this.root.rotation.y = frame.yaw;
  }

  private mat(m: THREE.Material) {
    this.mats.push(m);
    return m;
  }

  buildStep(): boolean {
    if (this.built) return true;
    if (this.step === 0) {
      // Grass with mown stripes (vertex colours: no texture)
      const g = new THREE.PlaneGeometry(GRASS.width, GRASS.length, 1, 24).rotateX(-Math.PI / 2);
      const pos = g.getAttribute('position');
      const col = new Float32Array(pos.count * 3);
      const ng = g.toNonIndexed();
      g.dispose();
      const p2 = ng.getAttribute('position');
      const c2 = new Float32Array(p2.count * 3);
      for (let i = 0; i < p2.count; i += 3) {
        const z = (p2.getZ(i) + p2.getZ(i + 1) + p2.getZ(i + 2)) / 3;
        const band = Math.floor((z + GRASS.length / 2) / (GRASS.length / 24)) % 2;
        const k = band === 0 ? 1 : 0.86;
        for (let j = 0; j < 3; j++) c2.set([0.2 * k, 0.55 * k, 0.22 * k], (i + j) * 3);
      }
      void col;
      ng.setAttribute('color', new THREE.BufferAttribute(c2, 3));
      ng.computeVertexNormals();
      this.grass = new THREE.Mesh(
        ng,
        this.mat(
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 1,
            name: 'fb-stub-grass',
          }),
        ),
      );
      this.grass.receiveShadow = true;
      this.root.add(this.grass);
      this.step = 1;
      return false;
    }
    this.setPitch(this.pitch);
    this.built = true;
    return true;
  }

  setPitch(spec: PitchSpec) {
    this.pitch = spec;
    if (this.lines !== null) {
      this.lines.geometry.dispose();
      this.lines.removeFromParent();
      this.goals!.geometry.dispose();
      this.goals!.removeFromParent();
      this.nets!.geometry.dispose();
      this.nets!.removeFromParent();
    }
    const lm =
      this.mats.find(m => m.name === 'fb-stub-line') ??
      this.mat(new THREE.MeshBasicMaterial({ color: 0xf4f4ee, name: 'fb-stub-line' }));
    const gm =
      this.mats.find(m => m.name === 'fb-stub-goal') ??
      this.mat(
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, name: 'fb-stub-goal' }),
      );
    const nm =
      this.mats.find(m => m.name === 'fb-stub-net') ??
      this.mat(
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          wireframe: true,
          transparent: true,
          opacity: 0.45,
          name: 'fb-stub-net',
        }),
      );
    this.lines = new THREE.Mesh(lineGeometry(spec), lm);
    const { frame, net } = goalGeometry(spec);
    this.goals = new THREE.Mesh(frame, gm);
    this.goals.castShadow = true;
    this.nets = new THREE.Mesh(net, nm);
    this.root.add(this.lines, this.goals, this.nets);
  }

  setKits(kits: [TeamKit, TeamKit]) {
    this.kits = kits;
  }

  board(info: Parameters<StadiumViewApi['board']>[0]) {
    this.lastBoard = info;
  }

  crowd(excite: number, end: TeamId | null) {
    this.excite = excite;
    this.end = end;
  }

  netHit(px: number, py: number, pz: number, strength: number) {
    this.netHits.push({ px, py, pz, strength });
    if (this.netHits.length > 8) this.netHits.shift();
  }

  setLive(on: boolean) {
    this.live = on;
  }

  dispose() {
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}

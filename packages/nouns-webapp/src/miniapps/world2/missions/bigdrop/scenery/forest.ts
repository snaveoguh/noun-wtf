// ── The Big Drop's forests: pines, snags and boulders streamed down the line ─
//
// Near chunks (placement.ts) along the track: one InstancedMesh per model
// per chunk, matrices relative to the chunk's own origin (so float32 never
// sees peak coordinates), the chunk group placed with ctx.toLocal and
// shifted on a rebase. Streamed by track distance ahead of the rider (up to
// 600 m/s), recycled from a pool; at most one chunk built per frame once
// the first window is up. Trees and rocks near the line get trunk colliders
// (one merged collider per chunk, only round the rider) so riding into a
// tree is a crash. Far chunks scatter one-cone pines over the whole
// mountainside out to the terrain's edge.

import type { PeakCtx, PeakSystem } from '../contract';

import * as THREE from 'three';

import { toonify } from '../../../render/Toon';
import { peakHeight } from '../../peakTerrain';
import { centerX, TRACK } from '../track';

import { farPineGeometry, nearGeometries, sceneryMaterial } from './models';
import {
  chunkWindow,
  FOREST,
  Kind,
  KIND_COUNT,
  type Placed,
  placeChunkSteps,
  placeFarChunkSteps,
} from './placement';

interface Chunk {
  index: number;
  far: boolean;
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  /** Kind of each mesh in `meshes` (for the pool). */
  kinds: number[];
  /** Peak coordinates of the chunk's origin. */
  origin: THREE.Vector3;
  solids: Placed[];
  heights: number[];
  collider: THREE.BufferGeometry | null;
}

/** Instance capacity per chunk mesh, by kind (near), and for the far pines. */
const CAP = [900, 900, 160, 260];
const FAR_CAP = 1100;
/** Most solids per chunk collider. */
const MAX_SOLIDS = 260;
/** JS time per frame for building chunks once the first window is up (ms). */
const BUILD_MS = { low: 0.5, medium: 0.6, high: 0.7 } as const;
/** Heights sampled between time checks. */
const BATCH = 24;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _win = { first: 0, last: -1 };

interface Job {
  index: number;
  far: boolean;
  steps: Generator<void, unknown>;
}

export class Forest implements PeakSystem {
  private readonly root = new THREE.Group();
  private readonly near = new Map<number, Chunk>();
  private readonly far = new Map<number, Chunk>();
  private readonly geos: THREE.BufferGeometry[];
  private readonly farGeos: THREE.BufferGeometry[];
  private readonly mat: THREE.Material;
  /** Free InstancedMeshes per kind (near 0..3, far 4..5). */
  private readonly pool: THREE.InstancedMesh[][] = [[], [], [], [], [], []];
  private first = true;
  private job: Job | null = null;
  /** For the perf readout (?bigdrop debug): chunks built, colliders live. */
  stats = { built: 0, colliders: 0, instances: 0 };

  constructor(private ctx: PeakCtx) {
    this.root.name = 'BigDropForest';
    ctx.group.add(this.root);
    this.geos = nearGeometries();
    this.farGeos = [farPineGeometry(false), farPineGeometry(true)];
    const mat = sceneryMaterial('BigDropTrees');
    if (ctx.toon) {
      // toonify swaps materials per mesh; convert once through a stand-in
      const probe = new THREE.Mesh(this.geos[0], mat);
      toonify(probe);
      this.mat = probe.material as THREE.Material;
    } else this.mat = mat;
  }

  update() {
    const ctx = this.ctx;
    const q = ctx.quality;
    const s = Math.min(TRACK.end, Math.max(0, ctx.riderPeak.z));
    // Near: drop what's out of the window, then build the nearest missing chunk
    chunkWindow(s, FOREST.chunk, FOREST.behind, FOREST.ahead[q], _win);
    const nf = _win.first;
    const nl = _win.last;
    for (const [i, c] of this.near) if (i < nf || i > nl) this.drop(this.near, c);
    // Far patches
    chunkWindow(s, FOREST.farChunk, FOREST.farBehind, FOREST.farAhead[q], _win);
    const ff = _win.first;
    const fl = _win.last;
    for (const [i, c] of this.far) if (i < ff || i > fl) this.drop(this.far, c);
    // A job for a chunk that's left the window is abandoned
    const j = this.job;
    if (j !== null && (j.far ? j.index < ff || j.index > fl : j.index < nf || j.index > nl))
      this.job = null;
    // Build: the chunk under the rider first, then ahead, then behind, then far
    const t0 = performance.now();
    // No budget on the way in, or after a respawn / jump: the ground under
    // the rider (and just ahead) must never be bare
    const here = Math.floor(s / FOREST.chunk);
    const catchUp = !this.near.has(here) || (here + 1 <= nl && !this.near.has(here + 1));
    const limit = this.first ? Infinity : BUILD_MS[q];
    while (
      performance.now() - t0 < limit ||
      (catchUp && !(this.near.has(here) && (here + 1 > nl || this.near.has(here + 1))))
    ) {
      if (this.job === null) {
        const at = Math.floor(s / FOREST.chunk);
        let next = -1;
        for (let i = at; next < 0 && i <= nl; i++) if (!this.near.has(i)) next = i;
        for (let i = nf; next < 0 && i < at; i++) if (!this.near.has(i)) next = i;
        if (next >= 0) this.job = this.start(next, false);
        else {
          for (let i = ff; next < 0 && i <= fl; i++) if (!this.far.has(i)) next = i;
          if (next < 0) break;
          this.job = this.start(next, true);
        }
      }
      if (this.job.steps.next().done === true) this.job = null;
    }
    // Colliders only round the rider
    const c0 = s - FOREST.colliderBehind;
    const c1 = s + FOREST.colliderAhead;
    let live = 0;
    for (const c of this.near.values()) {
      const a = c.index * FOREST.chunk;
      const want = a + FOREST.chunk >= c0 && a <= c1;
      if (want && c.collider === null) this.addCollider(c);
      else if (!want && c.collider !== null) this.removeCollider(c);
      if (c.collider !== null) live++;
    }
    this.stats.colliders = live;
    this.first = false;
  }

  private take(kind: number, far: boolean): THREE.InstancedMesh {
    const free = this.pool[kind]!;
    const hit = free.pop();
    if (hit !== undefined) return hit;
    const geo = far ? this.farGeos[kind - KIND_COUNT]! : this.geos[kind]!;
    const mesh = new THREE.InstancedMesh(geo, this.mat, far ? FAR_CAP : CAP[kind]!);
    mesh.name = far ? 'BigDropFarPines' : `BigDropTrees${kind}`;
    const shadows = !far && this.ctx.quality !== 'low' && kind !== Kind.Rock;
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    return mesh;
  }

  private start(index: number, far: boolean): Job {
    return { index, far, steps: this.buildSteps(index, far) };
  }

  /** One chunk, in slices: placement, then the heights, then the meshes in one go. */
  private *buildSteps(index: number, far: boolean): Generator<void, void> {
    const q = this.ctx.quality;
    const placed: Placed[] = [];
    if (far) yield* placeFarChunkSteps(index, q, placed);
    else yield* placeChunkSteps(index, q, placed);
    const heights = new Float64Array(placed.length);
    for (let i = 0; i < placed.length; i++) {
      heights[i] = peakHeight(placed[i]!.x, placed[i]!.z);
      if (i % BATCH === BATCH - 1) yield;
    }
    this.finish(index, far, placed, heights);
  }

  private finish(index: number, far: boolean, placed: Placed[], heights: Float64Array) {
    const ctx = this.ctx;
    const len = far ? FOREST.farChunk : FOREST.chunk;
    const s0 = Math.max(TRACK.start, index * len);
    const ox = centerX(s0);
    const origin = new THREE.Vector3(ox, peakHeight(ox, s0), s0);
    const group = new THREE.Group();
    group.name = `${far ? 'far' : 'near'}${index}`;
    const chunk: Chunk = {
      index,
      far,
      group,
      meshes: [],
      kinds: [],
      origin,
      solids: [],
      heights: [],
      collider: null,
    };
    // Bucket by kind (far: 4 = pine, 5 = snowy)
    const kinds = far ? 2 : KIND_COUNT;
    for (let k = 0; k < kinds; k++) {
      const poolKind = far ? KIND_COUNT + k : k;
      const want = far ? (k === 0 ? Kind.Pine : Kind.SnowyPine) : k;
      let mesh: THREE.InstancedMesh | null = null;
      let n = 0;
      for (let pi = 0; pi < placed.length; pi++) {
        const t = placed[pi]!;
        if (t.kind !== want) continue;
        if (mesh === null) mesh = this.take(poolKind, far);
        if (n >= mesh.instanceMatrix.count) break;
        const y = heights[pi]!;
        const rock = t.kind === Kind.Rock;
        // Sink the base into the slope (it falls away 1.15 m per m downhill)
        const sink = rock ? 0.5 * t.scale : 0.55 * t.scale;
        _p.set(t.x - origin.x, y - origin.y - sink, t.z - origin.z);
        if (rock) _e.set((t.rot * 3.1) % 0.6, t.rot, (t.rot * 1.7) % 0.5);
        else _e.set(0, t.rot, 0);
        _q.setFromEuler(_e);
        const sy = rock
          ? t.scale * (0.7 + ((t.rot * 5) % 0.6))
          : t.scale * (0.85 + ((t.rot * 7) % 0.3));
        _s.set(t.scale, sy, t.scale);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n++, _m);
        if (t.solid && !far) {
          chunk.solids.push(t);
          chunk.heights.push(y);
        }
      }
      if (mesh === null) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      chunk.meshes.push(mesh);
      chunk.kinds.push(poolKind);
      this.stats.instances += n;
    }
    ctx.toLocal(origin.x, origin.y, origin.z, group.position);
    this.root.add(group);
    (far ? this.far : this.near).set(index, chunk);
    this.stats.built++;
  }

  private drop(map: Map<number, Chunk>, c: Chunk) {
    map.delete(c.index);
    this.removeCollider(c);
    this.root.remove(c.group);
    c.meshes.forEach((m, i) => {
      this.stats.instances -= m.count;
      c.group.remove(m);
      this.pool[c.kinds[i]!]!.push(m);
    });
    c.meshes.length = 0;
  }

  /** One merged collider for the chunk: a hex prism per trunk, a box per rock. */
  private addCollider(c: Chunk) {
    const list = c.solids;
    if (list.length === 0) {
      c.collider = new THREE.BufferGeometry();
      return;
    }
    const n = Math.min(MAX_SOLIDS, list.length);
    // 6 sides + a top, 2 triangles each, 3 vertices
    const pos = new Float32Array(n * 42 * 3);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const t = list[i]!;
      const y = c.heights[i]!;
      const rock = t.kind === Kind.Rock;
      const r = rock ? 1.3 * t.scale : 0.45 * t.scale;
      const y0 = y - c.origin.y - 1.5;
      const y1 = y0 + (rock ? 1.5 + 1.5 * t.scale : 1.5 + 4.5 * t.scale);
      const cx = t.x - c.origin.x;
      const cz = t.z - c.origin.z;
      for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * Math.PI * 2;
        const a1 = ((k + 1) / 6) * Math.PI * 2;
        const x0 = cx + Math.cos(a0) * r;
        const z0 = cz + Math.sin(a0) * r;
        const x1 = cx + Math.cos(a1) * r;
        const z1 = cz + Math.sin(a1) * r;
        pos.set([x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0], o);
        o += 18;
      }
      // Two triangles across the top (a rock you can land on)
      pos.set(
        [
          cx - r,
          y1,
          cz - r,
          cx + r,
          y1,
          cz + r,
          cx + r,
          y1,
          cz - r,
          cx - r,
          y1,
          cz - r,
          cx - r,
          y1,
          cz + r,
          cx + r,
          y1,
          cz + r,
        ],
        o,
      );
      o += 18;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
    c.collider = g;
    this.ctx.setCollider(`forest${c.index}`, g, c.origin);
  }

  private removeCollider(c: Chunk) {
    if (c.collider === null) return;
    if (c.collider.getAttribute('position') !== undefined)
      this.ctx.setCollider(`forest${c.index}`, null);
    c.collider.dispose();
    c.collider = null;
  }

  rebase(d: THREE.Vector3) {
    for (const c of this.near.values()) c.group.position.add(d);
    for (const c of this.far.values()) c.group.position.add(d);
  }

  /** Every live chunk's instance count (tests / the perf readout). */
  get chunkCount() {
    return { near: this.near.size, far: this.far.size };
  }

  dispose() {
    for (const c of [...this.near.values()]) this.drop(this.near, c);
    for (const c of [...this.far.values()]) this.drop(this.far, c);
    for (const list of this.pool) for (const m of list) m.dispose();
    this.pool.forEach(l => (l.length = 0));
    for (const g of this.geos) g.dispose();
    for (const g of this.farGeos) g.dispose();
    (this.mat.userData.toonSrc as THREE.Material | undefined)?.dispose();
    this.mat.dispose();
    this.ctx.group.remove(this.root);
  }
}

export const makeForest = (ctx: PeakCtx): PeakSystem => new Forest(ctx);

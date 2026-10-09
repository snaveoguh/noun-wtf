// ── Mountain dressing: streams, ponds, plants, flowers, trees, rocks ────
//
// Given one terrain chunk (bounds) and a TerrainQuery, deterministically
// builds everything that decorates it and hands back a disposable object +
// chunk-local collision triangles. Pure function of (seed, chunk coords,
// terrain), so every client dresses the mountain identically.
//
// Per chunk (≤ 9 draw calls, one per type, all sharing global materials):
//   water ribbons + ponds (1 merged mesh)  · bridges (1 merged mesh)
//   rocks · grass · flowers · bush leaves · bush blossoms · tree wood ·
//   tree leaves (InstancedMesh each)
//
// Cheap to build: heights / track distance come from small per-chunk grids
// (33² + 17² terrain evaluations, bilinear in between); only trees, rocks
// and the water ribbons evaluate the terrain exactly.
//
// LOD: the returned root is a THREE.LOD whose update() (called by the
// renderer every frame it's projected) trims each instanced mesh's `count`
// by the camera's distance to the chunk: grass only near the rider, flowers
// a bit further, bushes thin out, trees / rocks / water always. Instances
// are generated in random order, so a prefix is an even subsample. The
// grass / flower shaders also shrink each tuft by its own camera distance.

import * as THREE from 'three';

import { warmDressing, type DressingAssets } from './DressingAssets';
import { Rand, fbm, hash3i, smoothstep, type TerrainQuery } from './dressingUtil';
import {
  StreamNetwork,
  WaterField,
  buildBridge,
  buildWaterGeometry,
  dressingBridgeMaterial,
  dressingTime,
  dressingWaterMaterial,
} from './DressingWater';

export type { TerrainQuery } from './dressingUtil';

export type DressingQuality = 'low' | 'medium' | 'high';

export interface DressingOptions {
  /** World seed (the mountain's MOUNTAIN.seed). */
  seed: number;
  /** Flat half-width of the dirt track (m); clearances are measured from it. */
  trackHalf?: number;
  quality?: DressingQuality;
  /** Scatter rocks (off if another decorator already does). Default true. */
  rocks?: boolean;
  /** Extra hand-placed springs (world XZ), traced like the seeded ones. */
  springs?: [number, number][];
}

/** The chunk to dress: square, `size` m, min corner at `origin` (world XZ). */
export interface DressingChunk {
  ix: number;
  iz: number;
  size: number;
  origin: { x: number; z: number };
}

export interface DressingChunkStats {
  ms: number;
  /** Draw calls (meshes) in the chunk, before LOD trimming. */
  draws: number;
  grass: number;
  flowers: number;
  bushes: number;
  blossoms: number;
  trees: number;
  rocks: number;
  bigRocks: number;
  streamSamples: number;
  ponds: number;
  bridges: number;
  fords: number;
  /** ms of it spent tracing new streams (global cache misses). */
  traceMs: number;
  /** ms per phase: terrain grids, water (query + ribbons + bridges), placement, meshes/colliders. */
  phases: [number, number, number, number];
}

export interface DressingResult {
  /** Chunk-local render root (place it at the chunk origin). */
  object: THREE.Object3D;
  /** Chunk-local collision triangles (non-indexed positions), or undefined. */
  collision?: THREE.BufferGeometry;
  dispose(): void;
  stats: DressingChunkStats;
}

/** Same shape as the mountain stream's ChunkDecorator (structural typing). */
export interface DressingDecorator {
  id: string;
  populate(ctx: {
    ix: number;
    iz: number;
    size: number;
    origin: { x: number; z: number };
  }): { object?: THREE.Object3D; collision?: THREE.BufferGeometry; dispose?: () => void } | null;
}

// ── LOD root ────────────────────────────────────────────────────────────

interface Tier {
  mesh: THREE.InstancedMesh;
  full: number;
  /** Camera distance (to the chunk's XZ box) where thinning starts / reaches `min`. */
  near: number;
  far: number;
  /** Fraction kept beyond `far` (0 = hide). */
  min: number;
}

class DressingRoot extends THREE.LOD {
  tiers: Tier[] = [];
  constructor(private size: number) {
    super();
    this.name = 'mountain-dressing';
  }

  /** Called by WebGLRenderer.projectObject every frame this root is drawn. */
  override update(camera: THREE.Camera) {
    const e = this.matrixWorld.elements;
    const c = camera.matrixWorld.elements;
    const ox = e[12];
    const oz = e[14];
    const cx = c[12];
    const cz = c[14];
    const dx = Math.max(ox - cx, 0, cx - (ox + this.size));
    const dz = Math.max(oz - cz, 0, cz - (oz + this.size));
    const d = Math.hypot(dx, dz);
    for (const t of this.tiers) {
      const f = t.min + (1 - t.min) * (1 - smoothstep(t.near, t.far, d));
      const n = Math.round(t.full * f);
      t.mesh.count = n;
      t.mesh.visible = n > 0;
    }
    dressingTime.value = performance.now() / 1000;
  }
}

// ── Instance buffers ────────────────────────────────────────────────────

class Inst {
  m: number[] = [];
  c: number[] | null;
  constructor(color: boolean) {
    this.c = color ? [] : null;
  }
  get count() {
    return this.m.length / 16;
  }
  /** Rotation about Y + scale (sx, sy, sz) + translation. */
  push(x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    this.m.push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1);
  }
  color(r: number, g: number, b: number) {
    this.c?.push(r, g, b);
  }
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  inst: Inst,
  name: string,
  sphere: THREE.Sphere,
  shadow: boolean,
  depth?: THREE.Material,
): THREE.InstancedMesh | null {
  const n = inst.count;
  if (n === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = name;
  mesh.instanceMatrix.array.set(inst.m);
  mesh.instanceMatrix.needsUpdate = true;
  if (inst.c !== null) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(inst.c), 3);
  }
  mesh.boundingSphere = sphere.clone();
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  if (depth !== undefined) mesh.customDepthMaterial = depth;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// Punk palette for blossoms (instance colour × white blossom cards)
const BLOSSOM = [
  [1.0, 0.36, 0.66],
  [1.0, 0.85, 0.22],
  [0.72, 0.45, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.5, 0.85],
];

// Meadow flowers: hot pink, sunflower yellow, violet, white, coral
const FLOWER = [
  [1.0, 0.25, 0.62],
  [1.0, 0.86, 0.1],
  [0.62, 0.32, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.45, 0.32],
];

// ── The dressing ────────────────────────────────────────────────────────

export class MountainDressing {
  readonly network: StreamNetwork;
  readonly assets: DressingAssets;
  /** Running totals (for HUD / tests). */
  readonly totals = { chunks: 0, ms: 0, maxMs: 0, draws: 0 };
  private trackHalf: number;
  private quality: DressingQuality;
  private qMul: number;

  constructor(
    readonly terrain: TerrainQuery,
    readonly opts: DressingOptions,
  ) {
    this.trackHalf = opts.trackHalf ?? 6.5;
    this.quality = opts.quality ?? 'medium';
    this.qMul = this.quality === 'low' ? 0.45 : this.quality === 'medium' ? 1 : 1.35;
    this.network = new StreamNetwork(terrain, opts.seed, this.trackHalf);
    for (const [x, z] of opts.springs ?? []) this.network.addSpring(x, z);
    this.assets = warmDressing(this.quality);
  }

  /** ChunkDecorator for MountainStream.addDecorator(). */
  decorator(id = 'dressing'): DressingDecorator {
    return {
      id,
      populate: ctx =>
        this.populate({ ix: ctx.ix, iz: ctx.iz, size: ctx.size, origin: ctx.origin }),
    };
  }

  populate(chunk: DressingChunk): DressingResult | null {
    const t0 = performance.now();
    const trace0 = this.network.traceMs;
    const T = this.terrain;
    const A = this.assets;
    const size = chunk.size;
    const x0 = chunk.origin.x;
    const z0 = chunk.origin.z;
    const x1 = x0 + size;
    const z1 = z0 + size;
    const seed = this.opts.seed;
    const th = this.trackHalf;
    const rnd = new Rand(Math.floor(hash3i(chunk.ix, chunk.iz, 99, seed) * 4294967296));

    // ── Coarse grids: height (4 m), track distance + mask (8 m) ──
    const HG = 4;
    const hn = Math.round(size / HG) + 1;
    const hgrid = new Float32Array(hn * hn);
    for (let j = 0; j < hn; j++)
      for (let i = 0; i < hn; i++) hgrid[j * hn + i] = T.height(x0 + i * HG, z0 + j * HG);
    const DG = 8;
    const dn = Math.round(size / DG) + 1;
    const dgrid = new Float32Array(dn * dn);
    const bgrid = new Uint8Array(dn * dn);
    let blockedAll = true;
    for (let j = 0; j < dn; j++) {
      for (let i = 0; i < dn; i++) {
        const wx = x0 + i * DG;
        const wz = z0 + j * DG;
        const b = T.blocked?.(wx, wz) === true;
        bgrid[j * dn + i] = b ? 1 : 0;
        dgrid[j * dn + i] = b ? 0 : T.trackDist(wx, wz);
        if (!b) blockedAll = false;
      }
    }
    if (blockedAll) return null;
    const bil = (g: Float32Array, n: number, step: number, x: number, z: number) => {
      const fx = Math.min(n - 1.0001, Math.max(0, (x - x0) / step));
      const fz = Math.min(n - 1.0001, Math.max(0, (z - z0) / step));
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const v = fz - j;
      const a = g[j * n + i];
      const b = g[j * n + i + 1];
      const c = g[(j + 1) * n + i];
      const d = g[(j + 1) * n + i + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const H = (x: number, z: number) => bil(hgrid, hn, HG, x, z);
    const TD = (x: number, z: number) => bil(dgrid, dn, DG, x, z);
    const BL = (x: number, z: number) => {
      const i = Math.min(dn - 2, Math.max(0, Math.floor((x - x0) / DG)));
      const j = Math.min(dn - 2, Math.max(0, Math.floor((z - z0) / DG)));
      return (
        (bgrid[j * dn + i] |
          bgrid[j * dn + i + 1] |
          bgrid[(j + 1) * dn + i] |
          bgrid[(j + 1) * dn + i + 1]) ===
        1
      );
    };
    const slope = (x: number, z: number) => {
      const gx = (H(x + 2, z) - H(x - 2, z)) / 4;
      const gz = (H(x, z + 2) - H(x, z - 2)) / 4;
      return Math.hypot(gx, gz);
    };

    const tGrid = performance.now();
    // ── Water ──
    const wq = this.network.query(x0, z0, x1, z1, 24);
    const field = new WaterField(wq, x0, z0, x1, z1, 24);
    const water = buildWaterGeometry(wq, T, x0, z0, size);
    // Water distance: 4 m grid, exact only close to the water
    let wgrid: Float32Array | null = null;
    if (!field.empty) {
      wgrid = new Float32Array(hn * hn);
      for (let j = 0; j < hn; j++)
        for (let i = 0; i < hn; i++) wgrid[j * hn + i] = field.dist(x0 + i * HG, z0 + j * HG);
    }
    const WD = (x: number, z: number) => {
      if (wgrid === null) return 16;
      const g = bil(wgrid, hn, HG, x, z);
      return g < 5 ? field.dist(x, z) : g;
    };
    // Ponds: also keep plants out of anything actually under the water line
    const inPond = (x: number, z: number, y: number) => {
      for (const p of wq.ponds)
        if (y < p.level + 0.08 && Math.hypot(p.x - x, p.z - z) < p.r) return true;
      return false;
    };

    const root = new DressingRoot(size);
    const owned: THREE.BufferGeometry[] = [];
    const meshes: THREE.Mesh[] = [];
    // Shared culling sphere for every instanced mesh (the chunk's box)
    const sphere = new THREE.Sphere(new THREE.Vector3(size / 2, 0, size / 2), size);
    {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < hgrid.length; k++) {
        lo = Math.min(lo, hgrid[k]);
        hi = Math.max(hi, hgrid[k]);
      }
      sphere.center.y = (lo + hi) / 2 + 4;
      sphere.radius = Math.hypot(size / 2, size / 2, (hi - lo) / 2 + 12);
    }
    const stats: DressingChunkStats = {
      ms: 0,
      draws: 0,
      grass: 0,
      flowers: 0,
      bushes: 0,
      blossoms: 0,
      trees: 0,
      rocks: 0,
      bigRocks: 0,
      streamSamples: water.samples,
      ponds: 0,
      bridges: 0,
      fords: 0,
      traceMs: 0,
      phases: [tGrid - t0, 0, 0, 0],
    };
    for (const p of wq.ponds) if (p.x >= x0 && p.x < x1 && p.z >= z0 && p.z < z1) stats.ponds++;
    if (water.geometry !== null) {
      const m = new THREE.Mesh(water.geometry, dressingWaterMaterial());
      m.name = 'dressing-water';
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      owned.push(water.geometry);
      meshes.push(m);
    }

    // ── Bridges / fords ──
    const colTris: number[] = [];
    {
      const pos: number[] = [];
      const col: number[] = [];
      for (const c of water.crossings) {
        if (c.kind === 'ford') {
          stats.fords++;
          continue;
        }
        stats.bridges++;
        buildBridge(c, T, x0, z0, th, pos, col, colTris);
      }
      if (pos.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, dressingBridgeMaterial());
        m.name = 'dressing-bridges';
        m.castShadow = true;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        owned.push(g);
        meshes.push(m);
      }
    }

    const tWater = performance.now();
    stats.phases[1] = tWater - tGrid;
    const q = this.qMul;
    const near = (x: number, z: number) => 1 - smoothstep(1, 9, WD(x, z));

    // ── Grass tufts ──
    const grass = new Inst(true);
    {
      const n = Math.round(2600 * q);
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd.next() * size;
        const z = z0 + rnd.next() * size;
        const r = rnd.next();
        const rot = rnd.next() * Math.PI * 2;
        const sc = rnd.range(0.9, 1.6);
        if (TD(x, z) < th + 2.5 || BL(x, z)) continue;
        const patch = fbm(x, z, 34, seed + 11);
        const w = near(x, z);
        const dens =
          Math.min(1, 0.32 + 0.55 * patch + w * 0.8) * (1 - smoothstep(0.55, 0.85, slope(x, z)));
        if (r > dens) continue;
        if (WD(x, z) < 0.35) continue;
        const y = H(x, z) - 0.06;
        if (inPond(x, z, y)) continue;
        grass.push(x - x0, y, z - z0, rot, sc, sc * rnd.range(0.85, 1.2), sc);
        const dry = smoothstep(0.2, 0.7, patch) * (1 - w);
        const v = rnd.range(0.9, 1.08);
        grass.color((1 + 0.12 * dry) * v, (1 + 0.02 * dry) * v, (1 - 0.25 * dry) * v);
      }
    }

    // ── Flower patches (punk palette, one colour per patch with strays) ──
    const flowers = new Inst(true);
    {
      const n = Math.round(1500 * q);
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd.next() * size;
        const z = z0 + rnd.next() * size;
        const r = rnd.next();
        const rot = rnd.next() * Math.PI * 2;
        const sc = rnd.range(1.0, 1.6);
        const cl = fbm(x, z, 22, seed + 21);
        const w = near(x, z);
        const p = smoothstep(0.12, 0.5, cl) * 0.85 + w * 0.55;
        if (r > p) continue;
        if (TD(x, z) < th + 3.5 || BL(x, z) || WD(x, z) < 0.5) continue;
        const y = H(x, z) - 0.04;
        if (inPond(x, z, y)) continue;
        flowers.push(x - x0, y, z - z0, rot, sc, sc, sc);
        const pick = fbm(x, z, 15, seed + 31) * 0.5 + 0.5;
        const k =
          Math.floor(pick * FLOWER.length + (rnd.next() - 0.5) * 0.9 + FLOWER.length) %
          FLOWER.length;
        flowers.color(FLOWER[k][0], FLOWER[k][1], FLOWER[k][2]);
      }
    }

    // ── Bushes (a third flowering, punk palette blossoms) ──
    const bushes = new Inst(true);
    const blossoms = new Inst(true);
    {
      const n = Math.round(320 * q);
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd.next() * size;
        const z = z0 + rnd.next() * size;
        const r = rnd.next();
        const rot = rnd.next() * Math.PI * 2;
        const sc = rnd.range(0.75, 1.35);
        const flower = rnd.next();
        const pal = rnd.next();
        const cl = fbm(x, z, 40, seed + 41);
        if (r > smoothstep(0.0, 0.55, cl) * 0.7 + near(x, z) * 0.35) continue;
        if (TD(x, z) < th + 6 || BL(x, z) || WD(x, z) < 1.2) continue;
        const y = H(x, z) - 0.18 * sc;
        if (inPond(x, z, y + 0.2)) continue;
        bushes.push(x - x0, y, z - z0, rot, sc, sc, sc);
        const g = rnd.range(0.88, 1.06);
        bushes.color(g * rnd.range(0.92, 1.05), g, g * rnd.range(0.85, 1.0));
        if (flower < 0.38) {
          blossoms.push(x - x0, y, z - z0, rot, sc, sc, sc);
          const c = BLOSSOM[Math.floor(pal * BLOSSOM.length) % BLOSSOM.length];
          blossoms.color(c[0], c[1], c[2]);
        }
      }
    }

    // ── Trees: loose groves, well off the track (trunk colliders) ──
    const trees = new Inst(true);
    const trunks: number[][] = [];
    {
      const n = Math.round(40 * Math.min(1.2, q));
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd.next() * size;
        const z = z0 + rnd.next() * size;
        const r = rnd.next();
        const rot = rnd.next() * Math.PI * 2;
        const sc = rnd.range(0.75, 1.25);
        const grove = fbm(x, z, 70, seed + 51);
        if (r > smoothstep(-0.1, 0.45, grove) * 0.6 + 0.06) continue;
        if (TD(x, z) < th + 11 || BL(x, z) || WD(x, z) < 2.5) continue;
        if (trunks.some(p => Math.hypot(p[0] - x, p[1] - z) < 6)) continue;
        if (T.trackDist(x, z) < th + 11) continue;
        const e = 0.6;
        const y =
          Math.min(
            T.height(x, z),
            T.height(x + e, z),
            T.height(x - e, z),
            T.height(x, z + e),
            T.height(x, z - e),
          ) - 0.05;
        if (inPond(x, z, y)) continue;
        trees.push(x - x0, y, z - z0, rot, sc, sc, sc);
        trees.color(rnd.range(0.92, 1.05), rnd.range(0.95, 1.05), rnd.range(0.85, 1.03));
        trunks.push([x, z, y, sc, rot]);
      }
    }

    // ── Rocks: rounded boulders (small ones may sit in / by the water) ──
    const rocks = new Inst(false);
    const bigRocks: number[][] = [];
    if (this.opts.rocks !== false) {
      const n = 5 + Math.floor(rnd.next() * 8);
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd.next() * size;
        const z = z0 + rnd.next() * size;
        const r0 = rnd.next();
        const r1 = rnd.next();
        const r2 = rnd.next();
        const far = TD(x, z) > 40;
        const s = 0.45 + r0 * r0 * (far ? 3.2 : 1.6);
        const big = s >= 1.3;
        if (TD(x, z) < th + (big ? 14 : 8) || BL(x, z)) continue;
        if (WD(x, z) < (big ? 2 : -0.4)) continue;
        if (trunks.some(p => Math.hypot(p[0] - x, p[1] - z) < 3 + s)) continue;
        if (T.trackDist(x, z) < th + (big ? 14 : 8)) continue;
        const e = s * 0.8;
        const lo = Math.min(
          T.height(x + e, z),
          T.height(x - e, z),
          T.height(x, z + e),
          T.height(x, z - e),
        );
        const y = Math.min(T.height(x, z), lo) - s * 0.12;
        if (wq.ponds.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 2 + s)) continue;
        const sx = s * (0.9 + r2 * 0.4);
        const sy = s * (0.7 + r1 * 0.35);
        const sz = s * (0.9 + r0 * 0.3);
        rocks.push(x - x0, y, z - z0, r1 * Math.PI * 2, sx, sy, sz);
        if (big) bigRocks.push([x - x0, y, z - z0, r1 * Math.PI * 2, sx, sy, sz]);
      }
    }

    const tPlace = performance.now();
    stats.phases[2] = tPlace - tWater;
    // ── Meshes + LOD tiers ──
    const F = A.foliage;
    const add = (m: THREE.InstancedMesh | null, near0: number, far0: number, min: number) => {
      if (m === null) return;
      meshes.push(m);
      if (far0 > 0) root.tiers.push({ mesh: m, full: m.count, near: near0, far: far0, min });
    };
    const shadowsLow = this.quality !== 'low';
    add(instanced(A.rockGeo, A.rockMat, rocks, 'dressing-rocks', sphere, true), 0, 0, 1);
    add(
      instanced(A.grassGeo, A.grassMat, grass, 'dressing-grass', sphere, false),
      A.grassFade[0] * 0.6,
      A.grassFade[1],
      0,
    );
    add(
      instanced(A.flowerGeo, A.flowerMat, flowers, 'dressing-flowers', sphere, false),
      A.flowerFade[0] * 0.6,
      A.flowerFade[1],
      0,
    );
    add(
      instanced(A.bushLeaves, F.bush, bushes, 'dressing-bush', sphere, shadowsLow, F.bushDepth),
      110,
      320,
      0.35,
    );
    add(
      instanced(A.bushBlossoms, F.blossom, blossoms, 'dressing-blossom', sphere, false),
      90,
      260,
      0.25,
    );
    add(
      instanced(A.treeWood, F.bark, trees, 'dressing-tree-wood', sphere, true, F.barkDepth),
      0,
      0,
      1,
    );
    add(
      instanced(A.treeLeaves, F.leaf, trees, 'dressing-tree-leaves', sphere, true, F.leafDepth),
      0,
      0,
      1,
    );
    for (const m of meshes) {
      m.updateMatrix();
      root.add(m);
    }
    stats.grass = grass.count;
    stats.flowers = flowers.count;
    stats.bushes = bushes.count;
    stats.blossoms = blossoms.count;
    stats.trees = trees.count;
    stats.rocks = rocks.count;
    stats.bigRocks = bigRocks.length;
    stats.draws = meshes.length;

    // ── Collision: big rocks, trunks, bridge rails (chunk-local) ──
    const m4 = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const pushGeo = (g: THREE.BufferGeometry, mat: THREE.Matrix4) => {
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(mat);
        colTris.push(v.x, v.y, v.z);
      }
    };
    for (const b of bigRocks) {
      qt.setFromAxisAngle(up, b[3]);
      m4.compose(new THREE.Vector3(b[0], b[1], b[2]), qt, new THREE.Vector3(b[4], b[5], b[6]));
      pushGeo(A.rockCollider, m4);
    }
    for (const tr of trunks) {
      m4.makeScale(tr[3], tr[3], tr[3]).setPosition(tr[0] - x0, tr[2], tr[1] - z0);
      pushGeo(A.trunkCollider, m4);
    }
    let collision: THREE.BufferGeometry | undefined;
    if (colTris.length > 0) {
      collision = new THREE.BufferGeometry();
      collision.setAttribute('position', new THREE.Float32BufferAttribute(colTris, 3));
      owned.push(collision);
    }

    root.updateMatrixWorld(true);
    stats.traceMs = this.network.traceMs - trace0;
    stats.phases[3] = performance.now() - tPlace;
    stats.ms = performance.now() - t0;
    this.totals.chunks++;
    this.totals.ms += stats.ms;
    this.totals.maxMs = Math.max(this.totals.maxMs, stats.ms);
    this.totals.draws += stats.draws;
    let disposed = false;
    return {
      object: root,
      collision,
      stats,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        root.removeFromParent();
        for (const m of meshes)
          if ((m as THREE.InstancedMesh).isInstancedMesh === true)
            (m as THREE.InstancedMesh).dispose();
        for (const g of owned) g.dispose();
        root.clear();
        this.totals.chunks--;
        this.totals.draws -= stats.draws;
      },
    };
  }
}

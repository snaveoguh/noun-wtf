// ── Endless mountain: chunk streaming, LOD meshing and prop hooks ───────
//
// The surface itself is analytic (terrain.ts) and collides without any
// meshes at all; this module only builds what you *see* plus the colliders
// for props that sit on it:
//
//   • Square chunks (CHUNK m) appear around the player out to VIEW m and are
//     disposed once they fall behind. Near chunks are finer (LOD 0), distant
//     ones coarser; skirts hide the cracks between LODs. Fog hides the edge.
//   • Meshing is incremental (a few rows at a time) inside a per-frame time
//     budget, nearest chunk first, so streaming never stalls a frame.
//   • Vertices are chunk-local and each mesh is positioned at its chunk
//     origin, so the GPU only ever sees small numbers — kilometres downhill
//     still renders without float32 jitter (three builds modelView in doubles).
//   • Decorators (props) are the extension hook: each one is asked once per
//     chunk to populate it deterministically (seeded by chunk coords), and may
//     return render objects + collision geometry. Rocks + kickers ship now;
//     rivers, flowers, mega ramps… plug in the same way.

import type { CollisionWorld } from '../../physics/Collision';
import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';

import { courseGroundColour, overlapsCourse, type Rgb } from '../../golf/course/colors';
import { toonify } from '../../render/Toon';

import { RERUN_MOVE, ringHides, type Aabb } from './ringOcclusion';
import {
  hashInts,
  meshHeight,
  raycastTerrain,
  sampleTerrain,
  terrainHeight,
  terrainNormal,
  tintNoise,
  type TerrainSample,
} from './terrain';
import { tracks } from './tracks';

/** Inside this (the facade line) the terrain is sunk under the street. */
const UNDER_CITY = 76;

interface CullItem {
  obj: THREE.Object3D;
  boxes: Aabb[];
  hidden: boolean;
  /** Its layer mask while hidden (restored when it shows again). */
  mask: number;
}

/**
 * World bounds bucketed by the side of the city square a point / box lies
 * beyond (one box per side), plus any box that straddles the city as is.
 */
class SideBoxes {
  private sides: (THREE.Box3 | null)[] = [null, null, null, null];
  private loose: THREE.Box3[] = [];
  empty = true;

  private static side(x: number, z: number): number {
    if (Math.max(Math.abs(x), Math.abs(z)) < UNDER_CITY) return -1;
    if (Math.abs(x) >= Math.abs(z)) return x > 0 ? 0 : 1;
    return z > 0 ? 2 : 3;
  }

  private into(k: number, b: THREE.Box3 | THREE.Vector3) {
    const at = (this.sides[k] ??= new THREE.Box3());
    if ((b as THREE.Box3).isBox3) at.union(b as THREE.Box3);
    else at.expandByPoint(b as THREE.Vector3);
    this.empty = false;
  }

  /** Terrain vertex (under-the-city ones are skipped: they're under the street). */
  addPoint(p: THREE.Vector3) {
    const k = SideBoxes.side(p.x, p.z);
    if (k >= 0) this.into(k, p);
  }

  addBox(b: THREE.Box3) {
    if (b.isEmpty()) return;
    const k = SideBoxes.side((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
    if (k >= 0) this.into(k, b);
    else {
      this.loose.push(b.clone());
      this.empty = false;
    }
  }

  item(obj: THREE.Object3D): CullItem {
    const boxes = [...this.sides.filter((b): b is THREE.Box3 => b !== null), ...this.loose].map(
      b => ({
        minX: b.min.x,
        minY: b.min.y,
        minZ: b.min.z,
        maxX: b.max.x,
        maxY: b.max.y,
        maxZ: b.max.z,
      }),
    );
    return { obj, boxes, hidden: false, mask: obj.layers.mask };
  }
}
export const CHUNK = 128;
/** View radius; phones (low) stream a smaller ring: faster loads, fewer hitches. */
const VIEW_BY_QUALITY: Record<Quality, number> = { low: 460, medium: 760, high: 760 };
/** Distance (chunk centre → focus) under which each LOD is used. */
const LOD_RANGE = [210, 420, Infinity];
/** Props (and their colliders) exist on chunks at or below this LOD. */
const PROP_LOD = 1;
/**
 * A chunk whose props (trees, rocks, their colliders) aren't built yet and
 * whose centre is this close (m) gets them this frame, whatever else did.
 */
const URGENT_PROPS = CHUNK * 1.2;
/**
 * Phones (low) draw a chunk's dressing (trees, bushes, rocks, flowers)
 * only this close (chunk centre → focus, m); colliders stay. From the
 * plaza the far chunks' dressing was ~80 draws and 100k+ triangles of a
 * weak phone's frame (?perf=1, 2026-10-28) for trees the fog half hides.
 */
const LOW_DRESSING_VIEW = 300;

export interface ChunkContext {
  ix: number;
  iz: number;
  size: number;
  /** World position of the chunk's (min x, min z) corner, y = 0. */
  origin: THREE.Vector3;
  /** Deterministic [0,1) random stream for this chunk + decorator. */
  random: () => number;
  height(x: number, z: number): number;
  sample(x: number, z: number, out: TerrainSample): TerrainSample;
  toon: boolean;
  quality: Quality;
}

export interface ChunkDecoration {
  /** Render object in chunk-local coordinates (positioned at origin by the stream). */
  object?: THREE.Object3D;
  /** Collision triangles in chunk-local coordinates. */
  collision?: THREE.BufferGeometry;
  dispose?: () => void;
}

/** Placement hook: populate one chunk. Must be deterministic from ctx. */
export interface ChunkDecorator {
  id: string;
  populate(ctx: ChunkContext): ChunkDecoration | null;
}

interface GenJob {
  lod: number;
  n: number;
  /** Rows of the (n+3)² height grid computed so far. */
  row: number;
  heights: Float32Array;
  track: Float32Array;
  alley: Float32Array;
  side: Float32Array;
  tint: Float32Array;
  /** NOUN LINKS ground colour + weight per vertex (rgbw), on chunks over the course. */
  golf: Float32Array | null;
  ms: number;
}

interface Chunk {
  ix: number;
  iz: number;
  key: string;
  origin: THREE.Vector3;
  mesh: THREE.Mesh | null;
  lod: number;
  job: GenJob | null;
  props: { group: THREE.Group; decorations: ChunkDecoration[] } | null;
  /**
   * What it draws (the terrain, each prop mesh) with world bounds per side
   * of the square it lies beyond: hidden one by one when the plaza's ring of
   * buildings hides every box of it from the camera.
   */
  cull: CullItem[];
  /** All of it, per side (the quick whole-chunk test). */
  boxes: Aabb[];
  dist: number;
  /** Distance to the look-ahead point (Infinity when slow). */
  ahead: number;
}

export interface MountainStats {
  chunks: number;
  meshes: number;
  created: number;
  disposed: number;
  propChunks: number;
  /** Mesh generation time per LOD: [count, total ms, max ms]. */
  gen: [number, number, number][];
  propsMs: number;
  lastFrameMs: number;
  maxFrameMs: number;
  pending: number;
}

const SEGS: Record<Quality, number[]> = {
  high: [64, 24, 10],
  medium: [64, 24, 10],
  low: [32, 16, 8],
};

const _sample: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
const GRASS = new THREE.Color(0x5cc04a);
const GRASS_DARK = new THREE.Color(0x3f9a3c);
const GRASS_DRY = new THREE.Color(0x9ccf4f);
const DIRT = new THREE.Color(0xc58a4e);
const DIRT_DARK = new THREE.Color(0x9a6337);
const CONCRETE = new THREE.Color(0x9a95a6);
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _golf: Rgb = { r: 0, g: 0, b: 0 };

export class MountainStream {
  readonly group = new THREE.Group();
  readonly stats: MountainStats = {
    chunks: 0,
    meshes: 0,
    created: 0,
    disposed: 0,
    propChunks: 0,
    gen: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    propsMs: 0,
    lastFrameMs: 0,
    maxFrameMs: 0,
    pending: 0,
  };
  /** The shared track network (for tests, HUD, future set pieces). */
  readonly network = tracks;
  /** Max ms of meshing work per frame (scaled up with speed). */
  budgetMs = 3;
  /**
   * The camera (Game sets it to the live camera position). From the plaza
   * floor the ring of buildings hides most chunks: those aren't drawn.
   */
  viewer: THREE.Vector3 | null = null;
  /** In `prime`: build every prop chunk in range now, not one a frame. */
  private priming = false;
  private frameBudget = 3;
  private chunks = new Map<string, Chunk>();
  private material: THREE.Material;
  private decorators: ChunkDecorator[] = [];
  private segs: number[];

  constructor(
    private world: CollisionWorld,
    private quality: Quality,
    private toon: boolean,
  ) {
    this.group.name = 'Mountain';
    this.segs = SEGS[quality];
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    mat.name = 'MountainTerrain';
    this.material = mat;
    world.terrain = {
      raycast: raycastTerrain,
      normal: terrainNormal,
    };
  }

  /** Register a placement hook (rocks, kickers, later rivers / flowers / mega ramps). */
  addDecorator(d: ChunkDecorator) {
    this.decorators.push(d);
  }

  /**
   * Stream chunks around `focus` within the frame budget. `vel` (m/s) adds a
   * look-ahead point a few seconds down the line, so at speed the chunks in
   * the direction of travel are meshed first and kept alive.
   */
  update(focus: THREE.Vector3, vel?: THREE.Vector3) {
    const t0 = performance.now();
    const fx = focus.x;
    const fz = focus.z;
    const speed = vel !== undefined ? Math.hypot(vel.x, vel.z) : 0;
    const lookT = Math.min(4, 120 / Math.max(1, speed)) * Math.min(1, speed / 15);
    const lx = fx + (vel?.x ?? 0) * lookT;
    const lz = fz + (vel?.z ?? 0) * lookT;
    const VIEW = VIEW_BY_QUALITY[this.quality];
    const aheadR = VIEW * 0.6;
    // More work per frame the faster we go (≈ one chunk row per second)
    const budget = this.budgetMs * (1 + Math.min(2, speed / 40));
    const distTo = (c: { origin: THREE.Vector3 }, px: number, pz: number) =>
      Math.hypot(c.origin.x + CHUNK / 2 - px, c.origin.z + CHUNK / 2 - pz);
    // Dispose chunks that fell out of range (behind us)
    const low = this.quality === 'low';
    for (const c of this.chunks.values()) {
      c.dist = distTo(c, fx, fz);
      c.ahead = speed > 15 ? distTo(c, lx, lz) : Infinity;
      if (c.dist > VIEW + CHUNK && c.ahead > aheadR + CHUNK) this.disposeChunk(c);
      else if (low && c.props !== null) {
        const near = c.dist < LOW_DRESSING_VIEW;
        for (const o of c.props.group.children)
          if (o.userData.farCull === true && o.visible !== near) o.visible = near;
      }
    }
    // Create the ones that came into range around us and ahead of us
    const spawnAround = (px: number, pz: number, radius: number) => {
      const cix = Math.floor(px / CHUNK);
      const ciz = Math.floor(pz / CHUNK);
      const r = Math.ceil(radius / CHUNK) + 1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const ix = cix + dx;
          const iz = ciz + dz;
          const ox = ix * CHUNK;
          const oz = iz * CHUNK;
          // Nothing to draw under the city itself
          if (ox > -70 && oz > -70 && ox + CHUNK < 70 && oz + CHUNK < 70) continue;
          const dist = Math.hypot(ox + CHUNK / 2 - px, oz + CHUNK / 2 - pz);
          if (dist > radius + CHUNK * 0.5) continue;
          const key = `${ix},${iz}`;
          if (!this.chunks.has(key)) {
            this.chunks.set(key, {
              ix,
              iz,
              key,
              origin: new THREE.Vector3(ox, 0, oz),
              mesh: null,
              lod: -1,
              job: null,
              props: null,
              cull: [],
              boxes: [],
              dist: distTo({ origin: new THREE.Vector3(ox, 0, oz) }, fx, fz),
              ahead: Infinity,
            });
          }
        }
      }
    };
    spawnAround(fx, fz, VIEW);
    if (speed > 15) spawnAround(lx, lz, aheadR);
    for (const c of this.chunks.values()) if (speed > 15) c.ahead = distTo(c, lx, lz);
    // Work list: missing meshes first (nearest first), then LOD changes
    const work: { c: Chunk; want: number; pri: number }[] = [];
    for (const c of this.chunks.values()) {
      const want = this.lodFor(c);
      if (c.mesh === null || c.lod !== want || (c.job !== null && c.job.lod !== want)) {
        const pri =
          (c.mesh === null ? 0 : want < c.lod ? 1e5 : 2e5) + Math.min(c.dist, c.ahead * 0.8);
        work.push({ c, want, pri });
      }
      if (c.props !== null && want > PROP_LOD + 1) this.disposeProps(c);
    }
    work.sort((a, b) => a.pri - b.pri);
    this.stats.pending = work.length;
    this.frameBudget = budget;
    for (const w of work) {
      if (performance.now() - t0 > budget) break;
      const c = w.c;
      if (c.job === null || c.job.lod !== w.want) c.job = this.newJob(w.want, c.origin);
      if (this.advance(c, t0)) this.finish(c);
    }
    // Props on near chunks (after their terrain mesh exists), nearest first.
    // One a frame: a chunk's props are built in one go (3-8 ms, its collider
    // BVH included), and at speed, with the budget raised, two or three used
    // to land in the same frame: the hitch you felt riding fast. They're
    // queued ~400 m out, seconds ahead even at 200 m/s, so one a frame keeps
    // up; only one you're nearly on goes ahead even past the budget.
    const propWork = [...this.chunks.values()]
      .filter(c => c.props === null && c.mesh !== null && this.lodFor(c) <= PROP_LOD)
      .sort((a, b) => Math.min(a.dist, a.ahead) - Math.min(b.dist, b.ahead));
    let built = 0;
    for (const c of propWork) {
      const near = Math.min(c.dist, c.ahead) < URGENT_PROPS;
      if (!this.priming && !near && (built > 0 || performance.now() - t0 > budget)) break;
      this.buildProps(c);
      built++;
    }
    const ms = performance.now() - t0;
    this.stats.lastFrameMs = ms;
    this.stats.maxFrameMs = Math.max(this.stats.maxFrameMs, ms);
    this.stats.chunks = this.chunks.size;
    let meshes = 0;
    let props = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh !== null) meshes++;
      if (c.props !== null) props++;
    }
    this.stats.meshes = meshes;
    this.stats.propChunks = props;
    this.cullByRing();
  }

  /** Chunks drawn / hidden behind the plaza's ring last frame. */
  ringCulled = 0;

  /** Where the ring cull last ran from; it reruns once the camera moves (or chunks change). */
  private cullFrom = new THREE.Vector3(Infinity, 0, 0);
  private cullDirty = true;

  private cullByRing() {
    const v = this.viewer;
    if (v === null) return;
    // Only the camera's position matters (not where it looks)
    if (!this.cullDirty && v.distanceToSquared(this.cullFrom) < RERUN_MOVE * RERUN_MOVE) return;
    this.cullFrom.copy(v);
    this.cullDirty = false;
    let n = 0;
    const hides = (b: Aabb) => ringHides(v.x, v.y, v.z, b);
    for (const c of this.chunks.values()) {
      // Whole chunk hidden (most of them): no need to look at its pieces
      const all = c.boxes.length > 0 && c.boxes.every(hides);
      for (const it of c.cull) {
        const hide = all || it.boxes.every(hides);
        if (hide) n++;
        if (hide === it.hidden) continue;
        it.hidden = hide;
        // By layer mask, so it never fights code that sets `visible`
        if (hide) {
          it.mask = it.obj.layers.mask;
          it.obj.layers.mask = 0;
        } else it.obj.layers.mask = it.mask;
      }
    }
    this.ringCulled = n;
  }

  /** The chunk's cull items: its terrain and each prop mesh, boxed per side of the city. */
  private updateBox(c: Chunk) {
    // Anything hidden by the old items shows again until the next cull
    for (const it of c.cull) if (it.hidden) it.obj.layers.mask = it.mask;
    c.cull = [];
    this.cullDirty = true;
    const whole = new SideBoxes();
    const p = new THREE.Vector3();
    if (c.mesh !== null) {
      // Vertices under the city are sunk out of sight under the street
      const pos = c.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const sides = new SideBoxes();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).add(c.origin);
        sides.addPoint(p);
        whole.addPoint(p);
      }
      c.cull.push(sides.item(c.mesh));
    }
    // Props: per mesh; an instanced one boxed per instance
    c.props?.group.updateMatrixWorld(true);
    c.props?.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      const sides = new SideBoxes();
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        if (im.geometry.boundingBox === null) im.geometry.computeBoundingBox();
        const mat = new THREE.Matrix4();
        const ib = new THREE.Box3();
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, mat);
          ib.copy(im.geometry.boundingBox!).applyMatrix4(mat.premultiply(im.matrixWorld));
          sides.addBox(ib);
          whole.addBox(ib);
        }
      } else {
        const b = new THREE.Box3().setFromObject(o, false);
        sides.addBox(b);
        whole.addBox(b);
      }
      if (!sides.empty) c.cull.push(sides.item(o));
    });
    c.boxes = whole.item(this.group).boxes;
  }

  /** Synchronously mesh everything near `focus` (spawn / teleport). */
  prime(focus: THREE.Vector3) {
    const budget = this.budgetMs;
    this.budgetMs = 1e9;
    this.priming = true;
    this.update(focus);
    this.priming = false;
    this.budgetMs = budget;
  }

  private lodFor(c: Chunk): number {
    // Hysteresis: keep the current LOD for an extra 20 m before coarsening.
    // Chunks we're about to reach count as near.
    const d = Math.min(c.dist, c.ahead + 60);
    for (let l = 0; l < LOD_RANGE.length; l++) {
      const edge = LOD_RANGE[l] + (c.lod >= 0 && c.lod <= l ? 20 : 0);
      if (d < edge) return l;
    }
    return LOD_RANGE.length - 1;
  }

  private newJob(lod: number, origin: THREE.Vector3): GenJob {
    const n = this.segs[lod];
    const g = n + 3;
    const v = (n + 1) * (n + 1);
    const golf = overlapsCourse(origin.x, origin.z, origin.x + CHUNK, origin.z + CHUNK);
    return {
      golf: golf ? new Float32Array(v * 4) : null,
      lod,
      n,
      row: 0,
      heights: new Float32Array(g * g),
      track: new Float32Array(v),
      alley: new Float32Array(v),
      side: new Float32Array(v),
      tint: new Float32Array(v),
      ms: 0,
    };
  }

  /** Sample rows of the height grid until the frame budget runs out. True when done. */
  private advance(c: Chunk, frameStart: number): boolean {
    const j = c.job!;
    const n = j.n;
    const g = n + 3;
    const step = CHUNK / n;
    const ox = c.origin.x;
    const oz = c.origin.z;
    const t0 = performance.now();
    while (j.row < g) {
      const gz = j.row - 1;
      const wz = oz + gz * step;
      for (let gi = 0; gi < g; gi++) {
        const gx = gi - 1;
        const wx = ox + gx * step;
        const s = meshHeight(wx, wz, _sample);
        j.heights[j.row * g + gi] = s.y;
        if (gx >= 0 && gx <= n && gz >= 0 && gz <= n) {
          const vi = gz * (n + 1) + gx;
          j.track[vi] = s.track;
          j.alley[vi] = s.alley;
          j.side[vi] = s.side;
          j.tint[vi] = tintNoise(wx, wz);
          if (j.golf !== null) {
            const w = courseGroundColour(wx, wz, _golf);
            j.golf.set([_golf.r, _golf.g, _golf.b, w], vi * 4);
          }
        }
      }
      j.row++;
      if (performance.now() - frameStart > this.frameBudget) break;
    }
    j.ms += performance.now() - t0;
    return j.row >= g;
  }

  private finish(c: Chunk) {
    const j = c.job!;
    const t0 = performance.now();
    const geo = this.buildGeometry(j);
    if (c.mesh === null) {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.name = `mountain:${c.key}`;
      mesh.position.copy(c.origin);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (this.toon) toonify(mesh);
      this.group.add(mesh);
      c.mesh = mesh;
      this.stats.created++;
    } else {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    }
    c.lod = j.lod;
    this.updateBox(c);
    j.ms += performance.now() - t0;
    const st = this.stats.gen[j.lod];
    st[0]++;
    st[1] += j.ms;
    st[2] = Math.max(st[2], j.ms);
    c.job = null;
  }

  private buildGeometry(j: GenJob): THREE.BufferGeometry {
    const n = j.n;
    const g = n + 3;
    const step = CHUNK / n;
    const nv = (n + 1) * (n + 1);
    const skirtV = 4 * (n + 1);
    const total = nv + skirtV;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let gz = 0; gz <= n; gz++) {
      for (let gx = 0; gx <= n; gx++) {
        const vi = gz * (n + 1) + gx;
        const hi = (gz + 1) * g + (gx + 1);
        const y = j.heights[hi];
        pos[vi * 3] = gx * step;
        pos[vi * 3 + 1] = y;
        pos[vi * 3 + 2] = gz * step;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        const dhx = (j.heights[hi + 1] - j.heights[hi - 1]) / (2 * step);
        const dhz = (j.heights[hi + g] - j.heights[hi - g]) / (2 * step);
        const l = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
        nrm[vi * 3] = -dhx / l;
        nrm[vi * 3 + 1] = 1 / l;
        nrm[vi * 3 + 2] = -dhz / l;
        // Colour: grass ↔ dirt track (with wheel ruts) ↔ alley concrete
        const tn = j.tint[vi];
        _c.copy(GRASS).lerp(tn > 0 ? GRASS_DRY : GRASS_DARK, Math.min(1, Math.abs(tn) * 0.9));
        const tr = j.track[vi];
        if (tr > 0) {
          const s = Math.abs(j.side[vi]);
          const rut = Math.max(0, 1 - Math.abs(s - 2.1) / 0.7) * 0.55;
          _c2.copy(DIRT).lerp(DIRT_DARK, Math.max(rut, (tn + 1) * 0.18));
          _c.lerp(_c2, tr);
        }
        const al = j.alley[vi];
        if (al > 0) _c.lerp(CONCRETE, al);
        // NOUN LINKS: the course's own ground (rough, deep rough, under the overlays)
        const gf = j.golf;
        if (gf !== null && gf[vi * 4 + 3] > 0)
          _c.lerp(_c2.setRGB(gf[vi * 4], gf[vi * 4 + 1], gf[vi * 4 + 2]), gf[vi * 4 + 3]);
        col[vi * 3] = _c.r;
        col[vi * 3 + 1] = _c.g;
        col[vi * 3 + 2] = _c.b;
      }
    }
    // Skirts: copy each edge vertex straight down
    const depth = 1.2 + step * 0.4;
    const edges: number[][] = [[], [], [], []];
    for (let k = 0; k <= n; k++) {
      edges[0].push(k); // z = 0 row
      edges[1].push(n * (n + 1) + k); // z = max row
      edges[2].push(k * (n + 1)); // x = 0 column
      edges[3].push(k * (n + 1) + n); // x = max column
    }
    let sv = nv;
    const skirtStart: number[] = [];
    for (const e of edges) {
      skirtStart.push(sv);
      for (const vi of e) {
        pos[sv * 3] = pos[vi * 3];
        pos[sv * 3 + 1] = pos[vi * 3 + 1] - depth;
        pos[sv * 3 + 2] = pos[vi * 3 + 2];
        nrm[sv * 3] = nrm[vi * 3];
        nrm[sv * 3 + 1] = nrm[vi * 3 + 1];
        nrm[sv * 3 + 2] = nrm[vi * 3 + 2];
        col[sv * 3] = col[vi * 3];
        col[sv * 3 + 1] = col[vi * 3 + 1];
        col[sv * 3 + 2] = col[vi * 3 + 2];
        sv++;
      }
    }
    const idxCount = n * n * 6 + 4 * n * 12;
    const index = total > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
    let ii = 0;
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        const a = gz * (n + 1) + gx;
        const b = a + 1;
        const d = a + (n + 1);
        const e = d + 1;
        // CCW seen from above (+Y): a → d → b, b → d → e
        index[ii++] = a;
        index[ii++] = d;
        index[ii++] = b;
        index[ii++] = b;
        index[ii++] = d;
        index[ii++] = e;
      }
    }
    for (let k = 0; k < 4; k++) {
      const e = edges[k];
      const s0 = skirtStart[k];
      for (let q = 0; q < n; q++) {
        const top0 = e[q];
        const top1 = e[q + 1];
        const bot0 = s0 + q;
        const bot1 = s0 + q + 1;
        // Both windings (skirts are tiny; saves caring which way each edge faces)
        index[ii++] = top0;
        index[ii++] = bot0;
        index[ii++] = top1;
        index[ii++] = top1;
        index[ii++] = bot0;
        index[ii++] = bot1;
        index[ii++] = top0;
        index[ii++] = top1;
        index[ii++] = bot0;
        index[ii++] = top1;
        index[ii++] = bot1;
        index[ii++] = bot0;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(0, minY - depth, 0),
      new THREE.Vector3(CHUNK, maxY, CHUNK),
    );
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    return geo;
  }

  private buildProps(c: Chunk) {
    const t0 = performance.now();
    const group = new THREE.Group();
    group.name = `mountain-props:${c.key}`;
    group.position.copy(c.origin);
    const decorations: ChunkDecoration[] = [];
    const cols: THREE.BufferGeometry[] = [];
    for (const d of this.decorators) {
      let salt = 0;
      for (let i = 0; i < d.id.length; i++) salt = (salt * 31 + d.id.charCodeAt(i)) | 0;
      let k = 0;
      const ctx: ChunkContext = {
        ix: c.ix,
        iz: c.iz,
        size: CHUNK,
        origin: c.origin,
        random: () => hashInts(c.ix * 7919 + k, c.iz * 104729 + k++ * 31, salt),
        height: terrainHeight,
        sample: sampleTerrain,
        toon: this.toon,
        quality: this.quality,
      };
      let deco: ChunkDecoration | null = null;
      try {
        deco = d.populate(ctx);
      } catch (err) {
        console.warn(`[world2] mountain decorator ${d.id} failed`, err);
      }
      if (deco === null) continue;
      decorations.push(deco);
      if (deco.object !== undefined) {
        // Scenery only (no ramps, towns, landmarks): phones cull it far off
        if (d.id === 'dressing') deco.object.userData.farCull = true;
        group.add(deco.object);
      }
      if (deco.collision !== undefined) cols.push(deco.collision);
    }
    group.updateMatrixWorld(true);
    this.group.add(group);
    c.props = { group, decorations };
    this.updateBox(c);
    this.world.setDynamic(`mountain:${c.key}`, mergePositions(cols), c.origin);
    this.stats.propsMs += performance.now() - t0;
  }

  private disposeProps(c: Chunk) {
    if (c.props === null) return;
    this.group.remove(c.props.group);
    for (const d of c.props.decorations) d.dispose?.();
    this.world.setDynamic(`mountain:${c.key}`, null);
    c.props = null;
    this.updateBox(c);
  }

  private disposeChunk(c: Chunk) {
    this.disposeProps(c);
    if (c.mesh !== null) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    c.job = null;
    this.chunks.delete(c.key);
    this.stats.disposed++;
  }

  /**
   * Point on main track `i` (0 = the +Z alley's line) at along-track
   * distance s, on the surface (handy for tests / teleports).
   */
  trackPoint(s: number, i = 0, out = new THREE.Vector3()) {
    const p = tracks.pointAt(tracks.main(i), s, { x: 0, z: 0, h: 0, k: 0 });
    return out.set(p.x, terrainHeight(p.x, p.z), p.z);
  }

  dispose() {
    for (const c of [...this.chunks.values()]) this.disposeChunk(c);
    if (this.world.terrain !== null) this.world.terrain = null;
    this.material.dispose();
  }
}

/** Merge position-only copies of geometries (non-indexed) for a collider. */
function mergePositions(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  let count = 0;
  const parts: Float32Array[] = [];
  for (const g of geos) {
    const src = g.index !== null ? g.toNonIndexed() : g;
    const a = src.attributes.position.array as Float32Array;
    parts.push(a);
    count += a.length;
  }
  if (count === 0) return null;
  const out = new Float32Array(count);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return geo;
}

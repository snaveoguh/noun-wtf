// ── Noun Golf view: NOUN LINKS drawn (built when near, freed when far) ───
//
// Nothing exists until the viewer (the rider, or the camera) is within
// ACTIVATE m of the course's terraced area. Then, in frame slices (≤
// BUDGET_MS a frame, nearest first):
//   1. every region's far overlay (LOD 1: holes, the clubhouse, the range),
//   2. the near overlays (LOD 0) of regions within NEAR m, swapped in as
//      they finish and dropped again past NEAR + 150 m,
//   3. the static scenery (buildings + their colliders, flags, signs,
//      course dressing), the ponds, the trees (3 instanced draws).
// Past RELEASE m everything is freed (geometries, materials, textures,
// colliders). Far away update() is one distance test.
//
// Draws: one per region overlay in view (≤ 21), ponds 1, trees 3, solid
// scenery 1, glass 1, signs 1, flags 1.
//
// Materials are the game's: vertex-coloured toon (the mountain's program;
// the instanced variant for trees), the dressing's water, plus a textured
// toon (signs / flags) and glass. They're compiled behind the scenes at
// activation (before any of it is drawn), so nothing links mid-play.

import type { Game } from '../../Game';
import type { CollisionWorld } from '../../physics/Collision';
import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';

import { getToonRamp } from '../../render/Toon';
import { BOUNDS, DATUM, SITE, outsideCore, toCourse } from '../course/site';
import { golfCourse, type GolfCourse } from '../course/surface';
import { dressingWaterMaterial } from '../../world/mountain/DressingWater';
import { hexLinear } from '../course/colors';

import { paintFlags, paintSigns } from './atlas';
import { devPose, type DevPose, type DevShot } from './devShots';
import { colliderTriangles, type MeshData } from './kit';
import { OVERLAY_LOD, buildRegion, courseRegions, regionDist, type Region, type RegionBuild } from './overlays';
import { sceneryGen, waveFlags, type FlagSet, type Scenery } from './scenery';
import { SliceQueue } from './slices';
import { TREE_TILE, tileTrees, treeMatrix, treeVariety, treesWithin, unitTree, type TreeIndex } from './trees';
import { pondSurfaces } from './water';

/** Start building within this distance of the course's bounds (m). */
export const ACTIVATE = 1200;
/** Free everything past this (m). */
export const RELEASE = 2000;
/** Frame budget for building (ms). */
export const BUDGET_MS = 3;

interface Tuning {
  /** Regions get their near overlay within this (m, to their bounds). */
  near: number;
  /** Regions (and the scenery) are drawn within this; the mountain streams no further. */
  view: number;
  /** Trees drawn within this. */
  trees: number;
}

const TUNING: Record<Quality, Tuning> = {
  high: { near: 340, view: 860, trees: 600 },
  medium: { near: 300, view: 860, trees: 520 },
  low: { near: 200, view: 560, trees: 350 },
};

/** What the view needs from the game. */
export interface CourseViewHost {
  scene: THREE.Scene;
  quality(): Quality;
  toon(): boolean;
  world(): CollisionWorld;
  /** Compile programs as the frame draws (Graphics.asDrawn + renderer.compile). */
  warm(root: THREE.Object3D, camera: THREE.Camera): void;
  /** The rider's world is suspended (a pocket room, the Big Drop). */
  away(): boolean;
  /** The endless mountain is on (no course without it). */
  enabled(): boolean;
}

interface RegionState {
  r: Region;
  dist: number;
  mesh: (THREE.Mesh | null)[];
  queued: boolean[];
  verts: number[];
}

export interface CourseViewStats {
  active: boolean;
  regions: number;
  far: number;
  near: number;
  queue: number;
  /** Visible draws this frame (meshes of the course in view range). */
  draws: number;
  /** Ms spent in the last frame's slice, the worst, and the total build. */
  sliceMs: number;
  maxSliceMs: number;
  buildMs: number;
  /** The longest single build step (between two yields), and whose. */
  worstStep: { id: string; ms: number };
  /** Overlay vertices currently built. */
  verts: number;
  trees: number;
  /** Activations / releases. */
  builds: number;
  frees: number;
}

const _v = new THREE.Vector3();
const _uv = { u: 0, v: 0 };

export class CourseView {
  readonly group = new THREE.Group();
  readonly stats: CourseViewStats = {
    active: false,
    regions: 0,
    far: 0,
    near: 0,
    queue: 0,
    draws: 0,
    sliceMs: 0,
    maxSliceMs: 0,
    buildMs: 0,
    worstStep: { id: '', ms: 0 },
    verts: 0,
    trees: 0,
    builds: 0,
    frees: 0,
  };
  private active = false;
  private course: GolfCourse | null = null;
  private queue = new SliceQueue();
  private regions: RegionState[] = [];
  private mats: {
    overlay: THREE.Material;
    solid: THREE.Material;
    glass: THREE.Material;
    signs: THREE.Material;
    flags: THREE.Material;
  } | null = null;
  private textures: THREE.Texture[] = [];
  private statics: THREE.Mesh[] = [];
  private flags: { mesh: THREE.Mesh; set: FlagSet } | null = null;
  private trees: {
    index: TreeIndex;
    meshes: THREE.InstancedMesh[];
    from: THREE.Vector3;
    list: number[];
  } | null = null;
  private treeCols = new Map<number, string>();
  private colliderIds: string[] = [];
  /** Mesh origin for the course-wide meshes (the bounds' centre). */
  private ox = (BOUNDS.x0 + BOUNDS.x1) / 2;
  private oz = (BOUNDS.z0 + BOUNDS.z1) / 2;
  private t = 0;
  private lodT = 0;
  private colT = 0;

  constructor(private host: CourseViewHost) {
    this.group.name = 'golf-course';
  }

  /**
   * Distance from (x, z) to the course's terraced area (m, 0 inside), in
   * the course's own frame: its world AABB reaches back towards the city
   * round the corner the course wraps, so it's no measure of nearness.
   */
  static distance(x: number, z: number): number {
    toCourse(x, z, _uv);
    return Math.max(0, outsideCore(_uv.u, _uv.v) - SITE.BLEND);
  }

  get built(): boolean {
    return this.active;
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3) {
    if (!this.host.enabled()) return;
    const d = Math.min(CourseView.distance(focus.x, focus.z), CourseView.distance(camera.position.x, camera.position.z));
    if (!this.active) {
      if (d > ACTIVATE || this.host.away()) return;
      this.activate(camera);
    } else if (d > RELEASE) {
      this.free();
      return;
    }
    const away = this.host.away();
    this.group.visible = !away;
    if (away) return;
    this.t += dt;
    const tune = TUNING[this.host.quality()];
    // LOD wants + visibility, a few times a second
    this.lodT -= dt;
    if (this.lodT <= 0) {
      this.lodT = 0.25;
      this.plan(focus, tune);
    }
    const ms = this.queue.run(BUDGET_MS);
    this.stats.sliceMs = ms;
    this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, ms);
    this.stats.buildMs += ms;
    this.stats.queue = this.queue.length;
    this.stats.worstStep = this.queue.worstStep;
    if (this.trees !== null && this.trees.from.distanceToSquared(focus) > 25 * 25) this.packTrees(focus, tune);
    this.colT -= dt;
    if (this.colT <= 0) {
      this.colT = 0.5;
      this.treeColliders(focus);
    }
    if (this.flags !== null && d < 700) {
      const pos = this.flags.mesh.geometry.attributes.position as THREE.BufferAttribute;
      waveFlags(this.flags.set, pos.array as Float32Array, this.t, 0.8 + 0.2 * Math.sin(this.t * 0.31));
      pos.needsUpdate = true;
    }
  }

  // ── Activation / release ──────────────────────────────────────────────

  private activate(camera: THREE.Camera) {
    this.active = true;
    this.stats.active = true;
    this.stats.builds++;
    const C = (this.course = golfCourse());
    this.makeMaterials();
    this.host.scene.add(this.group);
    this.regions = courseRegions(C.layout).map(r => ({
      r,
      dist: Infinity,
      mesh: [null, null],
      queued: [false, false],
      verts: [0, 0],
    }));
    this.stats.regions = this.regions.length;
    // Far overlays of every region first
    for (const s of this.regions) this.queueRegion(s, 1);
    this.queue.push({ id: 'scenery', priority: 60, start: () => this.sceneryJob() });
    this.queue.push({ id: 'water', priority: 120, start: () => this.waterJob() });
    this.queue.push({ id: 'trees', priority: 160, start: () => this.treesJob() });
    this.warm(camera);
  }

  private free() {
    this.queue.clear();
    const world = this.host.world();
    for (const id of this.colliderIds) world.setDynamic(id, null);
    for (const id of this.treeCols.values()) world.setDynamic(id, null);
    this.colliderIds = [];
    this.treeCols.clear();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.group.clear();
    this.host.scene.remove(this.group);
    if (this.mats !== null) for (const m of Object.values(this.mats)) m.dispose();
    this.mats = null;
    for (const t of this.textures) t.dispose();
    this.textures = [];
    this.regions = [];
    this.statics = [];
    this.flags = null;
    this.trees = null;
    this.active = false;
    this.stats.active = false;
    this.stats.frees++;
    this.stats.far = this.stats.near = this.stats.verts = this.stats.trees = this.stats.draws = 0;
  }

  dispose() {
    if (this.active) this.free();
  }

  // ── Materials ─────────────────────────────────────────────────────────

  private makeMaterials() {
    const toon = this.host.toon();
    const lit = (p: THREE.MeshStandardMaterialParameters) => {
      const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, ...p });
      if (!toon) return m;
      const t = new THREE.MeshToonMaterial({
        color: m.color,
        map: m.map,
        vertexColors: m.vertexColors,
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        gradientMap: getToonRamp(),
        polygonOffset: m.polygonOffset,
        polygonOffsetFactor: m.polygonOffsetFactor,
        polygonOffsetUnits: m.polygonOffsetUnits,
        depthWrite: m.depthWrite,
        emissive: m.emissive,
        alphaTest: m.alphaTest,
      });
      m.dispose();
      return t;
    };
    const overlay = lit({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    overlay.name = 'GolfOverlay';
    const solid = lit({ vertexColors: true });
    solid.name = 'GolfSolid';
    const glass = lit({ color: 0x9fd8f0, transparent: true, opacity: 0.55, depthWrite: false });
    glass.name = 'GolfGlass';
    const signCanvas = paintSigns(this.course!.layout);
    const flagCanvas = paintFlags();
    const tex = (c: HTMLCanvasElement | null) => {
      if (c === null) return null;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.push(t);
      return t;
    };
    const signs = lit({ map: tex(signCanvas) });
    signs.name = 'GolfSigns';
    const flags = lit({ map: tex(flagCanvas), side: THREE.DoubleSide });
    flags.name = 'GolfFlags';
    this.mats = { overlay, solid, glass, signs, flags };
  }

  /** Compile every program the course will use now, before any of it is drawn. */
  private warm(camera: THREE.Camera) {
    const m = this.mats!;
    const g = new THREE.Group();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    tri.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    tri.setAttribute('aWater', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    for (const mat of [m.overlay, m.solid, m.glass, m.signs, m.flags, dressingWaterMaterial()]) {
      const mesh = new THREE.Mesh(tri, mat);
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    const inst = new THREE.InstancedMesh(tri, m.solid, 1);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3).fill(1), 3);
    inst.receiveShadow = true;
    g.add(inst);
    try {
      this.host.warm(g, camera);
    } catch (err) {
      console.warn('[golf] warm-up failed', err);
    }
    inst.dispose();
    tri.dispose();
  }

  // ── Overlays ──────────────────────────────────────────────────────────

  private queueRegion(s: RegionState, lod: number) {
    if (s.queued[lod] || s.mesh[lod] !== null) return;
    s.queued[lod] = true;
    const out: RegionBuild = { data: null, verts: 0 };
    this.queue.push({
      id: `${s.r.id}:${lod}`,
      priority: s.dist + (lod === 0 ? 40 : 0),
      start: () => buildRegion(this.course!, s.r, lod, out),
      done: () => {
        s.queued[lod] = false;
        if (out.data === null) return;
        const mesh = this.mesh(out.data, this.mats!.overlay, s.r.cx, s.r.cz);
        mesh.name = `golf:${s.r.id}:lod${lod}`;
        mesh.receiveShadow = true;
        s.mesh[lod] = mesh;
        s.verts[lod] = out.verts;
        this.group.add(mesh);
        this.show(s);
        this.count();
      },
    });
  }

  private count() {
    let far = 0;
    let near = 0;
    let verts = 0;
    for (const s of this.regions) {
      if (s.mesh[1] !== null) far++;
      if (s.mesh[0] !== null) near++;
      verts += s.verts[0] * (s.mesh[0] !== null ? 1 : 0) + s.verts[1];
    }
    this.stats.far = far;
    this.stats.near = near;
    this.stats.verts = verts;
  }

  private plan(focus: THREE.Vector3, tune: Tuning) {
    for (const s of this.regions) {
      s.dist = regionDist(s.r, focus.x, focus.z);
      if (s.dist < tune.near) this.queueRegion(s, 0);
      else if (s.dist > tune.near + 150 && s.mesh[0] !== null) {
        this.group.remove(s.mesh[0]);
        s.mesh[0].geometry.dispose();
        s.mesh[0] = null;
      } else if (s.dist > tune.near + 60 && s.queued[0]) {
        this.queue.remove(j => j.id === `${s.r.id}:0` && j.it === undefined);
        if (!this.queue.has(`${s.r.id}:0`)) s.queued[0] = false;
      }
      this.show(s, tune);
    }
    this.count();
    this.queue.sort(j => {
      const [id, lod] = j.id.split(':');
      const s = this.regions.find(q => q.r.id === id);
      return s === undefined ? j.priority : s.dist + (lod === '0' ? 40 : 0);
    });
    // Scenery / water / trees: within view range
    const sceneryOn = CourseView.distance(focus.x, focus.z) < tune.view;
    for (const m of this.statics) m.visible = sceneryOn;
    if (this.flags !== null) this.flags.mesh.visible = sceneryOn;
    let draws = 0;
    this.group.traverseVisible(o => {
      if ((o as THREE.Mesh).isMesh) draws++;
    });
    this.stats.draws = draws;
  }

  private show(s: RegionState, tune = TUNING[this.host.quality()]) {
    const inView = s.dist < tune.view;
    const near = s.mesh[0] !== null;
    if (s.mesh[0] !== null) s.mesh[0].visible = inView;
    if (s.mesh[1] !== null) s.mesh[1].visible = inView && !near;
  }

  private mesh(d: MeshData, mat: THREE.Material, ox: number, oz: number): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
    if (d.uv !== null) g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setIndex(new THREE.BufferAttribute(d.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.position.set(ox, 0, oz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  // ── Scenery, water, trees ─────────────────────────────────────────────

  private *sceneryJob(): Generator<void> {
    const C = this.course!;
    const built: { scenery: Scenery | null } = { scenery: null };
    yield* sceneryGen(C, this.ox, this.oz, built);
    const sc = built.scenery!;
    yield;
    const M = this.mats!;
    const low = this.host.quality() === 'low';
    const solid = this.mesh(sc.solid, M.solid, this.ox, this.oz);
    solid.name = 'golf:scenery';
    solid.castShadow = !low;
    solid.receiveShadow = true;
    const glass = this.mesh(sc.glass, M.glass, this.ox, this.oz);
    glass.name = 'golf:glass';
    glass.renderOrder = 2;
    const signs = this.mesh(sc.signs, M.signs, this.ox, this.oz);
    signs.name = 'golf:signs';
    signs.receiveShadow = true;
    const flags = this.mesh(sc.flags.data, M.flags, this.ox, this.oz);
    flags.name = 'golf:flags';
    flags.frustumCulled = false;
    (flags.geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    for (const m of [solid, glass, signs, flags]) this.group.add(m);
    this.statics.push(solid, glass, signs);
    this.flags = { mesh: flags, set: sc.flags };
    yield;
    // Buildings + the entrance arch collide
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(colliderTriangles(sc.colliders, this.ox, this.oz), 3));
    this.host.world().setDynamic('golf:buildings', geo, new THREE.Vector3(this.ox, 0, this.oz));
    this.colliderIds.push('golf:buildings');
  }

  private *waterJob(): Generator<void> {
    const w = pondSurfaces(this.course!.layout, this.ox, this.oz, hexLinear(0x3aa6d8));
    if (w.count === 0) return;
    yield;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(w.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(w.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(w.col, 3));
    g.setAttribute('aWater', new THREE.BufferAttribute(w.water, 3));
    g.setIndex(new THREE.BufferAttribute(w.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, dressingWaterMaterial());
    m.name = 'golf:water';
    m.position.set(this.ox, 0, this.oz);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    this.statics.push(m);
  }

  private *treesJob(): Generator<void> {
    const L = this.course!.layout;
    const low = this.host.quality() === 'low';
    const index = tileTrees(L.trees);
    yield;
    const counts = [0, 0, 0];
    for (const t of L.trees) counts[t.kind]++;
    const meshes = ([0, 1, 2] as const).map(k => {
      const d = unitTree(k, low);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
      g.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
      g.setIndex(new THREE.BufferAttribute(d.idx, 1));
      const m = new THREE.InstancedMesh(g, this.mats!.solid, Math.max(1, counts[k]));
      m.name = `golf:trees:${['pine', 'broadleaf', 'palm'][k]}`;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, counts[k]) * 3), 3);
      m.count = 0;
      m.castShadow = !low;
      m.receiveShadow = true;
      m.boundingSphere = new THREE.Sphere();
      this.group.add(m);
      return m;
    });
    this.trees = { index, meshes, from: new THREE.Vector3(Infinity, 0, 0), list: [] };
  }

  private packTrees(focus: THREE.Vector3, tune: Tuning) {
    const T = this.trees!;
    T.from.copy(focus);
    const L = this.course!.layout;
    treesWithin(T.index, focus.x, focus.z, tune.trees, T.list);
    const n = [0, 0, 0];
    const lo = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
    const v = { yaw: 0, r: 1, g: 1, b: 1 };
    const r2 = tune.trees * tune.trees;
    for (const i of T.list) {
      const t = L.trees[i];
      if ((t.x - focus.x) ** 2 + (t.z - focus.z) ** 2 > r2) continue;
      const k = t.kind;
      const m = T.meshes[k];
      treeVariety(t, v);
      treeMatrix(t, v.yaw, m.instanceMatrix.array as Float32Array, n[k] * 16);
      const c = m.instanceColor!.array as Float32Array;
      c[n[k] * 3] = v.r;
      c[n[k] * 3 + 1] = v.g;
      c[n[k] * 3 + 2] = v.b;
      n[k]++;
      lo[k] = Math.min(lo[k], t.x - t.r);
      hi[k] = Math.max(hi[k], t.x + t.r);
      lo[k + 3] = Math.min(lo[k + 3], t.z - t.r);
      hi[k + 3] = Math.max(hi[k + 3], t.z + t.r);
    }
    let total = 0;
    T.meshes.forEach((m, k) => {
      m.count = n[k];
      total += n[k];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
      m.visible = n[k] > 0;
      if (n[k] > 0) {
        const cx = (lo[k] + hi[k]) / 2;
        const cz = (lo[k + 3] + hi[k + 3]) / 2;
        m.boundingSphere!.center.set(cx, DATUM, cz);
        // Course heights stay within ~±60 m of the datum; trees ≤ 20 m tall
        m.boundingSphere!.radius = Math.hypot(hi[k] - cx, hi[k + 3] - cz, 90);
      }
    });
    this.stats.trees = total;
  }

  /** Trunk colliders for the tiles round the rider (one tile built per call). */
  private treeColliders(focus: THREE.Vector3) {
    if (this.trees === null) return;
    const T = this.trees;
    const world = this.host.world();
    for (const [key, id] of this.treeCols) {
      const k = T.index.keys.find(q => q.key === key)!;
      if (Math.hypot(k.x - focus.x, k.z - focus.z) > 230) {
        world.setDynamic(id, null);
        this.treeCols.delete(key);
      }
    }
    const L = this.course!.layout;
    for (const k of T.index.keys) {
      if (this.treeCols.has(k.key) || Math.hypot(k.x - focus.x, k.z - focus.z) > 150) continue;
      const list = T.index.tiles.get(k.key)!;
      const ox = k.x;
      const oz = k.z;
      const pos = new Float32Array(list.length * 6 * 6 * 3);
      let o = 0;
      for (const i of list) {
        const t = L.trees[i];
        const r = t.trunk + 0.05;
        const top = t.y + Math.max(3, t.h0 + 1);
        for (let s = 0; s < 6; s++) {
          const a0 = (s / 6) * Math.PI * 2;
          const a1 = ((s + 1) / 6) * Math.PI * 2;
          const x0 = t.x + Math.cos(a0) * r - ox;
          const z0 = t.z + Math.sin(a0) * r - oz;
          const x1 = t.x + Math.cos(a1) * r - ox;
          const z1 = t.z + Math.sin(a1) * r - oz;
          const y0 = t.y - 1;
          pos.set([x0, y0, z0, x1, y0, z1, x1, top, z1, x0, y0, z0, x1, top, z1, x0, top, z0], o);
          o += 18;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const id = `golf:trees:${k.key}`;
      world.setDynamic(id, g, _v.set(ox, 0, oz).clone());
      this.treeCols.set(k.key, id);
      return;
    }
  }

  // ── Dev ───────────────────────────────────────────────────────────────

  /** Named camera / rider poses for screenshots (devShots.ts). */
  pose(shot: DevShot): DevPose {
    return devPose(golfCourse().layout, shot);
  }

  /** Overlay LOD spacings (for the dev handle). */
  readonly lods = OVERLAY_LOD;
  /** Tile size of the tree index (m). */
  readonly treeTile = TREE_TILE;
}

/** The game's CourseView (Game.ts: `readonly golfView = createCourseView(this)`). */
export function createCourseView(game: Game): CourseView {
  return new CourseView({
    get scene() {
      return game.gfx.scene;
    },
    quality: () => game.gfx.quality,
    toon: () => game.gfx.toon,
    world: () => game.world,
    warm: (root, camera) =>
      game.gfx.asDrawn(() => game.gfx.renderer.compile(root, camera, game.gfx.scene)),
    away: () => game.missions.ud.active || game.interiors.inside,
    enabled: () => game.mountain !== null,
  });
}


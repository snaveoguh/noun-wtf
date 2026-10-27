// ── Facades: the plaza's buildings, re-dressed (three.js side) ──────────
//
// On start it reads the plaza GLB's facade walls, the building footprints
// (interiors/plazaDoors, read-only) and the doors the interiors put on
// them, and plans every building (plan.ts). Then, a few milliseconds a
// frame so loading never hitches, it paints the texture atlas and builds
// each building's skin, detailing, rooftop clutter and fire escape into
// one set of meshes per side of the plaza. When everything is built it
// swaps in one frame: the GLB facade meshes hide (the skins replace them
// in the same planes, nothing coplanar) and the fire escapes' and roofs'
// colliders join the collision world.
//
// Draw calls: skin + detail + fine per side (≤ 12), against the 12 GLB
// facade meshes it hides. Detail shows within ~260 m, the fine layer
// (AC units, pipes, balusters, slats) within ~110 m and not at all on the
// low tier.

import type { BuildingDoor } from '../../interiors/contract';
import type { Footprint } from '../../interiors/doors';
import type { CollisionWorld } from '../../physics/Collision';
import type { Quality } from '../../render/Graphics';
import type { LevelData } from '../Level';
import type { BuildingPlan } from './details';
import type { SourceTri } from './faces';
import type { Obstacle } from './plan';
import type { RoofSpot } from './roof';

import * as THREE from 'three';

import { mulberry32 } from '../../interiors/rng';
import { plazaFootprints } from '../../interiors/plazaDoors';
import { toToon } from '../../render/Toon';
import { paintAtlas, SIGN_SLOTS } from './atlas';
import { buildBuilding, tintOf } from './details';
import { classifyPiece, facesFromTriangles, piecesOf } from './faces';
import { Geo, rgb, scale } from './geom';
import { planBuildings } from './plan';
import { antenna, crown, itemSize, penthouse, roofItems, vents, waterTower } from './roof';
import { STYLE_INFO } from './styles';

export interface FacadeHost {
  gfx: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    quality: Quality;
    toon: boolean;
  };
  world: CollisionWorld;
  interiors: { doors(): readonly BuildingDoor[] };
}

interface Side {
  skin: Geo;
  detail: Geo;
  fine: Geo;
  collide: Geo;
  box: THREE.Box3;
  meshes: { skin: THREE.Mesh | null; detail: THREE.Mesh | null; fine: THREE.Mesh | null };
}

const FACADE_MAT = /^(facade|plaster)/i;
const DETAIL_FAR: Record<Quality, number> = { high: 270, medium: 230, low: 170 };
const FINE_FAR = 115;

function sideOf(x: number, z: number): number {
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 0 : 1) : z > 0 ? 2 : 3;
}

function matName(m: THREE.Mesh): string {
  const mat = m.material;
  return (Array.isArray(mat) ? mat[0]?.name : mat?.name) ?? '';
}

/** World-space triangles of a mesh (with uv1 when it has one). */
function trianglesOf(mesh: THREE.Mesh): SourceTri[] {
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute | undefined;
  if (pos === undefined) return [];
  const uv1 = g.attributes.uv1 as THREE.BufferAttribute | undefined;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const idx = g.index;
  const n = idx !== null ? idx.count / 3 : pos.count / 3;
  const v = new THREE.Vector3();
  const out: SourceTri[] = [];
  for (let t = 0; t < n; t++) {
    const p: [number, number, number][] = [];
    const u: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const i = idx !== null ? idx.getX(t * 3 + k) : t * 3 + k;
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      p.push([v.x, v.y, v.z]);
      if (uv1 !== undefined) u.push([uv1.getX(i), uv1.getY(i)]);
    }
    out.push({ p, uv1: uv1 !== undefined ? u : undefined });
  }
  return out;
}

function toBuffer(g: Geo): THREE.BufferGeometry | null {
  if (g.pos.length === 0) return null;
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  b.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
  b.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
  if (g.withUv) b.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  if (g.withUv1) b.setAttribute('uv1', new THREE.Float32BufferAttribute(g.uv1, 2));
  b.computeBoundingBox();
  b.computeBoundingSphere();
  return b;
}

export interface FacadeStats {
  buildings: number;
  styles: Record<string, number>;
  escapes: {
    key: string;
    style: string;
    /** Foot of the ladder (world), the way the ladder faces, and the roof it reaches. */
    ladder: { x: number; z: number; nx: number; nz: number };
    /** The wall frame (u along the escape from end A, d out from the wall). */
    frame: {
      nx: number;
      nz: number;
      at: number;
      a: number;
      b: number;
      ladderAtS1: boolean;
      length: number;
    };
    ladderU: [number, number];
    levels: number[];
    top: number;
    roof: number;
  }[];
  vertices: { skin: number; detail: number; fine: number };
  buildMs: number;
  ready: boolean;
}

export class FacadeSystem {
  private group = new THREE.Group();
  private sides: Side[] = [];
  private plans: BuildingPlan[] = [];
  private jobs: (() => void)[] = [];
  private hidden: THREE.Mesh[] = [];
  private atlas: THREE.CanvasTexture | null = null;
  private skinMat: THREE.Material | null = null;
  private detailMat: THREE.Material | null = null;
  private colliders: string[] = [];
  private started = false;
  private ready = false;
  private buildMs = 0;
  private quality: Quality = 'high';
  private obstacles: Obstacle[] = [];
  private roofUnits: Obstacle[] = [];
  private facadeMeshes: THREE.Mesh[] = [];
  private stats_: FacadeStats = {
    buildings: 0,
    styles: {},
    escapes: [],
    vertices: { skin: 0, detail: 0, fine: 0 },
    buildMs: 0,
    ready: false,
  };

  constructor(private readonly host: FacadeHost) {
    this.group.name = 'facades';
  }

  /** After the level, its collision and the interiors' doors exist. */
  start(level: LevelData) {
    if (this.started || !level.baked) return;
    if (new URLSearchParams(window.location.search).get('facades') === '0') return;
    this.started = true;
    const t0 = performance.now();
    try {
      this.quality = this.host.gfx.quality;
      // The GLB's walls and the things standing on them
      const tris: SourceTri[] = [];
      const decalTris: SourceTri[] = [];
      level.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (/^decals/i.test(m.name) || /^decals/i.test(m.parent?.name ?? '')) {
          decalTris.push(...trianglesOf(m));
          return;
        }
        const inBuildings = /^buildings/i.test(m.name) || /^buildings/i.test(m.parent?.name ?? '');
        if (!inBuildings) return;
        const name = matName(m);
        if (FACADE_MAT.test(name)) {
          this.facadeMeshes.push(m);
          tris.push(...trianglesOf(m));
        } else if (/^(railing|trim)/i.test(name)) {
          for (const b of piecesOf(trianglesOf(m))) {
            const k = classifyPiece(name, b);
            if (k.obstacle) this.obstacles.push(b);
            if (k.roofUnit) this.roofUnits.push(b);
          }
        }
      });
      if (this.facadeMeshes.length === 0) return;
      const faces = facesFromTriangles(tris);
      const fps = plazaFootprints(level.collisionMeshes).filter(f => !f.key.startsWith('alley:'));
      const doors = this.host.interiors.doors().filter(d => d.area === 'plaza');
      const decals = facesFromTriangles(decalTris);
      this.plans = planBuildings({ faces, fps, doors, obstacles: this.obstacles, decals });
      for (let i = 0; i < 4; i++)
        this.sides.push({
          skin: new Geo(true, true),
          detail: new Geo(),
          fine: new Geo(),
          collide: new Geo(),
          box: new THREE.Box3(),
          meshes: { skin: null, detail: null, fine: null },
        });
      this.queue(doors);
      this.buildMs += performance.now() - t0;
      console.info(
        `[facades] planned ${this.plans.length} buildings (${faces.length} walls, ${this.plans.filter(p => p.escape !== null).length} fire escapes) in ${(performance.now() - t0).toFixed(0)} ms`,
      );
    } catch (err) {
      console.warn('[facades] plan failed', err);
      this.jobs = [];
    }
  }

  private queue(doors: readonly BuildingDoor[]) {
    const low = this.quality === 'low';
    // 1. The atlas, a tile at a time
    const canvas = document.createElement('canvas');
    const names = new Array<string>(SIGN_SLOTS).fill('NOUN');
    for (const b of this.plans) {
      if (b.sign === null) continue;
      const d = doors.find(x => x.id === `plaza:${b.key}`);
      names[b.sign] = d?.name ?? 'NOUN';
    }
    const steps = paintAtlas(canvas, low ? 128 : 256, names);
    let done = false;
    const paint = () => {
      if (done) return;
      done = steps.next().done === true;
      if (!done) this.jobs.unshift(paint);
      else this.makeMaterials(canvas);
    };
    this.jobs.push(paint);
    // 2. Each building
    for (const b of this.plans) this.jobs.push(() => this.buildOne(b));
    // 3. Swap in
    this.jobs.push(() => this.finish());
  }

  private makeMaterials(canvas: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.host.gfx.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.atlas = tex;
    const orig = this.facadeMeshes[0]!.material as THREE.MeshStandardMaterial;
    const skin = new THREE.MeshStandardMaterial({
      name: 'facade_skin',
      map: tex,
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      lightMap: orig.lightMap ?? null,
      lightMapIntensity: orig.lightMapIntensity ?? 1,
    });
    const detail = new THREE.MeshStandardMaterial({
      name: 'facade_detail',
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
    });
    this.skinMat = this.host.gfx.toon ? toToon(skin) : skin;
    this.detailMat = this.host.gfx.toon ? toToon(detail) : detail;
  }

  /**
   * Is a planned fire escape clear in the real level? Nothing (a lamp post,
   * a tree, a kiosk) stands in its volume or in front of its ladder, there's
   * street under the ladder and roof where its ramp comes down.
   */
  private escapeClear(b: BuildingPlan): boolean {
    const e = b.escape;
    if (e === null) return true;
    const f = e.face;
    const L = e.plan.length;
    const P = (u: number, d: number, y: number) => {
      const s = e.ladderAtS1 ? e.a + u : e.b - u;
      return f.nz !== 0
        ? new THREE.Vector3(s, y, f.at + d * f.nz)
        : new THREE.Vector3(f.at + d * f.nx, y, s);
    };
    const along = new THREE.Vector3().subVectors(P(1, 0, 0), P(0, 0, 0)).normalize();
    const out = new THREE.Vector3(f.nx, 0, f.nz);
    const down = new THREE.Vector3(0, -1, 0);
    const w = this.host.world;
    // The volume: rays along each lane at each level
    for (const y of e.plan.levels)
      for (const d of [0.45, 1.6, e.plan.depth - 0.1])
        for (const h of [0.3, 1.2, 2.2])
          if (w.raycast(P(-0.1, d, y + h), along, L + 0.2) !== null) return false;
    // In front of the ladder: open, with street under it
    const lu = (e.plan.ladder.u0 + e.plan.ladder.u1) / 2;
    for (const h of [0.4, 1.0, 1.8])
      for (const du of [-0.4, 0, 0.4])
        if (w.raycast(P(lu + du, e.plan.depth + 0.12, h), out, 1.6) !== null) return false;
    const g = w.raycast(P(lu, e.plan.depth + 0.9, 2), down, 3);
    if (g === null || Math.abs(g.point.y) > 0.4 || g.normal.y < 0.8) return false;
    // Roof where the ramp lands
    const bridge = e.plan.parts.find(p => p.kind === 'ramp' && p.role === 'bridge');
    if (bridge !== undefined) {
      for (const u of [bridge.u0 + 0.2, bridge.u1 - 0.2]) {
        const r = w.raycast(P(u, bridge.d1 - 0.4, bridge.y1 + 3), down, 6);
        if (r === null || Math.abs(r.point.y - bridge.y1) > 0.25) return false;
      }
    }
    return true;
  }

  private buildOne(b: BuildingPlan) {
    const low = this.quality === 'low';
    if (!this.escapeClear(b)) {
      console.info(`[facades] fire escape on ${b.key} dropped: something's in the way`);
      b.escape = null;
    }
    const geo = buildBuilding(b, { lowDetail: low });
    const c = b.fp ?? null;
    const cx = c !== null ? (c.minX + c.maxX) / 2 : (b.segments[0]?.face.at ?? 0);
    const cz = c !== null ? (c.minZ + c.maxZ) / 2 : 0;
    const side = this.sides[sideOf(cx, cz)]!;
    side.skin.append(geo.skin);
    side.detail.append(geo.detail);
    if (!low) side.fine.append(geo.fine);
    if (geo.collide !== null && b.fp !== null) this.colliderFor(`facades:fe:${b.key}`, geo.collide);
    if (b.fp !== null) this.roof(b, b.fp, side, low);
    this.stats_.buildings++;
    this.stats_.styles[b.style] = (this.stats_.styles[b.style] ?? 0) + 1;
    if (b.escape !== null && b.fp !== null) {
      const e = b.escape;
      const sLad = e.ladderAtS1
        ? e.a + (e.plan.ladder.u0 + e.plan.ladder.u1) / 2
        : e.b - (e.plan.ladder.u0 + e.plan.ladder.u1) / 2;
      const d = e.plan.depth + 0.7;
      const f = e.face;
      this.stats_.escapes.push({
        key: b.key,
        style: b.style,
        ladder:
          f.nz !== 0
            ? { x: sLad, z: f.at + d * f.nz, nx: f.nx, nz: f.nz }
            : { x: f.at + d * f.nx, z: sLad, nx: f.nx, nz: f.nz },
        levels: e.plan.levels,
        top: e.plan.top,
        roof:
          e.plan.parts.find(p => p.kind === 'ramp' && p.role === 'bridge')?.y1 ??
          b.fp.ground + b.fp.height,
        frame: {
          nx: f.nx,
          nz: f.nz,
          at: f.at,
          a: e.a,
          b: e.b,
          ladderAtS1: e.ladderAtS1,
          length: e.plan.length,
        },
        ladderU: [e.plan.ladder.u0, e.plan.ladder.u1],
      });
    }
  }

  private pendingColliders = new Map<string, THREE.BufferGeometry>();

  private colliderFor(id: string, g: Geo) {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    this.pendingColliders.set(id, b);
  }

  /** Rooftop clutter at clear spots (the collision says where the roof really is). */
  private roof(b: BuildingPlan, fp: Footprint, side: Side, low: boolean) {
    const rnd = mulberry32(b.seed ^ 0x2545f491);
    const roofY = fp.ground + fp.height;
    const items = roofItems(b.style, rnd() < STYLE_INFO[b.style].waterTower);
    const placed: RoofSpot[] = [];
    // Keep clear of the escape's way onto the roof
    const keepOut: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
    if (b.escape !== null) {
      const e = b.escape;
      const f = e.face;
      const [s0, s1] = [e.a - 0.5, e.b + 0.5];
      const d0 = -4.5;
      const d1 = 0;
      const p0 = f.nz !== 0 ? { x: s0, z: f.at + d0 * f.nz } : { x: f.at + d0 * f.nx, z: s0 };
      const p1 = f.nz !== 0 ? { x: s1, z: f.at + d1 * f.nz } : { x: f.at + d1 * f.nx, z: s1 };
      keepOut.push({
        minX: Math.min(p0.x, p1.x),
        maxX: Math.max(p0.x, p1.x),
        minZ: Math.min(p0.z, p1.z),
        maxZ: Math.max(p0.z, p1.z),
      });
    }
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const flat = (x: number, z: number) => {
      o.set(x, roofY + 40, z);
      const hit = this.host.world.raycast(o, down, 60);
      return hit !== null && Math.abs(hit.point.y - roofY) < 0.15 && hit.normal.y > 0.95;
    };
    const fits = (x: number, z: number, r: number) => {
      if (
        x - r < fp.minX + 0.7 ||
        x + r > fp.maxX - 0.7 ||
        z - r < fp.minZ + 0.7 ||
        z + r > fp.maxZ - 0.7
      )
        return false;
      for (const k of keepOut)
        if (x + r > k.minX && x - r < k.maxX && z + r > k.minZ && z - r < k.maxZ) return false;
      for (const u of this.roofUnits)
        if (
          u.minY > roofY - 0.3 &&
          u.minY < roofY + 1 &&
          x + r > u.minX - 0.3 &&
          x - r < u.maxX + 0.3 &&
          z + r > u.minZ - 0.3 &&
          z - r < u.maxZ + 0.3
        )
          return false;
      for (const p of placed)
        if (Math.abs(p.x - x) < p.r + r + 0.4 && Math.abs(p.z - z) < p.r + r + 0.4) return false;
      for (const [dx, dz] of [
        [0, 0],
        [r, r],
        [-r, r],
        [r, -r],
        [-r, -r],
      ] as const)
        if (!flat(x + dx, z + dz)) return false;
      return true;
    };
    const tint = tintOf(b.style, b.variant);
    const stone = scale(rgb(0xefe6d2), 1);
    const gold = rgb(0xd6b24c);
    for (const item of items) {
      if (low && (item === 'vents' || item === 'antenna')) continue;
      const r = itemSize(item);
      let spot: RoofSpot | null = null;
      for (let tries = 0; tries < 14 && spot === null; tries++) {
        const x = fp.minX + r + 0.7 + rnd() * Math.max(0, fp.maxX - fp.minX - 2 * r - 1.4);
        const z = fp.minZ + r + 0.7 + rnd() * Math.max(0, fp.maxZ - fp.minZ - 2 * r - 1.4);
        if (fits(x, z, r)) spot = { x, z, y: roofY, r };
      }
      if (spot === null) continue;
      placed.push(spot);
      switch (item) {
        case 'tower':
          waterTower(side.detail, side.fine, side.collide, spot, b.variant);
          break;
        case 'penthouse':
          penthouse(side.detail, side.fine, side.collide, spot);
          break;
        case 'crown':
          crown(
            side.detail,
            side.fine,
            side.collide,
            spot,
            [stone[0] * tint[0], stone[1] * tint[1], stone[2] * tint[2]],
            gold,
          );
          break;
        case 'vents':
          vents(side.fine, spot, rnd());
          break;
        case 'antenna':
          antenna(side.fine, spot, 2.5 + rnd() * 3);
          break;
      }
    }
  }

  private finish() {
    if (this.skinMat === null || this.detailMat === null) return;
    const lowShadow = this.quality === 'low';
    const castSkin = this.facadeMeshes.some(m => m.castShadow);
    this.sides.forEach((s, i) => {
      const mk = (g: Geo, mat: THREE.Material, name: string) => {
        const buf = toBuffer(g);
        if (buf === null) return null;
        const m = new THREE.Mesh(buf, mat);
        m.name = `facades_${name}_${i}`;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        m.receiveShadow = true;
        this.group.add(m);
        s.box.union(buf.boundingBox!);
        return m;
      };
      s.meshes.skin = mk(s.skin, this.skinMat!, 'skin');
      s.meshes.detail = mk(s.detail, this.detailMat!, 'detail');
      s.meshes.fine = mk(s.fine, this.detailMat!, 'fine');
      if (s.meshes.skin !== null) s.meshes.skin.castShadow = castSkin;
      if (s.meshes.detail !== null) s.meshes.detail.castShadow = !lowShadow;
      if (s.meshes.fine !== null) s.meshes.fine.castShadow = false;
      this.stats_.vertices.skin += s.skin.vertexCount;
      this.stats_.vertices.detail += s.detail.vertexCount;
      this.stats_.vertices.fine += s.fine.vertexCount;
      if (s.collide.pos.length > 0) this.colliderFor(`facades:roof:${i}`, s.collide);
      // The arrays aren't needed any more
      s.skin = new Geo(true, true);
      s.detail = new Geo();
      s.fine = new Geo();
      s.collide = new Geo();
    });
    // Swap: the GLB facades out, ours in
    const root = this.facadeMeshes[0]!.parent;
    (root ?? this.host.gfx.scene).add(this.group);
    for (const m of this.facadeMeshes)
      if (m.visible) {
        m.visible = false;
        this.hidden.push(m);
      }
    for (const [id, g] of this.pendingColliders) {
      this.host.world.setDynamic(id, g);
      this.colliders.push(id);
    }
    this.pendingColliders.clear();
    this.ready = true;
    this.stats_.ready = true;
    this.stats_.buildMs = Math.round(this.buildMs);
    console.info(
      `[facades] built in ${this.buildMs.toFixed(0)} ms of frame time: ${this.stats_.vertices.skin + this.stats_.vertices.detail + this.stats_.vertices.fine} vertices, ${this.colliders.length} colliders`,
    );
  }

  /** Per frame: a slice of the build, then distance culling. */
  update(_dt: number) {
    if (this.jobs.length > 0) {
      const t0 = performance.now();
      const budget = this.quality === 'low' ? 3 : 5;
      try {
        while (this.jobs.length > 0 && performance.now() - t0 < budget) this.jobs.shift()!();
      } catch (err) {
        console.warn('[facades] build failed', err);
        this.jobs = [];
      }
      this.buildMs += performance.now() - t0;
    }
    if (!this.ready) return;
    const cam = this.host.gfx.camera.position;
    const far = DETAIL_FAR[this.host.gfx.quality];
    for (const s of this.sides) {
      const d = s.box.isEmpty() ? Infinity : s.box.distanceToPoint(cam);
      if (s.meshes.detail !== null) s.meshes.detail.visible = d < far;
      if (s.meshes.fine !== null)
        s.meshes.fine.visible = d < FINE_FAR && this.host.gfx.quality !== 'low';
    }
  }

  stats(): FacadeStats {
    return this.stats_;
  }

  /** A/B switch (dev tools, perf checks): the GLB's own facades back on, ours off. */
  setEnabled(on: boolean) {
    if (!this.ready) return;
    this.group.visible = on;
    for (const m of this.hidden) m.visible = !on;
  }

  /** Each building's style and its longest street wall (dev tools, browser tests). */
  debugBuildings() {
    return this.plans.map(b => {
      const fronts = b.segments
        .filter(s => s.seg.fp === b.fp && s.seg.kind === 'front')
        .sort((p, q) => q.seg.s1 - q.seg.s0 - (p.seg.s1 - p.seg.s0));
      const f = fronts[0];
      return {
        key: b.key,
        style: b.style,
        escape: b.escape !== null,
        front:
          f === undefined
            ? null
            : {
                nx: f.face.nx,
                nz: f.face.nz,
                at: f.face.at,
                s0: f.seg.s0,
                s1: f.seg.s1,
                top: f.face.y1,
              },
      };
    });
  }

  dispose() {
    for (const id of this.colliders) this.host.world.setDynamic(id, null);
    this.colliders = [];
    for (const m of this.hidden) m.visible = true;
    this.hidden = [];
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.skinMat?.dispose();
    this.detailMat?.dispose();
    this.atlas?.dispose();
    this.jobs = [];
  }
}

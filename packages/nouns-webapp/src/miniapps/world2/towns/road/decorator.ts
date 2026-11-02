// ── Road trip: the chunk decorator (side towns, stations, roadside) ──────
//
// One decorator for everything this part adds. Per chunk it builds:
//   • the parts of any side town / station anchored in the chunk (look.ts),
//     so a town lands over several frames as its chunks come in and goes
//     chunk by chunk as they leave;
//   • the roadside items standing in the chunk (roadside.ts): km posts,
//     distance signs, billboards.
// Everything merges by material (the towns' shared materials, so no new
// shader programs): solid, ground, thin, glow, one sign mesh per atlas, one
// InstancedMesh per plant kind, the lake. A chunk with a station is ~6
// draws, a chunk of road with a sign 2–3, an empty one nothing.
//
// Atlases: side towns and the shared road atlas live for the session (like
// the older towns'); a line segment's atlas (km + distance signs) is
// refcounted by the chunks showing it and freed with the last one. Weak
// devices paint them at half the pixels (textureDiet).

import type {
  ChunkContext,
  ChunkDecoration,
  ChunkDecorator,
} from '../../world/mountain/MountainStream';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { textureDiet } from '../../render/textureDiet';
import { inkExcluded, toonify } from '../../render/Toon';
import { edgeDistance } from '../../world/mountain/config';
import { terrainHeight } from '../../world/mountain/terrain';
import { townAnimators, townMaterials, townStats } from '../build';
import { TownBuilder, atlasHeight, boxAt, planAtlas, type Atlas, type SignSpec } from '../kit';
import { townFrameNow, townToWorld, type PadFrame, type TownFrame } from '../site';

import { LEVEL_CTX, type PartCtx, type RoadLook } from './look';
import { SIDE_LOOKS } from './looks';
import { stationFrame, type StationFrame } from './pads';
import { SIDE_TOWNS, STATIONS, type SideTownId } from './places';
import { ROAD_C, billboard } from './props';
import { roadsideIn, segmentOf, segmentSlots, type RoadsideItem } from './roadside';
import { roadsideSize, roadsideSpec, sharedSigns } from './signs';
import { stationCtx, stationLook } from './stations';

// ── Atlases ─────────────────────────────────────────────────────────────

interface AtlasEntry {
  atlas: Atlas;
  mat: THREE.MeshStandardMaterial;
  refs: number;
  /** Freed when its last chunk goes (segments only). */
  transient: boolean;
  plan: { paint(ms: number): boolean };
}

const atlases = new Map<string, AtlasEntry>();

/** Atlases still being painted, a sign or two a frame (never inside a chunk build). */
const painting = new Set<{ paint(ms: number): boolean }>();
const PAINT_MS = 2;
townAnimators.add(() => {
  for (const p of painting) {
    if (p.paint(PAINT_MS)) painting.delete(p);
    return;
  }
});

function makeAtlas(specs: SignSpec[], transient: boolean): AtlasEntry {
  const w = textureDiet.on ? 512 : 1024;
  // Shrink the paint until it fits a square; small sets get a short atlas
  let ppm = textureDiet.on ? 20 : 40;
  while (atlasHeight(specs, w, ppm) > w && ppm > 8) ppm -= 2;
  const need = atlasHeight(specs, w, ppm);
  let h = 64;
  while (h < need && h < w) h *= 2;
  const plan = planAtlas(specs, { w, h, pxPerM: ppm });
  painting.add(plan);
  const mat = new THREE.MeshStandardMaterial({ map: plan.atlas.texture, roughness: 0.8 });
  mat.name = 'TownSigns';
  return { atlas: plan.atlas, mat, refs: 0, transient, plan };
}

function atlasFor(key: string, specs: () => SignSpec[], transient: boolean): AtlasEntry {
  let a = atlases.get(key);
  if (a === undefined) {
    a = makeAtlas(specs(), transient);
    atlases.set(key, a);
  }
  return a;
}

function release(key: string) {
  const a = atlases.get(key);
  if (a === undefined) return;
  a.refs--;
  if (a.refs <= 0 && a.transient) {
    painting.delete(a.plan);
    a.atlas.texture.dispose();
    a.mat.dispose();
    atlases.delete(key);
  }
}

/** Live atlases (perf checks / tests): key → texture size. */
export function roadAtlases(): { key: string; w: number; h: number; refs: number }[] {
  return [...atlases].map(([key, a]) => {
    const im = a.atlas.texture.image as { width: number; height: number };
    return { key, w: im.width, h: im.height, refs: a.refs };
  });
}

// ── Plants / lake ───────────────────────────────────────────────────────

const plantGeo = new Map<string, THREE.BufferGeometry>();
function plantGeometry(key: string, make: () => THREE.BufferGeometry) {
  let g = plantGeo.get(key);
  if (g === undefined) {
    g = make();
    plantGeo.set(key, g);
  }
  return g;
}

let lakeMat: THREE.MeshStandardMaterial | null = null;
function lakeMaterial(color: number) {
  if (lakeMat === null) {
    const base = townMaterials().water;
    lakeMat = base.clone();
    lakeMat.color.setHex(color);
    lakeMat.name = 'TownWater';
  }
  return lakeMat;
}

// ── Stats ───────────────────────────────────────────────────────────────

export interface RoadChunkStats {
  drawCalls: number;
  triangles: number;
  ms: number;
  what: string[];
}

/** Per chunk with something built (key `ix,iz`), plus running totals. */
export const roadStats = {
  chunks: new Map<string, RoadChunkStats>(),
  builds: 0,
  maxMs: 0,
};

// ── Frames ──────────────────────────────────────────────────────────────

/** A world-space frame for the roadside items (vp = x, u = z, P = 0). */
const WORLD: PadFrame = {
  ox: 0,
  oz: 0,
  fx: 0,
  fz: 1,
  rx: 1,
  rz: 0,
  yaw: 0,
  side: 1,
  P: 0,
  Lf: 0,
  vmin: 0,
  vmax: 0,
  lagoon: false,
  x0: 0,
  z0: 0,
  x1: 0,
  z1: 0,
};

const _w = { x: 0, z: 0 };

const inChunk = (ctx: ChunkContext, x: number, z: number) =>
  x >= ctx.origin.x &&
  x < ctx.origin.x + ctx.size &&
  z >= ctx.origin.z &&
  z < ctx.origin.z + ctx.size;

const touches = (ctx: ChunkContext, f: { x0: number; z0: number; x1: number; z1: number }) =>
  f.x1 >= ctx.origin.x - 300 &&
  f.x0 <= ctx.origin.x + ctx.size + 300 &&
  f.z1 >= ctx.origin.z - 300 &&
  f.z0 <= ctx.origin.z + ctx.size + 300;

// ── Build ───────────────────────────────────────────────────────────────

interface Group {
  b: TownBuilder;
  atlasKey: string;
  plant?: { key: string; make: () => THREE.BufferGeometry };
}

function populate(ctx: ChunkContext): ChunkDecoration | null {
  const t0 = performance.now();
  const cx = ctx.origin.x + ctx.size / 2;
  const cz = ctx.origin.z + ctx.size / 2;
  const ed = edgeDistance(cx, cz);
  if (ed < 400) return null;
  const groups: Group[] = [];
  const what: string[] = [];
  const atlasKeys: string[] = [];
  const low = ctx.quality === 'low';
  const extra: THREE.Object3D[] = [];
  const touchedTowns: SideTownId[] = [];

  // Side towns: their parts anchored here
  for (const st of SIDE_TOWNS) {
    if (ed < st.s * 0.5 - 600 || ed > st.s + 800) continue;
    const f = townFrameNow(st.id) as TownFrame | null;
    if (f === null || !touches(ctx, f)) continue;
    const look = SIDE_LOOKS[st.id];
    const parts = look.parts(f).filter(p => {
      townToWorld(f, p.vp, p.u, _w);
      return inChunk(ctx, _w.x, _w.z);
    });
    const centre = townToWorld(f, 0, f.Lf / 2, { x: 0, z: 0 });
    const hasCentre = inChunk(ctx, centre.x, centre.z);
    if (parts.length === 0 && !hasCentre) continue;
    const key = `town:${st.id}`;
    const a = atlasFor(key, look.signs, false);
    const b = new TownBuilder(f, ctx.origin, a.atlas);
    const pctx: PartCtx = {
      ground: (vp, u) => terrainHeight(...xz(townToWorld(f, vp, u, _w))),
      lift: () => 0,
      grade: 0,
      low,
    };
    for (const p of parts) p.build(b, pctx);
    groups.push({ b, atlasKey: key, plant: look.plant && { key, make: look.plant } });
    what.push(`${st.id}×${parts.length}`);
    touchedTowns.push(st.id);
    // The lake: with the market square
    if (hasCentre && look.water !== undefined) {
      const wsp = look.water(f);
      const g = new THREE.PlaneGeometry(wsp.v1 - wsp.v0, wsp.u1 - wsp.u0).rotateX(-Math.PI / 2);
      g.applyMatrix4(b.at((wsp.v0 + wsp.v1) / 2, (wsp.u0 + wsp.u1) / 2, wsp.y));
      g.computeBoundingSphere();
      const water = new THREE.Mesh(g, lakeMaterial(wsp.color));
      water.name = `${st.id}Water`;
      water.matrixAutoUpdate = false;
      water.renderOrder = 1;
      extra.push(water);
    }
  }

  // Stations
  for (const st of STATIONS) {
    if (ed < st.s * 0.5 - 600 || ed > st.s + 600) continue;
    const f = stationFrame(st.id, true);
    if (f === null || !touches(ctx, f)) continue;
    const look = stationLook(st);
    const parts = look.parts(f).filter(p => {
      townToWorld(f, p.vp, p.u, _w);
      return inChunk(ctx, _w.x, _w.z);
    });
    if (parts.length === 0) continue;
    const a = atlasFor('shared', sharedSigns, false);
    const b = new TownBuilder(f, ctx.origin, a.atlas);
    const pctx = stationCtx(f as StationFrame, low, (vp, u) =>
      terrainHeight(...xz(townToWorld(f, vp, u, _w))),
    );
    for (const p of parts) p.build(b, pctx);
    groups.push({
      b,
      atlasKey: 'shared',
      plant: look.plant && { key: `st:${st.kind}`, make: look.plant },
    });
    what.push(`${st.id}×${parts.length}`);
  }

  // Roadside items standing in this chunk
  for (const track of [1, 2, 3]) {
    // Along-track s is at least the edge distance and, ≤ 45° off outward, at most ~1.45×
    const items = roadsideIn(
      track,
      ctx.origin.x,
      ctx.origin.z,
      ctx.origin.x + ctx.size,
      ctx.origin.z + ctx.size,
      ed - 400,
      ed * 1.45 + 800,
    );
    for (const it of items) {
      const seg = segmentOf(it.s0);
      const key = it.kind === 'bb' ? 'shared' : `seg:${track}:${seg}`;
      const a =
        it.kind === 'bb'
          ? atlasFor('shared', sharedSigns, false)
          : atlasFor(key, () => segmentSlots(track, seg).map(roadsideSpec), true);
      let g = groups.find(q => q.atlasKey === key && q.b.f === WORLD);
      if (g === undefined) {
        g = { b: new TownBuilder(WORLD, ctx.origin, a.atlas), atlasKey: key };
        groups.push(g);
      }
      roadsideItem(g.b, it, ctx);
      what.push(it.id);
    }
  }
  if (groups.length === 0 && extra.length === 0) return null;
  return assemble(ctx, groups, extra, what, atlasKeys, touchedTowns, t0);
}

const xz = (w: { x: number; z: number }): [number, number] => [w.x, w.z];

/** One roadside item into the world-frame builder. */
function roadsideItem(b: TownBuilder, it: RoadsideItem, ctx: ChunkContext) {
  const y = ctx.height(it.x, it.z);
  const dx = Math.sin(it.yaw);
  const dz = Math.cos(it.yaw);
  const m = b.atY(it.x, it.z, y, dx, dz);
  const { w, h } = roadsideSize(it);
  if (it.kind === 'km') {
    b.add(boxAt(-0.05, 0.05, -0.5, 1.0, -0.06, 0.0), ROAD_C.darkSteel, m, { bucket: 'thin' });
    b.sign(it.id, m, 0, 1.0 + h / 2, 0.02);
  } else if (it.kind === 'bb') {
    billboard(b, m, it.rows[0]!, w, h, 5.5);
  } else {
    for (const x of [-w * 0.35, w * 0.35])
      b.add(boxAt(x - 0.07, x + 0.07, -0.6, 2.2 + h, -0.12, -0.02), ROAD_C.darkSteel, m, {
        bucket: 'thin',
      });
    b.sign(it.id, m, 0, 2.2 + h / 2, 0.0);
  }
}

function assemble(
  ctx: ChunkContext,
  groups: Group[],
  extra: THREE.Object3D[],
  what: string[],
  _keys: string[],
  towns: SideTownId[],
  t0: number,
): ChunkDecoration {
  const M = townMaterials();
  const root = new THREE.Group();
  root.name = `Road:${ctx.ix},${ctx.iz}`;
  const disposables: { dispose(): void }[] = [];
  let tris = 0;
  let calls = 0;
  const addMesh = (
    geos: THREE.BufferGeometry[],
    mat: THREE.Material,
    name: string,
    shadow: boolean,
  ) => {
    if (geos.length === 0) return null;
    const g = mergeGeometries(geos, false)!;
    for (const q of geos) q.dispose();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    disposables.push(g);
    tris += g.attributes.position.count / 3;
    calls++;
    return mesh;
  };
  const all = (k: 'solid' | 'ground' | 'thin' | 'glow') => groups.flatMap(g => g.b.geo[k]);
  const shadows = ctx.quality !== 'low';
  addMesh(all('solid'), M.solid, 'roadSolid', shadows);
  addMesh(all('ground'), M.ground, 'roadGround', false);
  const thin = addMesh(all('thin'), M.thin, 'roadThin', false);
  const glow = addMesh(all('glow'), M.glow, 'roadGlow', false);
  // Signs: one mesh per atlas
  const used = new Set<string>();
  for (const key of new Set(groups.map(g => g.atlasKey))) {
    const geos = groups.filter(g => g.atlasKey === key).flatMap(g => g.b.signs);
    const a = atlases.get(key)!;
    if (geos.length > 0) {
      addMesh(geos, a.mat, `roadSigns:${key}`, false);
      a.refs++;
      used.add(key);
    }
  }
  // Plants: one InstancedMesh per kind
  const kinds = new Map<string, { make: () => THREE.BufferGeometry; mats: THREE.Matrix4[] }>();
  for (const g of groups) {
    if (g.plant === undefined || g.b.plants.length === 0) continue;
    const k = kinds.get(g.plant.key) ?? { make: g.plant.make, mats: [] };
    k.mats.push(...g.b.plants);
    kinds.set(g.plant.key, k);
  }
  for (const [key, k] of kinds) {
    const pg = plantGeometry(key, k.make);
    const im = new THREE.InstancedMesh(pg, M.solid, k.mats.length);
    im.name = `roadPlants:${key}`;
    k.mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadows;
    im.receiveShadow = true;
    root.add(im);
    disposables.push({ dispose: () => im.dispose() });
    tris += (pg.attributes.position.count / 3) * k.mats.length;
    calls++;
  }
  for (const o of extra) {
    root.add(o);
    const g = (o as THREE.Mesh).geometry;
    disposables.push(g);
    tris += g.index !== null ? g.index.count / 3 : g.attributes.position.count / 3;
    calls++;
  }
  if (ctx.toon) toonify(root);
  if (thin !== null) inkExcluded.add(thin);
  if (glow !== null) inkExcluded.add(glow);
  root.updateMatrixWorld(true);
  // Collision (chunk-local, position only)
  const cols = groups.flatMap(g => g.b.col);
  let n = 0;
  for (const c of cols) n += c.attributes.position.array.length;
  const arr = new Float32Array(n);
  let o = 0;
  for (const c of cols) {
    arr.set(c.attributes.position.array as Float32Array, o);
    o += c.attributes.position.array.length;
    c.dispose();
  }
  const collision = new THREE.BufferGeometry();
  collision.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const ms = performance.now() - t0;
  const chunkKey = `${ctx.ix},${ctx.iz}`;
  roadStats.chunks.set(chunkKey, { drawCalls: calls, triangles: Math.round(tris), ms, what });
  roadStats.builds++;
  roadStats.maxMs = Math.max(roadStats.maxMs, ms);
  for (const id of towns) {
    const s = townStats[id];
    s.live = true;
    s.drawCalls += calls;
    s.triangles += Math.round(tris);
    s.collisionTriangles += n / 9;
    s.ms = Math.max(s.ms, ms);
  }
  return {
    object: root,
    collision,
    dispose: () => {
      if (thin !== null) inkExcluded.delete(thin);
      if (glow !== null) inkExcluded.delete(glow);
      collision.dispose();
      for (const d of disposables) d.dispose();
      for (const key of used) release(key);
      roadStats.chunks.delete(chunkKey);
      for (const id of towns) {
        const s = townStats[id];
        s.drawCalls = Math.max(0, s.drawCalls - calls);
        s.triangles = Math.max(0, s.triangles - Math.round(tris));
        s.collisionTriangles = Math.max(0, s.collisionTriangles - n / 9);
        s.live = s.drawCalls > 0;
      }
    },
  };
}

/** Side towns, gas stations, truck stops, rest areas, road signs and billboards. */
export function roadDecorator(): ChunkDecorator {
  return { id: 'road', populate };
}

/** Everything a look builds, into a throwaway builder (tests: sizes, collision). */
export function buildLookForTest(
  look: RoadLook,
  f: PadFrame,
  ctx: PartCtx = LEVEL_CTX,
): TownBuilder {
  const a = makeAtlas(look.signs(), true);
  painting.delete(a.plan);
  const b = new TownBuilder(f, new THREE.Vector3(), a.atlas);
  for (const p of look.parts(f)) p.build(b, ctx);
  a.atlas.texture.dispose();
  a.mat.dispose();
  return b;
}

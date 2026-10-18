// ── Noun Trade towns: the chunk decorator that builds them ───────────────
//
// Like Noun Jersey: a town is built (once) when the chunk holding its
// market square gets its props, and torn down with them. Everything static
// is merged by material — solid, ground decals, thin rods, signs — plus
// one InstancedMesh of plants (cacti / palms), Dry Gulch's tumbleweeds
// (one InstancedMesh, rolled by TownSystem through `townAnimators`) and
// Puerto Noun's lagoon water: 6–7 draw calls a town. Measured numbers land
// in `townStats` (perf audits, tests, the browser check).

import type {
  ChunkContext,
  ChunkDecoration,
  ChunkDecorator,
} from '../world/mountain/MountainStream';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { inkExcluded, toonify } from '../render/Toon';
import { edgeDistance } from '../world/mountain/config';
import { terrainHeight } from '../world/mountain/terrain';
import { TOWN_SITES } from '../world/mountain/tracks';

import { beachSigns, buildBeach, palmGeometry, BEACH_C } from './beach';
import { buildCowboy, cactusGeometry, cowboySigns, tumbleweedGeometry } from './cowboy';
import { buildAtlas, TownBuilder, type Atlas } from './kit';
import {
  GROWN_TOWNS,
  LAGOON,
  TOWN,
  townFrameNow,
  townToWorld,
  type GrownTown,
  type TownFrame,
} from './site';

export interface TownBuildStats {
  drawCalls: number;
  triangles: number;
  collisionTriangles: number;
  plants: number;
  ms: number;
  /** Built right now (its chunk has props). */
  live: boolean;
}

const blank = (): TownBuildStats => ({
  drawCalls: 0,
  triangles: 0,
  collisionTriangles: 0,
  plants: 0,
  ms: 0,
  live: false,
});

/** Last build's numbers per town. */
export const townStats: Record<GrownTown, TownBuildStats> = { cowboy: blank(), beach: blank() };

/** Per-frame animation hooks of the built towns (tumbleweeds); TownSystem runs them. */
export const townAnimators = new Set<(dt: number) => void>();

// ── Shared materials (session-wide; geometry is per build) ──

let mats: {
  solid: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  thin: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
} | null = null;

function materials() {
  if (mats === null) {
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    solid.name = 'TownSolid';
    const ground = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    ground.name = 'TownGround';
    const thin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    thin.name = 'TownThin';
    const water = new THREE.MeshStandardMaterial({
      color: BEACH_C.water,
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    water.name = 'TownWater';
    mats = { solid, ground, thin, water };
  }
  return mats;
}

const atlases = new Map<GrownTown, { atlas: Atlas; mat: THREE.MeshStandardMaterial }>();

function signsFor(id: GrownTown) {
  let a = atlases.get(id);
  if (a === undefined) {
    const atlas = buildAtlas(id === 'cowboy' ? cowboySigns() : beachSigns());
    const mat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.8 });
    mat.name = 'TownSigns';
    a = { atlas, mat };
    atlases.set(id, a);
  }
  return a;
}

const plantGeo = new Map<GrownTown, THREE.BufferGeometry>();
function plantGeometry(id: GrownTown) {
  let g = plantGeo.get(id);
  if (g === undefined) {
    g = id === 'cowboy' ? cactusGeometry() : palmGeometry();
    plantGeo.set(id, g);
  }
  return g;
}

let tumbleGeo: THREE.BufferGeometry | null = null;

/** Approximate distance band from the city (m) a town can sit in: cheap chunk reject. */
function nearBand(id: GrownTown, ed: number) {
  const at = TOWN_SITES.find(t => t.town === id)!.at;
  return ed > at * 0.7 && ed < at + 1500;
}

const _w = { x: 0, z: 0 };

function build(id: GrownTown, f: TownFrame, ctx: ChunkContext): ChunkDecoration {
  const t0 = performance.now();
  const { atlas, mat: signMat } = signsFor(id);
  const b = new TownBuilder(f, ctx.origin, atlas);
  const ground = (vp: number, u: number) => {
    townToWorld(f, vp, u, _w);
    return terrainHeight(_w.x, _w.z);
  };
  if (id === 'cowboy') buildCowboy(b, ground);
  else buildBeach(b, ground);
  const root = new THREE.Group();
  root.name = `Town:${id}`;
  const M = materials();
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
  addMesh(b.geo.solid, M.solid, `${id}Solid`, ctx.quality !== 'low');
  addMesh(b.geo.ground, M.ground, `${id}Ground`, false);
  const thin = addMesh(b.geo.thin, M.thin, `${id}Thin`, false);
  addMesh(b.signs, signMat, `${id}Signs`, false);
  if (b.plants.length > 0) {
    const pg = plantGeometry(id);
    const im = new THREE.InstancedMesh(pg, M.solid, b.plants.length);
    im.name = `${id}Plants`;
    b.plants.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = ctx.quality !== 'low';
    im.receiveShadow = true;
    root.add(im);
    disposables.push({ dispose: () => im.dispose() });
    tris += (pg.attributes.position.count / 3) * b.plants.length;
    calls++;
  }
  let animate: ((dt: number) => void) | null = null;
  if (id === 'cowboy') {
    tumbleGeo ??= tumbleweedGeometry();
    const n = ctx.quality === 'low' ? 3 : 5;
    const im = new THREE.InstancedMesh(tumbleGeo, M.solid, n);
    im.name = 'cowboyTumbleweeds';
    im.frustumCulled = false;
    root.add(im);
    disposables.push({ dispose: () => im.dispose() });
    tris += (tumbleGeo.attributes.position.count / 3) * n;
    calls++;
    animate = tumbleweeds(f, ctx.origin, im);
    animate(0);
  } else {
    // The lagoon: one plane at the waterline, its edges hidden under the sand rim
    const v0 = LAGOON.v0 + 2;
    const v1 = LAGOON.v3 - 2;
    const u0 = LAGOON.uIn0 + 2;
    const u1 = f.Lf - LAGOON.uIn0 - 2;
    const g = new THREE.PlaneGeometry(v1 - v0, u1 - u0).rotateX(-Math.PI / 2);
    g.applyMatrix4(b.at((v0 + v1) / 2, (u0 + u1) / 2, -TOWN.waterDown));
    g.computeBoundingSphere();
    const water = new THREE.Mesh(g, M.water);
    water.name = 'beachWater';
    water.matrixAutoUpdate = false;
    water.renderOrder = 1;
    root.add(water);
    disposables.push(g);
    tris += 2;
    calls++;
  }
  if (ctx.toon) toonify(root);
  if (thin !== null) inkExcluded.add(thin);
  root.updateMatrixWorld(true);
  // Collision (chunk-local, position only)
  let n = 0;
  for (const c of b.col) n += c.attributes.position.array.length;
  const arr = new Float32Array(n);
  let o = 0;
  for (const c of b.col) {
    arr.set(c.attributes.position.array as Float32Array, o);
    o += c.attributes.position.array.length;
    c.dispose();
  }
  const collision = new THREE.BufferGeometry();
  collision.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  if (animate !== null) townAnimators.add(animate);
  Object.assign(townStats[id], {
    drawCalls: calls,
    triangles: Math.round(tris),
    collisionTriangles: n / 9,
    plants: b.plants.length,
    ms: performance.now() - t0,
    live: true,
  });
  return {
    object: root,
    collision,
    dispose: () => {
      if (animate !== null) townAnimators.delete(animate);
      if (thin !== null) inkExcluded.delete(thin);
      collision.dispose();
      for (const d of disposables) d.dispose();
      townStats[id].live = false;
    },
  };
}

/** Tumbleweeds bouncing across main street (and on across the pad), wrapping round. */
function tumbleweeds(f: TownFrame, origin: THREE.Vector3, im: THREE.InstancedMesh) {
  const n = im.count;
  const lanes = Array.from({ length: n }, (_, i) => ({
    u: 30 + ((i * 47) % 180),
    speed: 2.2 + ((i * 0.37) % 1.6),
    phase: (i * 29) % 90,
    dir: i % 2 === 0 ? 1 : -1,
  }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  // Rolling across the line: axis along the line (f), sign per direction
  const axis = new THREE.Vector3(f.fx, 0, f.fz);
  let t = 0;
  return (dt: number) => {
    t += dt;
    for (let i = 0; i < n; i++) {
      const L = lanes[i];
      const d = L.phase + L.speed * t;
      const vp = L.dir * ((((d % 92) + 92) % 92) - 46);
      townToWorld(f, vp, L.u + Math.sin(d * 0.21) * 3, _w);
      const hop = Math.abs(Math.sin(d * 1.3));
      p.set(_w.x - origin.x, f.P + 0.5 + hop * 0.7, _w.z - origin.z);
      q.setFromAxisAngle(axis, (-L.dir * f.side * d) / 0.55);
      im.setMatrixAt(i, m.compose(p, q, s.setScalar(0.8 + (i % 3) * 0.15)));
    }
    im.instanceMatrix.needsUpdate = true;
  };
}

/** The towns, each in the chunk that holds its market square. */
export function townsDecorator(): ChunkDecorator {
  return {
    id: 'towns',
    populate(ctx: ChunkContext): ChunkDecoration | null {
      const cx = ctx.origin.x + ctx.size / 2;
      const cz = ctx.origin.z + ctx.size / 2;
      const ed = edgeDistance(cx, cz);
      for (const id of GROWN_TOWNS) {
        if (!nearBand(id, ed)) continue;
        const f = townFrameNow(id);
        if (f === null) continue;
        const a = townToWorld(f, 0, f.Lf / 2, _w);
        if (
          a.x < ctx.origin.x ||
          a.x >= ctx.origin.x + ctx.size ||
          a.z < ctx.origin.z ||
          a.z >= ctx.origin.z + ctx.size
        )
          continue;
        return build(id, f, ctx);
      }
      return null;
    },
  };
}

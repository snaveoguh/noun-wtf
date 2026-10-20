// ── Wild landmarks: the chunk decorator that builds them ─────────────────
//
// Like the towns: a wild landmark is built (once) when the chunk holding
// its centre gets its props, and torn down with them. It stands on a round
// stone plinth sunk into the slope (its top level with the highest ground
// under the footprint), so it never floats on one side or sinks on the
// other. Solid, thin and glow parts merge into one mesh each: ≤ 4 draw calls.

import type { ChunkContext, ChunkDecoration, ChunkDecorator } from '../mountain/MountainStream';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { inkExcluded, toonify } from '../../render/Toon';
import { cyl } from '../../towns/kit';
import { edgeDistance } from '../mountain/config';

import { MODELS } from './models';
import { PartBuilder } from './parts';
import { LANDMARKS, landmarkPlace, type LandmarkDef } from './sites';

let mats: {
  solid: THREE.MeshStandardMaterial;
  thin: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
} | null = null;

function materials() {
  if (mats === null) {
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    solid.name = 'LandmarkSolid';
    const thin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    thin.name = 'LandmarkThin';
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    glow.name = 'LandmarkGlow';
    mats = { solid, thin, glow };
  }
  return mats;
}

/** Last build per landmark (perf checks, the browser test). */
export const landmarkStats = new Map<
  string,
  { triangles: number; drawCalls: number; ms: number }
>();

const WILD = LANDMARKS.filter(d => !('town' in d.at));

function build(def: LandmarkDef, ctx: ChunkContext): ChunkDecoration | null {
  const t0 = performance.now();
  const p = landmarkPlace(def, true);
  if (p === null) return null;
  // Plinth: top at the highest ground under the footprint, foot below the lowest
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = i === 12 ? 0 : p.r;
    const h = ctx.height(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr);
    hi = Math.max(hi, h);
    lo = Math.min(lo, h);
  }
  const top = hi + 0.6;
  const k = new PartBuilder();
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x - ctx.origin.x, top, p.z - ctx.origin.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
    new THREE.Vector3(1, 1, 1),
  );
  const depth = top - lo + 3;
  k.add(cyl(p.r * 1.08, p.r * 1.18, depth, 20, 0, -depth / 2, 0), 0xb9b4a8, base, {
    collide: true,
  });
  k.add(cyl(p.r * 1.1, p.r * 1.1, 0.25, 20, 0, 0.12, 0), 0x8f8a7d, base);
  MODELS[def.model](k, base);

  const M = materials();
  const root = new THREE.Group();
  root.name = `Landmark:${def.id}`;
  const disposables: { dispose(): void }[] = [];
  let tris = 0;
  let calls = 0;
  const add = (
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
  add(k.geo.solid, M.solid, `${def.id}Solid`, ctx.quality !== 'low');
  const thin = add(k.geo.thin, M.thin, `${def.id}Thin`, false);
  const glow = add(k.geo.glow, M.glow, `${def.id}Glow`, false);
  if (ctx.toon) toonify(root);
  if (thin !== null) inkExcluded.add(thin);
  if (glow !== null) inkExcluded.add(glow);
  root.updateMatrixWorld(true);
  let n = 0;
  for (const c of k.col) n += c.attributes.position.array.length;
  const arr = new Float32Array(n);
  let o = 0;
  for (const c of k.col) {
    arr.set(c.attributes.position.array as Float32Array, o);
    o += c.attributes.position.array.length;
    c.dispose();
  }
  const collision = new THREE.BufferGeometry();
  collision.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  landmarkStats.set(def.id, {
    triangles: Math.round(tris),
    drawCalls: calls,
    ms: performance.now() - t0,
  });
  return {
    object: root,
    collision,
    dispose: () => {
      if (thin !== null) inkExcluded.delete(thin);
      if (glow !== null) inkExcluded.delete(glow);
      collision.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

/** The wild landmarks, each in the chunk that holds its centre. */
export function landmarksDecorator(): ChunkDecorator {
  return {
    id: 'landmarks',
    populate(ctx: ChunkContext): ChunkDecoration | null {
      const cx = ctx.origin.x + ctx.size / 2;
      const cz = ctx.origin.z + ctx.size / 2;
      const ed = edgeDistance(cx, cz);
      for (const def of WILD) {
        const at = def.at as { s: number };
        // Cheap reject: lines meander, but never get further out than along them
        if (ed > at.s + 1500 || ed < at.s * 0.5) continue;
        const p = landmarkPlace(def, true);
        if (p === null) continue;
        if (
          p.x < ctx.origin.x ||
          p.x >= ctx.origin.x + ctx.size ||
          p.z < ctx.origin.z ||
          p.z >= ctx.origin.z + ctx.size
        )
          continue;
        return build(def, ctx);
      }
      return null;
    },
  };
}

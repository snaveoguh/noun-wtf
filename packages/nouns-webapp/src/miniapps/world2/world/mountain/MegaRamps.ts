// ── Mega ramps on the mountain (chunk decorator) ────────────────────────
//
// Landmark set pieces: the noggles mega ramp (world/MegaRamp.ts) on a level
// terrace beside the main lines — the hero a few hundred metres below the
// +Z alley, then every 3–5 km (sites: tracks.ts, terrace + bridge + speed
// governor: terrain.ts). Each ramp is built by the chunk that holds its
// anchor (middle of the run) when that chunk gets its props, and torn down
// with them: render objects in the chunk's group, collision in the chunk's
// dynamic BVH, grind rails (rainbow arch + QP coping) added to the shared
// RailSet on load and removed on unload.

import type { ChunkContext, ChunkDecoration, ChunkDecorator } from './MountainStream';
import type { RailSet } from '../../physics/Rails';

import * as THREE from 'three';

import { toonify } from '../../render/Toon';
import { MEGA_RAMP, buildMegaRamp, placeMegaRamp } from '../MegaRamp';

import { MEGA_PAD, megaFrame, terrainHeight } from './terrain';
import { tracks, type MegaSite } from './tracks';

let checked = false;

/** Mega ramps whose anchor lies in the chunk (normally none, at most one). */
export function megaRampDecorator(rails: RailSet): ChunkDecorator {
  return {
    id: 'megaramps',
    populate(ctx: ChunkContext): ChunkDecoration | null {
      const sites = tracks
        .megasIn(ctx.origin.x, ctx.origin.z, ctx.origin.x + ctx.size, ctx.origin.z + ctx.size)
        .filter(m => !megaFrame(m).dead);
      if (sites.length === 0) return null;
      const root = new THREE.Group();
      root.name = 'mountain-megaramps';
      const cols: THREE.BufferGeometry[] = [];
      const railIds: string[] = [];
      const disposables: { dispose(): void }[] = [];
      for (const site of sites) {
        const built = buildSite(site, ctx);
        root.add(built.group);
        cols.push(built.collision);
        rails.add(built.rails);
        for (const r of built.rails) railIds.push(r.id);
        disposables.push(...built.disposables);
      }
      const collision = mergeAll(cols);
      for (const c of cols) c.dispose();
      return {
        object: root,
        collision,
        dispose: () => {
          rails.remove(railIds);
          collision.dispose();
          for (const d of disposables) d.dispose();
        },
      };
    },
  };
}

function buildSite(site: MegaSite, ctx: ChunkContext) {
  const f = megaFrame(site);
  // Ramp origin (ground under the back of the drop-in deck), world space
  const wx = f.ox + f.rx * f.cv;
  const wz = f.oz + f.rz * f.cv;
  const ramp = buildMegaRamp({
    seed: site.track.id * 31 + site.k * 7 + 3,
    approach: {
      level: f.uLevel,
      foot: f.uFoot,
      grade: MEGA_PAD.rampDownGrade,
      // Hillside under the bridge, local y
      ground: z => terrainHeight(wx + f.fx * z, wz + f.fz * z) - f.P,
    },
  });
  if (!checked) {
    checked = true;
    const st = ramp.stations;
    if (
      Math.abs(st.endZ - MEGA_PAD.rampLen) > 2 ||
      Math.abs(st.crestZ - MEGA_PAD.crestZ) > 0.01 ||
      MEGA_RAMP.topY !== MEGA_PAD.topY
    )
      console.warn('[world2] mega ramp terrace out of sync with MegaRamp.ts', st.endZ, st.crestZ);
  }
  // World placement → rails (world space), then move the group into the
  // chunk's local frame (render + collision stay small numbers)
  const placed = placeMegaRamp(ramp, new THREE.Vector3(wx, f.P, wz), f.yaw);
  const g = ramp.group;
  g.position.sub(ctx.origin);
  g.updateMatrixWorld(true);
  if (ctx.toon) toonify(g);
  const prefix = `mega:${site.track.id}:${site.k}:`;
  const rails = placed.rails.map(r => ({ ...r, id: prefix + r.id }));
  // Collision: every collision mesh baked into chunk-local positions
  const parts: THREE.BufferGeometry[] = [];
  for (const m of ramp.collision) {
    const src = m.geometry;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', src.attributes.position.clone());
    if (src.index !== null) geo.setIndex(src.index.clone());
    geo.applyMatrix4(m.matrixWorld);
    parts.push(geo.index !== null ? geo.toNonIndexed() : geo);
  }
  const collision = mergeAll(parts);
  for (const p of parts) p.dispose();
  const disposables: { dispose(): void }[] = [];
  const mats = new Set<THREE.Material>();
  g.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    disposables.push(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mats.add(m);
  });
  // (textures are shared, cached procedural maps: materials only)
  disposables.push(...mats);
  return { group: g, collision, rails, disposables };
}

/** Concatenate position-only, non-indexed geometries. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += g.attributes.position.array.length;
  const arr = new Float32Array(n);
  let o = 0;
  for (const g of geos) {
    arr.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return out;
}

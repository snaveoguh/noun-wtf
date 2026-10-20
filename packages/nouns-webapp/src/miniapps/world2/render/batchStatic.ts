// ── Static batching: many small meshes → one mesh per material ───────────
//
// Props built from dozens of boxes and cylinders (the ice cream van is ~150)
// cost one draw call each, and another each in the shadow pass. Parts that
// never move relative to the prop's root are baked into the root's frame and
// merged per material (and per shadow flags), so the van draws in ~20 calls.
// Anything the caller needs to find, move, animate or hide on its own stays
// a separate mesh (`keep`).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** userData flags copied onto the merged mesh (so a hide-by-flag still works). */
const FLAGS = ['parkedOnly'] as const;

function flagKey(o: THREE.Object3D): string {
  return FLAGS.map(f => (o.userData[f] === true ? '1' : '0')).join('');
}

/**
 * Merge `root`'s static meshes per material. Skips (leaves as they are):
 * meshes `keep` returns true for, hidden ones, multi-material ones,
 * transparent ones (they sort per mesh), skinned/instanced meshes.
 * Returns how many meshes were folded away.
 */
export function batchStatic(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh) return;
    if (!m.visible || Array.isArray(m.material) || keep(m)) return;
    if (m.material.transparent) return;
    if (m.geometry.attributes.position === undefined) return;
    let hidden = false;
    for (let p = m.parent; p !== null && p !== root; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    const key = `${m.material.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${flagKey(m)}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [m]);
    else list.push(m);
  });

  let folded = 0;
  const local = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Only the attributes every part has (position/normal/uv on primitives)
    const names = Object.keys(list[0]!.geometry.attributes).filter(n =>
      list.every(m => m.geometry.attributes[n] !== undefined),
    );
    if (!names.includes('position')) continue;
    const geos = list.map(m => {
      const src = m.geometry;
      const g = new THREE.BufferGeometry();
      for (const n of names) g.setAttribute(n, src.attributes[n]!.clone());
      if (src.index !== null) g.setIndex(src.index.clone());
      else {
        const n = src.attributes.position!.count;
        g.setIndex(Array.from({ length: n }, (_, i) => i));
      }
      local.multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(local);
      // a mirrored part would flip its winding
      if (local.determinant() < 0) {
        const idx = g.index!;
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i + 1);
          idx.setX(i + 1, idx.getX(i + 2));
          idx.setX(i + 2, a);
        }
      }
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged === null) continue;
    merged.computeBoundingSphere();
    const first = list[0]!;
    const out = new THREE.Mesh(merged, first.material);
    out.name = `${root.name || 'batch'}-static`;
    out.castShadow = first.castShadow;
    out.receiveShadow = first.receiveShadow;
    for (const f of FLAGS) if (first.userData[f] === true) out.userData[f] = true;
    // (originals aren't disposed: a geometry may be shared with a kept part,
    // and nothing was uploaded yet when props batch at build time)
    for (const m of list) m.removeFromParent();
    root.add(out);
    folded += list.length - 1;
  }
  return folded;
}

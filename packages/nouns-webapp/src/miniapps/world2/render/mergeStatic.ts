// ── Merge a static prop group into one mesh per material ────────────────
//
// Props built from dozens of primitives (the Keymaker's board of keys is 39
// meshes, the Oracle's table 25) cost a draw call each, every frame, on a
// phone that pays per draw. Their parts never move, so each set of meshes
// sharing a material (and the same shadow flags) is baked into one
// geometry in the group's own frame. Same materials, same triangles: it
// looks the same. Skinned / instanced meshes, multi-material meshes,
// meshes the ink pass skips and anything with a different attribute set
// are left as they are.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Fewer meshes than this sharing a material isn't worth merging. */
const MIN_PARTS = 2;

/** Merge `group`'s static meshes in place. Returns how many draws it saved. */
export function mergeStatic(group: THREE.Object3D, skip: ReadonlySet<THREE.Object3D> = new Set()) {
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const sets = new Map<string, THREE.Mesh[]>();
  const ids = new Map<THREE.Material, number>();
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (
      !m.isMesh ||
      (m as THREE.SkinnedMesh).isSkinnedMesh ||
      (m as THREE.InstancedMesh).isInstancedMesh
    )
      return;
    // (a primitive's face groups don't matter under one material)
    if (Array.isArray(m.material) || m.morphTargetInfluences) return;
    for (let x: THREE.Object3D | null = m; x !== null && x !== group.parent; x = x.parent)
      if (skip.has(x) || !x.visible) return;
    const attrs = Object.keys(m.geometry.attributes).sort().join(',');
    const mat = m.material;
    if (!ids.has(mat)) ids.set(mat, ids.size);
    const key = `${ids.get(mat)}|${attrs}|${m.castShadow}|${m.receiveShadow}|${m.geometry.index !== null}|${m.renderOrder}`;
    let list = sets.get(key);
    if (list === undefined) sets.set(key, (list = []));
    list.push(m);
  });
  let saved = 0;
  for (const list of sets.values()) {
    if (list.length < MIN_PARTS) continue;
    const geos = list.map(m =>
      m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, m.matrixWorld)),
    );
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged === null) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `${group.name || 'props'}:merged`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    group.add(mesh);
    // (their geometries may be shared with props elsewhere: left to the GC, not disposed)
    for (const m of list) m.removeFromParent();
    saved += list.length - 1;
  }
  return saved;
}

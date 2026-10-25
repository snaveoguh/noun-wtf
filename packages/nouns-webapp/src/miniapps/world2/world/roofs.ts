// ── Rooftops: seat the baked collision on the roofs you can see ──
//
// The plaza's baked COL_Buildings boxes run every block up to its parapet
// height, 0.9 m above the roof floor the render mesh draws. So on any roof
// you rode on an invisible slab: hovering a foot or more over the floor, and
// paint landed on the slab, floating in the air. This drops each collision
// roof onto the visible roof under it, then gives the visible parapets their
// own collision so you still can't walk through a lip.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

/** Roof floors sit this far (give or take) below the baked collision tops. */
const MIN_DROP = 0.3;
const MAX_DROP = 1.3;
/** Parapets: render triangles standing up to this high on the new roof. */
const PARAPET_H = 0.95;
const EPS = 0.05;
/** Only roofs: anything lower is street level. */
const MIN_Y = 2;
const PROBES: [number, number][] = [
  [0, 0],
  [0.6, 0],
  [-0.6, 0],
  [0, 0.6],
  [0, -0.6],
  [0.6, 0.6],
  [0.6, -0.6],
  [-0.6, 0.6],
  [-0.6, -0.6],
];

/** World-space, position-only, non-indexed copy of `meshes`. */
function worldGeometry(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const src = m.geometry;
    if (src.attributes.position === undefined) continue;
    m.updateWorldMatrix(true, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position.clone());
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(m.matrixWorld);
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

const _ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

/** Heights of every surface of `bvh` straight under (x, z). */
function heightsAt(bvh: MeshBVH, x: number, z: number): number[] {
  _ray.origin.set(x, 1000, z);
  return bvh.raycast(_ray, THREE.DoubleSide).map(h => h.point.y);
}

/**
 * New collision roof height for a vertex at `y`, or `y` to leave it. Lowered
 * only when a render roof floor lies MIN_DROP..MAX_DROP under it nearby; a
 * block whose collision already matches its roof has none there. Thin
 * render pieces above the vertex (signs, ledges) don't hold the slab up.
 */
export function seatHeight(y: number, samples: number[][]): number {
  if (y < MIN_Y) return y;
  let best = -Infinity;
  for (const hs of samples) {
    let top = -Infinity;
    for (const h of hs) if (h <= y + EPS && h > top) top = h;
    const drop = y - top;
    if (drop >= MIN_DROP && drop <= MAX_DROP && top > best) best = top;
  }
  return best === -Infinity ? y : best;
}

/**
 * Lower `col`'s roof tops onto the visible roofs of `render`, in place, and
 * return a collision mesh for the render parapets (null if there are none).
 */
export function seatRoofs(col: THREE.Mesh, render: THREE.Mesh[]): THREE.Mesh | null {
  const renderGeo = worldGeometry(render);
  if (renderGeo === null) return null;
  const renderBvh = new MeshBVH(renderGeo, { maxLeafTris: 8 });

  // Drop the slab tops (world space, then back into the mesh's own frame)
  col.updateWorldMatrix(true, false);
  const toLocal = col.matrixWorld.clone().invert();
  const pos = col.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(col.matrixWorld);
    const y = seatHeight(
      v.y,
      PROBES.map(([dx, dz]) => heightsAt(renderBvh, v.x + dx, v.z + dz)),
    );
    if (y === v.y) continue;
    v.y = y;
    v.applyMatrix4(toLocal);
    pos.setXYZ(i, v.x, v.y, v.z);
    moved++;
  }
  if (moved > 0) {
    pos.needsUpdate = true;
    col.geometry.computeBoundingBox();
    col.geometry.computeBoundingSphere();
  }

  // Parapets: render triangles standing on the (new) collision roof, no
  // taller than a parapet. Signs and ledges further up stay as they were.
  const colGeo = worldGeometry([col]);
  if (colGeo === null) return null;
  const colBvh = new MeshBVH(colGeo, { maxLeafTris: 8 });
  const rp = renderGeo.attributes.position;
  const out: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < rp.count; t += 3) {
    a.fromBufferAttribute(rp, t);
    b.fromBufferAttribute(rp, t + 1);
    c.fromBufferAttribute(rp, t + 2);
    const lo = Math.min(a.y, b.y, c.y);
    const hi = Math.max(a.y, b.y, c.y);
    if (lo < MIN_Y) continue;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    let roof = -Infinity;
    for (const [dx, dz] of PROBES.slice(0, 5))
      for (const h of heightsAt(colBvh, cx + dx / 2, cz + dz / 2))
        if (h <= lo + EPS && h > roof) roof = h;
    if (roof === -Infinity) continue;
    if (lo - roof < -EPS || hi - roof > PARAPET_H || hi - roof <= EPS) continue;
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  renderGeo.dispose();
  colGeo.dispose();
  if (out.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const mesh = new THREE.Mesh(g);
  // COL_Buildings* so the alley cuts trim it with the blocks
  mesh.name = 'COL_BuildingsParapets';
  mesh.updateMatrixWorld(true);
  return mesh;
}

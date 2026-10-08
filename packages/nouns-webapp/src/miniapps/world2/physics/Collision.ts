// ── Static collision world — BVH-accelerated raycasts + capsule pushout ──
//
// All level geometry is merged into a single world-space BufferGeometry and
// wrapped in a MeshBVH. Skate + on-foot controllers only ever query this:
// ground rays for surface following, capsule shapecasts for walls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

const _ray = new THREE.Ray();
const _tmpBox = new THREE.Box3();
const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _seg = new THREE.Line3();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class CollisionWorld {
  bvh: MeshBVH | null = null;
  geometry: THREE.BufferGeometry | null = null;
  /** Debug mesh (wireframe) — only built on demand. */
  private debugMesh: THREE.Mesh | null = null;

  /** Build from a list of meshes (their world matrices are baked in). */
  build(meshes: THREE.Mesh[]) {
    const geos: THREE.BufferGeometry[] = [];
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      const src = m.geometry;
      if (src.attributes.position === undefined) continue;
      // Position-only clone so mergeGeometries doesn't choke on mismatched attributes.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(m.matrixWorld);
      geos.push(g.index ? g.toNonIndexed() : g);
    }
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged === null) return;
    this.geometry?.dispose();
    this.geometry = merged;
    this.bvh = new MeshBVH(merged, { maxLeafTris: 12 });
  }

  /** Closest hit along a ray, or null. Back faces count (two-sided level). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): RayHit | null {
    if (!this.bvh) return null;
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
    if (hit === null || hit.distance > far) return null;
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    // Faces are stored in world space already; flip toward the ray origin.
    if (n.dot(_ray.direction) > 0) n.negate();
    return { point: hit.point.clone(), normal: n, distance: hit.distance };
  }

  /**
   * Push a capsule (segment start→end, radius) out of the static geometry.
   * Returns the total correction applied (zero vector when no contact) and
   * the deepest contact normal, so callers can kill velocity into walls.
   */
  capsulePushout(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    outNormal?: THREE.Vector3,
  ): THREE.Vector3 {
    const correction = new THREE.Vector3();
    if (!this.bvh) return correction;
    _seg.start.copy(start);
    _seg.end.copy(end);
    let bestDepth = 0;
    for (let iter = 0; iter < 3; iter++) {
      _tmpBox.makeEmpty();
      _tmpBox.expandByPoint(_seg.start);
      _tmpBox.expandByPoint(_seg.end);
      _tmpBox.min.addScalar(-radius);
      _tmpBox.max.addScalar(radius);
      let moved = false;
      this.bvh.shapecast({
        intersectsBounds: box => box.intersectsBox(_tmpBox),
        intersectsTriangle: (tri: ExtendedTriangle) => {
          const distance = tri.closestPointToSegment(_seg, _tri, _cap);
          if (distance < radius) {
            const depth = radius - distance;
            _dir.subVectors(_cap, _tri);
            const len = _dir.length();
            if (len < 1e-6) {
              tri.getNormal(_dir);
            } else {
              _dir.divideScalar(len);
            }
            _seg.start.addScaledVector(_dir, depth);
            _seg.end.addScaledVector(_dir, depth);
            correction.addScaledVector(_dir, depth);
            if (outNormal && depth > bestDepth) {
              bestDepth = depth;
              outNormal.copy(_dir);
            }
            moved = true;
          }
          return false;
        },
      });
      if (!moved) break;
    }
    return correction;
  }

  /** Line-of-sight test: is there geometry between a and b? Returns hit distance or -1. */
  obstruction(a: THREE.Vector3, b: THREE.Vector3): number {
    _a.copy(a);
    _b.subVectors(b, a);
    const len = _b.length();
    if (len < 1e-4) return -1;
    const hit = this.raycast(_a, _b, len);
    return hit ? hit.distance : -1;
  }

  debugObject(): THREE.Mesh | null {
    if (!this.geometry) return null;
    if (!this.debugMesh) {
      this.debugMesh = new THREE.Mesh(
        this.geometry,
        new THREE.MeshBasicMaterial({
          wireframe: true,
          color: 0x00ff88,
          transparent: true,
          opacity: 0.25,
        }),
      );
    }
    return this.debugMesh;
  }

  dispose() {
    this.geometry?.dispose();
    this.bvh = null;
  }
}

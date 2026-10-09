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
const _o = new THREE.Vector3();
const _e = new THREE.Vector3();
const _segBox = new THREE.Box3();
const _n = { x: 0, y: 0, z: 0 };

/**
 * Analytic ground that extends forever (the mountain). Queried alongside the
 * static BVH so terrain collision never needs a rebuild.
 */
export interface TerrainCollider {
  /** Hit distance along a unit ray, or -1. */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    far: number,
  ): number;
  normal(x: number, z: number, out: { x: number; y: number; z: number }): unknown;
}

/**
 * A small BVH that lives with a streamed terrain chunk (rocks, kickers…).
 * Geometry is stored relative to `offset` so it stays precise kilometres out.
 */
interface DynamicBody {
  bvh: MeshBVH;
  geometry: THREE.BufferGeometry;
  offset: THREE.Vector3;
  /** World-space bounds. */
  box: THREE.Box3;
}

export class CollisionWorld {
  bvh: MeshBVH | null = null;
  geometry: THREE.BufferGeometry | null = null;
  /** Debug mesh (wireframe) — only built on demand. */
  private debugMesh: THREE.Mesh | null = null;
  /** Endless analytic ground (null = level only). */
  terrain: TerrainCollider | null = null;
  /** Per-chunk prop colliders, keyed by chunk id. */
  private dynamic = new Map<string, DynamicBody>();

  /**
   * Add (or replace) a streamed collider. `geometry` positions are relative
   * to `offset`; the geometry is owned by the caller.
   */
  setDynamic(id: string, geometry: THREE.BufferGeometry | null, offset?: THREE.Vector3) {
    this.dynamic.delete(id);
    if (geometry === null || geometry.attributes.position === undefined) return;
    if (geometry.attributes.position.count < 3) return;
    const bvh = new MeshBVH(geometry, { maxLeafTris: 8 });
    geometry.computeBoundingBox();
    const off = offset?.clone() ?? new THREE.Vector3();
    const box = geometry.boundingBox!.clone().translate(off);
    this.dynamic.set(id, { bvh, geometry, offset: off, box });
  }

  get dynamicCount() {
    return this.dynamic.size;
  }

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
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    let best: RayHit | null = null;
    if (this.bvh) {
      const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
      if (hit !== null && hit.distance <= far) {
        const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        // Faces are stored in world space already; flip toward the ray origin.
        if (n.dot(_ray.direction) > 0) n.negate();
        best = { point: hit.point.clone(), normal: n, distance: hit.distance };
      }
    }
    if (this.dynamic.size > 0) {
      const lim = best?.distance ?? far;
      _segBox.makeEmpty();
      _segBox.expandByPoint(_ray.origin);
      _segBox.expandByPoint(_e.copy(_ray.origin).addScaledVector(_ray.direction, lim));
      for (const d of this.dynamic.values()) {
        if (!d.box.intersectsBox(_segBox)) continue;
        // Ray in the body's local frame
        _o.copy(_ray.origin);
        _ray.origin.sub(d.offset);
        const hit = d.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, best?.distance ?? far);
        _ray.origin.copy(_o);
        if (hit === null || hit.distance > (best?.distance ?? far)) continue;
        const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        if (n.dot(_ray.direction) > 0) n.negate();
        best = { point: hit.point.clone().add(d.offset), normal: n, distance: hit.distance };
      }
    }
    if (this.terrain !== null) {
      const r = _ray;
      const t = this.terrain.raycast(
        r.origin.x,
        r.origin.y,
        r.origin.z,
        r.direction.x,
        r.direction.y,
        r.direction.z,
        best?.distance ?? far,
      );
      if (t >= 0 && (best === null || t < best.distance)) {
        const p = r.origin.clone().addScaledVector(r.direction, t);
        this.terrain.normal(p.x, p.z, _n);
        // Started underground: report the surface right above us
        if (t === 0) {
          const h = this.terrainHeightAt(p.x, p.z, p.y);
          p.y = h;
        }
        best = { point: p, normal: new THREE.Vector3(_n.x, _n.y, _n.z), distance: t };
      }
    }
    return best;
  }

  /** Surface height by a short downward trace from above (terrain only). */
  private terrainHeightAt(x: number, z: number, below: number): number {
    if (this.terrain === null) return below;
    const top = below + 60;
    const t = this.terrain.raycast(x, top, z, 0, -1, 0, 120);
    return t >= 0 ? top - t : below;
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
    _seg.start.copy(start);
    _seg.end.copy(end);
    let bestDepth = 0;
    if (this.bvh)
      bestDepth = this.pushoutBvh(this.bvh, null, radius, correction, bestDepth, outNormal);
    if (this.dynamic.size > 0) {
      for (const d of this.dynamic.values()) {
        _segBox.makeEmpty();
        _segBox.expandByPoint(_seg.start);
        _segBox.expandByPoint(_seg.end);
        _segBox.min.addScalar(-radius);
        _segBox.max.addScalar(radius);
        if (!d.box.intersectsBox(_segBox)) continue;
        bestDepth = this.pushoutBvh(d.bvh, d.offset, radius, correction, bestDepth, outNormal);
      }
    }
    return correction;
  }

  /** Iterative capsule (in _seg) pushout against one BVH; moves _seg + accumulates. */
  private pushoutBvh(
    bvh: MeshBVH,
    offset: THREE.Vector3 | null,
    radius: number,
    correction: THREE.Vector3,
    bestDepthIn: number,
    outNormal?: THREE.Vector3,
  ): number {
    let bestDepth = bestDepthIn;
    if (offset !== null) {
      _seg.start.sub(offset);
      _seg.end.sub(offset);
    }
    for (let iter = 0; iter < 3; iter++) {
      _tmpBox.makeEmpty();
      _tmpBox.expandByPoint(_seg.start);
      _tmpBox.expandByPoint(_seg.end);
      _tmpBox.min.addScalar(-radius);
      _tmpBox.max.addScalar(radius);
      let moved = false;
      bvh.shapecast({
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
    if (offset !== null) {
      _seg.start.add(offset);
      _seg.end.add(offset);
    }
    return bestDepth;
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
    this.dynamic.clear();
  }
}

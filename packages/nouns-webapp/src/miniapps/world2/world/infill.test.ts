import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { beforeAll, describe, expect, it } from 'vitest';

import { blockRoofs } from '../interiors/plazaDoors';

import { loadPlaza } from './facades/plazaFixture.test-util';
import { buildInfills, FACADE, findInfills, type Infill, type RoofRect } from './infill';

/** World-space, position-only merge of `meshes`, with a BVH to ray-cast. */
function bvhOf(meshes: THREE.Mesh[]): MeshBVH {
  const geos = meshes.map(m => {
    m.updateWorldMatrix(true, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', m.geometry.attributes.position!.clone());
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    g.applyMatrix4(m.matrixWorld);
    return g.index ? g.toNonIndexed() : g;
  });
  return new MeshBVH(mergeGeometries(geos, false)!, { maxLeafTris: 8 });
}

const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

/** Height of the first thing straight down from high over (x, z), or -Infinity. */
function topAt(bvh: MeshBVH, x: number, z: number): number {
  ray.origin.set(x, 200, z);
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
  return hit === null ? -Infinity : hit.point.y;
}

/**
 * Probe points along every place two blocks meet on the facade line, and
 * across every slot between them: on the shared edge, either side of it,
 * from just behind the plaza wall to the back of the shallower block.
 */
function edgeProbes(roofs: readonly RoofRect[]): { x: number; z: number; at: string }[] {
  const out: { x: number; z: number; at: string }[] = [];
  for (const [nx, nz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const loc = roofs
      .map(r => {
        const [o0, o1] =
          nx > 0
            ? [r.minX, r.maxX]
            : nx < 0
              ? [-r.maxX, -r.minX]
              : nz > 0
                ? [r.minZ, r.maxZ]
                : [-r.maxZ, -r.minZ];
        const [u0, u1] = nx !== 0 ? [r.minZ, r.maxZ] : [r.minX, r.maxX];
        return { u0, u1, o0, o1 };
      })
      .filter(r => Math.abs(r.o0 - FACADE) < 0.3)
      .sort((a, b) => a.u0 - b.u0);
    for (let i = 1; i < loc.length; i++) {
      const a = loc[i - 1]!;
      const b = loc[i]!;
      if (b.u0 - a.u1 > 6) continue; // a street through the ring, not a seam
      const us = [a.u1 - 0.4, a.u1, (a.u1 + b.u0) / 2, b.u0, b.u0 + 0.4];
      const deep = Math.min(a.o1, b.o1);
      for (const u of us)
        for (let o = FACADE + 0.6; o < deep - 0.5; o += 0.5) {
          const x = nx !== 0 ? o * nx : u;
          const z = nx !== 0 ? u : o * nz;
          out.push({ x, z, at: `side ${nx},${nz} seam u≈${a.u1.toFixed(1)}` });
        }
    }
  }
  return out;
}

/** Probes that see down to the street (a roof is anything over 2 m). */
function holes(bvh: MeshBVH, probes: ReturnType<typeof edgeProbes>) {
  return probes.filter(p => topAt(bvh, p.x, p.z) < 2);
}

describe('ring infill', () => {
  let plaza: Awaited<ReturnType<typeof loadPlaza>>;
  let roofs: RoofRect[];
  let infills: Infill[];
  let probes: ReturnType<typeof edgeProbes>;

  beforeAll(async () => {
    plaza = await loadPlaza();
    roofs = blockRoofs(plaza.collision.find(m => m.name === 'COL_Buildings')!);
    infills = findInfills(roofs);
    probes = edgeProbes(roofs);
  });

  it('finds the four slots the bake left, one per side, and fills them flush', () => {
    const front = infills.filter(f => f.front);
    expect(front).toHaveLength(4);
    // Two of the blocks behind them stop 1 m short of the ring's back line
    expect(infills.filter(f => !f.front)).toHaveLength(2);
    for (const f of front) {
      const w = f.nx !== 0 ? f.maxZ - f.minZ : f.maxX - f.minX;
      const d = f.nx !== 0 ? f.maxX - f.minX : f.maxZ - f.minZ;
      expect(w).toBeCloseTo(4.5, 1);
      expect(d).toBeCloseTo(9, 1);
      // Flush with the low block behind it, never above its lower neighbour
      expect(f.top).toBeCloseTo(10.2, 1);
      expect(f.top).toBeLessThanOrEqual(Math.min(...f.neighbours) + 0.05);
    }
    expect(new Set(infills.map(f => `${f.nx},${f.nz}`)).size).toBe(4);
  });

  it('the scan sees the holes in the plaza as baked', () => {
    const render = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          plaza.prims.flatMap(p => p.tris.flatMap(t => t.p.flat())),
          3,
        ),
      ),
    );
    expect(holes(bvhOf([render]), probes).length).toBeGreaterThan(0);
  });

  it('no holes where blocks meet: render', () => {
    const render = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          plaza.prims.flatMap(p => p.tris.flatMap(t => t.p.flat())),
          3,
        ),
      ),
    );
    const { mesh } = buildInfills(infills);
    expect(holes(bvhOf([render, mesh!]), probes)).toEqual([]);
  });

  it('no holes where blocks meet: collision (parkour sees a roof, not a gap)', () => {
    const { collision } = buildInfills(infills);
    const bvh = bvhOf([
      ...plaza.collision.filter(m => /^col_buildings/i.test(m.name)),
      ...collision,
    ]);
    expect(holes(bvh, probes)).toEqual([]);
    // The infill roof is the roof you see, not a slab over it
    for (const f of infills)
      expect(topAt(bvh, (f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2)).toBeCloseTo(f.top, 2);
  });

  it('faces the plaza with a parapet you can stand behind', () => {
    const { collision } = buildInfills(infills);
    const bvh = bvhOf(collision);
    for (const f of infills.filter(i => i.front)) {
      const cx = (f.minX + f.maxX) / 2;
      const cz = (f.minZ + f.maxZ) / 2;
      const lipX = f.nx !== 0 ? f.nx * (FACADE + 0.15) : cx;
      const lipZ = f.nz !== 0 ? f.nz * (FACADE + 0.15) : cz;
      expect(topAt(bvh, lipX, lipZ)).toBeCloseTo(f.top + 0.9, 2);
    }
  });
});

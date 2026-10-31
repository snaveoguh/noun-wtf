import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { beforeAll, describe, expect, it } from 'vitest';

import { blockRoofs } from '../../interiors/plazaDoors';
import { loadPlaza } from '../facades/plazaFixture.test-util';
import { buildInfills, findInfills } from '../infill';

import { alleyCutBoxes, buildAlleys, cutTriangles } from './Alleys';
import { ringHides, type Aabb } from './ringOcclusion';

const box = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): Aabb => ({
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ,
});

describe('ringHides', () => {
  const cam = [0, 3.5, 14] as const;

  it('hides a low box behind the north blocks', () => {
    expect(ringHides(...cam, box(30, 60, -20, 5, 100, 128))).toBe(true);
  });

  it('shows a box tall enough to clear the roofs', () => {
    expect(ringHides(...cam, box(30, 60, -20, 60, 100, 128))).toBe(false);
  });

  it('shows a box down the DOWNHILL alley', () => {
    expect(ringHides(...cam, box(-2, 2, -30, -10, 110, 130))).toBe(false);
  });

  it('shows everything to a camera outside the square or up on a roof', () => {
    expect(ringHides(0, 3.5, 80, box(30, 60, -20, 5, 100, 128))).toBe(false);
    expect(ringHides(0, 25, 14, box(30, 60, -20, 5, 100, 128))).toBe(false);
  });

  it('never hides a box that reaches into the square', () => {
    expect(ringHides(...cam, box(-10, 10, -5, 2, 60, 130))).toBe(false);
  });
});

describe('ringHides against the real plaza', () => {
  let bvh: MeshBVH;

  beforeAll(async () => {
    // The banners paint on a canvas; jsdom has none
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy(
        {},
        {
          get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}),
          set: () => true,
        },
      )) as never;
    // The ring as Level.ts builds it: the plaza blocks, infills, the alley cuts + blocks
    const { collision } = await loadPlaza();
    const col = collision.filter(m => m.name !== 'COL_Boundary');
    const roofs = col.find(m => m.name === 'COL_Buildings')!;
    col.push(...buildInfills(findInfills(blockRoofs(roofs))).collision);
    const cuts = alleyCutBoxes();
    for (const m of col) if (/^col_(buildings|props)/i.test(m.name)) cutTriangles(m, cuts);
    col.push(...buildAlleys().collision);
    // Only the buildings and the street (with the ledges in it) occlude here, not lamp posts or rails
    const occluders = col.filter(m =>
      /^col_(buildings|alley|citywall|ground|obstacles)/i.test(m.name),
    );
    const geos = occluders.map(m => {
      m.updateWorldMatrix(true, false);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', m.geometry.attributes.position!.clone());
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      g.applyMatrix4(m.matrixWorld);
      return g.index ? g.toNonIndexed() : g;
    });
    bvh = new MeshBVH(mergeGeometries(geos, false)!, { maxLeafTris: 8 });
  });

  it('only hides boxes that every sight line to them is blocked from', () => {
    let rnd = 12345;
    const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    const ray = new THREE.Ray();
    let hidden = 0;
    let checked = 0;
    for (let i = 0; i < 1500; i++) {
      // A camera somewhere on the plaza floor (rider height to a raised chase cam)
      const cx = (r() * 2 - 1) * 70;
      const cz = (r() * 2 - 1) * 70;
      const cy = 1 + r() * 5;
      // A chunk-ish box out on the slopes on a random side
      const side = Math.floor(r() * 4);
      const along = (r() * 2 - 1) * 200;
      const out = 96 + r() * 220;
      const w = 10 + r() * 120;
      const top = -12 + r() * 22;
      const [x0, z0] =
        side === 0
          ? [along, out]
          : side === 1
            ? [out, along]
            : side === 2
              ? [along, -out - w]
              : [-out - w, along];
      const b = box(x0, x0 + w, top - 30, top, z0, z0 + w);
      checked++;
      if (!ringHides(cx, cy, cz, b)) continue;
      hidden++;
      // Every sample on the box's top face must be blocked by a building
      for (let u = 0; u <= 8; u++)
        for (let v = 0; v <= 8; v++) {
          const p = new THREE.Vector3(
            b.minX + ((b.maxX - b.minX) * u) / 8,
            b.maxY,
            b.minZ + ((b.maxZ - b.minZ) * v) / 8,
          );
          ray.origin.set(cx, cy, cz);
          ray.direction.subVectors(p, ray.origin);
          const len = ray.direction.length();
          ray.direction.divideScalar(len);
          const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
          expect(
            hit !== null && hit.distance < len,
            `cam (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)}) → (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`,
          ).toBe(true);
        }
    }
    // …and it does hide most of them (that's the point)
    expect(hidden).toBeGreaterThan(checked * 0.4);
  });
});

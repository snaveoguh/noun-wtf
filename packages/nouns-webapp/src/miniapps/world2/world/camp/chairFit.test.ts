import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildItem } from '../../interiors/build';
import { Kit } from '../../interiors/kit';
import { mulberry32 } from '../../interiors/rng';

import { campLayout, solidBox } from './layout';

const PALETTE = {
  wall: 0,
  wall2: 0,
  floor: 0,
  floor2: 0,
  trim: 0,
  ceiling: 0,
  wood: 0,
  fabric: 0,
  accent: 0,
  metal: 0,
};

// Solid pieces collide as axis-aligned boxes, and spray paint lands on the
// collider: the tipped armchair has to fill its box exactly, or a tag on it
// floats in the air beside it (a player's did, 2026-10-31).
describe('the tipped armchair', () => {
  it('is square to the room and fills its collider', () => {
    const q = campLayout(10, 8, 3.2, -2, 2).pieces.find(p => p.type === 'armchair_tipped')!;
    expect(q.yaw).toBe(0);
    // as build.ts places it (room frame, relative to q.x / q.z)
    const kit = new Kit();
    const e = new THREE.Euler(-Math.PI / 2, q.yaw, 0, 'YXZ');
    kit.frame.compose(
      new THREE.Vector3(0, q.h / 2, q.d / 2),
      new THREE.Quaternion().setFromEuler(e),
      new THREE.Vector3(1, 1, 1),
    );
    buildItem(
      kit,
      {
        type: 'armchair',
        x: 0,
        z: 0,
        rot: 0,
        w: q.w,
        d: q.h,
        h: q.d,
        solid: true,
        seed: 11,
      } as never,
      PALETTE as never,
      mulberry32(11),
      { slots: [], named: new Map() } as never,
      { kind: 'home', items: [], h: 3.5 } as never,
    );
    const b = new THREE.Box3();
    for (const { geo } of kit.all()) {
      geo.computeBoundingBox();
      b.union(geo.boundingBox!);
    }
    const c = solidBox(q);
    expect(b.min.x).toBeCloseTo(c.minX - q.x, 1);
    expect(b.max.x).toBeCloseTo(c.maxX - q.x, 1);
    expect(b.min.z).toBeCloseTo(c.minZ - q.z, 1);
    expect(b.max.z).toBeCloseTo(c.maxZ - q.z, 1);
    expect(b.max.y).toBeCloseTo(c.h, 1);
  });
});

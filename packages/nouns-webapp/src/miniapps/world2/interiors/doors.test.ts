import type { BuildingDoor } from './contract';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../physics/Collision';

import {
  doorReach,
  doorSpot,
  exposed,
  reachable,
  extractDoors,
  splitLong,
  walls,
  type Footprint,
  type Rect,
} from './doors';
import { kindFor } from './names';
import { plazaDoorPlan, plazaDoors, plazaFootprints } from './plazaDoors';

const fp = (key: string, minX: number, maxX: number, minZ: number, maxZ: number): Footprint => ({
  key,
  minX,
  maxX,
  minZ,
  maxZ,
  height: 10,
  ground: 0,
});

/** Is (x, z) strictly inside a rect (by more than `m`)? */
const inside = (r: Rect, x: number, z: number, m = 0.01) =>
  x > r.minX + m && x < r.maxX - m && z > r.minZ + m && z < r.maxZ - m;

describe('door extractor (synthetic)', () => {
  it('puts the door on the wall facing the street', () => {
    const b = fp('a', -5, 5, 10, 20);
    const s = doorSpot(b, [], { area: 't', street: () => ({ x: 0, z: 0 }) })!;
    expect(s.nz).toBe(-1);
    expect(s.z).toBe(10);
    expect(s.x).toBeCloseTo(0);
  });

  it('never opens onto a neighbour standing against the wall', () => {
    const b = fp('a', -5, 5, 10, 20);
    // A neighbour right in front of the street wall: that wall is blocked
    const n = fp('n', -6, 6, 8, 10);
    const s = doorSpot(b, [n], { area: 't', street: () => ({ x: 0, z: 0 }) })!;
    expect(s.nz).not.toBe(-1);
    // …and a blocker covering half the wall pushes the door to the free half
    const half = { minX: -5, maxX: 0, minZ: 9, maxZ: 10 };
    const s2 = doorSpot(b, [half], { area: 't', street: () => ({ x: 0, z: 0 }) })!;
    expect(s2.nz).toBe(-1);
    expect(s2.x - s2.width / 2).toBeGreaterThan(0);
  });

  it('respects the approach probe', () => {
    const b = fp('a', -5, 5, 10, 20);
    const s = doorSpot(b, [], {
      area: 't',
      street: () => ({ x: 0, z: 0 }),
      // a planter in front of the middle of the facade
      clear: x => Math.abs(x) > 1.5,
    })!;
    expect(s.nz).toBe(-1);
    expect(Math.abs(s.x)).toBeGreaterThan(1.5);
    expect(s.forced).toBe(false);
  });

  it('exposed() subtracts what stands outside a wall', () => {
    const w = walls(fp('a', 0, 10, 0, 10))[1]; // −Z wall, x 0..10 at z 0
    expect(exposed(w, [{ minX: 2, maxX: 4, minZ: -1, maxZ: 0 }], 1.4)).toEqual([
      [0, 2],
      [4, 10],
    ]);
    // Something behind the wall (inside the building) doesn't count
    expect(exposed(w, [{ minX: 2, maxX: 4, minZ: 0, maxZ: 1 }], 1.4)).toEqual([[0, 10]]);
  });

  it('gives a terrace of shops one door each, never on a party wall', () => {
    const terrace = splitLong(fp('t', 0, 60, 0, 16));
    expect(terrace.length).toBe(4);
    const doors = extractDoors(terrace, { area: 't', street: () => ({ x: 30, z: -40 }) });
    expect(doors.length).toBe(4);
    for (const d of doors) {
      expect(d.z).toBeLessThan(0); // on the street (−Z) side, just proud of the wall
      expect(Math.abs(d.yaw - Math.PI)).toBeLessThan(1e-9);
    }
  });

  it('ids are stable and unique', () => {
    const a = extractDoors([fp('k1', 0, 10, 0, 10), fp('k2', 20, 30, 0, 10)], {
      area: 'x',
      street: () => ({ x: 15, z: -20 }),
    });
    const b = extractDoors([fp('k2', 20, 30, 0, 10), fp('k1', 0, 10, 0, 10)], {
      area: 'x',
      street: () => ({ x: 15, z: -20 }),
    });
    expect(a.map(d => d.id).sort()).toEqual(b.map(d => d.id).sort());
    expect(new Set(a.map(d => d.id)).size).toBe(a.length);
    const byId = new Map(b.map(d => [d.id, d]));
    for (const d of a) expect(byId.get(d.id)).toEqual(d);
  });

  it('reads kinds off signs', () => {
    expect(kindFor('SALOON')).toBe('bar');
    expect(kindFor('BARBER')).toBe('barber');
    expect(kindFor('GENERAL STORE')).toBe('shop');
    expect(kindFor('PIZZA')).toBe('cafe');
    expect(kindFor('LAUNDRY')).toBe('laundromat');
    expect(kindFor('xyzzy')).toBeNull();
  });

  it('doorReach tells the outside from the inside', () => {
    const d = { x: 0, z: 0, yaw: Math.PI }; // faces −Z
    expect(doorReach(d, 0, -1).front).toBeGreaterThan(0);
    expect(doorReach(d, 0, 1).front).toBeLessThan(0);
  });
});

// ── The real plaza (public/world2/level/collision.glb) ──

function loadCollision(): Promise<THREE.Mesh[]> {
  const file = resolve(__dirname, '../../../../public/world2/level/collision.glb');
  const buf = readFileSync(file);
  // A fresh ArrayBuffer of this realm (GLTFLoader checks `instanceof ArrayBuffer`)
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Promise((ok, fail) =>
    new GLTFLoader().parse(
      ab,
      '',
      g => {
        g.scene.updateMatrixWorld(true);
        const out: THREE.Mesh[] = [];
        g.scene.traverse(o => {
          if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
        });
        ok(out);
      },
      fail,
    ),
  );
}

describe('plaza doors (real collision.glb)', async () => {
  const meshes = await loadCollision();
  const world = new CollisionWorld();
  world.build(meshes.filter(m => m.name !== 'COL_Boundary'));
  const open = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < 93.6;
  const fps = plazaFootprints(meshes);
  const walkable = reachable(fps, 95, { x: 0, z: 30 }, { open });
  const plan = plazaDoorPlan(meshes, { probe: world, open });
  const doors = plan.doors;
  const byKey = new Map<string, BuildingDoor>(doors.map(d => [d.id.slice('plaza:'.length), d]));
  const ids = new Set(doors.map(d => d.id));

  it('finds the ring of buildings', () => {
    expect(fps.length).toBeGreaterThan(35);
    expect(fps.length).toBeLessThan(80);
    expect(plan.footprints.length).toBe(fps.length);
  });

  it('gives every building a door (a corner block hidden behind its neighbours shares theirs)', () => {
    for (const f of fps) {
      const own = byKey.has(f.key);
      const via = plan.absorbed.get(f.key);
      expect(own || (via !== undefined && ids.has(via)), f.key).toBe(true);
    }
    // Only a handful are hidden like that, and none had to be forced
    expect(plan.absorbed.size).toBeLessThanOrEqual(4);
    expect(plan.forced).toEqual([]);
    expect(doors.length + plan.absorbed.size).toBe(fps.length);
  });

  it('a hidden building has no wall on reachable ground', () => {
    for (const key of plan.absorbed.keys()) {
      const f = fps.find(q => q.key === key)!;
      // Around its whole outline, 0.9 m out, nothing is reachable
      let reach = 0;
      for (let t = 0; t <= 1; t += 0.05)
        for (const [x, z] of [
          [f.minX + (f.maxX - f.minX) * t, f.minZ - 0.9],
          [f.minX + (f.maxX - f.minX) * t, f.maxZ + 0.9],
          [f.minX - 0.9, f.minZ + (f.maxZ - f.minZ) * t],
          [f.maxX + 0.9, f.minZ + (f.maxZ - f.minZ) * t],
        ])
          if (walkable(x, z)) reach++;
      expect(reach, key).toBe(0);
    }
  });

  it('doors face the plaza and open onto walkable ground', () => {
    for (const d of doors) {
      // Outward normal points toward the fountain side of the ring
      const nx = Math.sin(d.yaw);
      const nz = Math.cos(d.yaw);
      const toCentre = -(d.x * nx + d.z * nz) / Math.hypot(d.x, d.z);
      expect(toCentre, d.id).toBeGreaterThan(0.5);
      expect(walkable(d.x + nx * 0.9, d.z + nz * 0.9), d.id).toBe(true);
    }
  });

  it('no door is inside a wall: its approach is outside every building', () => {
    for (const d of doors) {
      const nx = Math.sin(d.yaw);
      const nz = Math.cos(d.yaw);
      for (const k of [0.3, 1.0])
        for (const f of fps) expect(inside(f, d.x + nx * k, d.z + nz * k), d.id).toBe(false);
    }
  });

  it('ids are stable across loads', async () => {
    const again = plazaDoors(await loadCollision(), { probe: world, open });
    expect(again.map(d => d.id)).toEqual(doors.map(d => d.id));
    expect(again.map(d => [d.x, d.z, d.kind, d.name])).toEqual(
      doors.map(d => [d.x, d.z, d.kind, d.name]),
    );
  });

  it('a mix of kinds', () => {
    if (process.env.DOORS_DEBUG)
      for (const d of doors)
        console.log(d.id, d.kind, d.name, d.x.toFixed(1), d.z.toFixed(1), d.width.toFixed(2));
    const kinds = new Set(doors.map(d => d.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(6);
  });
});

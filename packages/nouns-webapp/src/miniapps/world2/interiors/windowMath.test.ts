import { describe, expect, it } from 'vitest';

import { parallaxRect, roomDir, wallYaw, windowPose } from './windowMath';

const fwd = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];
const near = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('window views: room walls → the real building', () => {
  it('the door wall looks where the door faces; the back wall the other way', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, -2.1, Math.PI]) {
      near(fwd(wallYaw('s', yaw)), fwd(yaw));
      near(fwd(wallYaw('n', yaw)), fwd(yaw + Math.PI));
    }
  });

  it('room −z (out of the door wall) is the door normal, and walls match roomDir', () => {
    for (const yaw of [0, 1, -2.5, Math.PI / 2]) {
      near(roomDir(0, -1, yaw), fwd(yaw));
      near(roomDir(1, 0, yaw), fwd(wallYaw('e', yaw)));
      near(roomDir(-1, 0, yaw), fwd(wallYaw('w', yaw)));
      near(roomDir(0, 1, yaw), fwd(wallYaw('n', yaw)));
    }
  });

  it('is a rotation, not a mirror: left of the door inside is left of it outside', () => {
    for (const yaw of [0, 0.4, 2, -1.2]) {
      // Facing into the room (room +z), your right is room −x (three.js: forward +z, right −x)
      const into = roomDir(0, 1, yaw);
      const right = roomDir(-1, 0, yaw);
      // Same handedness in the world: right = forward turned by −90° about +y
      near(right, [-into[1], into[0]]);
    }
  });

  const l = { w: 10, d: 8, door: { x: 0, width: 1.2 } } as Parameters<typeof windowPose>[1];

  it('a door-wall window looks out of the street facade, at window height', () => {
    // Door at the origin facing +z (yaw 0); the building lies at −z
    const door = {
      x: 0,
      y: 2,
      z: 0,
      yaw: 0,
      footprint: { minX: -6, maxX: 6, minZ: -12, maxZ: 0, height: 9 },
    };
    const p = windowPose(door, l, { wall: 's', at: 3, y: 1.5 }, 0.4);
    expect(p.y).toBeCloseTo(3.5);
    expect(p.z).toBeCloseTo(0.4); // just outside the facade
    expect(p.yaw).toBeCloseTo(0);
    // At 3 m right of the door in a 10 m room → 80% across the 12 m facade.
    // From outside facing the door, the inside's right is the outside's left (−x):
    expect(p.x).toBeCloseTo(-(-6 + 0.8 * 12));
  });

  it('back and side windows land on the matching real facades', () => {
    const door = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      footprint: { minX: -6, maxX: 6, minZ: -12, maxZ: 0, height: 9 },
    };
    const back = windowPose(door, l, { wall: 'n', at: 0, y: 1.6 }, 0.4);
    expect(back.z).toBeCloseTo(-12.4);
    expect(back.x).toBeCloseTo(0);
    near(fwd(back.yaw), [0, -1]);
    const east = windowPose(door, l, { wall: 'e', at: 4, y: 1.6 }, 0.4);
    // Room +x (east) is world −x for this door; halfway back along the 12 m depth
    expect(east.x).toBeCloseTo(-6.4);
    expect(east.z).toBeCloseTo(-6);
    near(fwd(east.yaw), [-1, 0]);
    const west = windowPose(door, l, { wall: 'w', at: 2, y: 1.6 }, 0.4);
    expect(west.x).toBeCloseTo(6.4);
    expect(west.z).toBeCloseTo(-3);
  });

  it('turned buildings: every window ends up outside the footprint, looking away from it', () => {
    for (const yaw of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      // A 12 × 12 block centred on (20, −30), door on the side `yaw` faces
      const [nx, nz] = fwd(yaw);
      const door = { x: 20 + nx * 6, y: 0, z: -30 + nz * 6, yaw };
      const fp = { minX: 14, maxX: 26, minZ: -36, maxZ: -24, height: 8 };
      for (const wall of ['s', 'n', 'e', 'w'] as const) {
        const p = windowPose(
          { ...door, footprint: fp },
          l,
          { wall, at: wall === 's' || wall === 'n' ? 1 : 4, y: 1.5 },
          0.4,
        );
        const inside = p.x > fp.minX && p.x < fp.maxX && p.z > fp.minZ && p.z < fp.maxZ;
        expect(inside, `${yaw} ${wall}`).toBe(false);
        // Looking away from the block's centre
        const [fx, fz] = fwd(p.yaw);
        expect((p.x - 20) * fx + (p.z + 30) * fz).toBeGreaterThan(0);
      }
    }
  });

  it('no footprint: the room itself stands in for the building', () => {
    const p = windowPose({ x: 5, y: 0, z: 5, yaw: 0 }, l, { wall: 'n', at: 0, y: 1.6 }, 0);
    expect(p.z).toBeCloseTo(5 - 8);
  });
});

describe('window views: parallax', () => {
  it('centred viewer sees the middle; a viewer to one side sees the far side, within bounds', () => {
    parallaxRect(0, 0, 5).forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.1, 0.9, 0.9][i]!));
    const r = parallaxRect(4, 0, 4);
    expect(r[0]).toBeLessThan(0.1);
    expect(r[0]).toBeGreaterThanOrEqual(0);
    const far = parallaxRect(-100, 100, 1);
    for (const v of far) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

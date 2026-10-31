import type { Aabb } from '../mountain/ringOcclusion';

import { describe, expect, it } from 'vitest';

import { portalPlanes, seenFromRoom } from './portal';

// A window in the plane z = 0 from x −3…3, y 0…3; the room is z 0…10
const win = { x0: -3, x1: 3, y0: 0, y1: 3, z: 0 };
const room: Aabb = { minX: -5, maxX: 5, minY: 0, maxY: 3.5, minZ: 0, maxZ: 10 };
const box = (x: number, y: number, z: number, s = 1): Aabb => ({
  minX: x - s,
  maxX: x + s,
  minY: y - s,
  maxY: y + s,
  minZ: z - s,
  maxZ: z + s,
});

describe("CAMP's window portal", () => {
  const cam = [0, 1.6, 4] as const;
  const planes = portalPlanes(...cam, win, 0);

  it('sees what the window frames', () => {
    expect(seenFromRoom(planes, room, box(0, 1.5, -20))).toBe(true);
    // down past the sill (from 4 m back the sill line is at y −24 by z −60)
    expect(seenFromRoom(planes, room, box(0, -20, -60, 5))).toBe(true);
    expect(seenFromRoom(planes, room, box(0, -100, -60, 5))).toBe(false);
    // up past the head (y 20.5 by z −50)
    expect(seenFromRoom(planes, room, box(0, 18, -50, 3))).toBe(true);
    expect(seenFromRoom(planes, room, box(0, 40, -50, 3))).toBe(false);
  });

  it('culls what the walls hide: behind, beside, above and below the window', () => {
    expect(seenFromRoom(planes, room, box(0, 1.5, 40))).toBe(false); // behind the back wall
    expect(seenFromRoom(planes, room, box(60, 1.5, 5))).toBe(false); // off to the side
    expect(seenFromRoom(planes, room, box(40, 1.5, -2))).toBe(false); // outside, but the wall's in the way
    expect(seenFromRoom(planes, room, box(0, 200, 5, 3))).toBe(false); // over the roof
    expect(seenFromRoom(planes, room, box(0, -100, 20, 5))).toBe(false); // under the floor
  });

  it('always sees the room itself (and anyone in it)', () => {
    expect(seenFromRoom(planes, room, box(2, 1, 8, 0.4))).toBe(true);
  });

  it('a big box that crosses the view is kept (conservative)', () => {
    expect(
      seenFromRoom(planes, room, {
        minX: -500,
        maxX: 500,
        minY: -10,
        maxY: 10,
        minZ: -500,
        maxZ: -400,
      }),
    ).toBe(true);
  });

  it('the margin only ever keeps more', () => {
    const loose = portalPlanes(...cam, win, 0.5);
    for (let x = -60; x <= 60; x += 6)
      for (let y = -120; y <= 60; y += 15)
        for (let z = -80; z <= 30; z += 11)
          if (seenFromRoom(planes, room, box(x, y, z)))
            expect(seenFromRoom(loose, room, box(x, y, z))).toBe(true);
  });
});

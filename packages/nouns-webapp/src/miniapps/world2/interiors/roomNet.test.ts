import { describe, expect, it } from 'vitest';

import { decodeRoom, encodeRoom, type RoomKey, sameSpace, seatSpot } from './roomNet';

const cafe0: RoomKey = { door: 'plaza:cafe-2', level: 0, seat: -1 };

describe('room wire key', () => {
  it('round-trips', () => {
    const k: RoomKey = { door: 'town:north#12', level: 2, seat: 3 };
    expect(decodeRoom(JSON.parse(JSON.stringify(encodeRoom(k))))).toEqual(k);
    expect(decodeRoom(encodeRoom(cafe0))).toEqual(cafe0);
    // real door ids (interiors/doors.ts, townDoors.ts)
    for (const door of ['plaza:-31.4,-85', 'plaza:-31.4,-85#2', 'jersey:b12', 'n1:12.5,-3#roof'])
      expect(decodeRoom([door, 0, -1])?.door).toBe(door);
  });

  it('reads no key, or a malformed one, as the street', () => {
    for (const v of [
      undefined,
      null,
      'cafe',
      [],
      ['cafe'],
      [42, 0, -1],
      ['', 0, -1],
      ['x'.repeat(97), 0, -1],
      ['<img onerror=1>', 0, -1],
      ['cafe', -1, -1],
      ['cafe', 1.5, -1],
      ['cafe', 99, -1],
      ['cafe', '0', -1],
    ])
      expect(decodeRoom(v)).toBeNull();
  });

  it('reads a bad seat as standing, and an old two-slot key too', () => {
    expect(decodeRoom(['cafe', 0, 'x'])?.seat).toBe(-1);
    expect(decodeRoom(['cafe', 0, 1.5])?.seat).toBe(-1);
    expect(decodeRoom(['cafe', 0, 9999])?.seat).toBe(-1);
    expect(decodeRoom(['cafe', 1])).toEqual({ door: 'cafe', level: 1, seat: -1 });
  });
});

describe('who is drawn where', () => {
  it('in the street: only riders in the street', () => {
    expect(sameSpace(null, null)).toBe(true);
    expect(sameSpace(null, cafe0)).toBe(false);
  });

  it('inside: only riders in the same room, on the same floor', () => {
    expect(sameSpace(cafe0, null)).toBe(false);
    expect(sameSpace(cafe0, { ...cafe0 })).toBe(true);
    // sitting doesn't matter
    expect(sameSpace(cafe0, { ...cafe0, seat: 4 })).toBe(true);
    expect(sameSpace(cafe0, { ...cafe0, level: 1 })).toBe(false);
    expect(sameSpace(cafe0, { ...cafe0, door: 'plaza:bar-1' })).toBe(false);
  });
});

describe('seated spot', () => {
  it('sits a touch back from the seat, facing its way', () => {
    const at = seatSpot({ x: 2, z: -1, yaw: 0 });
    expect(at.x).toBeCloseTo(2);
    expect(at.z).toBeCloseTo(-1.08);
    expect(at.yaw).toBe(0);
    const side = seatSpot({ x: 0, z: 0, yaw: Math.PI / 2 });
    expect(side.x).toBeCloseTo(-0.08);
    expect(side.z).toBeCloseTo(0);
  });
});

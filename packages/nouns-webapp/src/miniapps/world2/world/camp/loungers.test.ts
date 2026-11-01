import { describe, expect, it } from 'vitest';

import { campLayout, solidBox } from './layout';
import {
  boredPose,
  coinPose,
  LOUNGERS,
  loungerSpots,
  onPiece,
  SIGH_EVERY,
  sofaY,
} from './loungers';
import { campSite, campTier } from './site';

// The real room, as layout.test.ts builds it: the tower on the 13.6 m roof
function layoutForTest() {
  const { tier, top } = campTier(13.6);
  const site = campSite(tier, top);
  return campLayout(
    site.w,
    site.d,
    site.h,
    site.window.x0 - site.origin.x,
    site.window.x1 - site.origin.x,
  );
}

describe('CAMP loungers', () => {
  const l = layoutForTest();

  it('sits COIN HEAD on the sofa and MICROWAVE HEAD on the kitchen counter, facing out', () => {
    const spots = loungerSpots(l);
    expect(spots.map(s => s.id)).toEqual(['coin', 'microwave']);
    const sofa = l.pieces.find(q => q.type === 'sofa')!;
    const kitchen = l.pieces.find(q => q.type === 'kitchen')!;
    for (const [s, q] of [
      [spots[0]!, sofa],
      [spots[1]!, kitchen],
    ] as const) {
      const b = solidBox(q);
      expect(s.x).toBeGreaterThan(b.minX);
      expect(s.x).toBeLessThan(b.maxX);
      expect(s.z).toBeGreaterThan(b.minZ);
      expect(s.z).toBeLessThan(b.maxZ);
      expect(s.yaw).toBe(q.yaw);
    }
    expect(spots[0]!.seatY).toBeGreaterThan(0.4);
    expect(spots[0]!.seatY).toBeLessThan(0.5);
    expect(spots[1]!.seatY).toBeCloseTo(kitchen.h + 0.02);
  });

  it('faces them into the room (toward the window, z = 0)', () => {
    for (const s of loungerSpots(l)) expect(Math.cos(s.yaw)).toBeLessThan(-0.9);
  });

  it('stacks the cash on the sofa, on the arm side, at the sofa top', () => {
    const sofa = l.pieces.find(q => q.type === 'sofa')!;
    const cash = l.pieces.filter(q => q.type === 'cash');
    expect(cash.length).toBeGreaterThanOrEqual(3);
    const b = solidBox(sofa);
    for (const c of cash) {
      expect(c.x).toBeGreaterThan(b.minX - 0.05);
      expect(c.x).toBeLessThan(b.maxX + 0.05);
      expect(c.z).toBeGreaterThan(b.minZ - 0.05);
      expect(c.z).toBeLessThan(b.maxZ + 0.05);
      expect(c.solid).toBe(false);
      expect(c.y).toBeGreaterThan(0.35);
      expect(c.y).toBeLessThan(0.65);
    }
    // The arm is higher than the cushion, and the sag drops the left end
    expect(sofaY(-1.05, true)).toBeGreaterThan(sofaY(-0.9, false));
    expect(sofaY(-1, false)).toBeLessThan(sofaY(1, false));
  });

  it('maps a piece frame point like the build does (yaw about +Y)', () => {
    const q = { ...l.pieces[0]!, x: 1, z: 2, yaw: Math.PI / 2 };
    const p = onPiece(q, 0, 1);
    expect(p.x).toBeCloseTo(2);
    expect(p.z).toBeCloseTo(2);
  });

  it('looks traits up by their art filenames', () => {
    const coin = LOUNGERS.find(x => x.id === 'coin')!;
    const mw = LOUNGERS.find(x => x.id === 'microwave')!;
    expect(coin.head).toBe('head-goldcoin');
    expect(mw.head).toBe('head-microwave');
    for (const d of LOUNGERS) expect(d.lines.length).toBeGreaterThan(1);
  });

  it('counts steadily, pausing now and then to lick a thumb', () => {
    let licks = 0;
    let notes = 0;
    let prev: number | null = null;
    for (let t = 0; t < 30; t += 1 / 60) {
      const c = coinPose(t);
      if (c.lick) licks++;
      if (c.note !== null && prev === null) notes++;
      prev = c.note;
      for (const v of [c.headDown, c.holdUpper, c.holdFore, c.flickUpper, c.flickFore])
        expect(Number.isFinite(v)).toBe(true);
    }
    expect(licks).toBeGreaterThan(0);
    expect(notes).toBeGreaterThan(40);
  });

  it('keeps MICROWAVE HEAD bored: legs swinging out of step, a sigh every so often', () => {
    let sighs = 0;
    let wasSigh = false;
    for (let t = 0; t < SIGH_EVERY * 3; t += 1 / 30) {
      const m = boredPose(t);
      expect(Math.abs(m.shinL)).toBeLessThan(0.5);
      expect(Math.abs(m.headYaw)).toBeLessThan(1);
      const sigh = m.slump > 0.15;
      if (sigh && !wasSigh) sighs++;
      wasSigh = sigh;
    }
    expect(sighs).toBe(3);
    expect(boredPose(1).shinL).not.toBeCloseTo(boredPose(1).shinR);
  });
});

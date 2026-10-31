import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../../interiors/rng';

import { BOOK_AT, BOOK_TILT, readingPlan, readingShot, SPREADS, tossAt } from './reading';

describe('the rider reading MEME VALUE', () => {
  it('ten different real spreads, new ones every load', () => {
    const a = readingPlan(mulberry32(1));
    const b = readingPlan(mulberry32(2));
    expect(a.spreads).toHaveLength(SPREADS);
    expect(new Set(a.spreads).size).toBe(SPREADS);
    for (const p of a.spreads) {
      expect(p % 2).toBe(0); // a spread opens on an even left page
      expect(p).toBeGreaterThanOrEqual(4);
      expect(p + 1).toBeLessThanOrEqual(252);
    }
    expect(a.spreads).not.toEqual(b.spreads);
  });

  it('turns a page per spread, then tosses, lands and hands back to play', () => {
    const p = readingPlan(mulberry32(3));
    expect(p.flips).toHaveLength(SPREADS - 1);
    for (let i = 1; i < p.flips.length; i++) expect(p.flips[i]!).toBeGreaterThan(p.flips[i - 1]!);
    expect(p.tossAt).toBeGreaterThan(p.flips[p.flips.length - 1]!);
    expect(p.landAt).toBeGreaterThan(p.tossAt);
    // The pull back out starts as it's thrown and is still going when it lands (the reveal)
    expect(p.pullAt).toBeGreaterThan(p.tossAt);
    expect(p.pullAt).toBeLessThan(p.landAt);
    expect(p.endAt).toBeGreaterThan(p.landAt + 0.5);
    // About 9 s from the first spread to play: a beat, not a cutscene
    expect(p.endAt).toBeLessThan(10);
  });

  it('first person: from the eyes, down onto the pages, which face the reader', () => {
    const s = readingShot([0, 0, 0], 0);
    expect(s.book).toEqual(BOOK_AT);
    // looking down and forward at the book from above it
    expect(s.cam[1] - s.look[1]).toBeGreaterThan(0.35);
    expect(s.look[2]).toBeGreaterThan(s.cam[2]);
    expect(Math.abs(s.cam[0])).toBeLessThan(0.01);
    // within ~0.7 m: the spread (0.5 m wide) fills the middle of the frame
    expect(Math.hypot(s.look[1] - s.cam[1], s.look[2] - s.cam[2])).toBeLessThan(0.7);
    // the page normal (tilted back toward the rider) points at the eyes, within ~25°
    const n = [0, Math.cos(BOOK_TILT), -Math.sin(BOOK_TILT)];
    const d = [s.cam[0] - BOOK_AT[0], s.cam[1] - BOOK_AT[1], s.cam[2] - BOOK_AT[2]];
    const cos = (n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!) / Math.hypot(...d);
    expect(cos).toBeGreaterThan(Math.cos((25 * Math.PI) / 180));
  });

  it('turns with the rider (any facing)', () => {
    const a = readingShot([0, 0, 0], 0);
    const b = readingShot([0, 0, 0], Math.PI / 2);
    // Rotated a quarter turn about y: (x, z) → (z, −x)
    expect(b.cam[0]).toBeCloseTo(a.cam[2], 6);
    expect(b.cam[2]).toBeCloseTo(-a.cam[0], 6);
    expect(b.cam[1]).toBeCloseTo(a.cam[1], 6);
  });

  it('the toss lands on the floor out to the right and in front, and stays', () => {
    for (const from of [BOOK_AT, [0, 0.9, 1.2] as [number, number, number]]) {
      const end = tossAt(5, from);
      expect(end.landed).toBe(true);
      expect(end.at[1]).toBeCloseTo(0.02, 3);
      expect(end.at[0]).toBeLessThan(-0.6); // the rider's right
      expect(end.at[2]).toBeGreaterThan(from[2]); // in front
      expect(Math.hypot(end.at[0], end.at[2] - from[2])).toBeLessThan(2.6);
      expect(tossAt(0.1, from).at[1]).toBeGreaterThan(from[1]); // up first
      expect(tossAt(9, from)).toEqual(end);
    }
  });
});

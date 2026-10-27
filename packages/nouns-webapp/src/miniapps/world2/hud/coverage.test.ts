import { describe, expect, it } from 'vitest';

import { clip, coverage, playZone, unionArea } from './coverage';

describe('unionArea', () => {
  it('is 0 for nothing', () => {
    expect(unionArea([])).toBe(0);
    expect(unionArea([{ x: 0, y: 0, w: 0, h: 10 }])).toBe(0);
  });
  it('adds disjoint rects', () => {
    expect(
      unionArea([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 20, w: 5, h: 4 },
      ]),
    ).toBe(120);
  });
  it('counts overlaps once', () => {
    expect(
      unionArea([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 5, y: 5, w: 10, h: 10 },
      ]),
    ).toBe(175);
    // fully nested
    expect(
      unionArea([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 2, y: 2, w: 3, h: 3 },
      ]),
    ).toBe(100);
  });
  it('handles touching and stacked spans in one strip', () => {
    expect(
      unionArea([
        { x: 0, y: 0, w: 10, h: 5 },
        { x: 0, y: 5, w: 10, h: 5 },
        { x: 0, y: 20, w: 10, h: 1 },
      ]),
    ).toBe(110);
  });
});

describe('clip', () => {
  it('clips and drops', () => {
    expect(clip({ x: -5, y: -5, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual({
      x: 0,
      y: 0,
      w: 5,
      h: 5,
    });
    expect(clip({ x: 200, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toBeNull();
  });
});

describe('coverage', () => {
  it('measures the play zone separately from the screen', () => {
    const z = playZone(400, 800);
    expect(z.x).toBeCloseTo(60);
    expect(z.y).toBeCloseTo(120);
    expect(z.w).toBeCloseTo(280);
    expect(z.h).toBeCloseTo(560);
    // A corner block: on screen, not in the zone
    const c = coverage([{ x: 0, y: 0, w: 40, h: 40 }], 400, 800);
    expect(c.screen).toBeCloseTo(1600 / 320000);
    expect(c.zone).toBe(0);
    // A centred block half the zone's width
    const m = coverage([{ x: 130, y: 120, w: 140, h: 560 }], 400, 800);
    expect(m.zone).toBeCloseTo(0.5);
  });
  it('ignores what is off screen', () => {
    expect(coverage([{ x: -100, y: 0, w: 50, h: 50 }], 100, 100).px).toBe(0);
  });
});

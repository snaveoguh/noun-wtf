import { describe, expect, it } from 'vitest';

import { fitScreen, muralScreen, sameRect, scanEdge } from './billboardFit';

// The plaza's mural: 14 × 8.68 m from y 3.8, on a 16.5 m wide, 14.5 m tall wall
const MURAL = { u: 0, width: 14, bottom: 3.8, top: 12.48 };
const WALL = { top: 14.5, left: -8.24, right: 8.24 };
const OPTS = { border: 0.38, margin: 0.35 };
const TOP_LIMIT = WALL.top - OPTS.border - OPTS.margin;

describe('fitScreen', () => {
  it('keeps the clip aspect', () => {
    for (const a of [0.5625, 0.8, 1, 4 / 3, 16 / 9, 2.4]) {
      const r = fitScreen(MURAL, a, WALL, OPTS);
      expect(r.width / r.height).toBeCloseTo(a, 6);
    }
  });

  it('a square clip grows taller than the mural, up to the roofline', () => {
    const r = fitScreen(MURAL, 1, WALL, OPTS);
    expect(r.height).toBeGreaterThan(MURAL.top - MURAL.bottom);
    expect(r.bottom + r.height).toBeCloseTo(TOP_LIMIT, 6);
    expect(r.bottom).toBe(MURAL.bottom);
    expect(r.width).toBeLessThan(MURAL.width);
  });

  it('a portrait clip is height-limited and narrow', () => {
    const r = fitScreen(MURAL, 9 / 16, WALL, OPTS);
    expect(r.bottom + r.height).toBeCloseTo(TOP_LIMIT, 6);
    expect(r.width).toBeCloseTo((TOP_LIMIT - MURAL.bottom) * (9 / 16), 6);
  });

  it('a wide clip takes the mural width and its own height', () => {
    const r = fitScreen(MURAL, 2.4, WALL, OPTS);
    expect(r.width).toBeCloseTo(14, 6);
    expect(r.height).toBeCloseTo(14 / 2.4, 6);
    expect(r.bottom).toBe(MURAL.bottom);
  });

  it('never runs past the wall: frame + margin stay inside its top and ends', () => {
    for (let a = 0.2; a < 6; a += 0.1) {
      const r = fitScreen(MURAL, a, WALL, OPTS);
      const pad = OPTS.border + OPTS.margin;
      expect(r.bottom + r.height + pad).toBeLessThanOrEqual(WALL.top + 1e-9);
      expect(r.u - r.width / 2 - pad).toBeGreaterThanOrEqual(WALL.left - 1e-9);
      expect(r.u + r.width / 2 + pad).toBeLessThanOrEqual(WALL.right + 1e-9);
      expect(r.width).toBeLessThanOrEqual(MURAL.width + 1e-9);
    }
  });

  it('a narrow wall narrows the screen and keeps it centred on the wall', () => {
    const wall = { top: 30, left: -5, right: 9 };
    const r = fitScreen(MURAL, 2, wall, OPTS);
    const pad = OPTS.border + OPTS.margin;
    expect(r.width).toBeCloseTo(14 - 2 * pad, 6);
    expect(r.u).toBeCloseTo(2, 6);
  });

  it('with no wall measured it stays inside the mural rectangle', () => {
    const r = fitScreen(MURAL, 1, null, OPTS);
    expect(r.bottom + r.height).toBeCloseTo(MURAL.top, 6);
    expect(r.width).toBeCloseTo(MURAL.top - MURAL.bottom, 6);
  });

  it('nonsense aspects fall back to the mural', () => {
    for (const a of [0, -1, NaN, Infinity, 100])
      expect(fitScreen(MURAL, a, WALL, OPTS)).toEqual(muralScreen(MURAL));
  });
});

describe('sameRect', () => {
  it('ignores sub-centimetre changes', () => {
    const a = fitScreen(MURAL, 1, WALL, OPTS);
    expect(sameRect(null, a)).toBe(false);
    expect(sameRect(a, { ...a, width: a.width + 0.005 })).toBe(true);
    expect(sameRect(a, { ...a, width: a.width + 0.05 })).toBe(false);
  });
});

describe('scanEdge', () => {
  it('finds an edge to ~1 cm going up and down', () => {
    expect(scanEdge(y => y <= 14.5, 12, 0.25, 40)).toBeCloseTo(14.5, 1);
    expect(scanEdge(u => u >= -8.24, 0, -0.25, -40)).toBeCloseTo(-8.24, 1);
  });
  it('stops at the limit when the wall never ends', () => {
    expect(scanEdge(() => true, 0, 0.5, 10)).toBe(10);
  });
});

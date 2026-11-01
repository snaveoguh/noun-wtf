import { describe, expect, it } from 'vitest';

import { gaussian, parseRgb, POSTER_STEP, softenAtlas } from './softenAtlas';

/** A w×h RGBA atlas with one opaque colour block (x0..x1, y0..y1 inclusive). */
function block(w: number, h: number, rgb: [number, number, number], x0: number, y0: number, x1: number, y1: number) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const o = (y * w + x) * 4;
      a.set([...rgb, 255], o);
    }
  return a;
}

const px = (a: Uint8ClampedArray, W: number, x: number, y: number) =>
  Array.from(a.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));

describe('softenAtlas', () => {
  it('upscales by `up`', () => {
    const out = softenAtlas(block(72, 32, [200, 40, 40], 0, 0, 31, 31), 72, 32, 8, 0.8, true);
    expect(out.length).toBe(72 * 8 * 32 * 8 * 4);
  });

  it('crisp art is a nearest-neighbour copy (posterised)', () => {
    const src = block(4, 2, [120, 60, 240], 1, 0, 1, 0);
    const out = softenAtlas(src, 4, 2, 2, 0, false);
    expect(px(out, 8, 2, 0)).toEqual([120, 60, 240, 255]);
    expect(px(out, 8, 3, 1)).toEqual([120, 60, 240, 255]);
    expect(px(out, 8, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(px(out, 8, 4, 0)).toEqual([0, 0, 0, 0]);
  });

  it('keeps a flat region its own colour (no darkening from transparent neighbours)', () => {
    const out = softenAtlas(block(16, 16, [96, 180, 36], 2, 2, 13, 13), 16, 16, 8, 1.6, true);
    const W = 128;
    // The middle, and right at the edge of the art (alpha < 1 but colour unchanged)
    expect(px(out, W, 64, 64)).toEqual([96, 180, 36, 255]);
    const edge = px(out, W, 2 * 8 - 2, 64);
    expect(edge[3]).toBeGreaterThan(0);
    expect(edge[3]).toBeLessThan(255);
    expect(edge.slice(0, 3)).toEqual([96, 180, 36]);
    // Far outside stays fully transparent
    expect(px(out, W, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('posterises colour to steps of 12 and blends across a colour edge', () => {
    const src = block(8, 4, [250, 0, 0], 0, 0, 3, 3);
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) src.set([0, 0, 250, 255], (y * 8 + x) * 4);
    const out = softenAtlas(src, 8, 4, 8, 1.6, true);
    const W = 64;
    for (let i = 0; i < out.length; i += 4)
      for (let k = 0; k < 3; k++) expect(out[i + k] % POSTER_STEP).toBe(0);
    const mid = px(out, W, 32, 16);
    expect(mid[0]).toBeGreaterThan(60);
    expect(mid[2]).toBeGreaterThan(60);
    expect(px(out, W, 4, 16)[0]).toBe(252);
  });

  it('is quick: a full head atlas in a few ms', () => {
    const src = block(72, 32, [180, 120, 60], 4, 4, 66, 28);
    softenAtlas(src, 72, 32, 8, 0.8, true); // warm the JIT
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) softenAtlas(src, 72, 32, 8, 0.8, true);
    // The canvas blur + readback it replaces was ~40 ms a head in Chrome
    expect((performance.now() - t0) / 5).toBeLessThan(40);
  });
});

describe('gaussian', () => {
  it('is normalised and symmetric, radius ⌈3σ⌉', () => {
    const k = gaussian(0.8);
    expect(k.length).toBe(7);
    expect(k.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
    expect(k[0]).toBeCloseTo(k[6], 6);
  });
});

describe('parseRgb', () => {
  it('reads the atlas colour strings', () => {
    expect(parseRgb('rgb(1,22,255)')).toEqual([1, 22, 255]);
    expect(parseRgb('#fff')).toBeNull();
  });
});

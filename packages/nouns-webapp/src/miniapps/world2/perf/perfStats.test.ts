import { describe, expect, it } from 'vitest';

import { percentile, Ring, summarize, summarizeBuckets } from './perfStats';

describe('Ring', () => {
  it('keeps the last `size` samples, oldest first', () => {
    const r = new Ring(3);
    for (const v of [1, 2, 3, 4, 5]) r.push(v);
    expect(r.length).toBe(3);
    expect(r.values()).toEqual([3, 4, 5]);
    r.clear();
    expect(r.values()).toEqual([]);
  });
});

describe('percentile', () => {
  it('is nearest-rank', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(5);
    expect(percentile(s, 95)).toBe(10);
    expect(percentile(s, 0)).toBe(1);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports fps from summed frame time and counts hitches over 50 ms', () => {
    const s = summarize([16, 16, 16, 16, 100]);
    expect(s.frames).toBe(5);
    expect(s.fps).toBeCloseTo((5 * 1000) / 164, 5);
    expect(s.p50).toBe(16);
    expect(s.max).toBe(100);
    expect(s.hitches).toBe(1);
  });

  it('is all zeros when empty', () => {
    expect(summarize([])).toMatchObject({ frames: 0, fps: 0, p95: 0, max: 0 });
  });
});

describe('summarizeBuckets', () => {
  it('ranks systems by mean ms', () => {
    const a = new Ring(4);
    const b = new Ring(4);
    for (const v of [1, 1, 1, 1]) a.push(v);
    for (const v of [0, 4, 0, 4]) b.push(v);
    const out = summarizeBuckets(
      new Map([
        ['a', a],
        ['b', b],
      ]),
    );
    expect(out.map(x => x.name)).toEqual(['b', 'a']);
    expect(out[0].mean).toBe(2);
    expect(out[0].max).toBe(4);
  });
});

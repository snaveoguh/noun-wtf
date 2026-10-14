import { describe, expect, it } from 'vitest';

import { softPasses } from './Graffiti';

const core = (passes: [number, number][]) => 1 - passes.reduce((a, [, x]) => a * (1 - x), 1);

describe('soft cap passes', () => {
  it('keeps the original 4 passes for thin lines', () => {
    expect(softPasses(3)).toEqual([
      [1, 0.2],
      [0.8, 0.26],
      [0.58, 0.34],
      [0.36, 0.5],
    ]);
  });

  it('fat lines get finer steps with the same core density', () => {
    const want = core(softPasses(3));
    for (const w of [30, 60, 120, 400]) {
      const p = softPasses(w);
      expect(p.length).toBeGreaterThan(4);
      expect(p.length).toBeLessThanOrEqual(12);
      expect(core(p)).toBeCloseTo(want, 3);
      // widths narrow from the full nozzle to the core, softest at the edge
      for (let i = 1; i < p.length; i++) {
        expect(p[i][0]).toBeLessThan(p[i - 1][0]);
        expect(p[i][1]).toBeGreaterThan(p[i - 1][1]);
      }
      expect(p[0][1]).toBeLessThan(0.2);
    }
  });
});

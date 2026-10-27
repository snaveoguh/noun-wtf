import { describe, expect, it } from 'vitest';

import { inCheckpoint } from '../sim/route';

import { ROUTES, routeById } from './routes';

describe('NOUN PARKOUR routes', () => {
  it('ids are unique and look up', () => {
    const ids = ROUTES.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROUTES) expect(routeById(r.id)).toBe(r);
    expect(routeById('nope')).toBeUndefined();
  });

  it('every route is well formed', () => {
    for (const r of ROUTES) {
      expect(r.checkpoints.length, r.id).toBeGreaterThanOrEqual(3);
      expect(r.medals.gold, r.id).toBeLessThan(r.medals.silver);
      expect(r.medals.silver, r.id).toBeLessThan(r.medals.bronze);
      // The start isn't already inside the first gate, and gates don't overlap
      const s = r.start;
      expect(inCheckpoint(r.checkpoints[0], s.x, s.y, s.z), r.id).toBe(false);
      for (let i = 1; i < r.checkpoints.length; i++) {
        const a = r.checkpoints[i - 1];
        const b = r.checkpoints[i];
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), `${r.id} ${i}`).toBeGreaterThan(
          a.r + b.r,
        );
      }
      for (const c of r.checkpoints) expect(c.r).toBeGreaterThan(0.5);
      for (const p of r.props) {
        if (p.k === 'box') expect(Math.min(p.sx, p.sy, p.sz), r.id).toBeGreaterThan(0.05);
        else expect(p.y1, r.id).toBeGreaterThan(p.y0 + 2);
      }
      expect(r.color).toMatch(/^#[\da-f]{6}$/i);
    }
  });
});

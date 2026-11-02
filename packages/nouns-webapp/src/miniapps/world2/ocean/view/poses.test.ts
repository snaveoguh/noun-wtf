import { describe, expect, it } from 'vitest';

import { isMix } from '../../breakdance/view/pose';
import { WIRE_PHASES } from '../net/sf';

import { surfPose } from './poses';

describe('surf poses', () => {
  it('has a pose for every phase in the sea (the walk clip while wading)', () => {
    for (const phase of WIRE_PHASES) {
      const p = surfPose(
        { phase, board: 'foamie', lean: 0.3, crouch: 0.5, stroke: 1, sit: 0, t: 0.2 },
        1,
      );
      if (phase === 'off' || phase === 'wade') expect(p).toBeNull();
      else expect(p).not.toBeNull();
    }
  });

  it('blends prone → stance through the pop', () => {
    const at = (t: number) =>
      surfPose({ phase: 'pop', board: 'shortboard', lean: 0, crouch: 0, stroke: 0, sit: 0, t }, 0)!;
    const a = at(0);
    const b = at(10);
    expect(isMix(a) && isMix(b)).toBe(true);
    if (isMix(a) && isMix(b)) {
      expect(a.k).toBeLessThan(0.05);
      expect(b.k).toBeGreaterThan(0.95);
    }
  });

  it('every number is finite (nothing NaN reaches the rig)', () => {
    for (const phase of WIRE_PHASES) {
      for (const t of [0, 0.5, 3]) {
        const p = surfPose({ phase, board: null, lean: -1, crouch: 1, stroke: 5, sit: 0.5, t }, t);
        if (p === null) continue;
        const specs = isMix(p) ? [p.a, p.b] : [p];
        for (const s of specs) {
          expect(Number.isFinite(s.hips.x + s.hips.y + s.hips.z)).toBe(true);
          expect(Number.isFinite(s.pelvis.x + s.pelvis.y + s.pelvis.z + s.pelvis.w)).toBe(true);
        }
      }
    }
  });
});

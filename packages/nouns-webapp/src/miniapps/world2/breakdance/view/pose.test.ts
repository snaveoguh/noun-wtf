import { describe, expect, it } from 'vitest';

import { MOVE_IDS, VIEW_MOVES } from './moves';
import {
  bounce,
  crashPose,
  isMix,
  mirrorSpec,
  movePose,
  revs,
  specNumbers,
  stepOut,
  turnSpec,
  vibePose,
  type PoseSpec,
} from './pose';

describe('pose specs', () => {
  it('every move stays finite across (and past) its length, mirrored or not', () => {
    for (const id of MOVE_IDS) {
      const n = VIEW_MOVES[id].beats;
      for (let b = -0.5; b <= n * 2.5; b += 0.173)
        for (const m of [false, true]) {
          const nums = specNumbers(movePose(id, b, n, m));
          expect(nums.every(Number.isFinite), `${id} @${b.toFixed(2)}`).toBe(true);
        }
    }
    expect(specNumbers(crashPose(0, 0.3)).every(Number.isFinite)).toBe(true);
    expect(specNumbers(vibePose(1.3)).every(Number.isFinite)).toBe(true);
  });

  it('unknown ids fall back to something sensible', () => {
    expect(specNumbers(movePose('moonwalk_3000', 1, 4)).every(Number.isFinite)).toBe(true);
  });

  it('power moves turn a whole number of times per move (repeats loop without a pop)', () => {
    for (const id of [
      'windmill',
      'flare',
      'headspin',
      'backspin',
      'swipe',
      'turtle',
      'airflare',
    ] as const) {
      for (const n of [2, 3, 4, 6]) {
        const a = movePose(id, 0, n) as PoseSpec;
        const b = movePose(id, n, n) as PoseSpec;
        expect(isMix(a)).toBe(false);
        // Same orientation (q and −q are the same rotation)
        expect(Math.abs(a.pelvis.dot(b.pelvis)), `${id} n=${n}`).toBeGreaterThan(0.999);
        expect(a.hips.distanceTo(b.hips), `${id} n=${n}`).toBeLessThan(1e-6);
      }
    }
    expect(Number.isInteger(revs(4, 4, 1))).toBe(true);
    expect(revs(4, 4, 1.5)).toBe(6);
    expect(revs(0.5, 4, 1)).toBeCloseTo(0.5);
  });

  it('toprock steps on the beat: a foot is out on its beat and home on the "and"', () => {
    expect(stepOut(0, 1)).toBeCloseTo(1); // right foot, beat 0
    expect(stepOut(0.5, 1)).toBeCloseTo(0); // home by the "and"
    expect(stepOut(1, 0)).toBeCloseTo(1); // left foot, beat 1
    expect(stepOut(1, 1)).toBeCloseTo(0);
    expect(stepOut(2, 1)).toBeCloseTo(1);
    expect(bounce(0)).toBeCloseTo(1);
    expect(bounce(0.5)).toBeCloseTo(0);
    for (let b = 0; b < 4; b += 0.01) {
      // Continuous: no jumps between frames
      expect(Math.abs(stepOut(b + 0.01, 1) - stepOut(b, 1))).toBeLessThan(0.08);
    }
  });

  it('mirroring twice is the identity', () => {
    const s = movePose('chair_freeze', 0.4, 2) as PoseSpec;
    const back = mirrorSpec(mirrorSpec(s));
    expect(specNumbers(back)).toEqual(specNumbers(s));
    const m = mirrorSpec(s);
    expect(m.hips.x).toBeCloseTo(-s.hips.x);
  });

  it('turning a spec turns the hips round the vertical', () => {
    const s = movePose('flare', 0.2, 4) as PoseSpec;
    const t = turnSpec(s, Math.PI);
    expect(t.hips.x).toBeCloseTo(-s.hips.x);
    expect(t.hips.z).toBeCloseTo(-s.hips.z);
    expect(t.hips.y).toBeCloseTo(s.hips.y);
  });

  it('transitions blend between two shapes over the move', () => {
    for (const id of ['drop', 'spin_down', 'get_up'] as const) {
      const a = movePose(id, 0, 2);
      const z = movePose(id, 2, 2);
      expect(isMix(a) && isMix(z)).toBe(true);
      if (isMix(a) && isMix(z)) expect(z.k).toBeGreaterThan(a.k);
    }
  });
});

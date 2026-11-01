import { describe, expect, it } from 'vitest';

import { decodeSk, encodeSk, NO_SKY } from './sk';

describe('the sk pose key', () => {
  it('round-trips', () => {
    for (const a of [
      { phase: 'freefall', posture: 'dive', open: 0, steer: -0.5 },
      { phase: 'canopy', posture: 'belly', open: 0.42, steer: 1 },
      { phase: 'freefall', posture: 'track', open: 0, steer: 0 },
    ] as const)
      expect(decodeSk(encodeSk(a))).toEqual(a);
  });
  it('sends nothing when off', () => expect(encodeSk(NO_SKY)).toBe(null));
  it('rejects junk', () => {
    for (const v of [undefined, null, 3, 'x', [], [0, 0, 0, 0], [1, 'a', 0, 0], [9, 0, 0, 0]])
      expect(decodeSk(v)).toBe(null);
    expect(decodeSk([2, 99, 7, -4])).toEqual({
      phase: 'canopy',
      posture: 'track',
      open: 1,
      steer: -1,
    });
  });
});

import { ImageData } from '@noundry/nouns-assets';
import { describe, expect, it } from 'vitest';

import { stepHead } from '../ui/CharacterSelect';

import { glitchAt } from './missingNoun';
import { parseSeedKey, seedKey, type NounSeed } from './NounAppearance';

const SEED: NounSeed = { background: 1, body: 7, accessory: 11, head: 40, glasses: 3 };
const N = ImageData.images.heads.length;

describe('missingnoun rider', () => {
  it('rides the seed key as a trailing -m (and plain seeds are unchanged)', () => {
    expect(seedKey(SEED)).toBe('1-7-11-40-3');
    const mn = { ...SEED, missingnoun: true };
    expect(seedKey(mn)).toBe('1-7-11-40-3-m');
    expect(parseSeedKey('1-7-11-40-3-m')).toEqual(mn);
    expect(parseSeedKey('1-7-11-40-3')).toEqual(SEED);
    expect(parseSeedKey('1-7-11-40-3')?.missingnoun).toBeUndefined();
    // Anything else in the sixth place is junk
    expect(parseSeedKey('1-7-11-40-3-x')).toBeNull();
    expect(parseSeedKey('1-7-11-40-m')).toBeNull();
  });

  it('is the head stop after the last head, and steps back out either way', () => {
    const last = { ...SEED, head: N - 1 };
    const mn = stepHead(last, 1);
    expect(mn.missingnoun).toBe(true);
    // the real head stays a valid V1 head (older clients draw that)
    expect(mn.head).toBe(N - 1);
    expect(stepHead(mn, 1)).toEqual({ ...SEED, head: 0 });
    expect(stepHead(mn, -1)).toEqual({ ...SEED, head: N - 1 });
    expect(stepHead({ ...SEED, head: 0 }, -1).missingnoun).toBe(true);
    expect(stepHead(SEED, 1)).toEqual({ ...SEED, head: 41 });
  });

  it('glitches in bursts: mostly still, splits and slices now and then, never wild', () => {
    let bursts = 0;
    let still = 0;
    for (let i = 0; i < 2000; i++) {
      const g = glitchAt(i / 60, 7);
      expect(Math.abs(g.dx)).toBeLessThanOrEqual(0.09);
      expect(g.sy).toBeGreaterThan(0.85);
      expect(g.sy).toBeLessThanOrEqual(1);
      if (g.slice !== null) expect(Math.abs(g.slice.dx)).toBeLessThanOrEqual(0.18);
      if (g.split > 0 || g.slice !== null) bursts++;
      if (g.dx === 0 && g.split === 0 && g.slice === null && g.sy === 1) still++;
    }
    expect(bursts).toBeGreaterThan(100);
    expect(still).toBeGreaterThan(1000);
    // Pure: the same moment is the same frame
    expect(glitchAt(3.21, 7)).toEqual(glitchAt(3.21, 7));
  });
});

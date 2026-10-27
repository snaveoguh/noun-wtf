import { describe, expect, it } from 'vitest';

import { outfitFromSeed, PANTS_COLORS, SHOE_COLORS } from '../../world2/character/outfit';
import { ART } from '../render/crowdMesh';

import { seedFromId } from './looks';
import { outfitFor } from './outfit';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

describe('exchange3d outfits', () => {
  it("colours a trader's legs with its Noun's default outfit (what its rig wears)", () => {
    const seed = seedFromId('sim:1', ART);
    const d = outfitFromSeed(seed);
    expect(outfitFor(seed)).toEqual({
      trouser: hex(PANTS_COLORS[d.pantsColor]!.hex),
      shoe: hex(SHOE_COLORS[d.shoeColor]!.hex),
    });
    expect(outfitFor(seed)).toEqual(outfitFor({ ...seed }));
  });

  it('varies across the crowd', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => {
        const o = outfitFor(seedFromId(`sim:${i}`, ART));
        return `${o.trouser}/${o.shoe}`;
      }),
    );
    expect(seen.size).toBeGreaterThan(20);
  });

  it("a rider's own outfit wins", () => {
    const seed = seedFromId('r:abc', ART);
    const mine = { pants: 'track', pantsColor: 9, shoes: 'boot', shoeColor: 11 } as const;
    expect(outfitFor(seed, mine)).toEqual({
      trouser: hex(PANTS_COLORS[9]!.hex),
      shoe: hex(SHOE_COLORS[11]!.hex),
    });
    expect(outfitFor(seed, null)).toEqual(outfitFor(seed));
  });
});

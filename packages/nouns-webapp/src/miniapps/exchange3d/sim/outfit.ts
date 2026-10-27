// ── 3D Grand Exchange: trouser and shoe colours (pure) ───────────────────
//
// The crowd's legs are coloured per trader so the floor doesn't look like
// one Noun cloned three hundred times. It uses Noun World's outfit
// contract (world2/character/outfit.ts): every Noun's default outfit is
// `outfitFromSeed(seed)`, the same one a rigged NounCharacter dresses
// itself in, so a trader's instanced legs and its full rig always match
// across the LOD swap. A rider who picked an outfit passes it as `real`.

import type { Seed } from './looks';

import {
  outfitFromSeed,
  PANTS_COLORS,
  SHOE_COLORS,
  type Outfit as RiderOutfit,
} from '../../world2/character/outfit';

/** The crowd mesh's view of an outfit: two flat colours. */
export interface Outfit {
  /** sRGB hex, '#rrggbb'. */
  trouser: string;
  shoe: string;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** A trader's trouser and shoe colours: their own outfit if known, else their Noun's default. */
export function outfitFor(seed: Seed, real?: RiderOutfit | null): Outfit {
  const o = real ?? outfitFromSeed(seed);
  return {
    trouser: hex((PANTS_COLORS[o.pantsColor] ?? PANTS_COLORS[0]!).hex),
    shoe: hex((SHOE_COLORS[o.shoeColor] ?? SHOE_COLORS[0]!).hex),
  };
}

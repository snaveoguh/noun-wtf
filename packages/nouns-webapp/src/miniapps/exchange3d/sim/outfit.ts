// ── 3D Grand Exchange: trouser and shoe colours (pure) ───────────────────
//
// The crowd's legs are coloured per trader so the floor doesn't look like
// one Noun cloned three hundred times. `outfitFor` is the one place that
// decides it: today it hashes the trader's id into a palette; when riders
// get real outfit options (world2/character), pass them in as `real` and
// they win, so a rider's legs on the floor match the ones they picked.

import { hashStr } from './looks';

export interface Outfit {
  /** sRGB hex, '#rrggbb'. */
  trouser: string;
  shoe: string;
}

/** Trousers: denim, chinos, black, greys, a few loud ones (it's a trading floor). */
export const TROUSERS: readonly string[] = [
  '#2c3e66',
  '#3b5b8c',
  '#1f2a44',
  '#22252b',
  '#4a4f57',
  '#6b6f76',
  '#8a7552',
  '#b59a6a',
  '#5a3d2b',
  '#3f5a3a',
  '#7a2f2f',
  '#d9c9a3',
  '#e2e2e2',
  '#c2486b',
  '#e0a526',
];

export const SHOES: readonly string[] = [
  '#151515',
  '#f2f2f2',
  '#5a3a22',
  '#8b5a2b',
  '#2b2b2b',
  '#c0392b',
  '#2e6fd8',
  '#e8d24a',
  '#7d7d7d',
];

const HEX = /^#[\da-f]{6}$/i;

/**
 * A trader's trousers and shoes: `real` (their own outfit, when known)
 * wins, field by field; otherwise a stable pick from the id.
 */
export function outfitFor(id: string, real?: Partial<Outfit> | null): Outfit {
  const h = hashStr(`outfit:${id}`);
  const pick = {
    trouser: TROUSERS[h % TROUSERS.length]!,
    shoe: SHOES[(h >>> 8) % SHOES.length]!,
  };
  return {
    trouser: real?.trouser !== undefined && HEX.test(real.trouser) ? real.trouser : pick.trouser,
    shoe: real?.shoe !== undefined && HEX.test(real.shoe) ? real.shoe : pick.shoe,
  };
}

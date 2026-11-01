// ── A Noun World rider's 32 × 32 pixels, from its seed key ────────────────
//
// Riders are drawn with the V1 art (as the game does, NounAppearance.ts). A
// missingnoun rider is only V2 head 252 and its glasses (the 23 glasses are
// the same in both sets), no body or accessory (character/missingNoun.ts).
// Out-of-range trait numbers wrap, so any key a link carries still draws.

import { pickNounAssets } from '../../src/lib/nounAssets';
import type { RiderSeed } from '../../src/miniapps/world2/share/playLink';

import { nounGrid, type NounGrid } from './nounOg';

/** V2 art index of head-missingnoun. */
export const MISSINGNOUN_V2_HEAD = 252;

const wrap = (n: number, len: number) => ((n % len) + len) % len;

export function riderGrid(seed: RiderSeed): NounGrid {
  const v1 = pickNounAssets(false).ImageData;
  const bg = v1.bgcolors[wrap(seed.background, v1.bgcolors.length)]!;
  if (seed.missingnoun === true) {
    const v2 = pickNounAssets(true).ImageData;
    const head = v2.images.heads[MISSINGNOUN_V2_HEAD]!;
    const glasses = v2.images.glasses[wrap(seed.glasses, v2.images.glasses.length)]!;
    return nounGrid([head, glasses], v2.palette, bg);
  }
  const im = v1.images;
  const parts = [
    im.bodies[wrap(seed.body, im.bodies.length)]!,
    im.accessories[wrap(seed.accessory, im.accessories.length)]!,
    im.heads[wrap(seed.head, im.heads.length)]!,
    im.glasses[wrap(seed.glasses, im.glasses.length)]!,
  ];
  return nounGrid(parts, v1.palette, bg);
}

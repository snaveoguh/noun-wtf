// ── The Farcaster mini app's static images, drawn by the card code ─────────
//
// public/fc/icon.png (1024², no alpha), splash.png (200²), world-card.png
// (1200 × 800, the 3:2 embed for plain /world) and world-og.png (1200 × 630,
// og:image and the manifest's hero). fcAssets.test.ts checks the committed
// files match; `WRITE_FC=1 npx vitest run netlify/lib/fcAssets.test.ts`
// redraws them.

import { pickNounAssets } from '../../src/lib/nounAssets';
import type { RiderSeed } from '../../src/miniapps/world2/share/playLink';

import { nounGrid } from './nounOg';
import { riderGrid } from './riderGrid';
import { CARD_SIZES, INK, renderNogglesSquare, renderRiderCard } from './riderOg';

/** V1 glasses-square-red: the canonical noggles. */
export const RED_NOGGLES = 15;

/** The rider on the plain /world card. */
export const WORLD_CARD_SEED: RiderSeed = {
  background: 0,
  body: 13,
  accessory: 60,
  head: 120,
  glasses: RED_NOGGLES,
};

export function fcAssets(): Record<string, Buffer> {
  const v1 = pickNounAssets(false).ImageData;
  const noggles = nounGrid([v1.images.glasses[RED_NOGGLES]!], v1.palette, 'ffd400');
  const card = (size: { width: number; height: number }) =>
    renderRiderCard(riderGrid(WORLD_CARD_SEED), {
      ...size,
      headline: ['NOUN', 'WORLD'],
      kicker: 'ONE LINK. ONE CITY.',
    });
  return {
    'icon.png': renderNogglesSquare(noggles, 1024),
    'splash.png': renderNogglesSquare(noggles, 200, INK),
    'world-card.png': card(CARD_SIZES.fc),
    'world-og.png': card(CARD_SIZES.og),
  };
}

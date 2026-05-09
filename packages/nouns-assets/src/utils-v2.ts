import imageDataV2 from './image-data-v2.json';
import { NounSeed, NounData } from './types';

const { images: imagesV2, bgcolors: bgcolorsV2 } = imageDataV2;
const {
  bodies: bodiesV2,
  accessories: accessoriesV2,
  heads: headsV2,
  glasses: glassesV2,
} = imagesV2;

/**
 * V2 variant of `getNounData`. Reads parts and palette from `image-data-v2.json`,
 * which mirrors the on-chain V2-owned `NounsDescriptorV2` exactly:
 *   - 32 bodies   (30 inherited + white@30, black@31)
 *   - 144 accessories (142 inherited + multicolor@142, slobber@143)
 *   - 253 heads   (252 inherited + missingnoun@252)
 *   - 23 glasses  (unchanged)
 *   - 253 palette colors (239 inherited + 14 founder colors at slots 239..252)
 *
 * Use this from V2 noun rendering paths (NounV2AuctionHero, CrystalBall,
 * CrystalBallPage, etc). V1 paths should keep using getNounData from
 * `@noundry/nouns-assets`.
 */
export const getNounDataV2 = (seed: NounSeed): NounData => ({
  parts: [
    bodiesV2[seed.body],
    accessoriesV2[seed.accessory],
    headsV2[seed.head],
    glassesV2[seed.glasses],
  ],
  background: bgcolorsV2[seed.background],
});

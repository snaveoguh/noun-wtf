/**
 * Pick the right ImageData / getNounData depending on whether we're rendering
 * a V1 noun (original Nouns DAO) or a V2 noun (the new V2 NounDAO whose
 * descriptor adds founder traits + extended palette colors).
 *
 * V1: pin to npm `@noundry/nouns-assets@1.17.0` — the canonical V1-frozen
 *     trait set. Using the workspace package for V1 would risk drift if a
 *     future commit ever changes the merged blob in a way that affects V1
 *     decoding.
 *
 * V2: use the workspace `@nouns/assets`, which carries the V1 traits plus
 *     the V2 additions (palette 239→253, bodies 30→32, accessories 143→145,
 *     heads 254→255).
 *
 * Default is V1 to keep existing behavior unchanged.
 */
import {
  ImageData as ImageDataV1,
  getNounData as getNounDataV1,
} from '@noundry/nouns-assets';
import { ImageDataV2, getNounDataV2 } from '@nouns/assets';

// Use the V1 typings as the canonical shape. Both packages' image-data
// JSON have identical structure (palette, bgcolors, images.{bodies,
// accessories, heads, glasses}); the V2 superset is just longer arrays
// with the same schema.
export type NounAssetSet = {
  ImageData: typeof ImageDataV1;
  getNounData: typeof getNounDataV1;
};

/**
 * Returns the V1 or V2 asset bundle. Defaults to V1.
 *
 * Usage:
 *   const { ImageData, getNounData } = pickNounAssets(isV2);
 */
export function pickNounAssets(isV2 = false): NounAssetSet {
  return isV2
    ? {
        ImageData: ImageDataV2 as typeof ImageDataV1,
        getNounData: getNounDataV2 as typeof getNounDataV1,
      }
    : { ImageData: ImageDataV1, getNounData: getNounDataV1 };
}

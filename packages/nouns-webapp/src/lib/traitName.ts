import { ImageData } from '@noundry/nouns-assets';
import { ImageDataV2 } from '@nouns/assets';

import { traitCategory } from '@/lib/traitCategory';
import { INounSeed } from '@/wrappers/nounToken';

const capitalizeFirstLetter = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Resolve a trait's display name from a raw filename. Shared between the V1
 * and V2 variants below so both apply identical rules:
 *  - 'glasses': strip leading `square-`
 *  - 'accessory': strip leading `body-` (renaming carryover from earlier
 *                 descriptors — `accessory-body-bege` ≡ `body-bege`)
 *  - drop the category prefix up to the first `-`, then replace any
 *    remaining `-` with spaces and capitalise.
 */
const filenameToName = (filename: string, type: keyof INounSeed): string => {
  let f = filename;
  if (type === 'glasses') f = f.replace('square-', '');
  if (type === 'accessory') f = f.replace('body-', '');
  return capitalizeFirstLetter(f.substring(f.indexOf('-') + 1).replace(/-/g, ' '));
};

export const traitName = (type: keyof INounSeed, seed: number) => {
  if (type === 'background') {
    return ['Cool', 'Warm'][seed] ?? 'Unknown';
  }

  // Defensive: guard against indices that don't exist in the bundled
  // @noundry/nouns-assets V1 ImageData. V2 nouns can roll body=31
  // (V2-only black founder), and the npm snapshot can drift behind the
  // actual chain — we'd rather render 'Unknown' than crash the page.
  const entry = ImageData.images[traitCategory[type]][seed];
  if (entry == null) return 'Unknown';
  return filenameToName(entry.filename, type);
};

/**
 * V2 variant of `traitName`. Reads from `ImageDataV2` so V2-only founder
 * traits (slobber, missingnoun, white/black bodies, multicolor) resolve to
 * their proper display names instead of falling back to 'Unknown'.
 *
 * Use this from V2-context UIs (dream builder, V2 noun detail, V2 catalog).
 * V1-context UIs should keep calling `traitName` so the indices line up
 * with V1's descriptor (which has different counts).
 */
export const traitNameV2 = (type: keyof INounSeed, seed: number) => {
  if (type === 'background') {
    return ['Cool', 'Warm'][seed] ?? 'Unknown';
  }
  const entry = ImageDataV2.images[traitCategory[type]][seed];
  if (entry == null) return 'Unknown';
  return filenameToName(entry.filename, type);
};

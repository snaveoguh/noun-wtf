import { ImageData } from '@noundry/nouns-assets';
import { ImageDataV2 } from '@nouns/assets';

import { traitCategory } from '@/lib/traitCategory';
import { INounSeed } from '@/wrappers/nounToken';

const capitalizeFirstLetter = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// V2 nouns ship a separate descriptor/art set (e.g. body 30 = white founder,
// 31 = black founder) absent from V1's @noundry/nouns-assets ImageData. Resolve
// V2 names against the workspace ImageDataV2 so they don't fall through to a
// wrong or 'Unknown' V1 name.
const v2Images = ImageDataV2.images as Record<string, { filename: string }[]>;

export const traitName = (type: keyof INounSeed, seed: number, isV2 = false): string => {
  if (type === 'background') {
    return ['Cool', 'Warm'][seed] ?? 'Unknown';
  }

  // Still defensive — an index can outrun even the V2 art set if the npm
  // snapshot drifts behind the chain; render 'Unknown' rather than crash.
  const category = traitCategory[type];
  const entry = isV2 ? v2Images[category]?.[seed] : ImageData.images[category][seed];
  if (entry == null) return 'Unknown';
  let filename = entry.filename;

  if (type === 'glasses') {
    filename = filename.replace('square-', '');
  }

  if (type === 'accessory') {
    filename = filename.replace('body-', '');
  }

  return capitalizeFirstLetter(filename.substring(filename.indexOf('-') + 1).replace(/-/g, ' '));
};

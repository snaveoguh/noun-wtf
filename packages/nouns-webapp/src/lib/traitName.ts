import { ImageData } from '@noundry/nouns-assets';

import { traitCategory } from '@/lib/traitCategory';
import { INounSeed } from '@/wrappers/nounToken';

const capitalizeFirstLetter = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

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
  let filename = entry.filename;

  if (type === 'glasses') {
    filename = filename.replace('square-', '');
  }

  if (type === 'accessory') {
    filename = filename.replace('body-', '');
  }

  return capitalizeFirstLetter(filename.substring(filename.indexOf('-') + 1).replace(/-/g, ' '));
};

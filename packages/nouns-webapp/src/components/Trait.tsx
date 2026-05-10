import { FC, HTMLAttributes } from 'react';

import { ImageData as ImageDataV1 } from '@noundry/nouns-assets';
import { ImageDataV2 } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';
import { useQuery } from '@tanstack/react-query';

import { traitCategory } from '@/lib/traitCategory';
import { INounSeed } from '@/wrappers/nounToken';

export interface TraitProps extends HTMLAttributes<HTMLImageElement> {
  type: keyof INounSeed;
  seed?: number;
  /** True when this trait belongs to a V2 noun / dream — uses ImageDataV2 so
   *  V2-only founder traits (slobber@143, missingnoun@252, white/black
   *  bodies@30/31) decode against the right palette. Default false (V1 path)
   *  for backwards compatibility with existing V1 callers. */
  isV2?: boolean;
}

const fallbackTransparentPixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export const Trait: FC<TraitProps> = ({ type, seed, isV2 = false, ...props }) => {
  const { data: svg } = useQuery({
    // Include isV2 in the cache key so V1 and V2 renders of the same index
    // don't collide (e.g. accessory 143 = silly-goose on V1 / slobber on V2).
    queryKey: ['trait-svg', type, seed, isV2] as const,
    queryFn: () => {
      const ImageData = isV2 ? (ImageDataV2 as typeof ImageDataV1) : ImageDataV1;
      return type === 'background'
        ? buildSVG([], ImageData.palette, ImageData.bgcolors[seed!])
        : buildSVG([ImageData.images[traitCategory[type]][seed!]], ImageData.palette, '');
    },
    enabled: seed !== undefined,
  });

  return (
    <img
      {...props}
      src={svg ? `data:image/svg+xml;base64,${btoa(svg)}` : fallbackTransparentPixel}
    />
  );
};

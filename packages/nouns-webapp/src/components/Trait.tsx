import { FC, HTMLAttributes } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { ImageDataV2 } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';
import { useQuery } from '@tanstack/react-query';

import { traitCategory } from '@/lib/traitCategory';
import { INounSeed } from '@/wrappers/nounToken';

export interface TraitProps extends HTMLAttributes<HTMLImageElement> {
  type: keyof INounSeed;
  seed?: number;
  /** Render against the NounV2 art set (`@nouns/assets` ImageDataV2) instead of V1. */
  isV2?: boolean;
}

const fallbackTransparentPixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

type ArtSet = {
  palette: string[];
  bgcolors: string[];
  images: Record<string, { filename: string; data: string }[]>;
};

export const Trait: FC<TraitProps> = ({ type, seed, isV2 = false, ...props }) => {
  const { data: svg } = useQuery({
    queryKey: ['trait-svg', isV2 ? 'v2' : 'v1', type, seed] as const,
    queryFn: () => {
      const art = (isV2 ? ImageDataV2 : ImageData) as ArtSet;
      if (type === 'background') {
        const bg = art.bgcolors[seed!];
        return bg == null ? '' : buildSVG([], art.palette, bg);
      }
      // Index can outrun the art snapshot if the chain adds a trait before
      // the npm data is refreshed — render nothing rather than crash.
      const part = art.images[traitCategory[type]]?.[seed!];
      return part == null ? '' : buildSVG([part], art.palette, '');
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

import { useMemo } from 'react';

import { getNounData, ImageData as data } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

import { isBurnedSeed, useNounSeeds } from '@/wrappers/nounToken';

interface Props {
  nounId: number | string | bigint;
  size?: number;
  /** Title attribute (defaults to "Noun N"). */
  title?: string;
}

/**
 * Tiny inline thumbnail of a Noun's face — for use in the activity feed
 * where rows mention "Noun 110" / "Noun 1893" etc. Uses the cached
 * `useNounSeeds` map so 30+ rows don't trigger 30 RPC calls.
 *
 * Falls back to an empty pixel placeholder while seeds are loading or for
 * v2/lil/burned/unknown nouns we don't have a seed for. Never throws.
 */
export default function InlineNoun({ nounId, size = 14, title }: Props) {
  const seeds = useNounSeeds();
  const idStr = String(nounId);
  const seed = seeds?.[idStr];

  const dataUrl = useMemo(() => {
    if (!seed) return null;
    if (isBurnedSeed(seed)) return null;
    try {
      const { parts, background } = getNounData(seed);
      return `data:image/svg+xml;base64,${btoa(buildSVG(parts, data.palette, background))}`;
    } catch {
      return null;
    }
  }, [seed]);

  // Empty placeholder keeps the row's horizontal rhythm steady while seeds
  // are still being fetched on first load.
  const style = {
    display: 'inline-block',
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '3px',
    verticalAlign: '-3px',
    background: dataUrl ? 'transparent' : 'rgba(255,255,255,0.06)',
    flexShrink: 0,
  } as const;

  if (!dataUrl) {
    return <span style={style} aria-hidden title={title || `Noun ${idStr}`} />;
  }

  return (
    <img
      src={dataUrl}
      alt=""
      style={style}
      title={title || `Noun ${idStr}`}
      loading="lazy"
    />
  );
}

import { FC, HTMLAttributes, useState, useEffect } from 'react';

import { getNounData, ImageData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { useQuery } from '@tanstack/react-query';

import loadingNoun from '@/assets/loading-skull-noun.gif';
import { NounHoverCard } from '@/components/NounHoverCard';
import { useReadNounsTokenSeeds } from '@/contracts';
import { INounSeed } from '@/wrappers/nounToken';

export interface NounProps extends HTMLAttributes<HTMLImageElement> {
  nounId?: bigint;
  seed?: INounSeed;
  loadingNounFallback?: boolean;
  minFallbackDuration?: number;
  /** When true, wraps the Noun image in a rich hover popover */
  hoverCard?: boolean;
}

const fallbackTransparentPixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

export const Noun: FC<NounProps> = ({
  nounId,
  seed: providedSeed,
  loadingNounFallback,
  minFallbackDuration = 0,
  hoverCard = false,
  ...props
}) => {
  const [shouldShowFallback, setShouldShowFallback] = useState(false);
  const [fallbackStartTime, setFallbackStartTime] = useState<number | null>(null);
  // `seeds(nounId)` reverts for burned nouns (reserve-not-met). `isError`
  // lets us render a burned-state placeholder instead of spinning forever
  // on the transparent pixel.
  const { data: fetchedSeed, isError: seedReverted } = useReadNounsTokenSeeds({
    args: [nounId!],
    query: {
      enabled: nounId !== undefined && !providedSeed,
      retry: 1,
      select: data => {
        if (!data) return null;
        return {
          background: Number(data[0]),
          body: Number(data[1]),
          accessory: Number(data[2]),
          head: Number(data[3]),
          glasses: Number(data[4]),
        };
      },
    },
  });

  const seed = providedSeed ?? fetchedSeed;

  const { data: svg } = useQuery({
    queryKey: ['noun-svg', seed] as const,
    queryFn: () => {
      const { parts, background } = getNounData(seed!);
      return buildSVG(parts, ImageData.palette, background);
    },
    enabled: !!seed,
  });

  // Handle fallback timing logic
  useEffect(() => {
    if (!svg && loadingNounFallback && !shouldShowFallback && !fallbackStartTime) {
      // Start showing fallback and record start time
      setShouldShowFallback(true);
      setFallbackStartTime(Date.now());
    } else if (svg && shouldShowFallback && fallbackStartTime) {
      // SVG is ready, check if minimum duration has passed
      const elapsed = Date.now() - fallbackStartTime;
      if (elapsed >= minFallbackDuration) {
        // Minimum duration passed, hide fallback immediately
        setShouldShowFallback(false);
        setFallbackStartTime(null);
      } else {
        // Wait for remaining time before hiding fallback
        const remainingTime = minFallbackDuration - elapsed;
        const timeoutId = setTimeout(() => {
          setShouldShowFallback(false);
          setFallbackStartTime(null);
        }, remainingTime);
        return () => clearTimeout(timeoutId);
      }
    } else if (!loadingNounFallback && shouldShowFallback) {
      // Fallback disabled, reset state
      setShouldShowFallback(false);
      setFallbackStartTime(null);
    }
  }, [svg, loadingNounFallback, shouldShowFallback, fallbackStartTime, minFallbackDuration]);

  if (shouldShowFallback) return <img {...props} src={loadingNoun} />;

  // Burned noun: seed-read reverted and no seed was provided. Use the
  // skull-noun placeholder instead of letting the tanstack query hang on a
  // transparent pixel forever.
  if (seedReverted && !providedSeed) {
    return <img {...props} src={loadingNoun} alt={props.alt ?? 'Burned noun'} />;
  }

  const imgElement = (
    <img
      {...props}
      src={svg ? `data:image/svg+xml;base64,${btoa(svg)}` : fallbackTransparentPixel}
    />
  );

  if (hoverCard && nounId !== undefined) {
    return (
      <NounHoverCard nounId={nounId} seed={seed ?? undefined}>
        {imgElement}
      </NounHoverCard>
    );
  }

  return imgElement;
};

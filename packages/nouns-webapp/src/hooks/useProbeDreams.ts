import { useEffect, useState } from 'react';

import type { CustomTraitLayer } from '@/lib/dreamStorage';

export interface ProbeDream {
  id: number;
  dreamer: string;
  seeds: {
    accessory: number | null;
    background: number;
    body: number;
    glasses: number;
    head: number | null;
  };
  createdAt: string;
  customLayer?: CustomTraitLayer;
  customImage?: string;
}

export interface ProbeDreamWithPreview extends ProbeDream {
  /** Full composed noun SVG (pre-rendered) */
  nounSvgUrl: string;
  /** Just the custom trait image (for hover), null if standard dream */
  customTraitUrl: string | null;
}

const DREAMS_URL = '/probe-dreams/dreams.json';
const RENDERED_BASE = '/probe-dreams/rendered';
const TRAITS_BASE = '/probe-dreams/traits';

let cachedDreams: ProbeDreamWithPreview[] | null = null;

export function useProbeDreams() {
  const [dreams, setDreams] = useState<ProbeDreamWithPreview[]>(cachedDreams ?? []);
  const [loading, setLoading] = useState(!cachedDreams);

  useEffect(() => {
    if (cachedDreams) return;

    fetch(DREAMS_URL)
      .then(r => r.json())
      .then((data: ProbeDream[]) => {
        const withPreviews = data.map(d => ({
          ...d,
          nounSvgUrl: `${RENDERED_BASE}/${d.id}.svg`,
          customTraitUrl: d.customImage
            ? `${TRAITS_BASE}/${d.id}_${d.customImage}`
            : null,
        }));
        cachedDreams = withPreviews;
        setDreams(withPreviews);
      })
      .catch(err => console.error('Failed to load probe dreams:', err))
      .finally(() => setLoading(false));
  }, []);

  return { dreams, loading };
}

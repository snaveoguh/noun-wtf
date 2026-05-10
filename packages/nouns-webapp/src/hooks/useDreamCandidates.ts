import { useEffect, useMemo, useState } from 'react';

import { extractArtworkFromDescription } from '@/lib/dreamConstants';
import { useCandidateProposals } from '@/wrappers/nounsData';

const DREAM_PREFIXES = ['nounwtf-dream-', 'probe-dream-'];
const DREAMS_JSON_URL = '/probe-dreams/dreams.json';

interface ProbeDreamRecord {
  id: number;
  customLayer?: string;
  customImage?: string;
}

let cachedProbeDreams: Map<number, ProbeDreamRecord> | null = null;

export interface OnChainDream {
  id: string;
  slug: string;
  title: string;
  description: string;
  artworkUri: string | null;
  /** Pre-rendered full noun SVG from probe dreams archive */
  nounSvgUrl: string | null;
  /** Custom trait image URL from probe dreams archive */
  customTraitUrl: string | null;
  proposer: string;
  signaturesCount: number;
  canceled: boolean;
  lastUpdatedTimestamp: bigint;
  proposalId?: number;
  /** Dream ID extracted from slug */
  dreamId: string | null;
}

export function useDreamCandidates() {
  const { data: allCandidates, loading, error } = useCandidateProposals();
  const [probeDreams, setProbeDreams] = useState<Map<number, ProbeDreamRecord>>(cachedProbeDreams ?? new Map());

  // Load probe dreams archive for cross-referencing
  useEffect(() => {
    if (cachedProbeDreams) return;
    fetch(DREAMS_JSON_URL)
      .then(r => r.json())
      .then((data: ProbeDreamRecord[]) => {
        const map = new Map(data.map(d => [d.id, d]));
        cachedProbeDreams = map;
        setProbeDreams(map);
      })
      .catch(() => { /* silent */ });
  }, []);

  const dreams = useMemo(() => {
    if (!allCandidates) return [];

    return allCandidates
      .filter(c => DREAM_PREFIXES.some(p => c.slug.startsWith(p)) && !c.canceled)
      .map((c): OnChainDream => {
        const latestVersion = c.version;
        const rawDescription = latestVersion?.content?.description ?? '';

        const titleMatch = rawDescription.match(/^#\s+(.+)/m);
        const title = titleMatch?.[1] ?? c.slug;

        const { artwork, cleanDescription } = extractArtworkFromDescription(rawDescription);

        // Extract dream ID from slug to cross-reference with probe dreams archive
        const dreamIdMatch = c.slug.match(/(?:probe-dream-|nounwtf-dream-)(\d+)/);
        const dreamId = dreamIdMatch?.[1] ?? null;
        const probeDream = dreamId ? probeDreams.get(Number(dreamId)) : null;

        // Build image URLs from probe dreams archive. `/probe-dreams/rendered/`
        // only contains pre-baked SVGs for dream ids ≤ 721 (the snapshot we
        // bundled). For newer ids the file doesn't exist and the <img> would
        // 404 → broken-image icon (bug seen on dreams #685, #693). Cap the
        // synthesised URL at the bundled max; OnChainDreamCard's FallbackImg
        // will fall through to artworkUri / customTraitUrl when nounSvgUrl
        // is null.
        const MAX_BUNDLED_RENDERED_ID = 721;
        let nounSvgUrl: string | null = null;
        let customTraitUrl: string | null = null;
        if (probeDream) {
          if (probeDream.id <= MAX_BUNDLED_RENDERED_ID) {
            nounSvgUrl = `/probe-dreams/rendered/${probeDream.id}.svg`;
          }
          if (probeDream.customImage) {
            customTraitUrl = `/probe-dreams/traits/${probeDream.id}_${probeDream.customImage}`;
          }
        }

        return {
          id: c.id,
          slug: c.slug,
          title,
          description: cleanDescription,
          artworkUri: artwork ?? customTraitUrl,
          nounSvgUrl,
          customTraitUrl,
          proposer: c.proposer,
          signaturesCount: latestVersion?.content?.contentSignatures?.length ?? 0,
          canceled: c.canceled,
          lastUpdatedTimestamp: c.lastUpdatedTimestamp,
          dreamId,
        };
      })
      .sort((a, b) => Number(b.lastUpdatedTimestamp - a.lastUpdatedTimestamp));
  }, [allCandidates, probeDreams]);

  return { dreams, loading, error };
}

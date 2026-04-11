import { useMemo } from 'react';

import { extractArtworkFromDescription } from '@/lib/dreamConstants';

/** Match both noun.wtf and probe.wtf dream prefixes */
const DREAM_PREFIXES = ['nounwtf-dream-', 'probe-dream-'];
import { useCandidateProposals } from '@/wrappers/nounsData';

export interface OnChainDream {
  id: string;
  slug: string;
  title: string;
  description: string;
  artworkUri: string | null;
  proposer: string;
  signaturesCount: number;
  canceled: boolean;
  lastUpdatedTimestamp: bigint;
  proposalId?: number;
}

export function useDreamCandidates() {
  const { data: allCandidates, loading, error } = useCandidateProposals();

  const dreams = useMemo(() => {
    if (!allCandidates) return [];

    return allCandidates
      .filter(c => DREAM_PREFIXES.some(p => c.slug.startsWith(p)) && !c.canceled)
      .map((c): OnChainDream => {
        const latestVersion = c.version;
        const rawDescription = latestVersion?.content?.description ?? '';

        // Extract title from first markdown heading
        const titleMatch = rawDescription.match(/^#\s+(.+)/m);
        const title = titleMatch?.[1] ?? c.slug;

        // Extract embedded artwork
        const { artwork, cleanDescription } = extractArtworkFromDescription(rawDescription);

        return {
          id: c.id,
          slug: c.slug,
          title,
          description: cleanDescription,
          artworkUri: artwork,
          proposer: c.proposer,
          signaturesCount: latestVersion?.content?.contentSignatures?.length ?? 0,
          canceled: c.canceled,
          lastUpdatedTimestamp: c.lastUpdatedTimestamp,
        };
      })
      .sort((a, b) => Number(b.lastUpdatedTimestamp - a.lastUpdatedTimestamp));
  }, [allCandidates]);

  return { dreams, loading, error };
}

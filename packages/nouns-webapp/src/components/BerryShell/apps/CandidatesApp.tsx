import { useMemo } from 'react';

import { useCandidateProposals } from '@/wrappers/nounsData';

interface PartialCandidate {
  id?: string | number;
  slug?: string;
  proposer?: string;
  latestVersion?: { content?: { title?: string; description?: string } };
}

/**
 * CandidatesApp — list of proposal candidates.
 *
 * Uses the same `useCandidateProposals` hook as the main /candidates page so
 * we get the GraphQL → on-chain fallback for free.
 */
export default function CandidatesApp() {
  const { data: candidates, loading } = useCandidateProposals();

  const sorted = useMemo<PartialCandidate[]>(() => {
    if (!candidates) return [];
    return [...candidates].slice(0, 60) as unknown as PartialCandidate[];
  }, [candidates]);

  if (loading && !sorted.length) {
    return (
      <div style={{ padding: 16, color: 'var(--theme-text-muted)', fontSize: 13, lineHeight: 1.4 }}>
        loading candidates…
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div style={{ padding: 16, color: 'var(--theme-text-muted)', fontSize: 13, lineHeight: 1.4 }}>
        no candidates.
      </div>
    );
  }

  return (
    // HIG: 8pt edge gutter, 44pt min row height
    <div style={{ padding: 8 }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sorted.map((c, i) => {
          const title = c.latestVersion?.content?.title || c.slug || `Candidate ${c.id ?? i}`;
          return (
            <li key={String(c.id ?? i)} style={{ borderBottom: '1px dotted var(--theme-feed-row-border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 12px',
                  minHeight: 44,
                  textDecoration: 'none',
                  color: 'var(--theme-text-primary)',
                  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
                  fontSize: 13,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'default',
                }}
              >
                {title}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

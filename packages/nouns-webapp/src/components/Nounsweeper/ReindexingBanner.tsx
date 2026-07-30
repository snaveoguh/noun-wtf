/**
 * Shows a dismissible banner (and offers Nounsweeper) whenever the indexer is
 * mid-backfill. Every `railway up` starts a fresh Ponder schema, so the whole
 * site looks empty for ~10-15 min — this explains why, instead of looking broken.
 */
import { FC, lazy, Suspense, useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

const Nounsweeper = lazy(() => import('./index'));

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const ReindexingBanner: FC = () => {
  const [playing, setPlaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ['indexer-health'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/health`);
      if (!res.ok) throw new Error('health failed');
      return (await res.json()) as { indexing?: boolean; proposalCount?: number | null };
    },
    refetchInterval: 30_000,
    retry: false,
    staleTime: 20_000,
  });

  const indexing = data?.indexing === true;

  // Re-arm the banner for the next deploy once the index comes back.
  useEffect(() => {
    if (!indexing) setDismissed(false);
  }, [indexing]);

  if (!indexing || dismissed) return null;

  return (
    <>
      <div
        style={{
          background: '#14141f',
          color: '#f4f0ea',
          padding: '7px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontSize: '0.8rem',
          fontFamily: "'PT Root UI', ui-monospace, monospace",
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span style={{ color: '#c54e38' }}>⌐◨-◨</span> reindexing — data&apos;s back in a few minutes
        </span>
        <button
          onClick={() => setPlaying(true)}
          style={{
            border: '1px solid #c54e38',
            background: 'none',
            color: '#c54e38',
            borderRadius: 6,
            padding: '1px 10px',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          play nounsweeper
        </button>
        <button
          onClick={() => setDismissed(true)}
          style={{ border: 0, background: 'none', color: '#79809c', cursor: 'pointer', font: 'inherit' }}
          aria-label="dismiss"
        >
          ×
        </button>
      </div>
      {playing && (
        <Suspense fallback={null}>
          <Nounsweeper onClose={() => setPlaying(false)} />
        </Suspense>
      )}
    </>
  );
};

export default ReindexingBanner;

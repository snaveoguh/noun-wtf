import { useEffect, useState } from 'react';

import { MarketCard } from '@/components/Predictions/MarketCard';
import {
  fetchActivePredictionProposals,
  type PredictionProposal,
} from '@/lib/marketplace/governance';

export function AsyncMarketGrid() {
  const [proposals, setProposals] = useState<PredictionProposal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivePredictionProposals()
      .then(setProposals)
      .catch(err => console.error('[Predictions] Failed to fetch proposals:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm italic text-neutral-500">Loading markets...</p>
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm italic text-neutral-500">
          No active Nouns or Lil Nouns proposals at the moment. Check back when a new proposal goes
          to vote.
        </p>
      </div>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest">
        Active Markets ({proposals.length})
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {proposals.map(p => (
          <MarketCard
            key={`${p.dao}-${p.proposalId}`}
            dao={p.dao}
            proposalId={p.proposalId}
            title={p.title}
            status={p.status}
            url={p.url}
            votesFor={p.votesFor}
            votesAgainst={p.votesAgainst}
            quorum={p.quorum}
          />
        ))}
      </div>
    </section>
  );
}

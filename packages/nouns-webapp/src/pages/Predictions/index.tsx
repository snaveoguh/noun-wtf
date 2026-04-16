import { useEffect, useState } from 'react';

import { AsyncMarketGrid } from '@/components/Predictions/AsyncMarketGrid';
import { MarketCard } from '@/components/Predictions/MarketCard';
import { OperatorPanel } from '@/components/Predictions/OperatorPanel';
import {
  fetchResolvedPredictionProposals,
  type PredictionProposal,
} from '@/lib/marketplace/governance';

export default function PredictionsPage() {
  const [resolved, setResolved] = useState<PredictionProposal[]>([]);

  useEffect(() => {
    fetchResolvedPredictionProposals()
      .then(setResolved)
      .catch(err => console.error('[Predictions] Resolved fetch failed:', err));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 border-b-2 border-neutral-200 pb-4 dark:border-neutral-700">
        <h1 className="font-londrina text-4xl">Nouns + Lil Nouns Predictions</h1>
        <p className="mt-1 text-xs uppercase tracking-widest text-neutral-500">
          Parimutuel · Ethereum Mainnet · 2% Resolution Fee
        </p>
      </div>

      <AsyncMarketGrid />

      <OperatorPanel />

      {resolved.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest">
            Resolved Markets ({resolved.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {resolved.map(p => (
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
                votingClosed={p.votingClosed}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 rounded border border-neutral-200 p-5 dark:border-neutral-700">
        <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest">How It Works</h3>
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <span className="font-mono text-lg font-bold">1</span>
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              Pick a Nouns or Lil Nouns proposal and stake ETH on For or Against.
            </p>
          </div>
          <div>
            <span className="font-mono text-lg font-bold">2</span>
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              When the proposal resolves onchain, the market locks in the outcome.
            </p>
          </div>
          <div>
            <span className="font-mono text-lg font-bold">3</span>
            <p className="mt-1 text-neutral-600 dark:text-neutral-400">
              Winners split the losing pool (minus 2% resolution fee). Claim your payout.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

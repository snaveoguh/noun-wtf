import { useEffect, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import {
  AUCTION_PRICE_MARKET_ABI,
  AUCTION_PRICE_MARKET_ADDRESS,
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
  PREDICTION_MARKET_CHAIN_ID,
} from '@/lib/marketplace/contracts';
import { formatEth } from '@/lib/marketplace/market-utils';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

interface MarketEntry {
  kind: 'auction' | 'proposal';
  id: string;
  nounId?: string;
  daoKey?: 'nouns' | 'lil-nouns';
  proposalId?: string;
  title: string;
  link?: string;
  outcome: number;
  totalPoolWei: string;
  stakers: number;
  status: 'needs-resolution' | 'live' | 'resolved' | 'pending';
  closesAt?: number;
  note?: string;
}

interface MarketsResponse {
  entries: MarketEntry[];
  generatedAt: number;
}

const PAGE_SIZE = 10;
const OUTCOME_LABEL: Record<number, string> = {
  1: 'HIGHER/FOR',
  2: 'LOWER/AGAINST',
  3: 'VOID',
};

function statusLabel(status: MarketEntry['status']): string {
  switch (status) {
    case 'needs-resolution':
      return 'NEEDS RESOLVE';
    case 'live':
      return 'LIVE';
    case 'pending':
      return 'PENDING';
    case 'resolved':
      return 'RESOLVED';
  }
}

function statusColor(status: MarketEntry['status']): string {
  switch (status) {
    case 'needs-resolution':
      return 'var(--accent-red)';
    case 'live':
      return 'var(--ink)';
    case 'pending':
      return 'var(--ink-light)';
    case 'resolved':
      return 'var(--ink-faint)';
  }
}

export function MarketsTable() {
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuery<MarketsResponse>({
    queryKey: ['predictions-markets'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/predictions/markets`, {
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const entries = data?.entries ?? [];

  const counts = useMemo(() => {
    return {
      needsResolve: entries.filter(e => e.status === 'needs-resolution').length,
      live: entries.filter(e => e.status === 'live').length,
      resolved: entries.filter(e => e.status === 'resolved').length,
    };
  }, [entries]);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const paged = entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Keep page in range if entries shrink (e.g. refetch after a resolve)
  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  if (isLoading) {
    return (
      <section className="mb-8 border-t-2 border-[var(--rule)] pt-6">
        <p className="font-mono text-[9px] text-[var(--ink-faint)]">Loading markets…</p>
      </section>
    );
  }

  if (error != null) {
    return (
      <section className="mb-8 border-t-2 border-[var(--rule)] pt-6">
        <p className="font-mono text-[9px] text-[var(--accent-red)]">
          {error instanceof Error ? error.message : 'Failed to load markets'}
        </p>
      </section>
    );
  }

  if (entries.length === 0) return null;

  return (
    <section className="mb-8 border-t-2 border-[var(--rule)] pt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--ink)]">
          Recent Markets
        </h2>
        <p className="font-mono text-[8px] uppercase tracking-wider text-[var(--ink-faint)]">
          {counts.needsResolve} needs resolve · {counts.live} live · {counts.resolved} resolved
        </p>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse font-mono text-[9px]">
          <thead>
            <tr className="border-b border-[var(--rule)] text-left text-[var(--ink-faint)]">
              <th className="whitespace-nowrap py-1 pr-2 sm:pr-3">Kind</th>
              <th className="whitespace-nowrap py-1 pr-2 sm:pr-3">Market</th>
              <th className="whitespace-nowrap py-1 pr-2 sm:pr-3">Pool</th>
              <th className="whitespace-nowrap py-1 pr-2 sm:pr-3">Status</th>
              <th className="whitespace-nowrap py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(entry => (
              <tr key={entry.id} className="border-b border-[var(--rule-light)]">
                <td className="whitespace-nowrap py-1.5 pr-2 sm:pr-3">
                  <span
                    className="border px-1 py-0.5 text-[8px] uppercase tracking-wider"
                    style={{
                      borderColor: 'var(--rule)',
                      color:
                        entry.kind === 'auction'
                          ? 'var(--accent-red)'
                          : entry.daoKey === 'lil-nouns'
                            ? '#ec4899'
                            : 'var(--ink)',
                    }}
                  >
                    {entry.kind === 'auction'
                      ? 'AUCTION'
                      : entry.daoKey === 'lil-nouns'
                        ? 'LIL'
                        : 'NOUNS'}
                  </span>
                </td>
                <td className="max-w-[160px] truncate py-1.5 pr-3 text-[var(--ink-light)] sm:max-w-[240px]">
                  {entry.link != null ? (
                    <a
                      href={entry.link}
                      target={entry.link.startsWith('/') ? undefined : '_blank'}
                      rel="noreferrer"
                      className="hover:text-[var(--ink)]"
                    >
                      {entry.title}
                    </a>
                  ) : (
                    entry.title
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-[var(--ink-light)]">
                  {formatEth(BigInt(entry.totalPoolWei))}
                </td>
                <td
                  className="whitespace-nowrap py-1.5 pr-3 uppercase"
                  style={{ color: statusColor(entry.status) }}
                >
                  {statusLabel(entry.status)}
                  {entry.status === 'resolved' && OUTCOME_LABEL[entry.outcome] != null && (
                    <span className="ml-1 text-[8px] text-[var(--ink-faint)]">
                      {OUTCOME_LABEL[entry.outcome]}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5">
                  {entry.status === 'needs-resolution' ? (
                    <ResolveActionButton entry={entry} />
                  ) : (
                    <span className="text-[var(--ink-faint)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between font-mono text-[9px] text-[var(--ink-faint)]">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="border border-[var(--rule)] px-2 py-0.5 uppercase tracking-wider transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)] disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="border border-[var(--rule)] px-2 py-0.5 uppercase tracking-wider transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)] disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      )}
    </section>
  );
}

function ResolveActionButton({ entry }: { entry: MarketEntry }) {
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  if (isSuccess) return <span className="text-[var(--ink)]">Resolved</span>;

  const onClick = () => {
    if (entry.kind === 'auction' && entry.nounId != null) {
      writeContract({
        chainId: PREDICTION_MARKET_CHAIN_ID,
        address: AUCTION_PRICE_MARKET_ADDRESS,
        abi: AUCTION_PRICE_MARKET_ABI,
        functionName: 'resolve',
        args: [BigInt(entry.nounId)],
      });
    } else if (entry.kind === 'proposal' && entry.daoKey != null && entry.proposalId != null) {
      writeContract({
        chainId: PREDICTION_MARKET_CHAIN_ID,
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'resolve',
        args: [entry.daoKey, entry.proposalId],
      });
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending || isConfirming}
        className="border border-[var(--accent-red)] px-2 py-0.5 text-[var(--accent-red)] transition-colors hover:bg-[var(--accent-red)] hover:text-[var(--paper)] disabled:opacity-50"
      >
        {isPending ? 'Sign…' : isConfirming ? 'Confirming…' : 'Resolve'}
      </button>
      {error != null && (
        <p className="mt-0.5 text-[8px] text-[var(--accent-red)]">
          {(error as { shortMessage?: string }).shortMessage || error.message}
        </p>
      )}
    </div>
  );
}

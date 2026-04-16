import { useState } from 'react';

import { parseEther } from 'viem';
import { useReadContract, useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

import {
  PREDICTION_MARKET_ADDRESS,
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_CHAIN_ID,
  ZERO_ADDRESS,
} from '@/lib/marketplace/contracts';
import {
  parseMarketData,
  parsePosition,
  MarketOutcome,
  type ParsedMarketData,
} from '@/lib/marketplace/market-utils';
import { formatEth, getDaoPredictionKey } from '@/lib/marketplace/market-utils';

interface MarketCardProps {
  dao: string;
  proposalId: string;
  title: string;
  status: string;
  url?: string;
  votesFor?: number;
  votesAgainst?: number;
  quorum?: number;
  /** True when governance voting has ended (proposal executed/defeated/etc) */
  votingClosed?: boolean;
}

const OUTCOME_LABELS: Record<MarketOutcome, { label: string; color: string }> = {
  [MarketOutcome.Unresolved]: { label: 'Active', color: 'var(--ink-faint)' },
  [MarketOutcome.For]: { label: 'Passed', color: 'var(--ink)' },
  [MarketOutcome.Against]: { label: 'Failed', color: 'var(--accent-red)' },
  [MarketOutcome.Void]: { label: 'Voided', color: 'var(--ink-light)' },
};

const DEFAULT_MARKET: ParsedMarketData = {
  forPool: BigInt(0),
  againstPool: BigInt(0),
  forStakers: 0,
  againstStakers: 0,
  forOddsBps: 5000,
  againstOddsBps: 5000,
  outcome: MarketOutcome.Unresolved,
  exists: false,
  totalPool: BigInt(0),
  forPercent: 50,
  againstPercent: 50,
};

const GOV_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  executed: { label: 'Executed', color: 'var(--ink)' },
  succeeded: { label: 'Succeeded', color: 'var(--ink)' },
  defeated: { label: 'Defeated', color: 'var(--accent-red)' },
  closed: { label: 'Closed', color: 'var(--ink-light)' },
  queued: { label: 'Queued', color: 'var(--ink-light)' },
};

export function MarketCard({
  dao,
  proposalId,
  title,
  status,
  url,
  votesFor,
  votesAgainst,
  quorum,
  votingClosed,
}: MarketCardProps) {
  const { address } = useAccount();
  const daoKey = getDaoPredictionKey(dao);

  const { data: marketRaw } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'getMarket',
    args: [daoKey, proposalId],
    chainId: PREDICTION_MARKET_CHAIN_ID,
  });

  const { data: positionRaw } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: 'getPosition',
    args: [daoKey, proposalId, address ?? ZERO_ADDRESS],
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!address },
  });

  const market = marketRaw
    ? parseMarketData(
        marketRaw as readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean],
      )
    : null;
  const position = positionRaw
    ? parsePosition(positionRaw as readonly [bigint, bigint, boolean])
    : null;

  // Use actual market data if it exists, otherwise show default 50/50
  const displayMarket = market?.exists === true ? market : DEFAULT_MARKET;
  const isResolved = displayMarket.outcome !== MarketOutcome.Unresolved;
  // Badge: use onchain outcome if resolved, else governance status if voting closed, else default
  const outcomeInfo = isResolved
    ? OUTCOME_LABELS[displayMarket.outcome]
    : votingClosed === true && GOV_STATUS_LABELS[status] != null
      ? GOV_STATUS_LABELS[status]
      : OUTCOME_LABELS[displayMarket.outcome];

  return (
    <div className="border-2 border-[var(--rule)] bg-[var(--paper)] p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[8px] uppercase tracking-wider text-[var(--ink-faint)]">
            {dao} &bull; #{proposalId}
          </p>
          <h3 className="font-headline mt-0.5 text-sm font-bold leading-snug text-[var(--ink)]">
            {title.length > 80 ? title.slice(0, 77) + '...' : title}
          </h3>
        </div>
        <span
          className="shrink-0 border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider"
          style={{ borderColor: outcomeInfo.color, color: outcomeInfo.color }}
        >
          {outcomeInfo.label}
        </span>
      </div>

      {/* Odds bar */}
      <div className="mb-2">
        <div className="flex h-6 w-full overflow-hidden border border-[var(--rule-light)]">
          <div
            className="flex items-center justify-center bg-[var(--ink)] font-mono text-[9px] font-bold text-[var(--paper)] transition-all"
            style={{ width: `${displayMarket.forPercent}%` }}
          >
            {displayMarket.forPercent > 10 ? `PASS ${displayMarket.forPercent.toFixed(0)}%` : ''}
          </div>
          <div
            className="flex items-center justify-center bg-[var(--accent-red)] font-mono text-[9px] font-bold text-[var(--paper)] transition-all"
            style={{ width: `${displayMarket.againstPercent}%` }}
          >
            {displayMarket.againstPercent > 10
              ? `FAIL ${displayMarket.againstPercent.toFixed(0)}%`
              : ''}
          </div>
        </div>
      </div>

      {/* Pool info + governance votes */}
      <div className="mb-3 space-y-1 font-mono text-[9px] text-[var(--ink-faint)]">
        <div className="flex items-center justify-between">
          <span>
            Pool: {formatEth(displayMarket.totalPool)} &bull;{' '}
            {displayMarket.forStakers + displayMarket.againstStakers} stakers
          </span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="uppercase tracking-wider transition-colors hover:text-[var(--ink)]"
            >
              View &rarr;
            </a>
          )}
        </div>
        {(votesFor !== undefined || votesAgainst !== undefined) && (
          <div className="text-[8px]">
            Governance: {votesFor ?? 0} for / {votesAgainst ?? 0} against
            {quorum !== undefined && <span> (quorum: {quorum})</span>}
          </div>
        )}
        {market?.exists !== true && votingClosed !== true && (
          <div className="text-[8px] uppercase tracking-wider">
            First wager auto-creates the market onchain
          </div>
        )}
      </div>

      {/* User position */}
      {position && position.totalStake > BigInt(0) && (
        <div className="mb-3 border border-[var(--rule-light)] p-2 font-mono text-[9px]">
          <span className="font-bold uppercase tracking-wider text-[var(--ink)]">
            Your Position:
          </span>
          {position.forStake > BigInt(0) && (
            <span className="ml-2 text-[var(--ink-light)]">
              PASS {formatEth(position.forStake)}
            </span>
          )}
          {position.againstStake > BigInt(0) && (
            <span className="ml-2 text-[var(--accent-red)]">
              FAIL {formatEth(position.againstStake)}
            </span>
          )}
          {position.claimed && <span className="ml-2 text-[var(--ink-faint)]">(Claimed)</span>}
        </div>
      )}

      {/* Inline wager UI — first stake auto-creates the market onchain */}
      {!isResolved && votingClosed !== true && <InlineWager dao={daoKey} proposalId={proposalId} />}

      {/* Voting closed but contract not yet resolved by operator */}
      {!isResolved && votingClosed === true && market?.exists === true && (
        <p className="py-2 text-center font-mono text-[9px] text-[var(--ink-faint)]">
          Voting ended &mdash; awaiting onchain resolution
        </p>
      )}

      {/* Claim button for resolved markets */}
      {isResolved && position && position.totalStake > BigInt(0) && !position.claimed && (
        <ClaimButton dao={daoKey} proposalId={proposalId} />
      )}
    </div>
  );
}

// --- Inline Wager: 2-click flow (pick side → pick amount) --------------------

const QUICK_AMOUNTS = ['0.001', '0.005', '0.01'];

function InlineWager({ dao, proposalId }: { dao: string; proposalId: string }) {
  const { isConnected } = useAccount();
  const [side, setSide] = useState<'for' | 'against' | null>(null);
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  if (!isConnected) {
    return (
      <p className="py-2 text-center font-mono text-[9px] text-[var(--ink-faint)]">
        Connect wallet to wager
      </p>
    );
  }

  if (isSuccess) {
    return (
      <div className="border border-[var(--rule-light)] p-2 text-center font-mono text-[9px] font-bold text-[var(--ink)]">
        Wager placed.
      </div>
    );
  }

  function handleQuickStake(amount: string) {
    if (!side) return;
    writeContract({
      chainId: PREDICTION_MARKET_CHAIN_ID,
      address: PREDICTION_MARKET_ADDRESS,
      abi: PREDICTION_MARKET_ABI,
      functionName: 'stake',
      args: [dao, proposalId, side === 'for'],
      value: parseEther(amount),
    });
  }

  return (
    <div className="space-y-2">
      {/* Side selector: PASS / FAIL */}
      <div className="flex gap-2">
        <button
          onClick={() => setSide('for')}
          className={`flex-1 border py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            side === 'for'
              ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
              : 'border-[var(--rule-light)] text-[var(--ink-faint)] hover:border-[var(--rule)] hover:text-[var(--ink)]'
          }`}
        >
          Pass
        </button>
        <button
          onClick={() => setSide('against')}
          className={`flex-1 border py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            side === 'against'
              ? 'border-[var(--accent-red)] bg-[var(--accent-red)] text-[var(--paper)]'
              : 'border-[var(--rule-light)] text-[var(--ink-faint)] hover:border-[var(--rule)] hover:text-[var(--ink)]'
          }`}
        >
          Fail
        </button>
      </div>

      {/* Quick amount buttons — visible when side is selected */}
      {side && (
        <div className="flex gap-1">
          {QUICK_AMOUNTS.map(amt => (
            <button
              key={amt}
              onClick={() => handleQuickStake(amt)}
              disabled={isPending || isConfirming}
              className="flex-1 border border-[var(--rule)] py-1.5 font-mono text-[9px] text-[var(--ink-light)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)] disabled:opacity-50"
            >
              {isPending || isConfirming ? '...' : `${amt} ETH`}
            </button>
          ))}
        </div>
      )}

      {/* Error display */}
      {error && (
        <p className="font-mono text-[8px] text-[var(--accent-red)]">
          {(error as { shortMessage?: string }).shortMessage || error.message}
        </p>
      )}
    </div>
  );
}

// --- Claim Button for resolved markets --------------------------------------

function ClaimButton({ dao, proposalId }: { dao: string; proposalId: string }) {
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  return (
    <button
      onClick={() =>
        writeContract({
          chainId: PREDICTION_MARKET_CHAIN_ID,
          address: PREDICTION_MARKET_ADDRESS,
          abi: PREDICTION_MARKET_ABI,
          functionName: 'claim',
          args: [dao, proposalId],
        })
      }
      disabled={isPending || isConfirming}
      className="w-full border border-[var(--rule)] bg-[var(--ink)] py-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--paper)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-50"
    >
      {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Claim Winnings'}
    </button>
  );
}

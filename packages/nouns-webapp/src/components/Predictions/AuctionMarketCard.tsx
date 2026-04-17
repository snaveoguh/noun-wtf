import { useEffect, useState } from 'react';

import { formatEther, parseEther } from 'viem';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { Noun } from '@/components/Noun';
import {
  AUCTION_PRICE_MARKET_ABI,
  AUCTION_PRICE_MARKET_ADDRESS,
  PREDICTION_MARKET_CHAIN_ID,
  ZERO_ADDRESS,
} from '@/lib/marketplace/contracts';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

interface AuctionStats {
  current: { nounId: string; amount: string | null; endTime: number; settled: boolean } | null;
  prior7: Array<{ nounId: string; amount: string | null }>;
  avgWei: string;
  sampleSize: number;
}

const QUICK_AMOUNTS = ['0.001', '0.005', '0.01'];

function formatEthShort(wei: bigint): string {
  const eth = Number(formatEther(wei));
  if (eth === 0) return '0';
  if (eth < 0.001) return '<0.001';
  return `${eth.toFixed(3)} ETH`;
}

export function AuctionMarketCard() {
  const [stats, setStats] = useState<AuctionStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${API_BASE}/api/auction-stats`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as AuctionStats;
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setStatsError('Auction stats endpoint unavailable.');
      }
    }
    load();
    // Refresh every 30s so countdown + current bid reflect reality.
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (statsError) {
    return (
      <div className="border-2 border-[var(--rule)] bg-[var(--paper)] p-4">
        <p className="font-mono text-[11px] text-[var(--ink-faint)]">{statsError}</p>
      </div>
    );
  }

  if (!stats?.current) {
    return (
      <div className="border-2 border-[var(--rule)] bg-[var(--paper)] p-4">
        <p className="font-mono text-xs text-[var(--ink-faint)]">Loading current auction…</p>
      </div>
    );
  }

  const nounId = BigInt(stats.current.nounId);
  const currentBid = stats.current.amount ? BigInt(stats.current.amount) : BigInt(0);
  const avgWei = BigInt(stats.avgWei);

  return (
    <AuctionMarketCardInner
      nounId={nounId}
      currentBid={currentBid}
      avgWei={avgWei}
      endTime={stats.current.endTime}
      sampleSize={stats.sampleSize}
    />
  );
}

interface InnerProps {
  nounId: bigint;
  currentBid: bigint;
  avgWei: bigint;
  endTime: number;
  sampleSize: number;
}

function AuctionMarketCardInner({ nounId, currentBid, avgWei, endTime, sampleSize }: InnerProps) {
  const { address, isConnected } = useAccount();

  const { data: marketRaw, refetch: refetchMarket } = useReadContract({
    address: AUCTION_PRICE_MARKET_ADDRESS,
    abi: AUCTION_PRICE_MARKET_ABI,
    functionName: 'getMarket',
    args: [nounId],
    chainId: PREDICTION_MARKET_CHAIN_ID,
  });

  const { data: positionRaw } = useReadContract({
    address: AUCTION_PRICE_MARKET_ADDRESS,
    abi: AUCTION_PRICE_MARKET_ABI,
    functionName: 'getPosition',
    args: [nounId, address ?? ZERO_ADDRESS],
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!address },
  });

  const market = marketRaw
    ? {
        higherPool: marketRaw[0] as bigint,
        lowerPool: marketRaw[1] as bigint,
        higherStakers: Number(marketRaw[2] as bigint),
        lowerStakers: Number(marketRaw[3] as bigint),
        higherOddsBps: Number(marketRaw[4] as bigint),
        lowerOddsBps: Number(marketRaw[5] as bigint),
        outcome: Number(marketRaw[6] as bigint | number),
        priceWei: marketRaw[7] as bigint,
        avgWei: marketRaw[8] as bigint,
        feeBps: Number(marketRaw[9] as bigint | number),
        exists: marketRaw[10] as boolean,
      }
    : null;

  const position = positionRaw
    ? {
        higherStake: positionRaw[0] as bigint,
        lowerStake: positionRaw[1] as bigint,
        claimed: positionRaw[2] as boolean,
      }
    : null;

  const totalPool = (market?.higherPool ?? BigInt(0)) + (market?.lowerPool ?? BigInt(0));
  const higherPercent =
    totalPool > BigInt(0)
      ? Number((market!.higherPool * BigInt(10000)) / totalPool / BigInt(100))
      : 50;
  const lowerPercent = 100 - higherPercent;

  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = Math.max(0, endTime - now);
  const auctionEnded = secondsLeft === 0;
  // Outcome enum: 0=UNRESOLVED, 1=HIGHER, 2=LOWER, 3=VOID
  const isResolved = market?.outcome === 1 || market?.outcome === 2 || market?.outcome === 3;
  const outcomeLabel =
    market?.outcome === 1
      ? 'Higher'
      : market?.outcome === 2
        ? 'Lower'
        : market?.outcome === 3
          ? 'Void (Refund)'
          : auctionEnded
            ? 'Ended'
            : 'Live';
  const outcomeColor =
    market?.outcome === 1
      ? 'var(--ink)'
      : market?.outcome === 2
        ? 'var(--accent-red)'
        : 'var(--ink-faint)';

  return (
    <div className="border-2 border-[var(--rule)] bg-[var(--paper)] p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden border border-[var(--rule-light)]">
          <Noun nounId={nounId} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[8px] uppercase tracking-wider text-[var(--ink-faint)]">
            Auction · Noun #{nounId.toString()}
          </p>
          <h3 className="font-headline mt-0.5 text-sm font-bold leading-snug text-[var(--ink)]">
            Higher or Lower than 7-day avg?
          </h3>
          <p className="mt-1 font-mono text-[9px] text-[var(--ink-faint)]">
            Current bid: <span className="text-[var(--ink)]">{formatEthShort(currentBid)}</span>
            {'  ·  '}
            Avg ({sampleSize}): <span className="text-[var(--ink)]">{formatEthShort(avgWei)}</span>
          </p>
        </div>
        <span
          className="shrink-0 border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider"
          style={{ borderColor: outcomeColor, color: outcomeColor }}
        >
          {outcomeLabel}
        </span>
      </div>

      {/* Odds bar */}
      <div className="mb-2 flex h-6 w-full overflow-hidden border border-[var(--rule-light)]">
        <div
          className="flex items-center justify-center bg-[var(--ink)] font-mono text-[9px] font-bold text-[var(--paper)] transition-all"
          style={{ width: `${higherPercent}%` }}
        >
          {higherPercent > 10 ? `HIGHER ${higherPercent}%` : ''}
        </div>
        <div
          className="flex items-center justify-center bg-[var(--accent-red)] font-mono text-[9px] font-bold text-[var(--paper)] transition-all"
          style={{ width: `${lowerPercent}%` }}
        >
          {lowerPercent > 10 ? `LOWER ${lowerPercent}%` : ''}
        </div>
      </div>

      <div className="mb-3 font-mono text-[9px] text-[var(--ink-faint)]">
        Pool: {formatEthShort(totalPool)} ·{' '}
        {(market?.higherStakers ?? 0) + (market?.lowerStakers ?? 0)} stakers
        {!auctionEnded && (
          <span className="ml-2">
            · Closes in {Math.floor(secondsLeft / 3600)}h {Math.floor((secondsLeft % 3600) / 60)}m
          </span>
        )}
        {market?.exists !== true && !auctionEnded && (
          <div className="text-[8px] uppercase tracking-wider">
            First wager auto-creates the market onchain
          </div>
        )}
      </div>

      {position && position.higherStake + position.lowerStake > BigInt(0) && (
        <div className="mb-3 border border-[var(--rule-light)] p-2 font-mono text-[9px]">
          <span className="font-bold uppercase tracking-wider text-[var(--ink)]">
            Your Position:
          </span>
          {position.higherStake > BigInt(0) && (
            <span className="ml-2 text-[var(--ink-light)]">
              HIGHER {formatEthShort(position.higherStake)}
            </span>
          )}
          {position.lowerStake > BigInt(0) && (
            <span className="ml-2 text-[var(--accent-red)]">
              LOWER {formatEthShort(position.lowerStake)}
            </span>
          )}
          {position.claimed && <span className="ml-2 text-[var(--ink-faint)]">(Claimed)</span>}
        </div>
      )}

      {!auctionEnded && !isResolved && (
        <InlineWager
          nounId={nounId}
          marketExists={market?.exists === true}
          onSuccess={() => refetchMarket()}
          isConnected={isConnected}
        />
      )}

      {auctionEnded && !isResolved && (
        <ResolveButton nounId={nounId} onSuccess={() => refetchMarket()} />
      )}

      {isResolved &&
        position &&
        position.higherStake + position.lowerStake > BigInt(0) &&
        !position.claimed && <ClaimButton nounId={nounId} />}

      {isResolved && market !== null && (
        <p className="mt-2 font-mono text-[8px] text-[var(--ink-faint)]">
          Settled at {formatEthShort(market.priceWei)} vs avg {formatEthShort(market.avgWei)}
        </p>
      )}
    </div>
  );
}

// --- Inline Wager ---

function InlineWager({
  nounId,
  marketExists,
  onSuccess,
  isConnected,
}: {
  nounId: bigint;
  marketExists: boolean;
  onSuccess: () => void;
  isConnected: boolean;
}) {
  const [side, setSide] = useState<'higher' | 'lower' | null>(null);
  // Track the pending tx type so we can chain create → stake if needed.
  const [pendingAction, setPendingAction] = useState<'create' | 'stake' | null>(null);
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (isSuccess) {
      onSuccess();
      if (pendingAction === 'create') setPendingAction(null);
    }
  }, [isSuccess, onSuccess, pendingAction]);

  if (!isConnected) {
    return (
      <p className="py-2 text-center font-mono text-[9px] text-[var(--ink-faint)]">
        Connect wallet to wager
      </p>
    );
  }

  if (isSuccess && pendingAction === 'stake') {
    return (
      <div className="border border-[var(--rule-light)] p-2 text-center font-mono text-[9px] font-bold text-[var(--ink)]">
        Wager placed.
      </div>
    );
  }

  function handleCreateMarket() {
    setPendingAction('create');
    writeContract({
      chainId: PREDICTION_MARKET_CHAIN_ID,
      address: AUCTION_PRICE_MARKET_ADDRESS,
      abi: AUCTION_PRICE_MARKET_ABI,
      functionName: 'createMarket',
      args: [nounId],
    });
  }

  function handleQuickStake(amount: string) {
    if (!side) return;
    setPendingAction('stake');
    writeContract({
      chainId: PREDICTION_MARKET_CHAIN_ID,
      address: AUCTION_PRICE_MARKET_ADDRESS,
      abi: AUCTION_PRICE_MARKET_ABI,
      functionName: 'stake',
      args: [nounId, side === 'higher'],
      value: parseEther(amount),
    });
  }

  // First mover must create the market before anyone can stake.
  if (!marketExists) {
    return (
      <div className="space-y-2">
        <p className="font-mono text-[9px] text-[var(--ink-faint)]">
          No market yet — open it (one tx), then stake in the next.
        </p>
        <button
          type="button"
          onClick={handleCreateMarket}
          disabled={isPending || isConfirming}
          className="w-full border border-[var(--rule)] bg-[var(--paper)] py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)] disabled:opacity-50"
        >
          {isPending
            ? 'Confirming in wallet…'
            : isConfirming
              ? 'Opening market onchain…'
              : 'Open Market'}
        </button>
        {error !== null && (
          <p className="font-mono text-[8px] text-[var(--accent-red)]">
            {(error as { shortMessage?: string }).shortMessage || error.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSide('higher')}
          className={`flex-1 border py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            side === 'higher'
              ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
              : 'border-[var(--rule-light)] text-[var(--ink-faint)] hover:border-[var(--rule)] hover:text-[var(--ink)]'
          }`}
        >
          Higher
        </button>
        <button
          type="button"
          onClick={() => setSide('lower')}
          className={`flex-1 border py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
            side === 'lower'
              ? 'border-[var(--accent-red)] bg-[var(--accent-red)] text-[var(--paper)]'
              : 'border-[var(--rule-light)] text-[var(--ink-faint)] hover:border-[var(--rule)] hover:text-[var(--ink)]'
          }`}
        >
          Lower
        </button>
      </div>

      {side && (
        <div className="flex gap-1">
          {QUICK_AMOUNTS.map(amt => (
            <button
              key={amt}
              type="button"
              onClick={() => handleQuickStake(amt)}
              disabled={isPending || isConfirming}
              className="flex-1 border border-[var(--rule)] py-1.5 font-mono text-[9px] text-[var(--ink-light)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)] disabled:opacity-50"
            >
              {isPending || isConfirming ? '...' : `${amt} ETH`}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="font-mono text-[8px] text-[var(--accent-red)]">
          {(error as { shortMessage?: string }).shortMessage || error.message}
        </p>
      )}
    </div>
  );
}

// --- Resolve button (permissionless once auction ends) ---

function ResolveButton({ nounId, onSuccess }: { nounId: bigint; onSuccess: () => void }) {
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (isSuccess) onSuccess();
  }, [isSuccess, onSuccess]);

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          writeContract({
            chainId: PREDICTION_MARKET_CHAIN_ID,
            address: AUCTION_PRICE_MARKET_ADDRESS,
            abi: AUCTION_PRICE_MARKET_ABI,
            functionName: 'resolve',
            args: [nounId],
          })
        }
        disabled={isPending || isConfirming}
        className="w-full border border-[var(--rule)] bg-[var(--paper)] py-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)] disabled:opacity-50"
      >
        {isPending ? 'Signing…' : isConfirming ? 'Confirming…' : 'Resolve Market'}
      </button>
      {error && (
        <p className="mt-1 font-mono text-[8px] text-[var(--accent-red)]">
          {(error as { shortMessage?: string }).shortMessage || error.message}
        </p>
      )}
    </div>
  );
}

// --- Claim button ---

function ClaimButton({ nounId }: { nounId: bigint }) {
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  return (
    <button
      type="button"
      onClick={() =>
        writeContract({
          chainId: PREDICTION_MARKET_CHAIN_ID,
          address: AUCTION_PRICE_MARKET_ADDRESS,
          abi: AUCTION_PRICE_MARKET_ABI,
          functionName: 'claim',
          args: [nounId],
        })
      }
      disabled={isPending || isConfirming}
      className="w-full border border-[var(--rule)] bg-[var(--ink)] py-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--paper)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-50"
    >
      {isPending ? 'Signing…' : isConfirming ? 'Confirming…' : 'Claim Winnings'}
    </button>
  );
}

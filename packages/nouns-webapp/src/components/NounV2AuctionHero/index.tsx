/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';

import { Link } from 'react-router';
import { toast } from 'sonner';
import { formatEther, parseEther } from 'viem';
import {
  useAccount,
  useBalance,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { NOUNV2_TREASURY_ADDRESS } from '@/contracts/nounv2-treasury';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function formatSecondsLeft(sec: number): string {
  if (sec <= 0) return 'ended';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

/**
 * Compact NounV2 auction hero rendered in place of the default Nouns hero
 * when `?dao=nounv2` is active on the main auction page. Self-contained —
 * reads directly from the NounV2AuctionHouse on chain (no Ponder dependency
 * yet — the NounV2 indexer is a separate branch).
 *
 * Deliberately does NOT try to reuse the giant <Auction> component from
 * `/components/Auction/index.tsx` — that component is tightly coupled to
 * the mainnet Nouns contracts, image pipeline and derivative systems.
 * Better to render a thin surrogate and deep-link to `/nounv2` for full
 * governance + proposal UX.
 */
export default function NounV2AuctionHero() {
  const { address: userAddr } = useAccount();

  const addressesMissing =
    NOUNV2_AUCTION_HOUSE_ADDRESS === ZERO_ADDRESS ||
    NOUNV2_TREASURY_ADDRESS === ZERO_ADDRESS;

  const { data: balance } = useBalance({
    address: NOUNV2_TREASURY_ADDRESS,
    query: { enabled: NOUNV2_TREASURY_ADDRESS !== ZERO_ADDRESS },
  });
  const treasuryEth = balance ? formatEther(balance.value) : '0';

  const { data: auctionData, refetch: refetchAuction } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'auction',
    query: {
      enabled: NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS,
      refetchInterval: 12_000,
    },
  });

  const { data: minBidIncrementPercentage } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'minBidIncrementPercentage',
    query: { enabled: NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS },
  });

  const { data: reservePrice } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'reservePrice',
    query: { enabled: NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS },
  });

  const auction = auctionData as
    | readonly [bigint, bigint, bigint, bigint, `0x${string}`, boolean]
    | undefined;
  const [nounId, bidAmount, _startTime, endTime, bidder, settled] = auction ?? [];
  void _startTime;

  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = endTime != null ? Number(endTime) - now : 0;
  const auctionEnded = auction ? secondsLeft <= 0 : false;

  const minNextBid = useMemo(() => {
    if (!auction) return 0n;
    const inc = minBidIncrementPercentage ?? 2n;
    if (bidAmount === 0n) return reservePrice ?? 1n;
    return (bidAmount ?? 0n) + ((bidAmount ?? 0n) * BigInt(inc)) / 100n;
  }, [auction, bidAmount, minBidIncrementPercentage, reservePrice]);

  const [bidInput, setBidInput] = useState('');
  const {
    writeContractAsync,
    data: txHash,
    isPending,
    reset: resetWrite,
  } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (txConfirmed) {
      void refetchAuction();
      setBidInput('');
      resetWrite();
    }
  }, [txConfirmed, refetchAuction, resetWrite]);

  async function handleBid() {
    if (!userAddr) {
      toast.error('Connect your wallet first');
      return;
    }
    if (nounId == null) return;
    const amtStr = bidInput.trim();
    if (!amtStr) {
      toast.error('Enter a bid amount');
      return;
    }
    let value: bigint;
    try {
      value = parseEther(amtStr);
    } catch {
      toast.error('Invalid ETH amount');
      return;
    }
    if (value < minNextBid) {
      toast.error(`Min bid is ${formatEther(minNextBid)} ETH`);
      return;
    }
    try {
      await writeContractAsync({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        functionName: 'createBid',
        args: [nounId],
        value,
      });
      toast.success('Bid submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Bid failed');
    }
  }

  async function handleSettle() {
    try {
      await writeContractAsync({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        functionName: 'settleCurrentAndCreateNewAuction',
      });
      toast.success('Settlement submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Settle failed');
    }
  }

  return (
    <div
      id="dao-panel-nounv2"
      role="tabpanel"
      className="mx-auto w-full max-w-[880px] px-4 pb-8 pt-4 sm:pt-6"
    >
      {addressesMissing && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong className="font-semibold">NounV2 contracts not yet deployed.</strong> Reads and
          writes are no-ops until <code>VITE_NOUNV2_AUCTION_HOUSE_ADDRESS</code> and{' '}
          <code>VITE_NOUNV2_TREASURY_ADDRESS</code> are set in the environment.
        </div>
      )}

      {/* Hero header */}
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 text-[2.25rem] font-extrabold tracking-[-0.02em] text-red-600">
          NounV2
        </h1>
        <span className="inline-block rounded-sm bg-red-600 px-2 py-[2px] text-xs font-extrabold uppercase tracking-[0.08em] text-white">
          New
        </span>
        {balance && (
          <span className="font-mono text-base font-semibold text-green-600">
            {parseFloat(treasuryEth).toFixed(4)} ETH
          </span>
        )}
        <p className="mt-1 basis-full text-sm leading-relaxed text-neutral-600">
          A Nouns fork with no-reserve auctions. Governance is a single-contract governor +
          treasury; proposals need 1 NounV2 voting unit, ~12h vote, 12h timelock.
        </p>
      </div>

      {/* Active auction */}
      {auction && (
        <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-[0.08em]">
            <span className="text-neutral-500">Live Auction</span>
            <span
              className={
                settled === true
                  ? 'text-green-600'
                  : auctionEnded
                    ? 'text-amber-600'
                    : 'text-red-600'
              }
            >
              {settled === true
                ? 'Settled'
                : auctionEnded
                  ? 'Ended — awaiting settle'
                  : 'Active'}
            </span>
          </div>
          <h2 className="mb-4 text-2xl font-extrabold tracking-tight text-neutral-900">
            NounV2 #{nounId != null ? nounId.toString() : '—'}
          </h2>

          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Current Bid" value={`${bidAmount != null ? formatEther(bidAmount) : '0'} ETH`} />
            <Stat
              label={auctionEnded ? 'Status' : 'Ends in'}
              value={auctionEnded ? 'Ended' : formatSecondsLeft(secondsLeft)}
            />
            <Stat
              label="Top Bidder"
              value={
                bidder && bidder !== ZERO_ADDRESS ? (
                  <ShortAddress address={bidder} />
                ) : (
                  <span className="text-neutral-400">none</span>
                )
              }
            />
            <Stat label="Min Next Bid" value={`${formatEther(minNextBid)} ETH`} />
          </div>

          {!auctionEnded && settled !== true && (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                  placeholder={`Min ${formatEther(minNextBid)} ETH`}
                  value={bidInput}
                  onChange={e => setBidInput(e.target.value)}
                  type="number"
                  step="0.001"
                  min="0"
                />
                <button
                  type="button"
                  className="rounded-md bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                  onClick={handleBid}
                  disabled={isPending || !userAddr}
                >
                  {isPending ? 'Signing...' : userAddr ? 'Bid' : 'Connect Wallet'}
                </button>
              </div>
              {!userAddr && (
                <p className="mt-2 text-xs text-neutral-500">
                  Connect your wallet to place a bid.
                </p>
              )}
            </>
          )}

          {auctionEnded && settled !== true && (
            <button
              type="button"
              className="w-full rounded-md bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              onClick={handleSettle}
              disabled={isPending || !userAddr}
            >
              {isPending ? 'Settling...' : 'Settle & Start Next'}
            </button>
          )}
        </div>
      )}

      {/* Deep-link to the full NounV2 page — governance, proposal list, etc. */}
      <div className="mt-4 flex justify-end">
        <Link
          to="/nounv2"
          className="text-sm font-semibold text-red-700 hover:underline"
        >
          View full NounV2 page (governance, proposals) &rarr;
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-base font-bold text-neutral-900">{value}</div>
    </div>
  );
}

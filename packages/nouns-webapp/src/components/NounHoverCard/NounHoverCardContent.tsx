import { FC } from 'react';

import { formatEther } from 'viem';
import { ExternalLink, Landmark, MessageCircle } from 'lucide-react';
import { Link } from 'react-router';

import NounPalette from '@/components/NounPalette';
import ShortAddress from '@/components/ShortAddress';
import { Address } from '@/utils/types';
import { INounSeed } from '@/wrappers/nounToken';

import { FundPoolSection } from './FundPoolSection';
import { useNounHoverData } from './useNounHoverData';

interface NounHoverCardContentProps {
  nounId: bigint;
  seed?: INounSeed;
}

export const NounHoverCardContent: FC<NounHoverCardContentProps> = ({
  nounId,
  seed: providedSeed,
}) => {
  const { traits, owner, auction, seed, isLoading } = useNounHoverData(
    nounId,
    providedSeed,
  );

  return (
    <div className="relative">
      {/* ── Header ── */}
      <div className="border-b-2 border-black px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold tracking-tight">
            Noun {nounId.toString()}
          </h3>
          <Link
            to={`/noun/${nounId}`}
            className="flex items-center gap-0.5 text-xs font-semibold text-red-600 no-underline hover:text-red-800"
          >
            View auction
            <ExternalLink className="inline-block size-3" />
          </Link>
        </div>
        {owner && (
          <div className="mt-0.5 text-xs text-gray-500">
            Held by{' '}
            <ShortAddress address={owner as Address} />
          </div>
        )}
      </div>

      {/* ── Traits ── */}
      {traits && (
        <div className="border-b border-gray-200 px-3 py-2">
          <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-gray-400">
            Traits
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            <TraitRow label="Head" value={traits.head} />
            <TraitRow label="Noggles" value={traits.glasses} />
            <TraitRow label="Body" value={traits.body} />
            <TraitRow label="Accessory" value={traits.accessory} />
          </div>
        </div>
      )}

      {/* ── Auction Result ── */}
      {auction && auction.settled && (
        <div className="border-b border-gray-200 px-3 py-2">
          {/* Burned = reserve-not-met settlement. Show BURNED banner instead
               of "Winning Bid: 0.00 ETH / Bids: 0" which would be technically
               correct but misleading — the noun no longer exists. */}
          {auction.burned ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-600">
                Burned
              </span>
              <span className="text-xs font-semibold text-gray-700">Reserve not met</span>
              <span className="text-[10px] text-gray-500">
                No bid reached the minimum reserve price.
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs">
              <div>
                <span className="font-mono text-[8px] uppercase text-gray-400">
                  Winning Bid
                </span>
                <br />
                <span className="font-bold">
                  {auction.amount
                    ? `${parseFloat(formatEther(auction.amount)).toFixed(2)} ETH`
                    : '--'}
                </span>
              </div>
              <div className="text-right">
                <span className="font-mono text-[8px] uppercase text-gray-400">
                  Bids
                </span>
                <br />
                <span className="font-semibold">{auction.bidCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Color Palette ── */}
      {seed && (
        <div className="border-b border-gray-200 px-3 py-1.5">
          <NounPalette seed={seed} max={12} />
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-2 px-3 py-2">
        <Link
          to={`/?topic=noun:${nounId}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border-2 border-black bg-yellow-200 px-2 py-1.5 text-xs font-bold no-underline transition-colors hover:bg-yellow-300"
        >
          <MessageCircle className="size-3.5" />
          Post as Topic
        </Link>
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded border-2 border-black bg-gray-100 px-2 py-1.5 text-xs font-bold transition-colors hover:bg-gray-200"
          onClick={() => {
            // Phase 2: open fund pool modal
          }}
        >
          <Landmark className="size-3.5" />
          Fund Pool
        </button>
      </div>

      {/* ── Fund Pool Section ── */}
      <FundPoolSection nounId={nounId} />

      {/* ── Loading overlay ── */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <span className="text-xs text-gray-400">Loading...</span>
        </div>
      )}
    </div>
  );
};

// ── Trait Row ──────────────────────────────────────────────────────────────────

const TraitRow: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <span className="font-mono text-[8px] uppercase text-gray-400">{label}</span>
    <br />
    <span className="font-semibold">{value}</span>
  </div>
);

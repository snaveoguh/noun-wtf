import { FC, memo } from 'react';

import { blo } from 'blo';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

import { StandaloneNounImage } from '@/components/StandaloneNoun';
import { cn } from '@/lib/utils';
import { formatShortAddress } from '@/utils/addressAndENSDisplayUtils';
import { Address } from '@/utils/types';

import { useVoterHoverData } from './useVoterHoverData';

interface VoterHoverCardContentProps {
  address: Address;
}

const NOUN_GRID_VISIBLE = 14;

export const VoterHoverCardContent: FC<VoterHoverCardContentProps> = memo(({ address }) => {
  const data = useVoterHoverData(address);
  const {
    isLoading,
    ensName,
    ensAvatar,
    ownedNounIds,
    delegatedVotes,
    delegatorCount,
    proposalCount,
    voteCount,
    feedbackCount,
    candidateCount,
    sponsoredCount,
    multisig,
  } = data;

  const shortAddr = formatShortAddress(address);
  const profileHref = `/delegate?to=${address}`;
  const ownedCount = ownedNounIds.length;
  // The delegate-supplied total includes the delegate's own held nouns.
  // "Delegated from N other addresses" reads better than the raw sum, so
  // subtract own holdings to get the truly-delegated count.
  const delegatedFromOthers = Math.max(0, delegatedVotes - ownedCount);
  const visibleNouns = ownedNounIds.slice(0, NOUN_GRID_VISIBLE);
  const overflow = Math.max(0, ownedCount - NOUN_GRID_VISIBLE);

  return (
    <div className="flex flex-col gap-2.5 p-3 text-[12px] leading-tight text-zinc-100">
      {/* ── Header row ── */}
      <Link
        to={profileHref}
        className="group flex items-center gap-2 no-underline"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={ensAvatar ?? blo(address)}
          alt=""
          className="size-6 shrink-0 rounded-full bg-zinc-800 object-cover"
          style={{ backgroundImage: `url(${blo(address)})` }}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
          {ensName ?? shortAddr}
        </span>
        {ensName && (
          <span className="font-mono text-[11px] text-zinc-500">{shortAddr}</span>
        )}
        <ArrowRight
          className="size-3.5 shrink-0 text-zinc-500 transition-colors group-hover:text-white"
          aria-hidden
        />
      </Link>

      {/* ── Owned nouns grid ── */}
      {(isLoading || ownedCount > 0) && (
        <div className="grid grid-cols-7 gap-1.5">
          {isLoading && ownedCount === 0
            ? Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded bg-zinc-800/70"
                />
              ))
            : visibleNouns.map(id => (
                <NounThumb key={id} nounId={id} />
              ))}
          {overflow > 0 && (
            <div className="flex aspect-square items-center justify-center rounded bg-zinc-800 text-[10px] font-semibold text-zinc-300">
              +{overflow}
            </div>
          )}
        </div>
      )}

      {/* ── Stats line 1 ── */}
      <div className={cn('text-[11px] text-zinc-400', isLoading && 'animate-pulse')}>
        {isLoading ? (
          <span className="inline-block h-3 w-44 rounded bg-zinc-800" />
        ) : (
          <>
            Owns {ownedCount} noun{ownedCount === 1 ? '' : 's'}
            {delegatedFromOthers > 0 && (
              <>
                , {delegatedFromOthers} delegated
                {delegatorCount > 0 && (
                  <> from {delegatorCount} address{delegatorCount === 1 ? '' : 'es'}</>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Stats line 2 ── */}
      <div className={cn('text-[11px] text-zinc-400', isLoading && 'animate-pulse')}>
        {isLoading ? (
          <span className="inline-block h-3 w-56 rounded bg-zinc-800" />
        ) : (
          <StatList
            entries={[
              [voteCount, 'votes'],
              [feedbackCount, 'feedback'],
              [proposalCount, 'proposals'],
              [candidateCount, 'candidate', 'candidates'],
              [sponsoredCount, 'sponsored'],
            ]}
          />
        )}
      </div>

      {/* ── Multisig section ── */}
      {multisig && multisig.owners.length > 0 && (
        <div className="border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          {multisig.threshold} of {multisig.owners.length} multisig:{' '}
          {multisig.owners.slice(0, 6).map((owner, i) => (
            <span key={owner}>
              {i > 0 && ', '}
              <span className="text-zinc-400">{formatShortAddress(owner)}</span>
            </span>
          ))}
          {multisig.owners.length > 6 && (
            <span className="text-zinc-500">, +{multisig.owners.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
});

VoterHoverCardContent.displayName = 'VoterHoverCardContent';

const NounThumb: FC<{ nounId: number }> = memo(({ nounId }) => (
  <div className="flex flex-col items-center gap-0.5">
    <div className="size-full overflow-hidden rounded">
      <StandaloneNounImage nounId={BigInt(nounId)} />
    </div>
    <span className="text-[9px] leading-none text-zinc-500">{nounId}</span>
  </div>
));
NounThumb.displayName = 'NounThumb';

interface StatListProps {
  entries: Array<readonly [number, string] | readonly [number, string, string]>;
}

const StatList: FC<StatListProps> = ({ entries }) => {
  const filled = entries.filter(([n]) => n > 0);
  if (filled.length === 0) return <span>No activity yet</span>;
  return (
    <>
      {filled.map(([n, singular, plural], i) => (
        <span key={singular}>
          {i > 0 && ', '}
          <span className="text-zinc-200">{n}</span>{' '}
          {n === 1 ? singular : (plural ?? singular)}
        </span>
      ))}
    </>
  );
};

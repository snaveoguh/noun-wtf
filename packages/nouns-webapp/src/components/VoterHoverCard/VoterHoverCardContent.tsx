import { FC, memo } from 'react';

import { blo } from 'blo';
import { Link } from 'react-router';

import { StandaloneNounImage } from '@/components/StandaloneNoun';
import { cn } from '@/lib/utils';
import { Sparkle } from '@/liquid-sand/icons';
import { formatShortAddress } from '@/utils/addressAndENSDisplayUtils';
import { Address } from '@/utils/types';

import { useVoterHoverData } from './useVoterHoverData';

interface VoterHoverCardContentProps {
  address: Address;
}

const NOUN_GRID_VISIBLE = 14;

// Reusable inline-style snippets so the JSX stays scannable. All values
// resolve to Liquid Sand tokens — no Tailwind color classes from here.
const fontSans: React.CSSProperties = { fontFamily: 'var(--ls-font-sans)' };
const fontMono: React.CSSProperties = { fontFamily: 'var(--ls-font-mono)' };
const colorOnDark: React.CSSProperties = { color: 'var(--ls-fg-on-dark)' };
const colorSecondary: React.CSSProperties = { color: 'var(--ls-fg-secondary)' };
const colorMuted: React.CSSProperties = { color: 'var(--ls-fg-muted)' };

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
    <div
      className="flex flex-col gap-2.5 p-3 leading-tight"
      style={{ ...fontSans, ...colorOnDark, fontSize: 'var(--ls-text-sm)' }}
    >
      {/* ── Header row ── */}
      <Link
        to={profileHref}
        className="group flex items-center gap-2 no-underline"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={ensAvatar ?? blo(address)}
          alt=""
          className="size-6 shrink-0 object-cover"
          style={{
            // Avatar uses the smaller chip radius so it reads as a token,
            // not a window. Background falls back to the blockie data URL.
            borderRadius: 'var(--ls-r-full)',
            backgroundImage: `url(${blo(address)})`,
            backgroundColor: 'rgba(255,250,240,0.06)',
          }}
        />
        <span
          className="min-w-0 flex-1 truncate font-bold"
          style={{ ...fontSans, ...colorOnDark, fontSize: 'var(--ls-text-md)' }}
        >
          {ensName ?? shortAddr}
        </span>
        {ensName && (
          <span
            className="tabular-nums"
            style={{ ...fontMono, ...colorMuted, fontSize: 'var(--ls-text-xs)' }}
          >
            {shortAddr}
          </span>
        )}
        <Sparkle
          className="shrink-0 transition-colors group-hover:[color:var(--ls-fg-on-dark)]"
          size={14}
          style={colorMuted}
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
                  className="aspect-square animate-pulse"
                  style={{
                    borderRadius: 'var(--ls-r-sm)',
                    backgroundColor: 'rgba(255,250,240,0.06)',
                  }}
                />
              ))
            : visibleNouns.map(id => <NounThumb key={id} nounId={id} />)}
          {overflow > 0 && (
            <div
              className="flex aspect-square items-center justify-center font-semibold"
              style={{
                ...fontSans,
                ...colorSecondary,
                fontSize: 'var(--ls-text-xs)',
                borderRadius: 'var(--ls-r-sm)',
                backgroundColor: 'rgba(255,250,240,0.08)',
              }}
            >
              +{overflow}
            </div>
          )}
        </div>
      )}

      {/* ── Stats line 1 ── */}
      <div
        className={cn(isLoading && 'animate-pulse')}
        style={{ ...fontSans, ...colorMuted, fontSize: 'var(--ls-text-sm)' }}
      >
        {isLoading ? (
          <span
            className="inline-block h-3 w-44"
            style={{
              backgroundColor: 'rgba(255,250,240,0.08)',
              borderRadius: 'var(--ls-r-sm)',
            }}
          />
        ) : (
          <>
            Owns{' '}
            <span className="tabular-nums" style={{ ...fontMono, ...colorOnDark }}>
              {ownedCount}
            </span>{' '}
            noun{ownedCount === 1 ? '' : 's'}
            {delegatedFromOthers > 0 && (
              <>
                ,{' '}
                <span className="tabular-nums" style={{ ...fontMono, ...colorOnDark }}>
                  {delegatedFromOthers}
                </span>{' '}
                delegated
                {delegatorCount > 0 && (
                  <>
                    {' '}
                    from{' '}
                    <span className="tabular-nums" style={{ ...fontMono, ...colorOnDark }}>
                      {delegatorCount}
                    </span>{' '}
                    address{delegatorCount === 1 ? '' : 'es'}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Stats line 2 ── */}
      <div
        className={cn(isLoading && 'animate-pulse')}
        style={{ ...fontSans, ...colorMuted, fontSize: 'var(--ls-text-sm)' }}
      >
        {isLoading ? (
          <span
            className="inline-block h-3 w-56"
            style={{
              backgroundColor: 'rgba(255,250,240,0.08)',
              borderRadius: 'var(--ls-r-sm)',
            }}
          />
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
        <div
          className="pt-2"
          style={{
            // Hairline divider — same border token as the panel itself so
            // it disappears against the glass when scrolled past.
            borderTop: '1px solid var(--ls-border-glass)',
            ...fontSans,
            ...colorMuted,
            fontSize: 'var(--ls-text-xs)',
          }}
        >
          <span className="tabular-nums" style={fontMono}>
            {multisig.threshold}
          </span>{' '}
          of{' '}
          <span className="tabular-nums" style={fontMono}>
            {multisig.owners.length}
          </span>{' '}
          multisig:{' '}
          {multisig.owners.slice(0, 6).map((owner, i) => (
            <span key={owner}>
              {i > 0 && ', '}
              <span className="tabular-nums" style={{ ...fontMono, ...colorSecondary }}>
                {formatShortAddress(owner)}
              </span>
            </span>
          ))}
          {multisig.owners.length > 6 && (
            <span style={colorMuted}>, +{multisig.owners.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
});

VoterHoverCardContent.displayName = 'VoterHoverCardContent';

const NounThumb: FC<{ nounId: number }> = memo(({ nounId }) => (
  <div className="flex flex-col items-center gap-0.5">
    <div
      className="size-full overflow-hidden"
      style={{ borderRadius: 'var(--ls-r-sm)' }}
    >
      <StandaloneNounImage nounId={BigInt(nounId)} />
    </div>
    <span
      className="leading-none tabular-nums"
      style={{ ...fontMono, ...colorMuted, fontSize: '9px' }}
    >
      {nounId}
    </span>
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
          <span className="tabular-nums" style={{ ...fontMono, ...colorOnDark }}>
            {n}
          </span>{' '}
          {n === 1 ? singular : (plural ?? singular)}
        </span>
      ))}
    </>
  );
};

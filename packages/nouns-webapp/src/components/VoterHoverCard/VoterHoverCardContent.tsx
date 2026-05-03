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

// Render every represented noun. Big delegates can carry 100+ tokens and the
// user wants the full bag visible; a max-height + scroll on the grid keeps
// extreme cases (whales, multisigs) from blowing the popover out of bounds.
const NOUN_GRID_MAX_HEIGHT = 280;

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
    delegatedNounIds,
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
  // Show owned first (the delegate's own bag), then delegated-to (their
  // proxied voting power). Each thumb is tagged so we can render a subtle
  // visual distinction between the two.
  const allRepresented: { id: number; kind: 'owned' | 'delegated' }[] = [
    ...ownedNounIds.map(id => ({ id, kind: 'owned' as const })),
    ...delegatedNounIds.map(id => ({ id, kind: 'delegated' as const })),
  ];
  // Indexer bug: delegate.delegatedVotes returns the correct aggregate but
  // delegateNoun.items is empty for most addresses, so we usually can't
  // enumerate delegated noun IDs. Surface the count visually with a sand-
  // tinted placeholder tile so the user still senses the voting power.
  const phantomDelegated =
    delegatedNounIds.length === 0 && delegatedFromOthers > 0
      ? delegatedFromOthers
      : 0;

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

      {/* ── Owned + delegated nouns grid ── */}
      {(isLoading || allRepresented.length > 0 || phantomDelegated > 0) && (
        <div
          className="overflow-y-auto pr-0.5"
          style={{ maxHeight: NOUN_GRID_MAX_HEIGHT }}
        >
          <div className="grid grid-cols-7 gap-1.5">
            {isLoading && allRepresented.length === 0
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
              : allRepresented.map(n => (
                  <NounThumb key={`${n.kind}-${n.id}`} nounId={n.id} kind={n.kind} />
                ))}
            {phantomDelegated > 0 && (
              <div
                className="flex aspect-square flex-col items-center justify-center font-semibold leading-none"
                style={{
                  ...fontSans,
                  ...colorSecondary,
                  fontSize: 'var(--ls-text-xs)',
                  borderRadius: 'var(--ls-r-sm)',
                  backgroundColor: 'rgba(184,147,82,0.14)', // sand accent tint
                  boxShadow: 'inset 0 0 0 1px rgba(255,250,240,0.18)',
                }}
                title={`${phantomDelegated} nouns delegated to this address`}
              >
                <span className="tabular-nums" style={fontMono}>
                  +{phantomDelegated}
                </span>
                <span style={{ ...colorMuted, fontSize: '8px', marginTop: 2 }}>
                  deleg
                </span>
              </div>
            )}
          </div>
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

// Delegated nouns get a subtle dim + ring so it's clear which voting power
// is the delegate's own vs proxied to them. Hover the card to read the count
// label for the precise breakdown.
const NounThumb: FC<{ nounId: number; kind: 'owned' | 'delegated' }> = memo(
  ({ nounId, kind }) => (
    <div className="flex flex-col items-center gap-0.5" title={kind}>
      <div
        className="size-full overflow-hidden"
        style={{
          borderRadius: 'var(--ls-r-sm)',
          opacity: kind === 'delegated' ? 0.75 : 1,
          boxShadow:
            kind === 'delegated'
              ? 'inset 0 0 0 1px rgba(255,250,240,0.18)'
              : 'none',
        }}
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
  ),
);
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

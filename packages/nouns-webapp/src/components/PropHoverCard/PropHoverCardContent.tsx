import { FC, memo, useMemo } from 'react';

import { useBlockNumber } from 'wagmi';

import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';
import { VoterHoverCard } from '@/components/VoterHoverCard';
import { GlassButton, GlassChip, type GlassChipTone } from '@/liquid-sand/glass';
import { Sparkle } from '@/liquid-sand/icons';
import { formatShortAddress } from '@/utils/addressAndENSDisplayUtils';
import { ProposalState } from '@/wrappers/nounsDao';

import { usePropHoverData, type PropHoverData } from './usePropHoverData';

interface PropHoverCardContentProps {
  type: 'proposal' | 'candidate';
  proposalId?: string;
  candidateSlug?: string;
}

// External deep-link pattern. nouns.game's per-proposal route is `/vote/{id}`,
// matching the in-repo `/vote/:id` route — kept aligned so users land on the
// equivalent context. Candidates share the proposal browser at `/vote`.
const NOUNS_GAME_BASE = 'https://www.nouns.game';
function externalLink(type: 'proposal' | 'candidate', id: string): string {
  if (type === 'proposal' && id) return `${NOUNS_GAME_BASE}/vote/${id}`;
  return `${NOUNS_GAME_BASE}/vote`;
}

type StatusTone = 'active' | 'positive' | 'negative' | 'neutral';

const STATUS_DISPLAY: Record<string, { label: string; tone: StatusTone }> = {
  [ProposalState.PENDING]: { label: 'PENDING', tone: 'neutral' },
  [ProposalState.ACTIVE]: { label: 'VOTING', tone: 'active' },
  [ProposalState.OBJECTION_PERIOD]: { label: 'OBJECTION', tone: 'active' },
  [ProposalState.UPDATABLE]: { label: 'UPDATABLE', tone: 'neutral' },
  [ProposalState.SUCCEEDED]: { label: 'SUCCEEDED', tone: 'positive' },
  [ProposalState.QUEUED]: { label: 'QUEUED', tone: 'positive' },
  [ProposalState.EXECUTED]: { label: 'EXECUTED', tone: 'positive' },
  [ProposalState.DEFEATED]: { label: 'DEFEATED', tone: 'negative' },
  [ProposalState.CANCELLED]: { label: 'CANCELLED', tone: 'negative' },
  [ProposalState.VETOED]: { label: 'VETOED', tone: 'negative' },
  [ProposalState.EXPIRED]: { label: 'EXPIRED', tone: 'negative' },
  CANDIDATE_LIVE: { label: 'LIVE', tone: 'active' },
  CANDIDATE_CANCELLED: { label: 'CANCELLED', tone: 'negative' },
  CANDIDATE_PROMOTED: { label: 'PROMOTED', tone: 'positive' },
};

// Map our internal status tone vocabulary onto GlassChip's tone enum.
// "active" → "accent" so the gold sand-tone signals in-progress; outcomes
// (positive/negative) map to success/danger; everything else stays neutral.
const CHIP_TONE: Record<StatusTone, GlassChipTone> = {
  active: 'accent',
  positive: 'success',
  negative: 'danger',
  neutral: 'neutral',
};

const AVG_BLOCK_TIME_S = 12;

// Reusable inline-style snippets so the JSX stays scannable. Tokens-only,
// no Tailwind colour classes.
const fontSans: React.CSSProperties = { fontFamily: 'var(--ls-font-sans)' };
const fontMono: React.CSSProperties = { fontFamily: 'var(--ls-font-mono)' };
const colorOnDark: React.CSSProperties = { color: 'var(--ls-fg-on-dark)' };
const colorSecondary: React.CSSProperties = { color: 'var(--ls-fg-secondary)' };
const colorMuted: React.CSSProperties = { color: 'var(--ls-fg-muted)' };

/** Format a remaining duration as "Nh Nm" / "Nd Nh" / "Nm". */
function formatTimeLeft(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Ended';
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m left`;
}

function votingTimerLabel(
  status: PropHoverData['status'],
  endBlock: bigint | undefined,
  objectionPeriodEndBlock: bigint | undefined,
  currentBlock: bigint | undefined,
): string | null {
  if (status !== ProposalState.ACTIVE && status !== ProposalState.OBJECTION_PERIOD) {
    return null;
  }
  const target = status === ProposalState.OBJECTION_PERIOD ? objectionPeriodEndBlock : endBlock;
  if (target == null || currentBlock == null) return 'VOTING';
  const blocksLeft = Number(target) - Number(currentBlock);
  if (blocksLeft <= 0) return 'VOTING';
  const baseLabel = status === ProposalState.OBJECTION_PERIOD ? 'OBJECTION' : 'VOTING';
  return `${baseLabel} · ${formatTimeLeft(blocksLeft * AVG_BLOCK_TIME_S)}`;
}

/**
 * Compact segmented vote bar — same idea as GameProposals' bar but slimmer
 * (~150px max, 6px tall) so the card stays dense. Colour comes from the
 * Liquid Sand for/against tokens (HIG-aligned emerald/rose).
 */
function CompactVoteBar({
  forCount,
  againstCount,
  abstainCount,
}: {
  forCount: number;
  againstCount: number;
  abstainCount: number;
}) {
  const total = forCount + againstCount + abstainCount;
  const trackBg = 'rgba(255,250,240,0.06)';
  if (total === 0) {
    return (
      <div
        className="h-[6px] w-full"
        style={{ borderRadius: 'var(--ls-r-sm)', backgroundColor: trackBg }}
        aria-hidden
      />
    );
  }
  const forPct = (forCount / total) * 100;
  const againstPct = (againstCount / total) * 100;
  const abstainPct = Math.max(0, 100 - forPct - againstPct);
  return (
    <div
      className="flex h-[6px] w-full overflow-hidden"
      style={{ borderRadius: 'var(--ls-r-sm)', backgroundColor: trackBg }}
      aria-hidden
    >
      {forPct > 0 && (
        <span style={{ width: `${forPct}%`, backgroundColor: 'var(--ls-for)' }} />
      )}
      {againstPct > 0 && (
        <span style={{ width: `${againstPct}%`, backgroundColor: 'var(--ls-against)' }} />
      )}
      {abstainPct > 0 && (
        <span style={{ width: `${abstainPct}%`, backgroundColor: 'rgba(255,250,240,0.32)' }} />
      )}
    </div>
  );
}

export const PropHoverCardContent: FC<PropHoverCardContentProps> = memo(
  // eslint-disable-next-line react/prop-types -- false positive: props are typed via FC<…>
  ({ type, proposalId, candidateSlug }) => {
    const data = usePropHoverData(
      type === 'proposal'
        ? { type: 'proposal', proposalId: proposalId ?? '' }
        : { type: 'candidate', candidateSlug: candidateSlug ?? '' },
    );

    const { data: blockNumber } = useBlockNumber();
    const ensLookup = useEnsNames(
      useMemo(() => (data.proposer ? [data.proposer] : []), [data.proposer]),
    );

    const proposerEns = data.proposer ? ensLookup(data.proposer) : null;
    const proposerDisplay = proposerEns
      ? proposerEns
      : data.proposer
        ? formatShortAddress(data.proposer as `0x${string}`)
        : '';

    const statusDisplay = STATUS_DISPLAY[String(data.status)] ?? {
      label: '—',
      tone: 'neutral' as StatusTone,
    };
    const showTally = type === 'proposal';
    const timerLabel =
      type === 'proposal'
        ? votingTimerLabel(data.status, data.endBlock, data.objectionPeriodEndBlock, blockNumber)
        : null;

    const href = externalLink(type, data.id);

    // Loading: skeleton placeholders for title/excerpt/byline. Status pill
    // still renders its frame so the card height is roughly stable when
    // content lands. Error case: degrade gracefully (just the header).
    if (data.isLoading) {
      const skBg = 'rgba(255,250,240,0.08)';
      const skR = { borderRadius: 'var(--ls-r-sm)' };
      return (
        <div
          className="flex flex-col gap-2.5 p-3 leading-tight"
          style={{ ...fontSans, ...colorOnDark, fontSize: 'var(--ls-text-sm)' }}
        >
          <div className="flex items-start gap-2">
            <div className="h-3.5 flex-1 animate-pulse" style={{ ...skR, backgroundColor: skBg }} />
            <div className="h-4 w-14 animate-pulse" style={{ ...skR, backgroundColor: skBg }} />
          </div>
          <div className="h-2.5 w-32 animate-pulse" style={{ ...skR, backgroundColor: skBg }} />
          <div className="space-y-1.5">
            <div className="h-2 w-full animate-pulse" style={{ ...skR, backgroundColor: skBg }} />
            <div className="h-2 w-11/12 animate-pulse" style={{ ...skR, backgroundColor: skBg }} />
            <div className="h-2 w-3/4 animate-pulse" style={{ ...skR, backgroundColor: skBg }} />
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex flex-col gap-2.5 p-3 leading-tight"
        style={{ ...fontSans, ...colorOnDark, fontSize: 'var(--ls-text-sm)' }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              {type === 'proposal' && (
                <span
                  className="font-semibold tabular-nums"
                  style={{ ...fontMono, ...colorMuted, fontSize: 'var(--ls-text-xs)' }}
                >
                  {data.id}
                </span>
              )}
              <span
                className="line-clamp-2 font-bold leading-snug"
                style={{ ...fontSans, ...colorOnDark, fontSize: 'var(--ls-text-md)' }}
              >
                {data.title}
              </span>
            </div>
            {proposerDisplay && (
              <div
                className="mt-1"
                style={{ ...fontSans, ...colorMuted, fontSize: 'var(--ls-text-xs)' }}
              >
                by{' '}
                {data.proposer ? (
                  <VoterHoverCard address={data.proposer} asChild>
                    <span
                      className="cursor-default transition-colors hover:[color:var(--ls-fg-on-dark)]"
                      style={colorSecondary}
                    >
                      {proposerDisplay}
                    </span>
                  </VoterHoverCard>
                ) : (
                  <span style={colorSecondary}>{proposerDisplay}</span>
                )}
              </div>
            )}
          </div>
          <GlassChip tone={CHIP_TONE[statusDisplay.tone]} size="xs" className="shrink-0">
            {statusDisplay.label}
          </GlassChip>
        </div>

        {/* ── Excerpt ───────────────────────────────────────────── */}
        {data.excerpt && (
          <p
            className="line-clamp-3 leading-snug"
            style={{ ...fontSans, ...colorMuted, fontSize: 'var(--ls-text-sm)' }}
          >
            {data.excerpt}
          </p>
        )}

        {/* ── Tally bar (proposals only) ────────────────────────── */}
        {showTally && (
          <div className="flex flex-col gap-1.5">
            <div className="max-w-[160px]">
              <CompactVoteBar
                forCount={data.forCount}
                againstCount={data.againstCount}
                abstainCount={data.abstainCount}
              />
            </div>
            <div
              className="flex items-center justify-between tabular-nums tracking-wider"
              style={{ ...fontMono, ...colorMuted, fontSize: 'var(--ls-text-xs)' }}
            >
              <span className="inline-flex items-center gap-2.5">
                <span style={{ color: 'var(--ls-for)' }}>
                  FOR{' '}
                  <strong className="font-bold" style={{ color: 'var(--ls-for-strong)' }}>
                    {data.forCount}
                  </strong>
                </span>
                <span style={{ color: 'var(--ls-against)' }}>
                  AGAINST{' '}
                  <strong className="font-bold" style={{ color: 'var(--ls-against-strong)' }}>
                    {data.againstCount}
                  </strong>
                </span>
                <span style={colorMuted}>
                  ABSTAIN{' '}
                  <strong className="font-bold" style={colorSecondary}>
                    {data.abstainCount}
                  </strong>
                </span>
              </span>
            </div>
          </div>
        )}

        {/* ── Timer ─────────────────────────────────────────────── */}
        {timerLabel && (
          <div
            className="uppercase tracking-wider"
            style={{ ...fontMono, ...colorMuted, fontSize: 'var(--ls-text-xs)' }}
          >
            {timerLabel}
          </div>
        )}

        {/* ── External link ─────────────────────────────────────── */}
        <div className="mt-1 self-start">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={e => {
              e.stopPropagation();
              window.open(href, '_blank', 'noopener,noreferrer');
            }}
            style={{
              // Ghost variant defaults to fg-primary which is dark-on-light.
              // Force the muted-on-dark colour so the button reads against
              // the smoked glass; hover state lifts to full on-dark.
              color: 'var(--ls-fg-muted)',
              fontFamily: 'var(--ls-font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            View on nouns.game
            <Sparkle size={12} aria-hidden />
          </GlassButton>
        </div>
      </div>
    );
  },
);

PropHoverCardContent.displayName = 'PropHoverCardContent';

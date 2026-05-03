import { FC, memo, useMemo } from 'react';

import { ExternalLinkIcon } from 'lucide-react';
import { useBlockNumber } from 'wagmi';

import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';
import { VoterHoverCard } from '@/components/VoterHoverCard';
import { cn } from '@/lib/utils';
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

type StatusTone = 'active' | 'positive' | 'negative' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  // Same emerald/rose palette already used by GameProposals' .status* classes.
  active: 'bg-emerald-700/20 text-emerald-300 ring-1 ring-inset ring-emerald-700/55',
  positive: 'bg-emerald-700/15 text-emerald-200 ring-1 ring-inset ring-emerald-700/40',
  negative: 'bg-rose-700/18 text-rose-300 ring-1 ring-inset ring-rose-700/50',
  neutral: 'bg-white/6 text-zinc-400',
};

const AVG_BLOCK_TIME_S = 12;

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
 * (~150px max, 6px tall) so the card stays dense.
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
  if (total === 0) {
    return <div className="h-[6px] w-full rounded-sm bg-white/[0.06]" aria-hidden />;
  }
  const forPct = (forCount / total) * 100;
  const againstPct = (againstCount / total) * 100;
  const abstainPct = Math.max(0, 100 - forPct - againstPct);
  return (
    <div className="flex h-[6px] w-full overflow-hidden rounded-sm bg-white/[0.04]" aria-hidden>
      {forPct > 0 && <span className="bg-emerald-700" style={{ width: `${forPct}%` }} />}
      {againstPct > 0 && <span className="bg-rose-700" style={{ width: `${againstPct}%` }} />}
      {abstainPct > 0 && <span className="bg-white/30" style={{ width: `${abstainPct}%` }} />}
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
      return (
        <div className="flex flex-col gap-2.5 p-3 text-[12px] leading-tight text-zinc-100">
          <div className="flex items-start gap-2">
            <div className="h-3.5 flex-1 animate-pulse rounded bg-zinc-800/80" />
            <div className="h-4 w-14 animate-pulse rounded bg-zinc-800/80" />
          </div>
          <div className="h-2.5 w-32 animate-pulse rounded bg-zinc-800/60" />
          <div className="space-y-1.5">
            <div className="h-2 w-full animate-pulse rounded bg-zinc-800/60" />
            <div className="h-2 w-11/12 animate-pulse rounded bg-zinc-800/60" />
            <div className="h-2 w-3/4 animate-pulse rounded bg-zinc-800/60" />
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2.5 p-3 text-[12px] leading-tight text-zinc-100">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              {type === 'proposal' && (
                <span className="font-mono text-[11px] font-semibold tabular-nums text-zinc-500">
                  {data.id}
                </span>
              )}
              <span className="line-clamp-2 text-[12.5px] font-bold leading-snug text-white">
                {data.title}
              </span>
            </div>
            {proposerDisplay && (
              <div className="mt-1 text-[11px] text-zinc-500">
                by{' '}
                {data.proposer ? (
                  <VoterHoverCard address={data.proposer} asChild>
                    <span className="cursor-default text-zinc-300 hover:text-white">
                      {proposerDisplay}
                    </span>
                  </VoterHoverCard>
                ) : (
                  <span className="text-zinc-300">{proposerDisplay}</span>
                )}
              </div>
            )}
          </div>
          <span
            className={cn(
              // Match GameProposals' status pill (Silkscreen pixel font,
              // sharp 2px tab) so the hover card visually echoes the parent.
              'shrink-0 rounded-sm px-1.5 py-0.5 text-[9.5px] uppercase leading-none tracking-wider',
              '[font-family:var(--gs-font-display)]',
              TONE_CLASSES[statusDisplay.tone],
            )}
          >
            {statusDisplay.label}
          </span>
        </div>

        {/* ── Excerpt ───────────────────────────────────────────── */}
        {data.excerpt && (
          <p className="line-clamp-3 text-[11.5px] leading-snug text-zinc-400">{data.excerpt}</p>
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
            <div className="flex items-center justify-between font-mono text-[10.5px] tabular-nums tracking-wider text-zinc-400">
              <span className="inline-flex items-center gap-2.5">
                <span className="text-emerald-500">
                  FOR <strong className="font-bold text-emerald-300">{data.forCount}</strong>
                </span>
                <span className="text-rose-500">
                  AGAINST <strong className="font-bold text-rose-300">{data.againstCount}</strong>
                </span>
                <span className="text-zinc-500">
                  ABSTAIN <strong className="font-bold text-zinc-300">{data.abstainCount}</strong>
                </span>
              </span>
            </div>
          </div>
        )}

        {/* ── Timer ─────────────────────────────────────────────── */}
        {timerLabel && (
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-500">
            {timerLabel}
          </div>
        )}

        {/* ── External link ─────────────────────────────────────── */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 self-start text-[10.5px] uppercase tracking-wider text-zinc-500 no-underline transition-colors hover:text-white"
          onClick={e => e.stopPropagation()}
        >
          View on nouns.game
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      </div>
    );
  },
);

PropHoverCardContent.displayName = 'PropHoverCardContent';

import { Fragment, useMemo, useState } from 'react';

import { useQuery } from '@apollo/client';
import { useBlockNumber } from 'wagmi';

import { PropHoverCard } from '@/components/PropHoverCard';
import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';
import { VoterHoverCard } from '@/components/VoterHoverCard';
import { formatShortAddress } from '@/utils/addressAndENSDisplayUtils';
import type { Address } from '@/utils/types';
import { ProposalState, useAllProposals, type PartialProposal } from '@/wrappers/nounsDao';
import { useCandidateProposals, type ProposalCandidate } from '@/wrappers/nounsData';
import { proposalVotesQuery } from '@/wrappers/subgraph';

import classes from './GameShell.module.css';

type TabKey = 'proposals' | 'candidates' | 'topics';

interface TabSpec {
  key: TabKey;
  label: string;
}

const TABS: TabSpec[] = [
  { key: 'proposals', label: 'Proposals' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'topics', label: 'Topics' },
];

const STATUS_LABELS: Partial<Record<ProposalState, string>> = {
  [ProposalState.PENDING]: 'Pending',
  [ProposalState.ACTIVE]: 'Voting',
  [ProposalState.OBJECTION_PERIOD]: 'Objection',
  [ProposalState.UPDATABLE]: 'Updatable',
  [ProposalState.SUCCEEDED]: 'Succeeded',
  [ProposalState.QUEUED]: 'Queued',
  [ProposalState.EXECUTED]: 'Executed',
  [ProposalState.DEFEATED]: 'Defeated',
  [ProposalState.CANCELLED]: 'Cancelled',
  [ProposalState.VETOED]: 'Vetoed',
  [ProposalState.EXPIRED]: 'Expired',
};

function statusToneClass(status: ProposalState): string {
  switch (status) {
    case ProposalState.ACTIVE:
    case ProposalState.OBJECTION_PERIOD:
      return classes.statusActive;
    case ProposalState.SUCCEEDED:
    case ProposalState.QUEUED:
    case ProposalState.EXECUTED:
      return classes.statusPositive;
    case ProposalState.DEFEATED:
    case ProposalState.CANCELLED:
    case ProposalState.VETOED:
    case ProposalState.EXPIRED:
      return classes.statusNegative;
    default:
      return classes.statusNeutral;
  }
}

const AVG_BLOCK_TIME_S = 12;

/** Format "Nd Nh", "Nh Nm", or "Nm" — keeps the byline compact. */
function formatTimeLeft(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Ended';
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Block-aware "VOTING 1d 2h" — falls back to bare "VOTING" when we don't
 * have a current block yet. Uses 12s block estimates (mainnet post-merge).
 */
function getVotingTimer(p: PartialProposal, currentBlock: bigint | undefined): string | null {
  if (p.status !== ProposalState.ACTIVE && p.status !== ProposalState.OBJECTION_PERIOD) {
    return null;
  }
  const target =
    p.status === ProposalState.OBJECTION_PERIOD ? p.objectionPeriodEndBlock : p.endBlock;
  if (!target) return 'VOTING';
  if (currentBlock == null) return 'VOTING';
  const blocksLeft = Number(target) - Number(currentBlock);
  if (blocksLeft <= 0) return 'VOTING';
  return `VOTING ${formatTimeLeft(blocksLeft * AVG_BLOCK_TIME_S)}`;
}

/** Generate a deterministic gradient for an address — used as avatar fallback. */
function avatarGradient(addr: string): string {
  const a = parseInt(addr.slice(2, 8), 16) % 360;
  const b = parseInt(addr.slice(8, 14), 16) % 360;
  return `linear-gradient(135deg, hsl(${a}, 60%, 55%), hsl(${b}, 60%, 35%))`;
}

interface RawVote {
  support: number;
  votes: number;
  voter: string;
  reason?: string;
  clientId?: number;
  createdAtBlock?: string;
  createdAtTransaction?: string;
}

/** Render the segmented vote bar (one tick per vote, color by support). */
function SegmentedVoteBar({
  forCount,
  againstCount,
  abstainCount,
}: {
  forCount: number;
  againstCount: number;
  abstainCount: number;
}) {
  const total = forCount + againstCount + abstainCount;
  // Cap the number of ticks rendered so a 200-vote prop doesn't ship 200
  // DOM nodes per card. Ticks remain visually proportional.
  const MAX_TICKS = 60;
  const targetTicks = total > 0 ? Math.min(total, MAX_TICKS) : MAX_TICKS;
  const ticks: ('for' | 'against' | 'abstain' | 'empty')[] = [];
  if (total === 0) {
    for (let i = 0; i < targetTicks; i++) ticks.push('empty');
  } else {
    const forTicks = Math.round((forCount / total) * targetTicks);
    const againstTicks = Math.round((againstCount / total) * targetTicks);
    const abstainTicks = Math.max(0, targetTicks - forTicks - againstTicks);
    for (let i = 0; i < forTicks; i++) ticks.push('for');
    for (let i = 0; i < againstTicks; i++) ticks.push('against');
    for (let i = 0; i < abstainTicks; i++) ticks.push('abstain');
  }
  return (
    <div className={classes.voteBarSeg} aria-hidden>
      {ticks.map((kind, i) => (
        <span
          key={i}
          className={`${classes.voteTick} ${
            kind === 'for'
              ? classes.voteTickFor
              : kind === 'against'
                ? classes.voteTickAgainst
                : kind === 'abstain'
                  ? classes.voteTickAbstain
                  : ''
          }`}
        />
      ))}
    </div>
  );
}

interface VoterRowProps {
  vote: RawVote;
  ensLookup: (addr: string) => string | null;
}

function VoterRow({ vote, ensLookup }: VoterRowProps) {
  const [expanded, setExpanded] = useState(false);
  const ens = ensLookup(vote.voter);
  const display = ens || formatShortAddress(vote.voter as `0x${string}`);
  const supportLabel = vote.support === 1 ? 'FOR' : vote.support === 0 ? 'AGAINST' : 'ABSTAIN';
  const supportClass =
    vote.support === 1
      ? classes.voteFor
      : vote.support === 0
        ? classes.voteAgainst
        : classes.voteAbstain;
  const hasReason = !!vote.reason && vote.reason.trim().length > 0;

  // Read-only Game shell: card no longer navigates, so no nested-<a> concern.
  // Click still toggles the inline reason expansion.
  const stopAndToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasReason) setExpanded(v => !v);
  };

  return (
    <div className={classes.voterRow}>
      <div
        className={`${classes.voterRowMain} ${hasReason ? classes.voterHasReason : ''}`}
        onClick={hasReason ? stopAndToggle : undefined}
      >
        <VoterHoverCard address={vote.voter as Address} asChild>
          <span
            className={classes.voterAvatar}
            style={{ background: avatarGradient(vote.voter), cursor: 'default' }}
            aria-hidden
          />
        </VoterHoverCard>
        <VoterHoverCard address={vote.voter as Address} asChild>
          <span className={classes.voterName} title={vote.voter} style={{ cursor: 'default' }}>
            {display}
          </span>
        </VoterHoverCard>
        <span className={classes.voterText}>voted</span>
        <span className={`${classes.voteTag} ${supportClass}`} style={{ marginLeft: 0 }}>
          {supportLabel}
        </span>
        <span className={classes.voterText}>({vote.votes})</span>
        {hasReason && (
          <span className={classes.voterChevron} aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        )}
      </div>
      {hasReason && !expanded && <div className={classes.voterReasonInline}>{vote.reason}</div>}
      {hasReason && expanded && <div className={classes.voterReasonRow}>{vote.reason}</div>}
    </div>
  );
}

interface ProposalCardProps {
  proposal: PartialProposal;
  currentBlock: bigint | undefined;
}

function ProposalCard({ proposal, currentBlock }: ProposalCardProps) {
  // Pull last few voters for the proposal. Skips when no id (shouldn't happen).
  const { data: votesData } = useQuery<{ votes: { items: RawVote[] } }>(
    proposalVotesQuery(proposal.id ?? '0').query,
    {
      variables: proposalVotesQuery(proposal.id ?? '0').variables,
      skip: !proposal.id,
    },
  );
  const allVotes = votesData?.votes?.items ?? [];
  // Highest-weight voters first — proxies/large delegates are the most
  // relevant signal at a glance. Sorted once, then sliced into the row list
  // (top 4) and the avatar stack (next ~10) so each card surfaces a wider
  // sample of voters without duplicating who's already named above.
  const sortedVotes = useMemo(
    () => [...allVotes].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)),
    [allVotes],
  );
  const voters = useMemo(() => sortedVotes.slice(0, 4), [sortedVotes]);
  const stackVoters = useMemo(() => sortedVotes.slice(4, 14), [sortedVotes]);
  // "+N more" excludes both the named rows and the avatar stack, so the
  // count reflects voters not represented anywhere on the card.
  const overflow = Math.max(0, allVotes.length - voters.length - stackVoters.length);

  // ENS lookup batches across the panel — feed both proposer + voters.
  const addresses = useMemo(() => {
    const set = new Set<string>();
    if (proposal.proposer) set.add(proposal.proposer);
    for (const v of voters) if (v.voter) set.add(v.voter);
    return Array.from(set);
  }, [voters, proposal.proposer]);
  const ensLookup = useEnsNames(addresses);

  const proposerEns = proposal.proposer ? ensLookup(proposal.proposer) : null;
  const proposerDisplay = proposerEns
    ? proposerEns
    : proposal.proposer
      ? formatShortAddress(proposal.proposer as `0x${string}`)
      : '';

  const votingLabel = getVotingTimer(proposal, currentBlock);
  const statusLabel = STATUS_LABELS[proposal.status] ?? '—';
  // Pulse FOR/AGAINST counts while the proposal is actively in voting (or
  // in the objection period) to telegraph "this is moving right now".
  // Skipped on terminal states so the rest of the page stays still.
  const isVotingLive =
    proposal.status === ProposalState.ACTIVE || proposal.status === ProposalState.OBJECTION_PERIOD;

  return (
    <div className={classes.propCard} style={{ cursor: 'default' }}>
      <div className={classes.propCardHeader}>
        <div className={classes.propTitleWrap}>
          {proposal.id ? (
            <PropHoverCard type="proposal" proposalId={proposal.id} asChild>
              <span className={classes.propTitle} style={{ cursor: 'default' }}>
                <span className={classes.propIdToken}>{proposal.id}</span>
                {proposal.title || 'Untitled proposal'}
              </span>
            </PropHoverCard>
          ) : (
            <span className={classes.propTitle}>
              <span className={classes.propIdToken}>{proposal.id}</span>
              {proposal.title || 'Untitled proposal'}
            </span>
          )}
          {proposerDisplay && (
            <span className={classes.propBy}>
              by{' '}
              {proposal.proposer ? (
                <VoterHoverCard address={proposal.proposer as Address} asChild>
                  <span style={{ cursor: 'default' }}>{proposerDisplay}</span>
                </VoterHoverCard>
              ) : (
                proposerDisplay
              )}
            </span>
          )}
        </div>
        <span className={`${classes.propStatusPill} ${statusToneClass(proposal.status)}`}>
          {statusLabel}
        </span>
      </div>

      <SegmentedVoteBar
        forCount={proposal.forCount}
        againstCount={proposal.againstCount}
        abstainCount={proposal.abstainCount}
      />

      <div className={classes.voteCounts}>
        <span className={classes.voteCountGroup}>
          <span
            className={`${classes.voteCountItem} ${isVotingLive ? classes.pulseFor : ''}`}
            style={{ color: 'var(--gs-for)' }}
          >
            FOR <strong>{proposal.forCount}</strong>
          </span>
          <span
            className={`${classes.voteCountItem} ${isVotingLive ? classes.pulseAgainst : ''}`}
            style={{ color: 'var(--gs-against)' }}
          >
            AGAINST <strong>{proposal.againstCount}</strong>
          </span>
          <span className={classes.voteCountItem}>
            ABSTAIN <strong>{proposal.abstainCount}</strong>
          </span>
        </span>
        {votingLabel && <span className={classes.votingTimer}>{votingLabel}</span>}
      </div>

      {voters.length > 0 && (
        <div className={classes.voterList}>
          {voters.map(v => (
            <VoterRow
              key={`${v.voter}-${v.createdAtTransaction ?? ''}`}
              vote={v}
              ensLookup={ensLookup}
            />
          ))}
          {(stackVoters.length > 0 || overflow > 0) && (
            <div className={classes.voterMoreRow}>
              {stackVoters.length > 0 && (
                <span
                  className={classes.voterAvatarStack}
                  aria-label={`${stackVoters.length} more voters`}
                >
                  {stackVoters.map((v, i) => (
                    <span
                      key={`${v.voter}-stack`}
                      className={classes.voterAvatarStackItem}
                      style={{
                        background: avatarGradient(v.voter),
                        // Leftmost on top reads cleanest — eye lands on the
                        // first disc and the rest fan out behind it.
                        zIndex: stackVoters.length - i,
                      }}
                      title={ensLookup(v.voter) || v.voter}
                      aria-hidden
                    />
                  ))}
                </span>
              )}
              {overflow > 0 && <span className={classes.voterMore}>+{overflow} more ›</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CandidateCardProps {
  candidate: ProposalCandidate;
  ensLookup: (addr: string) => string | null;
}

function CandidateCard({ candidate, ensLookup }: CandidateCardProps) {
  const title = candidate.version?.content?.title || candidate.slug || 'Untitled candidate';
  const sponsorCount = candidate.version?.content?.contentSignatures?.length ?? 0;
  const requiredVotes = candidate.requiredVotes ?? 0;
  const proposerVotes = candidate.proposerVotes ?? 0;
  const totalVotes = proposerVotes + (candidate.voteCount ?? 0);
  const pct = requiredVotes > 0 ? Math.min(100, (totalVotes / requiredVotes) * 100) : 0;

  const proposerAddr = candidate.proposer as string | undefined;
  const proposerEns = proposerAddr ? ensLookup(proposerAddr) : null;
  const proposerDisplay = proposerEns
    ? proposerEns
    : proposerAddr
      ? formatShortAddress(proposerAddr as `0x${string}`)
      : '';

  return (
    <div className={classes.propCard} style={{ cursor: 'default' }}>
      <div className={classes.propCardHeader}>
        <div className={classes.propTitleWrap}>
          {candidate.slug ? (
            <PropHoverCard type="candidate" candidateSlug={candidate.slug} asChild>
              <span className={classes.propTitle} style={{ cursor: 'default' }}>
                {title}
              </span>
            </PropHoverCard>
          ) : (
            <span className={classes.propTitle}>{title}</span>
          )}
          {proposerDisplay && (
            <span className={classes.propBy}>
              by{' '}
              {proposerAddr ? (
                <VoterHoverCard address={proposerAddr as Address} asChild>
                  <span style={{ cursor: 'default' }}>{proposerDisplay}</span>
                </VoterHoverCard>
              ) : (
                proposerDisplay
              )}
            </span>
          )}
        </div>
        <span className={`${classes.propStatusPill} ${classes.statusNeutral}`}>
          {candidate.canceled ? 'Cancelled' : 'Live'}
        </span>
      </div>

      <SegmentedVoteBar
        forCount={Math.round(pct)}
        againstCount={0}
        abstainCount={Math.max(0, 100 - Math.round(pct))}
      />

      <div className={classes.voteCounts}>
        <span className={classes.voteCountGroup}>
          <span className={classes.voteCountItem}>
            SPONSORS <strong>{sponsorCount}</strong>
          </span>
          <span className={classes.voteCountItem}>
            VOTES <strong>{totalVotes}</strong>
            {requiredVotes > 0 ? ` / ${requiredVotes}` : ''}
          </span>
        </span>
      </div>
    </div>
  );
}

function ProposalsList() {
  const { data, loading } = useAllProposals();
  const { data: blockNumber } = useBlockNumber();
  const top = useMemo<PartialProposal[]>(() => {
    const list = data ?? [];
    if (list.length === 0) return [];
    const ranked = [...list].sort((a, b) => {
      const aActive =
        a.status === ProposalState.ACTIVE || a.status === ProposalState.OBJECTION_PERIOD ? 1 : 0;
      const bActive =
        b.status === ProposalState.ACTIVE || b.status === ProposalState.OBJECTION_PERIOD ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return Number(b.id ?? 0) - Number(a.id ?? 0);
    });
    return ranked.slice(0, 6);
  }, [data]);

  if (loading && top.length === 0) {
    return <div className={classes.propEmpty}>Loading proposals…</div>;
  }
  if (top.length === 0) {
    return <div className={classes.propEmpty}>No proposals yet.</div>;
  }
  return (
    <div className={classes.propStack}>
      {top.map(p => (
        <ProposalCard key={p.id ?? p.title} proposal={p} currentBlock={blockNumber} />
      ))}
    </div>
  );
}

function CandidatesList() {
  const { data, loading } = useCandidateProposals();
  const top = useMemo<ProposalCandidate[]>(() => {
    const list = (data ?? []) as ProposalCandidate[];
    if (list.length === 0) return [];
    return [...list]
      .filter(c => !c.canceled)
      .sort((a, b) => Number(b.lastUpdatedTimestamp ?? 0) - Number(a.lastUpdatedTimestamp ?? 0))
      .slice(0, 6);
  }, [data]);

  // Batch ENS resolution for all candidate proposers.
  const proposerAddresses = useMemo(
    () =>
      top
        .map(c => c.proposer as string | undefined)
        .filter((a): a is string => typeof a === 'string'),
    [top],
  );
  const ensLookup = useEnsNames(proposerAddresses);

  if (loading && top.length === 0) {
    return <div className={classes.propEmpty}>Loading candidates…</div>;
  }
  if (top.length === 0) {
    return <div className={classes.propEmpty}>No candidates yet.</div>;
  }
  return (
    <div className={classes.propStack}>
      {top.map(c => (
        <CandidateCard key={c.id} candidate={c} ensLookup={ensLookup} />
      ))}
    </div>
  );
}

function TopicsPlaceholder() {
  return (
    <div className={classes.comingSoon}>
      <div className={classes.comingSoonTitle}>Topics</div>
      <div>Discussion topics coming soon.</div>
    </div>
  );
}

/**
 * Right-pane proposal browser with tabs.
 *
 * Tabs render as a slash-separated inline run ("Proposals / Candidates /
 * Topics") to mirror the nouns.game header style. Cards expose an author
 * byline, segmented vote bar, vote counts with mid-row separators, and a
 * preview of the most-recent voters with optional reason expansion.
 *
 * Game shell is a read-only emulation of nouns.game — cards/tabs do not
 * navigate. Users who want the full UX click the "nouns.game ↗" pill in
 * the nav.
 */
export default function GameProposals() {
  const [tab, setTab] = useState<TabKey>('proposals');

  return (
    <section className={classes.pane}>
      <header className={classes.tabBar}>
        <div className={classes.tabs} role="tablist">
          {TABS.map((t, idx) => (
            <Fragment key={t.key}>
              {idx > 0 && <span className={classes.tabSeparator}> / </span>}
              <button
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                className={`${classes.tab} ${tab === t.key ? classes.tabActive : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            </Fragment>
          ))}
        </div>
      </header>

      {tab === 'proposals' && <ProposalsList />}
      {tab === 'candidates' && <CandidatesList />}
      {tab === 'topics' && <TopicsPlaceholder />}
    </section>
  );
}

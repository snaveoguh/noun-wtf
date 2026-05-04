import { useMemo } from 'react';

// We re-use the existing Apollo-backed `proposalVotesQuery` exported from
// `wrappers/subgraph` so the cache keys line up with GameProposals' own
// fetch — migrating the wrapper to TanStack Query is out of scope here.
import { useQuery } from '@apollo/client';

import {
  ProposalState,
  removeMarkdownStyle,
  useAllProposals,
  useProposal,
  type PartialProposal,
  type Proposal,
} from '@/wrappers/nounsDao';
import { useCandidateProposal, type ProposalCandidate } from '@/wrappers/nounsData';
import { proposalVotesQuery } from '@/wrappers/subgraph';

export interface PropHoverData {
  /** Loading flag covers any in-flight fetch (proposal lookup, votes). */
  isLoading: boolean;
  hasError: boolean;
  /** Display id ("963" for proposals, slug for candidates). */
  id: string;
  /** Title — falls back to "Untitled". */
  title: string;
  /**
   * Status enum for proposals (mapped to STATUS_LABELS), or a synthetic
   * status string for candidates ("Live" / "Cancelled" / "Promoted").
   */
  status: ProposalState | 'CANDIDATE_LIVE' | 'CANDIDATE_CANCELLED' | 'CANDIDATE_PROMOTED';
  /** Stripped, truncated description excerpt — empty string if none. */
  excerpt: string;
  /** Proposer wallet (lowercased). May be undefined when unresolved. */
  proposer: string | undefined;
  /** Vote tally — only meaningful for proposals; 0/0/0 for candidates. */
  forCount: number;
  againstCount: number;
  abstainCount: number;
  /** Block at which voting concludes — undefined for terminal/candidate. */
  endBlock: bigint | undefined;
  /** Objection-period end block (overrides endBlock when in OBJECTION_PERIOD). */
  objectionPeriodEndBlock: bigint | undefined;
}

/**
 * Strip a markdown body down to a clean preview string.
 * - Drops headings, blockquotes, list bullets, code fences.
 * - Reuses removeMarkdownStyle for bold/italic glyphs.
 * - Truncates at the last word boundary before `maxChars`, appends "…".
 */
export function excerptFromMarkdown(raw: string | null | undefined, maxChars = 200): string {
  if (!raw) return '';
  // Pull out the title line so the excerpt doesn't repeat the header text.
  const withoutHeading = raw.replace(/^\s*#+\s.*$/m, '').trim();
  const noFences = withoutHeading.replace(/```[\S\s]*?```/g, ' ');
  const noLinks = noFences.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  const noImg = noLinks.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  const noBlock = noImg.replace(/^\s*[*>-]\s+/gm, '');
  const noHeading = noBlock.replace(/^#+\s+/gm, '');
  const stripped = removeMarkdownStyle(noHeading) ?? noHeading;
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  const slice = collapsed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  // Word-boundary truncation — prefer the last whole word, but don't lop off
  // more than ~25% of the slice. Falls through to a hard cut for long single
  // tokens (e.g. URLs that survived stripping).
  const cutAt = lastSpace > maxChars * 0.75 ? lastSpace : maxChars;
  return slice.slice(0, cutAt).trimEnd() + '…';
}

const PROPOSAL_TERMINAL = new Set<ProposalState>([
  ProposalState.EXECUTED,
  ProposalState.CANCELLED,
  ProposalState.VETOED,
  ProposalState.EXPIRED,
  ProposalState.DEFEATED,
]);

interface ProposalHookArgs {
  type: 'proposal';
  proposalId: string;
}
interface CandidateHookArgs {
  type: 'candidate';
  candidateSlug: string;
}
type HookArgs = ProposalHookArgs | CandidateHookArgs;

/**
 * Aggregate data for the rich proposal/candidate tooltip. Combines the
 * already-cached `useAllProposals` list (for the row's title + tally) with a
 * single-proposal `useProposal` fetch for the description/proposer (the list
 * doesn't carry these). Vote tally falls back to a fresh `proposalVotesQuery`
 * if the partial doesn't have counts yet (race during initial load).
 *
 * Candidates use `useCandidateProposal` for full content.
 *
 * Implementation note: every hook below runs unconditionally in the same
 * order on every render. The `enabled`/`skip` flags gate fetches by `type`
 * so we never fire the wrong source — but the hook calls themselves stay
 * stable, satisfying React's rules-of-hooks.
 */
export function usePropHoverData(args: HookArgs): PropHoverData {
  const proposalId = args.type === 'proposal' ? args.proposalId : '';
  const candidateSlug = args.type === 'candidate' ? args.candidateSlug : '';

  // ── Proposal sources ──
  const { data: allProposals } = useAllProposals();
  const partial: PartialProposal | undefined = useMemo(
    () =>
      args.type === 'proposal'
        ? (allProposals ?? []).find(p => String(p.id) === String(proposalId))
        : undefined,
    [allProposals, proposalId, args.type],
  );

  // useProposal short-circuits on empty id — we still call it every render
  // for hook-order stability, but it does nothing for candidate triggers.
  const full: Proposal | undefined = useProposal(proposalId);

  // Race fallback: if the partial doesn't carry fresh tally counts, pull
  // live counts from the votes subgraph. Skipped on candidates and when the
  // list partial already has data.
  const needsVotes = args.type === 'proposal' && !partial;
  const { data: votesData } = useQuery<{
    votes: { items: { support: number; votes: number }[] };
  }>(proposalVotesQuery(proposalId || '0').query, {
    variables: proposalVotesQuery(proposalId || '0').variables,
    skip: !needsVotes,
  });

  // ── Candidate source ──
  const candidateResult = useCandidateProposal(candidateSlug) as {
    data: ProposalCandidate | undefined;
    loading: boolean;
    error: unknown;
  };

  return useMemo<PropHoverData>(() => {
    if (args.type === 'candidate') {
      const candidate = candidateResult.data;
      const content = candidate?.version?.content;
      const title = content?.title || candidate?.slug || 'Untitled candidate';
      const excerpt = excerptFromMarkdown(content?.description);
      const proposer =
        ((candidate?.proposer as string | undefined) ?? '').toLowerCase() || undefined;

      let status: PropHoverData['status'] = 'CANDIDATE_LIVE';
      if (candidate?.canceled === true) status = 'CANDIDATE_CANCELLED';
      else if (candidate?.isProposal === true) status = 'CANDIDATE_PROMOTED';

      return {
        isLoading: candidateResult.loading && !candidate,
        hasError: Boolean(candidateResult.error) && !candidate,
        id: candidateSlug,
        title,
        status,
        excerpt,
        proposer,
        forCount: 0,
        againstCount: 0,
        abstainCount: 0,
        endBlock: undefined,
        objectionPeriodEndBlock: undefined,
      };
    }

    // Proposal branch
    let forCount = 0;
    let againstCount = 0;
    let abstainCount = 0;
    if (partial) {
      forCount = partial.forCount;
      againstCount = partial.againstCount;
      abstainCount = partial.abstainCount;
    } else {
      for (const v of votesData?.votes?.items ?? []) {
        if (v.support === 1) forCount += v.votes;
        else if (v.support === 0) againstCount += v.votes;
        else abstainCount += v.votes;
      }
    }

    const description = full?.description ?? '';
    const excerpt = excerptFromMarkdown(description);
    const proposer = (partial?.proposer ?? full?.proposer ?? '').toLowerCase() || undefined;

    return {
      isLoading: !full && !partial,
      hasError: false,
      id: proposalId,
      title: partial?.title ?? full?.title ?? 'Untitled proposal',
      status: partial?.status ?? full?.status ?? ProposalState.UNDETERMINED,
      excerpt,
      proposer,
      forCount,
      againstCount,
      abstainCount,
      endBlock: partial && !PROPOSAL_TERMINAL.has(partial.status) ? partial.endBlock : undefined,
      objectionPeriodEndBlock: partial?.objectionPeriodEndBlock,
    };
  }, [
    args.type,
    candidateResult.data,
    candidateResult.error,
    candidateResult.loading,
    candidateSlug,
    full,
    partial,
    proposalId,
    votesData,
  ]);
}

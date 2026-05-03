/**
 * Digest section builder — ports `createDigestSections` from
 * `apps/nouns-camp/src/components/landing-screen.jsx` (~lines 90–230).
 *
 * Camp's logged-in landing breaks proposals/candidates into curated sections:
 *   • "Not yet voted" — active proposals you haven't voted on
 *   • "Ongoing"       — active proposals you have voted on
 *   • "Upcoming"      — pending/updatable
 *   • "Recently concluded"
 *   • "New candidates" / "Recently active candidates"
 *
 * We produce the same sections from our `PartialProposal[]` + `ProposalCandidate[]`
 * inputs. `connectedAccountAddress == null` collapses to the logged-out flat view.
 */
import type { PartialProposal } from '@/wrappers/nounsDao';
import { ProposalState } from '@/wrappers/nounsDao';
import type { ProposalCandidate } from '@/wrappers/nounsData';

import { isFinalState, isSucceededState, toCampState } from './imported/proposals';

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_THRESHOLD_DAYS = 7;
const ACTIVE_THRESHOLD_DAYS = 7;

export type DigestProposalSectionKey =
  | 'proposals:awaiting-vote'
  | 'proposals:ongoing'
  | 'proposals:new'
  | 'proposals:recently-concluded'
  | 'proposals:past';

export type DigestCandidateSectionKey =
  | 'candidates:new'
  | 'candidates:active'
  | 'candidates:past';

export interface DigestProposalSection {
  key: DigestProposalSectionKey;
  title: string;
  description?: string;
  proposals: PartialProposal[];
  showVotingBar: boolean;
}

export interface DigestCandidateSection {
  key: DigestCandidateSectionKey;
  title: string;
  description?: string;
  candidates: ProposalCandidate[];
}

interface BuildDigestArgs {
  proposals: PartialProposal[];
  candidates: ProposalCandidate[];
  /** Lower-cased connected wallet address, or undefined for logged-out. */
  connectedAccountAddress?: string;
  /**
   * Optional set of proposal IDs the connected user has already voted on.
   * Without this we can't split active proposals into "not yet voted" vs "ongoing",
   * so the whole "awaiting" section collapses into "ongoing".
   */
  votedProposalIds?: Set<string>;
  now?: number;
}

const isFinalProposalState = (s: ProposalState) => isFinalState(toCampState(s));
const isSucceededProposalState = (s: ProposalState) => isSucceededState(toCampState(s));

const isPendingState = (s: ProposalState) =>
  s === ProposalState.PENDING || s === ProposalState.UPDATABLE;

const isVotableProposalState = (s: ProposalState) =>
  s === ProposalState.ACTIVE || s === ProposalState.OBJECTION_PERIOD;

export function buildDigestSections({
  proposals,
  candidates,
  connectedAccountAddress,
  votedProposalIds,
  now = Date.now(),
}: BuildDigestArgs): {
  proposalSections: DigestProposalSection[];
  candidateSections: DigestCandidateSection[];
} {
  const newCutoff = now - NEW_THRESHOLD_DAYS * DAY_MS;
  // Reserved for richer per-section windowing we may add later (mirrors Camp's
  // ACTIVE_THRESHOLD_DAYS gate). Currently the candidate "active" bucket is
  // just everything not-new-not-canceled, so we don't need it right now.
  void ACTIVE_THRESHOLD_DAYS;
  const buckets: Record<DigestProposalSectionKey, PartialProposal[]> = {
    'proposals:awaiting-vote': [],
    'proposals:ongoing': [],
    'proposals:new': [],
    'proposals:recently-concluded': [],
    'proposals:past': [],
  };

  for (const p of proposals) {
    const status = p.status;
    if (isPendingState(status)) {
      buckets['proposals:new'].push(p);
      continue;
    }
    if (isFinalProposalState(status) || isSucceededProposalState(status)) {
      // Camp uses endTimestamp; we approximate with endBlock heuristic — anything
      // ended in the last NEW_THRESHOLD_DAYS-worth-of-blocks is "recent".
      // Without timestamps we just put everything succeeded/queued/executed in
      // recently-concluded, and finals (defeated/expired/cancelled/vetoed) in past.
      if (isSucceededProposalState(status)) {
        buckets['proposals:recently-concluded'].push(p);
      } else {
        buckets['proposals:past'].push(p);
      }
      continue;
    }
    if (isVotableProposalState(status)) {
      const userVoted = !!(connectedAccountAddress && votedProposalIds?.has(String(p.id ?? '')));
      if (connectedAccountAddress && !userVoted) {
        buckets['proposals:awaiting-vote'].push(p);
      } else {
        buckets['proposals:ongoing'].push(p);
      }
      continue;
    }
    // Unknown / undetermined — bucket as past so it still surfaces.
    buckets['proposals:past'].push(p);
  }

  const proposalSections: DigestProposalSection[] = [
    {
      key: 'proposals:awaiting-vote',
      title: 'Not yet voted',
      description: 'Active proposals waiting on your vote',
      proposals: sortByEndsSoon(buckets['proposals:awaiting-vote']),
      showVotingBar: true,
    },
    {
      key: 'proposals:ongoing',
      title: 'Ongoing proposals',
      description: 'Currently in voting',
      proposals: sortByEndsSoon(buckets['proposals:ongoing']),
      showVotingBar: true,
    },
    {
      key: 'proposals:new',
      title: 'Upcoming proposals',
      proposals: sortByStartsSoon(buckets['proposals:new']),
      showVotingBar: false,
    },
    {
      key: 'proposals:recently-concluded',
      title: 'Recently concluded',
      proposals: sortReverseChrono(buckets['proposals:recently-concluded']),
      showVotingBar: true,
    },
    {
      key: 'proposals:past',
      title: 'Past proposals',
      proposals: sortReverseChrono(buckets['proposals:past']),
      showVotingBar: false,
    },
  ];

  // Candidates — Camp groups by `getCandidateForYouGroup` (new/active/etc.).
  // We approximate with two simple buckets since we don't have feedback timestamps.
  const candidateBuckets: Record<DigestCandidateSectionKey, ProposalCandidate[]> = {
    'candidates:new': [],
    'candidates:active': [],
    'candidates:past': [],
  };

  for (const c of candidates) {
    if (c.canceled) {
      candidateBuckets['candidates:past'].push(c);
      continue;
    }
    const tsMs = Number(c.lastUpdatedTimestamp ?? 0n) * 1000;
    if (tsMs >= newCutoff) {
      candidateBuckets['candidates:new'].push(c);
    } else {
      candidateBuckets['candidates:active'].push(c);
    }
  }

  const candidateSections: DigestCandidateSection[] = [
    {
      key: 'candidates:new',
      title: 'New candidates',
      description: `Created in the last ${NEW_THRESHOLD_DAYS} days`,
      candidates: sortCandidateReverseChrono(candidateBuckets['candidates:new']),
    },
    {
      key: 'candidates:active',
      title: 'Active candidates',
      candidates: sortCandidateReverseChrono(candidateBuckets['candidates:active']),
    },
  ];

  return {
    proposalSections: proposalSections.filter(s => s.proposals.length > 0),
    candidateSections: candidateSections.filter(s => s.candidates.length > 0),
  };
}

const sortByStartsSoon = (ps: PartialProposal[]) =>
  [...ps].sort((a, b) => Number(a.startBlock - b.startBlock));
const sortByEndsSoon = (ps: PartialProposal[]) =>
  [...ps].sort((a, b) => {
    const aEnd = a.objectionPeriodEndBlock || a.endBlock;
    const bEnd = b.objectionPeriodEndBlock || b.endBlock;
    return Number(aEnd - bEnd);
  });
const sortReverseChrono = (ps: PartialProposal[]) =>
  [...ps].sort((a, b) => Number(b.startBlock - a.startBlock));
const sortCandidateReverseChrono = (cs: ProposalCandidate[]) =>
  [...cs].sort((a, b) =>
    Number((b.lastUpdatedTimestamp ?? 0n) - (a.lastUpdatedTimestamp ?? 0n)),
  );

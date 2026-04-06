import { DynamicQuorumParams, Proposal, ProposalState } from '@/wrappers/nounsDao';

/**
 * Computes the dynamic quorum for a proposal based on against votes.
 *
 * The Nouns DAO contract adjusts the quorum threshold upward as more
 * "against" votes are cast, capped between minQuorumVotesBPS and
 * maxQuorumVotesBPS.
 *
 * Formula (from NounsDAODynamicQuorum.sol):
 *   againstVotesBPS = (againstVotes * 1e4) / totalSupply
 *   adjustedQuorumBPS = minQuorumVotesBPS +
 *     ((maxQuorumVotesBPS - minQuorumVotesBPS) * againstVotesBPS * quorumCoefficient) / 1e6
 *   adjustedQuorumBPS = clamp(adjustedQuorumBPS, minQuorumVotesBPS, maxQuorumVotesBPS)
 *   dynamicQuorum = (adjustedQuorumBPS * totalSupply) / 1e4
 */
export const computeDynamicQuorum = (
  params: DynamicQuorumParams,
  againstVotes: number,
  totalSupply: number,
): number => {
  if (totalSupply === 0) return 0;

  const againstVotesBPS = (againstVotes * 1e4) / totalSupply;

  const scaledDiff =
    (params.maxQuorumVotesBPS - params.minQuorumVotesBPS) *
    againstVotesBPS *
    params.quorumCoefficient;

  let adjustedQuorumBPS = params.minQuorumVotesBPS + scaledDiff / 1e6;

  // Clamp to [minQuorumVotesBPS, maxQuorumVotesBPS]
  adjustedQuorumBPS = Math.min(adjustedQuorumBPS, params.maxQuorumVotesBPS);
  adjustedQuorumBPS = Math.max(adjustedQuorumBPS, params.minQuorumVotesBPS);

  return Math.ceil((adjustedQuorumBPS * totalSupply) / 1e4);
};

export const isProposalUpdatable = (
  proposalState: ProposalState,
  proposalUpdatePeriodEndBlock: bigint,
  currentBlock: bigint,
) => {
  return (
    (proposalState === ProposalState.UPDATABLE || proposalState === ProposalState.PENDING) &&
    currentBlock <= proposalUpdatePeriodEndBlock
  );
};

export const checkEnoughVotes = (
  availableVotes: number | undefined,
  proposalThreshold: number | undefined,
) => {
  return !!(
    availableVotes != null &&
    proposalThreshold !== undefined &&
    availableVotes > proposalThreshold
  );
};

export const checkIsEligibleToPropose = (
  latestProposal: Proposal | undefined,
  account: string | null | undefined,
) => {
  return !!(
    latestProposal &&
    account &&
    (latestProposal?.status === ProposalState.ACTIVE ||
      latestProposal?.status === ProposalState.PENDING ||
      latestProposal?.status === ProposalState.UPDATABLE) &&
    latestProposal.proposer?.toLowerCase() === account?.toLowerCase()
  );
};

export const checkHasActiveOrPendingProposalOrCandidate = (
  latestProposalStatus: ProposalState,
  latestProposalProposer: string | undefined,
  account: string | null | undefined,
) => {
  return !!(
    account &&
    latestProposalProposer &&
    (latestProposalStatus === ProposalState.ACTIVE ||
      latestProposalStatus === ProposalState.PENDING ||
      latestProposalStatus === ProposalState.UPDATABLE) &&
    latestProposalProposer.toLowerCase() === account?.toLowerCase()
  );
};

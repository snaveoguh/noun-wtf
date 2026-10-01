import { useAccount, useReadContract, useWriteContract } from 'wagmi';

import {
  LIL_NOUNS_GOVERNOR,
  LIL_NOUNS_GOVERNOR_ABI,
  LIL_NOUNS_TOKEN,
  LIL_NOUNS_TOKEN_VOTES_ABI,
} from '@/lib/marketplace/governance';

// NounsDAO V3 ProposalState: Pending, Active, ..., ObjectionPeriod (9), Updatable (10).
// The governor refuses a new proposal while the proposer has one in any of these.
const LIVE_PROPOSAL_STATES = new Set([0, 1, 9, 10]);

/**
 * Lil Nouns equivalents of the reads/writes `ProposalDraftPanel` uses for
 * Nouns (`useUserVotes`, `useProposalThreshold`, latest-proposal check,
 * `usePropose`). Every read is gated on `enabled` so a Nouns draft doesn't
 * hit the Lil contracts.
 */
export function useLilNounsPropose(enabled: boolean) {
  const { address } = useAccount();

  const { data: votes } = useReadContract({
    address: LIL_NOUNS_TOKEN,
    abi: LIL_NOUNS_TOKEN_VOTES_ABI,
    functionName: 'getCurrentVotes',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  });

  const { data: threshold } = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'proposalThreshold',
    query: { enabled },
  });

  const { data: latestProposalId } = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'latestProposalIds',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  });

  const hasLatest = latestProposalId !== undefined && latestProposalId > 0n;
  const { data: latestState } = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'state',
    args: hasLatest ? [latestProposalId] : undefined,
    query: { enabled: enabled && hasLatest },
  });

  const { data: hash, writeContractAsync, isPending, isSuccess, error } = useWriteContract();

  let status = 'None';
  if (isPending) status = 'Mining';
  else if (isSuccess) status = 'Success';
  else if (error) status = 'Fail';

  const propose = (
    targets: `0x${string}`[],
    values: bigint[],
    signatures: string[],
    calldatas: `0x${string}`[],
    description: string,
  ) =>
    writeContractAsync({
      address: LIL_NOUNS_GOVERNOR,
      abi: LIL_NOUNS_GOVERNOR_ABI,
      functionName: 'propose',
      args: [targets, values, signatures, calldatas, description],
    });

  return {
    availableVotes: votes !== undefined ? Number(votes) : undefined,
    proposalThreshold: threshold !== undefined ? Number(threshold) : null,
    hasActiveOrPendingProposal: latestState !== undefined && LIVE_PROPOSAL_STATES.has(latestState),
    propose,
    proposeState: { status, errorMessage: error?.message, transaction: { hash } },
  };
}

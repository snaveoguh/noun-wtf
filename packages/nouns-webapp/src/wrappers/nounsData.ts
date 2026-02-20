import type { Address, Hash, Hex } from '@/utils/types';

import { useMemo } from 'react';

import { useQuery } from '@apollo/client';
import {
  useReadNounsDataCreateCandidateCost,
  useReadNounsDataUpdateCandidateCost,
  useWriteNounsDataAddSignature,
  useWriteNounsDataCancelProposalCandidate,
  useWriteNounsDataCreateProposalCandidate,
  useWriteNounsDataSendCandidateFeedback,
  useWriteNounsDataSendFeedback,
  useWriteNounsDataUpdateProposalCandidate,
  useWriteNounsGovernorCancelSig,
  useWriteNounsGovernorProposeBySigs,
  useWriteNounsGovernorUpdateProposalBySigs,
} from '@/contracts';
// Stubbed types — candidates/feedbacks not indexed by Ponder

import {
  ProposalDetail,
  useActivePendingUpdatableProposers,
  useProposalThreshold,
  useUpdatableProposalIds,
} from './nounsDao';
import { useDelegateNounsAtBlockQuery } from './nounToken';
import {
  candidateFeedbacksQuery,
  candidateProposalQuery,
  candidateProposalsQuery,
  candidateProposalVersionsQuery,
  proposalFeedbacksQuery,
} from './subgraph';

export interface VoteSignalDetail {
  supportDetailed: number;
  reason: string;
  votes: number;
  createdTimestamp: number;
  voter: {
    id: Address;
  };
}

export const useCreateProposalCandidate = () => {
  const {
    data: hash,
    writeContractAsync: createProposalCandidate,
    isPending: isCreatePending,
    isSuccess: isCreateSuccess,
    error: createError,
  } = useWriteNounsDataCreateProposalCandidate();

  let status = 'None';
  if (isCreatePending) {
    status = 'Mining';
  } else if (isCreateSuccess) {
    status = 'Success';
  } else if (createError) {
    status = 'Fail';
  }

  const createProposalCandidateState = useMemo(
    () => ({
      status,
      errorMessage: createError?.message,
      transaction: { hash },
    }),
    [hash, status, createError],
  );

  return {
    createProposalCandidate,
    createProposalCandidateState,
  };
};

export const useCancelCandidate = () => {
  const {
    data: hash,
    writeContract: cancelCandidate,
    isPending: isCancelPending,
    isSuccess: isCancelSuccess,
    error: cancelError,
  } = useWriteNounsDataCancelProposalCandidate();

  let status = 'None';
  if (isCancelPending) {
    status = 'Mining';
  } else if (isCancelSuccess) {
    status = 'Success';
  } else if (cancelError) {
    status = 'Fail';
  }

  const cancelCandidateState = useMemo(
    () => ({
      status,
      errorMessage: cancelError?.message,
      transaction: { hash },
    }),
    [hash, status, cancelError],
  );

  return {
    cancelCandidate,
    cancelCandidateState,
  };
};

export const useAddSignature = () => {
  const {
    data: hash,
    writeContractAsync: addSignature,
    isPending: isAddPending,
    isSuccess: isAddSuccess,
    error: addError,
  } = useWriteNounsDataAddSignature();

  let status = 'None';
  if (isAddPending) {
    status = 'Mining';
  } else if (isAddSuccess) {
    status = 'Success';
  } else if (addError) {
    status = 'Fail';
  }

  const addSignatureState = useMemo(
    () => ({
      status,
      errorMessage: addError?.message,
      transaction: { hash },
    }),
    [hash, status, addError],
  );

  return {
    addSignature,
    addSignatureState,
  };
};

export const useCandidateProposals = (blockNumber?: bigint) => {
  // Candidates not indexed by Ponder — return empty
  const { query, variables } = candidateProposalsQuery();
  const { loading, error, refetch } = useQuery(query, { variables, skip: true });
  // Still need these hooks to avoid conditional hook calls
  useDelegateNounsAtBlockQuery([], blockNumber ?? 0n);
  useProposalThreshold();
  useActivePendingUpdatableProposers(blockNumber);
  useDelegateNounsAtBlockQuery([], blockNumber ?? 0n);
  useUpdatableProposalIds(blockNumber);

  const candidatesData: ProposalCandidate[] = [];
  return { loading, data: candidatesData, error, refetch };
};

export const useCandidateProposal = (
  id: string,
  pollInterval: number = 0,
  _toUpdate?: boolean,
  blockNumber?: bigint,
) => {
  // Candidates not indexed by Ponder — return empty
  const { query, variables } = candidateProposalQuery(id);
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  // Still need these hooks to avoid conditional hook calls
  useActivePendingUpdatableProposers(blockNumber);
  useProposalThreshold();
  useDelegateNounsAtBlockQuery([], BigInt(blockNumber ?? 0n));
  useDelegateNounsAtBlockQuery([], BigInt(blockNumber ?? 0));
  useUpdatableProposalIds(blockNumber);

  return { loading, data: undefined as ProposalCandidate | undefined, error, refetch };
};

export const useCandidateProposalVersions = (id: string) => {
  // Candidates not indexed by Ponder — return empty
  const { query, variables } = candidateProposalVersionsQuery(id);
  const { loading, error } = useQuery(query, { variables, skip: true });
  return { loading, data: undefined as ProposalCandidateVersions | undefined, error };
};

export const useGetCreateCandidateCost = () => {
  const { data: createCandidateCost } = useReadNounsDataCreateCandidateCost();

  if (!createCandidateCost) {
    return;
  }

  return createCandidateCost;
};

export const useGetUpdateCandidateCost = () => {
  const { data: updateCandidateCost } = useReadNounsDataUpdateCandidateCost();

  if (!updateCandidateCost) {
    return;
  }

  return updateCandidateCost;
};

export const useUpdateProposalCandidate = () => {
  const {
    data: hash,
    writeContractAsync: updateProposalCandidate,
    isPending: isUpdatePending,
    isSuccess: isUpdateSuccess,
    error: updateError,
  } = useWriteNounsDataUpdateProposalCandidate();

  let status = 'None';
  if (isUpdatePending) {
    status = 'Mining';
  } else if (isUpdateSuccess) {
    status = 'Success';
  } else if (updateError) {
    status = 'Fail';
  }

  const updateProposalCandidateState = useMemo(
    () => ({
      status,
      errorMessage: updateError?.message,
      transaction: { hash },
    }),
    [hash, status, updateError],
  );

  return {
    updateProposalCandidate,
    updateProposalCandidateState,
  };
};

export const useCancelSignature = () => {
  const {
    data: hash,
    writeContractAsync: cancelSig,
    isPending: isCancelSigPending,
    isSuccess: isCancelSigSuccess,
    error: cancelSigError,
  } = useWriteNounsGovernorCancelSig();

  let status = 'None';
  if (isCancelSigPending) {
    status = 'Mining';
  } else if (isCancelSigSuccess) {
    status = 'Success';
  } else if (cancelSigError) {
    status = 'Fail';
  }

  const cancelSignatureState = useMemo(
    () => ({
      status,
      errorMessage: cancelSigError?.message,
      transaction: { hash },
    }),
    [hash, status, cancelSigError],
  );

  const cancelSignature = {
    send: cancelSig,
    state: cancelSignatureState,
  };

  return { cancelSignature };
};

export const useSendFeedback = () => {
  const {
    data: proposalFeedbackHash,
    writeContractAsync: sendProposalFeedback,
    isPending: isSendProposalFeedbackPending,
    isSuccess: isSendProposalFeedbackSuccess,
    error: sendProposalFeedbackError,
  } = useWriteNounsDataSendFeedback();

  let proposalFeedbackStatus = 'None';
  if (isSendProposalFeedbackPending) {
    proposalFeedbackStatus = 'Mining';
  } else if (isSendProposalFeedbackSuccess) {
    proposalFeedbackStatus = 'Success';
  } else if (sendProposalFeedbackError) {
    proposalFeedbackStatus = 'Fail';
  }

  const sendProposalFeedbackState = useMemo(
    () => ({
      status: proposalFeedbackStatus,
      errorMessage: sendProposalFeedbackError?.message,
      transaction: { hash: proposalFeedbackHash },
    }),
    [proposalFeedbackHash, proposalFeedbackStatus, sendProposalFeedbackError],
  );

  const {
    data: candidateFeedbackHash,
    writeContractAsync: sendCandidateFeedback,
    isPending: isSendCandidateFeedbackPending,
    isSuccess: isSendCandidateFeedbackSuccess,
    error: sendCandidateFeedbackError,
  } = useWriteNounsDataSendCandidateFeedback();

  let candidateFeedbackStatus = 'None';
  if (isSendCandidateFeedbackPending) {
    candidateFeedbackStatus = 'Mining';
  } else if (isSendCandidateFeedbackSuccess) {
    candidateFeedbackStatus = 'Success';
  } else if (sendCandidateFeedbackError) {
    candidateFeedbackStatus = 'Fail';
  }

  const sendCandidateFeedbackState = useMemo(
    () => ({
      status: candidateFeedbackStatus,
      errorMessage: sendCandidateFeedbackError?.message,
      transaction: { hash: candidateFeedbackHash },
    }),
    [candidateFeedbackHash, candidateFeedbackStatus, sendCandidateFeedbackError],
  );

  return {
    sendProposalFeedback,
    sendProposalFeedbackState,
    sendCandidateFeedback,
    sendCandidateFeedbackState,
  };
};

export const useProposalFeedback = (id: string, pollInterval: number = 0) => {
  // Feedbacks not indexed by Ponder — return empty
  const { query, variables } = proposalFeedbacksQuery(id);
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const feedbacks: VoteSignalDetail[] = [];
  return { loading, data: feedbacks, error, refetch };
};

export const useCandidateFeedback = (id: string, pollInterval?: number) => {
  // Feedbacks not indexed by Ponder — return empty
  const { query, variables } = candidateFeedbacksQuery(id);
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const feedbacks: VoteSignalDetail[] = [];
  return { loading, data: feedbacks, error, refetch };
};

export const useProposeBySigs = () => {
  const {
    data: hash,
    writeContractAsync: proposeBySigs,
    isPending: isProposePending,
    isSuccess: isProposeSuccess,
    error: proposeError,
  } = useWriteNounsGovernorProposeBySigs();

  let status = 'None';
  if (isProposePending) {
    status = 'Mining';
  } else if (isProposeSuccess) {
    status = 'Success';
  } else if (proposeError) {
    status = 'Fail';
  }

  const proposeBySigsState = useMemo(
    () => ({
      status,
      errorMessage: proposeError?.message,
      transaction: { hash },
    }),
    [hash, status, proposeError],
  );

  return {
    proposeBySigs,
    proposeBySigsState,
  };
};

export const useUpdateProposalBySigs = () => {
  const {
    data: hash,
    writeContractAsync: updateProposalBySigs,
    isPending: isUpdatePending,
    isSuccess: isUpdateSuccess,
    error: updateError,
  } = useWriteNounsGovernorUpdateProposalBySigs();

  let status = 'None';
  if (isUpdatePending) {
    status = 'Mining';
  } else if (isUpdateSuccess) {
    status = 'Success';
  } else if (updateError) {
    status = 'Fail';
  }

  const updateProposalBySigsState = useMemo(
    () => ({
      status,
      errorMessage: updateError?.message,
      transaction: { hash },
    }),
    [hash, status, updateError],
  );

  return {
    updateProposalBySigs,
    updateProposalBySigsState,
  };
};

export interface ProposalCandidateSubgraphEntity extends ProposalCandidateInfo {
  versions: {
    content: {
      title: string;
    };
  }[];
  latestVersion: {
    content: {
      title: string;
      description: string;
      targets: string[];
      values: string[];
      signatures: string[];
      calldatas: string[];
      encodedProposalHash: string;
      proposalIdToUpdate: string;
      contentSignatures: {
        reason: string;
        expirationTimestamp: number;
        sig: string;
        canceled: boolean;
        signer: {
          id: Address;
          proposals: {
            id: string;
          }[];
        };
      }[];
      matchingProposalIds: {
        id: string;
      }[];
    };
  };
}

export interface ProposalCandidateVersionsSubgraphEntity extends ProposalCandidateInfo {
  versions: {
    title: string;
    description: string;
    targets: string[];
    values: string[];
    signatures: string[];
    calldatas: string[];
    encodedProposalHash: string;
    updateMessage: string;
    createdTimestamp: number;
    content: {
      title: string;
      description: string;
      targets: string[];
      values: string[];
      signatures: string[];
      calldatas: string[];
      encodedProposalHash: string;
    };
  }[];
  latestVersion: {
    id: string;
    title: string;
    description: string;
  };
}

export interface PartialCandidateSignature {
  signer: {
    id: string;
  };
  expirationTimestamp: string;
}

export interface CandidateSignature {
  reason: string;
  expirationTimestamp: number;
  sig: string;
  canceled: boolean;
  signer: {
    id: Address;
    proposals: {
      id: string;
    }[];
    voteCount?: number;
    activeOrPendingProposal?: boolean;
  };
}

export interface ProposalCandidateInfo {
  id: string;
  slug: string;
  proposer: Address;
  lastUpdatedTimestamp: bigint;
  canceled: boolean;
  versionsCount: number;
  createdTransactionHash: Hash;
  isProposal: boolean;
  requiredVotes: number;
  proposalIdToUpdate?: number;
  proposerVotes: number;
  neededVotes?: number;
  voteCount: number;
  matchingProposalIds?: number[];
}

export interface ProposalCandidateVersionContent {
  title: string;
  description: string;
  details: ProposalDetail[];
  createdAt: number;
  updateMessage: string;
  versionNumber: number;
}

export interface ProposalCandidateVersion {
  content: {
    title: string;
    description: string;
    details: ProposalDetail[];
    targets: Address[];
    values: bigint[];
    signatures: string[];
    calldatas: Hex[];
    contentSignatures: CandidateSignature[];
    transactionHash?: Hash;
  };
}

export interface ProposalCandidate extends ProposalCandidateInfo {
  version: ProposalCandidateVersion;
}

export interface PartialProposalCandidate extends ProposalCandidateInfo {
  lastUpdatedTimestamp: bigint;
  latestVersion: {
    content: {
      title: string;
      description: string;
      proposalIdToUpdate: string;
      contentSignatures: {
        reason: string;
        expirationTimestamp: number;
        sig: string;
        canceled: boolean;
        signer: {
          id: string;
          proposals: {
            id: string;
          }[];
        };
      }[];
      matchingProposalIds: {
        id: string;
      }[];
    };
  };
}

export interface ProposalCandidateVersions extends ProposalCandidateInfo {
  title: string;
  description: string;
  versions: ProposalCandidateVersionContent[];
}

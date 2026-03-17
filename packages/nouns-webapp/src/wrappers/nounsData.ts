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
import { useCandidatesFromLogs, useCandidateFromLogs } from '@/hooks/useCandidatesFromLogs';
import {
  useCandidateFeedbackFromLogs,
  useProposalFeedbackFromLogs,
} from '@/hooks/useFeedbackFromLogs';

import {
  formatProposalTransactionDetails,
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

// ── Helper: transform Ponder candidate GraphQL response → ProposalCandidate ──
function ponderCandidateToProposalCandidate(p: Record<string, unknown>): ProposalCandidate {
  const description = (p.description as string) ?? '';
  const firstLine = description.split('\n')[0] ?? '';
  const title = firstLine.replace(/^#+\s*/, '').trim() || 'Untitled Candidate';

  const targets = JSON.parse((p.targets as string) || '[]') as Address[];
  const rawValues = JSON.parse((p.values as string) || '[]') as string[];
  const values = rawValues.map((v: string) => BigInt(v));
  const sigs = JSON.parse((p.signatures as string) || '[]') as string[];
  const calldatas = JSON.parse((p.calldatas as string) || '[]') as Hex[];

  const details = formatProposalTransactionDetails({ targets, signatures: sigs, values, calldatas });

  const rawSigs = (p.candidateSignatures as { items?: Record<string, unknown>[] })?.items ?? [];
  const contentSignatures: CandidateSignature[] = rawSigs.map((s: Record<string, unknown>) => ({
    reason: (s.reason as string) ?? '',
    expirationTimestamp: Number(s.expirationTimestamp ?? 0),
    sig: (s.sig as string) ?? '',
    canceled: (s.canceled as boolean) ?? false,
    signer: {
      id: ((s.signer as string) ?? '').toLowerCase() as Address,
      proposals: [],
    },
  }));

  const proposalIdToUpdate = Number(p.proposalIdToUpdate ?? 0);
  // Ponder returns timestamp as Unix seconds (number or stringified bigint)
  const lastUpdatedTimestamp = BigInt(Number(p.lastUpdatedAt) || 0);

  return {
    id: p.id as string,
    slug: p.slug as string,
    proposer: (p.proposer as Address) ?? ('0x0' as Address),
    lastUpdatedTimestamp,
    canceled: (p.canceled as boolean) ?? false,
    versionsCount: (p.versionsCount as number) ?? 1,
    createdTransactionHash: (p.createdAtTransaction as Hash) ?? ('' as Hash),
    isProposal: false,
    requiredVotes: 0,
    proposalIdToUpdate: proposalIdToUpdate > 0 ? proposalIdToUpdate : undefined,
    proposerVotes: 0,
    neededVotes: undefined,
    voteCount: contentSignatures.length,
    matchingProposalIds: undefined,
    version: {
      content: {
        title,
        description,
        details,
        targets,
        values,
        signatures: sigs,
        calldatas,
        contentSignatures,
        transactionHash: p.createdAtTransaction as Hash,
      },
    },
  };
}

export const useCandidateProposals = (blockNumber?: bigint) => {
  // Primary: fetch candidates from Ponder GraphQL (fast, indexed)
  const { query, variables } = candidateProposalsQuery();
  const { loading: gqlLoading, data: gqlData, error: gqlError, refetch: gqlRefetch } = useQuery<{
    candidates: { items: Record<string, unknown>[] };
  }>(query, { variables });

  // Fallback: raw eth_getLogs — only fires if Ponder GraphQL fails
  const { data: logCandidates, isLoading: logLoading, error: logError, refetch: logRefetch } = useCandidatesFromLogs(!!gqlError);

  // Keep dependent hooks to avoid conditional hook call violations
  useDelegateNounsAtBlockQuery([], blockNumber ?? 0n);
  useProposalThreshold();
  useActivePendingUpdatableProposers(blockNumber);
  useDelegateNounsAtBlockQuery([], blockNumber ?? 0n);
  useUpdatableProposalIds(blockNumber);

  // Use GraphQL data if available, otherwise fall back to logs
  const candidatesData: ProposalCandidate[] = useMemo(() => {
    const gqlItems = gqlData?.candidates?.items;
    if (gqlItems && gqlItems.length > 0) {
      return gqlItems.map(ponderCandidateToProposalCandidate);
    }
    // Fallback to log-based data
    return logCandidates ?? [];
  }, [gqlData, logCandidates]);

  const loading = gqlError ? logLoading : gqlLoading;
  const error = gqlError ? (logError ?? undefined) : undefined;
  const refetch = gqlError ? logRefetch : gqlRefetch;

  return { loading, data: candidatesData, error, refetch };
};

export const useCandidateProposal = (
  id: string,
  _pollInterval: number = 0,
  _toUpdate?: boolean,
  blockNumber?: bigint,
) => {
  // Primary: fetch single candidate from Ponder GraphQL
  const { query, variables } = candidateProposalQuery(id);
  const { loading: gqlLoading, data: gqlData, error: gqlError, refetch: gqlRefetch } = useQuery<{
    candidate: Record<string, unknown> | null;
  }>(query, { variables, skip: !id });

  // Fallback: raw eth_getLogs — only fires if Ponder GraphQL fails
  const { data: logCandidate, isLoading: logLoading, error: logError, refetch: logRefetch } = useCandidateFromLogs(id, !!gqlError);

  // Keep dependent hooks to avoid conditional hook call violations
  useActivePendingUpdatableProposers(blockNumber);
  useProposalThreshold();
  useDelegateNounsAtBlockQuery([], BigInt(blockNumber ?? 0n));
  useDelegateNounsAtBlockQuery([], BigInt(blockNumber ?? 0));
  useUpdatableProposalIds(blockNumber);

  const candidateData = useMemo(() => {
    if (gqlData?.candidate) {
      return ponderCandidateToProposalCandidate(gqlData.candidate);
    }
    return logCandidate ?? undefined;
  }, [gqlData, logCandidate]);

  const loading = gqlError ? logLoading : gqlLoading;
  const error = gqlError ? (logError ?? undefined) : undefined;
  const refetch = gqlError ? logRefetch : gqlRefetch;

  return { loading, data: candidateData, error, refetch };
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
  // Primary: fetch from Ponder GraphQL
  const { query, variables } = proposalFeedbacksQuery(id);
  const { loading: gqlLoading, data: gqlData, error: gqlError, refetch: gqlRefetch } = useQuery<{
    proposalFeedbacks: { items: Record<string, unknown>[] };
  }>(query, { variables, skip: !id });

  // Fallback: raw eth_getLogs — only fires if Ponder GraphQL fails
  const logResult = useProposalFeedbackFromLogs(id, pollInterval, !!gqlError);

  const feedbackData: VoteSignalDetail[] = useMemo(() => {
    const gqlItems = gqlData?.proposalFeedbacks?.items;
    if (gqlItems && gqlItems.length > 0) {
      return gqlItems.map((f: Record<string, unknown>) => ({
        supportDetailed: Number(f.support ?? 0),
        reason: (f.reason as string) ?? '',
        votes: 0, // Ponder doesn't store voter's vote count
        createdTimestamp: Math.floor(new Date((f.createdAt as string) ?? 0).getTime() / 1000),
        voter: { id: ((f.voter as string) ?? '').toLowerCase() as Address },
      }));
    }
    return logResult.data ?? [];
  }, [gqlData, logResult.data]);

  return {
    loading: gqlError ? logResult.loading : gqlLoading,
    data: feedbackData,
    error: gqlError ? logResult.error : undefined,
    refetch: gqlError ? logResult.refetch : gqlRefetch,
  };
};

export const useCandidateFeedback = (id: string, pollInterval?: number) => {
  // Primary: fetch from Ponder GraphQL
  const { query, variables } = candidateFeedbacksQuery(id);
  const { loading: gqlLoading, data: gqlData, error: gqlError, refetch: gqlRefetch } = useQuery<{
    candidateFeedbacks: { items: Record<string, unknown>[] };
  }>(query, { variables, skip: !id });

  // Fallback: raw eth_getLogs — only fires if Ponder GraphQL fails
  const logResult = useCandidateFeedbackFromLogs(id, pollInterval ?? 0, !!gqlError);

  const feedbackData: VoteSignalDetail[] = useMemo(() => {
    const gqlItems = gqlData?.candidateFeedbacks?.items;
    if (gqlItems && gqlItems.length > 0) {
      return gqlItems.map((f: Record<string, unknown>) => ({
        supportDetailed: Number(f.support ?? 0),
        reason: (f.reason as string) ?? '',
        votes: 0,
        createdTimestamp: Math.floor(new Date((f.createdAt as string) ?? 0).getTime() / 1000),
        voter: { id: ((f.voter as string) ?? '').toLowerCase() as Address },
      }));
    }
    return logResult.data ?? [];
  }, [gqlData, logResult.data]);

  return {
    loading: gqlError ? logResult.loading : gqlLoading,
    data: feedbackData,
    error: gqlError ? logResult.error : undefined,
    refetch: gqlError ? logResult.refetch : gqlRefetch,
  };
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

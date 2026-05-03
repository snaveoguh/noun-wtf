import { gql } from '@apollo/client';
import { useQuery } from '@tanstack/react-query';
import { useEnsAvatar, useEnsName, usePublicClient } from 'wagmi';

import { execute } from '@/subgraphs/execute';
import { stripNoggles } from '@/utils/addressAndENSDisplayUtils';
import { resolveNounContractAddress } from '@/utils/resolveNounsContractAddress';
import { Address } from '@/utils/types';

// Minimum-ABI for ERC-1271-style multisig detection. Safe (Gnosis) wallets
// expose getThreshold() + getOwners(); calling these on an EOA reverts, which
// we treat as "not a multisig" and fall back to an empty signer list.
const SAFE_ABI = [
  {
    inputs: [],
    name: 'getThreshold',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getOwners',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface VoterHoverData {
  isLoading: boolean;
  hasError: boolean;
  ensName: string | null;
  ensAvatar: string | null;
  ownedNounIds: number[];
  /** Total nouns this delegate represents (sum of own + delegated). */
  delegatedVotes: number;
  /** Number of distinct token holders that delegate to this address. */
  delegatorCount: number;
  proposalCount: number;
  voteCount: number;
  feedbackCount: number;
  candidateCount: number;
  sponsoredCount: number;
  multisig: {
    threshold: number;
    owners: Address[];
  } | null;
}

interface ListPage<T> {
  totalCount?: number;
  items?: T[];
}

interface SubgraphResult {
  ownedNouns?: ListPage<{ id: string }>;
  delegate?: { id: string; delegatedVotes: string | number } | null;
  representedNouns?: ListPage<{ nounId: string; noun?: { owner: string } | null }>;
  voterVotes?: ListPage<unknown>;
  proposerProposals?: ListPage<unknown>;
  proposalFeedbacks?: ListPage<unknown>;
  candidateFeedbacks?: ListPage<unknown>;
  proposerCandidates?: ListPage<unknown>;
  candidateSignatures?: ListPage<unknown>;
}

// Single combined query — Ponder supports parallel root fields. Each list
// uses a tiny limit + totalCount so we can read the count without fetching
// thousands of rows. The Ponder schema does not expose Account or per-Delegate
// aggregate accessors, so all stats are queried via the root list types
// filtered by voter / proposer / signer / owner.
const VOTER_HOVER_QUERY = gql`
  query GetVoterHoverData($id: String!) {
    ownedNouns: nouns(where: { owner: $id }, limit: 200) {
      totalCount
      items {
        id
      }
    }
    delegate(id: $id) {
      id
      delegatedVotes
    }
    representedNouns: delegateNouns(where: { delegateId: $id }, limit: 1000) {
      totalCount
      items {
        nounId
        noun {
          owner
        }
      }
    }
    voterVotes: votes(where: { voter: $id }, limit: 1) {
      totalCount
    }
    proposerProposals: proposals(where: { proposer: $id }, limit: 1) {
      totalCount
    }
    proposalFeedbacks(where: { voter: $id }, limit: 1) {
      totalCount
    }
    candidateFeedbacks(where: { voter: $id }, limit: 1) {
      totalCount
    }
    proposerCandidates: candidates(where: { proposer: $id }, limit: 1) {
      totalCount
    }
    candidateSignatures(where: { signer: $id }, limit: 1) {
      totalCount
    }
  }
`;

const EMPTY: Omit<VoterHoverData, 'isLoading' | 'hasError'> = {
  ensName: null,
  ensAvatar: null,
  ownedNounIds: [],
  delegatedVotes: 0,
  delegatorCount: 0,
  proposalCount: 0,
  voteCount: 0,
  feedbackCount: 0,
  candidateCount: 0,
  sponsoredCount: 0,
  multisig: null,
};

/**
 * Hook that aggregates everything the rich voter tooltip needs:
 *   • ENS name + avatar (wagmi)
 *   • Owned nouns (subgraph)
 *   • Delegate stats — total votes, delegator count (subgraph)
 *   • Activity counts — proposals, votes, feedback, candidates, sponsored (subgraph)
 *   • Multisig signers — Safe getThreshold() + getOwners() probe (RPC)
 *
 * Any individual data source that fails or isn't supported by the current
 * Ponder schema falls back to a sensible zero-value, so the card always
 * renders something. The loading flag covers the subgraph fetch only.
 */
export function useVoterHoverData(address: Address | undefined): VoterHoverData {
  const lower = (address ?? '').toLowerCase();
  const enabled = Boolean(address && lower.startsWith('0x') && lower.length === 42);

  const { data: ensName } = useEnsName({
    address,
    query: { enabled },
  });
  const safeEnsName = stripNoggles(ensName) || null;
  const avatarLookupName = safeEnsName ?? resolveNounContractAddress(address ?? ('' as Address));
  const { data: ensAvatar } = useEnsAvatar({
    name: avatarLookupName ?? undefined,
    query: { enabled: Boolean(avatarLookupName) },
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['voterHoverCard', lower],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SubgraphResult> => {
      try {
        const result = await execute<SubgraphResult>(VOTER_HOVER_QUERY, { id: lower });
        return result ?? {};
      } catch {
        // Schema mismatch — Ponder may not expose every field above. Surface
        // an empty record so the consumer renders a degraded card rather
        // than throwing. The error path is tracked separately.
        return {};
      }
    },
  });

  const publicClient = usePublicClient();

  // Multisig probe is only fired once we know the address is a contract — a
  // raw eth_getCode check would add a round-trip. Instead try the Safe view
  // calls directly: on EOAs they revert with `ContractFunctionExecutionError`
  // which the multicall path swallows.
  const { data: multisig } = useQuery({
    queryKey: ['voterHoverCardSafe', lower],
    enabled: enabled && Boolean(publicClient),
    staleTime: 60 * 60 * 1000, // signers ~never change for cached read
    queryFn: async () => {
      if (!publicClient || !address) return null;
      try {
        const [threshold, owners] = await Promise.all([
          publicClient.readContract({
            address,
            abi: SAFE_ABI,
            functionName: 'getThreshold',
          }),
          publicClient.readContract({
            address,
            abi: SAFE_ABI,
            functionName: 'getOwners',
          }),
        ]);
        return {
          threshold: Number(threshold),
          owners: owners as Address[],
        };
      } catch {
        return null;
      }
    },
  });

  if (!enabled) {
    return { ...EMPTY, isLoading: false, hasError: false };
  }

  const ownedNounIds = (data?.ownedNouns?.items ?? [])
    .map(n => Number(n.id))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  // Distinct delegators = distinct noun.owner addresses among the
  // delegated-to-this-address nouns, minus the delegate itself.
  const representedItems = data?.representedNouns?.items ?? [];
  const distinctOwners = new Set<string>();
  for (const it of representedItems) {
    const owner = it.noun?.owner?.toLowerCase();
    if (owner && owner !== lower) distinctOwners.add(owner);
  }
  const delegatorCount = distinctOwners.size;

  // Total represented count is authoritative from the delegate row when
  // present; otherwise fall back to the represented-nouns total. Subtract
  // own holdings only at render time so the raw stat stays meaningful.
  const totalRepresented = data?.delegate
    ? Number(data.delegate.delegatedVotes ?? 0)
    : (data?.representedNouns?.totalCount ?? 0);

  return {
    isLoading,
    hasError: isError,
    ensName: safeEnsName,
    ensAvatar: ensAvatar ?? null,
    ownedNounIds,
    delegatedVotes: totalRepresented,
    delegatorCount,
    proposalCount: data?.proposerProposals?.totalCount ?? 0,
    voteCount: data?.voterVotes?.totalCount ?? 0,
    feedbackCount:
      (data?.proposalFeedbacks?.totalCount ?? 0) +
      (data?.candidateFeedbacks?.totalCount ?? 0),
    candidateCount: data?.proposerCandidates?.totalCount ?? 0,
    sponsoredCount: data?.candidateSignatures?.totalCount ?? 0,
    multisig: multisig ?? null,
  };
}

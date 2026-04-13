import type { Address } from '@/utils/types';

import { useEffect, useState } from 'react';

import { useQuery } from '@apollo/client';
import { zeroAddress } from 'viem';
import { useAccount } from 'wagmi';

import {
  nounsGovernorAddress,
  nounsTokenAddress,
  useReadNounsTokenBalanceOf,
  useReadNounsTokenDelegates,
  useReadNounsTokenGetCurrentVotes,
  useReadNounsTokenGetPriorVotes,
  useReadNounsTokenIsApprovedForAll,
  useReadNounsTokenSeeds,
  useWriteNounsTokenDelegate,
  useWriteNounsTokenSetApprovalForAll,
} from '@/contracts';
import { defaultChain } from '@/wagmi';

import { cache, cacheKey, CHAIN_ID } from '../config';

import {
  accountEscrowedNounsQuery,
  delegateNounsAtBlockQuery,
  ownedNounsQuery,
  seedsQuery,
} from './subgraph';

export interface INounSeed {
  accessory: number;
  background: number;
  body: number;
  glasses: number;
  head: number;
}

const chainId = defaultChain.id;

const seedCacheKey = cacheKey(cache.seed, CHAIN_ID, nounsTokenAddress[chainId].toLowerCase());
const isSeedValid = (seed: INounSeed | Record<string, never> | undefined) => {
  const expectedKeys = ['background', 'body', 'accessory', 'head', 'glasses'];
  const hasExpectedKeys = expectedKeys.every(key => (seed || {}).hasOwnProperty(key));
  const hasValidValues = Object.values(seed || {}).some(v => v !== 0);
  return hasExpectedKeys && hasValidValues;
};
const seedArrayToObject = (seeds: (INounSeed & { id: string })[]) => {
  return seeds.reduce<Record<string, INounSeed>>((acc, seed) => {
    acc[seed.id] = {
      background: Number(seed.background),
      body: Number(seed.body),
      accessory: Number(seed.accessory),
      head: Number(seed.head),
      glasses: Number(seed.glasses),
    };
    return acc;
  }, {});
};

// Ponder response shape for seeds (nouns query)
interface PonderSeedsResponse {
  nouns: {
    items: Array<{
      id: string;
      background: number;
      body: number;
      accessory: number;
      head: number;
      glasses: number;
    }>;
  };
}

export const useNounSeeds = () => {
  // Read from localStorage once on mount, then keep in state so React re-renders
  // when seeds arrive from the network.
  const [seeds, setSeeds] = useState<Record<string, INounSeed> | undefined>(() => {
    const cached = localStorage.getItem(seedCacheKey);
    return cached ? JSON.parse(cached) : undefined;
  });

  const { query, variables } = seedsQuery();
  const { data } = useQuery<PonderSeedsResponse>(query, {
    skip: !!seeds,
    variables,
  });

  useEffect(() => {
    const items = data?.nouns?.items;
    if (!seeds && items !== undefined && items.length > 0) {
      const transformedSeeds = items.map(seed => ({
        ...seed,
        accessory: Number(seed.accessory),
        background: Number(seed.background),
        body: Number(seed.body),
        glasses: Number(seed.glasses),
        head: Number(seed.head),
        id: seed.id,
      }));
      const seedObj = seedArrayToObject(transformedSeeds);
      localStorage.setItem(seedCacheKey, JSON.stringify(seedObj));
      setSeeds(seedObj);
    }
  }, [data, seeds]);

  return seeds;
};

export const useNounSeed = (nounId: bigint): INounSeed | undefined => {
  const seeds = useNounSeeds();
  const seed = seeds?.[Number(nounId)];

  const { data: response } = useReadNounsTokenSeeds({
    args: [nounId],
    query: { enabled: !seed },
  });

  if (response) {
    const [background, body, accessory, head, glasses] = response;
    const seedData = { background, body, accessory, head, glasses };
    const seedCache = localStorage.getItem(seedCacheKey);
    if (seedCache && isSeedValid(seedData)) {
      const updatedSeedCache = JSON.stringify({
        ...JSON.parse(seedCache),
        [nounId.toString()]: {
          accessory: seedData.accessory,
          background: seedData.background,
          body: seedData.body,
          glasses: seedData.glasses,
          head: seedData.head,
        },
      });
      localStorage.setItem(seedCacheKey, updatedSeedCache);
    }
    return seedData;
  }
  return seed !== undefined
    ? {
        accessory: Number(seed.accessory),
        background: Number(seed.background),
        body: Number(seed.body),
        glasses: Number(seed.glasses),
        head: Number(seed.head),
      }
    : undefined;
};

export const useUserVotes = (): number | undefined => {
  const { address } = useAccount();
  return useAccountVotes(address ?? zeroAddress);
};

export const useAccountVotes = (account?: Address): number | undefined => {
  const { data: votes } = useReadNounsTokenGetCurrentVotes({
    args: account ? [account] : undefined,
  });

  return votes !== undefined ? Number(votes) : undefined;
};

export const useUserDelegatee = (): string | undefined => {
  const { address } = useAccount();
  const { data: delegate } = useReadNounsTokenDelegates({
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return delegate as string | undefined;
};

export const useUserVotesAsOfBlock = (block: number | undefined): number | undefined => {
  const { address } = useAccount();
  // Check for available votes
  const { data: votes } = useReadNounsTokenGetPriorVotes({
    args: address && block !== undefined ? [address, BigInt(block)] : undefined,
    query: { enabled: !!address && block !== undefined },
  });

  return votes !== undefined ? Number(votes) : undefined;
};

export const useDelegateVotes = () => {
  const {
    writeContract: delegateVotes,
    data: hash,
    isPending: isLoading,
    isSuccess,
    isError,
    error: errorMessage,
  } = useWriteNounsTokenDelegate();

  let status = 'None';
  if (isLoading) {
    status = 'Mining';
  } else if (isSuccess) {
    status = 'Success';
  } else if (isError) {
    status = 'Fail';
  }

  const delegateState = {
    status,
    errorMessage,
    transaction: { hash },
  };

  return {
    delegateVotes,
    delegateState,
  };
};

export const useNounTokenBalance = (address: Address): number | undefined => {
  const { data: tokenBalance } = useReadNounsTokenBalanceOf({
    args: [address],
  });

  return tokenBalance !== undefined ? Number(tokenBalance) : undefined;
};

// Ponder response: nouns(where: { owner }) { items { id } }
export const useUserOwnedNounIds = (pollInterval: number) => {
  const { address } = useAccount();
  const { query, variables } = ownedNounsQuery(address?.toLowerCase() ?? '');
  const { loading, data, error, refetch } = useQuery<{
    nouns: { items: Array<{ id: string }> };
  }>(query, {
    pollInterval,
    variables,
  });
  const userOwnedNouns: number[] = data?.nouns?.items?.map(noun => Number(noun.id)) || [];
  return { loading, data: userOwnedNouns, error, refetch };
};

// Escrowed nouns not indexed by Ponder — return empty
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useUserEscrowedNounIds = (pollInterval: number, _forkId: string) => {
  const { query, variables } = accountEscrowedNounsQuery('');
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true, // always skip — not indexed
  });
  const userEscrowedNounIds: number[] = [];
  return { loading, data: userEscrowedNounIds, error, refetch };
};

export const useSetApprovalForAll = () => {
  const {
    writeContractAsync,
    data,
    isPending: isLoading,
    isSuccess,
    isError,
    error,
  } = useWriteNounsTokenSetApprovalForAll();

  const getApprovalStatus = () => {
    if (isLoading) return 'Mining';
    if (isSuccess) return 'Success';
    if (isError) return 'Fail';
    return 'None';
  };

  const setApprovalState = {
    status: getApprovalStatus(),
    transaction: data,
    errorMessage: error?.message,
  };

  return {
    setApproval: async () => {
      await writeContractAsync({ args: [nounsGovernorAddress[chainId], true] });
    },
    setApprovalState,
  };
};

export const useIsApprovedForAll = () => {
  const { address } = useAccount();
  const { data } = useReadNounsTokenIsApprovedForAll({
    args: address ? [address, nounsGovernorAddress[chainId]] : undefined,
    query: { enabled: !!address },
  });

  return (data as boolean) || false;
};

// Ponder response: delegates(where: { id_in }) { items { id delegatedVotes } }
// The old subgraph returned `nounsRepresented` (array of nouns) — Ponder only has `delegatedVotes` count.
// We synthesize `nounsRepresented` as a dummy array of the correct length for vote counting.
export const useDelegateNounsAtBlockQuery = (signers: string[], block: bigint) => {
  const { query, variables } = delegateNounsAtBlockQuery(signers, block);
  const {
    loading,
    data: rawData,
    error,
  } = useQuery<{
    delegates: { items: Array<{ id: string; delegatedVotes: number }> };
  }>(query, { variables });

  // Adapt Ponder shape to match old subgraph Delegates type
  const data = rawData?.delegates?.items
    ? {
        delegates: rawData.delegates.items.map(d => ({
          id: d.id,
          nounsRepresented: Array.from({ length: Number(d.delegatedVotes) }, (_, i) => ({
            id: String(i),
          })),
        })),
      }
    : undefined;

  return { loading, data, error };
};

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
    pageInfo?: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

export const useNounSeeds = () => {
  const [seeds, setSeeds] = useState<Record<string, INounSeed> | undefined>(() => {
    const cached = localStorage.getItem(seedCacheKey);
    return cached ? JSON.parse(cached) : undefined;
  });

  useEffect(() => {
    // Refetch if no cache or cache is stale (< 1500 seeds = missing nouns)
    const seedCount = seeds ? Object.keys(seeds).length : 0;
    if (seedCount >= 1500) return;

    // Fetch all seeds with pagination (API caps at 1000 per request)
    let cancelled = false;
    (async () => {
      const allItems: PonderSeedsResponse['nouns']['items'] = [];
      let cursor: string | undefined;

      const url = import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined;
      if (!url) return;

      for (let page = 0; page < 10; page++) {
        try {
          const afterClause = cursor ? `, after: "${cursor}"` : '';
          const q = `query { nouns(limit: 1000, orderBy: "id", orderDirection: "asc"${afterClause}) { items { id background body accessory head glasses } pageInfo { hasNextPage endCursor } } }`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q }),
          });
          const json = (await res.json()) as { data: PonderSeedsResponse };
          const items = json.data?.nouns?.items;
          if (!items || items.length === 0) break;
          allItems.push(...items);
          const pageInfo = json.data?.nouns?.pageInfo;
          if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
          cursor = pageInfo.endCursor;
        } catch {
          break;
        }
      }

      if (cancelled || allItems.length === 0) return;

      const seedObj = seedArrayToObject(
        allItems.map(s => ({
          ...s,
          accessory: Number(s.accessory),
          background: Number(s.background),
          body: Number(s.body),
          glasses: Number(s.glasses),
          head: Number(s.head),
          id: s.id,
        })),
      );
      localStorage.setItem(seedCacheKey, JSON.stringify(seedObj));
      if (!cancelled) setSeeds(seedObj);
    })();

    return () => { cancelled = true; };
  }, [seeds]);

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

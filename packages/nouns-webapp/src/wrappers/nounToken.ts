/* eslint-disable @typescript-eslint/strict-boolean-expressions */
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

import { accountEscrowedNounsQuery, delegateNounsAtBlockQuery, ownedNounsQuery } from './subgraph';

export interface INounSeed {
  accessory: number;
  background: number;
  body: number;
  glasses: number;
  head: number;
}

/**
 * Sentinel seed returned by `useNounSeed` when the on-chain `seeds(nounId)`
 * call reverts — which happens when the noun has been burned (reserve-not-met
 * settlement). We use `-1` across all slots so consumers can detect the
 * sentinel with a single equality check (`seed === BURNED_NOUN_SEED`) instead
 * of sniffing for revert state everywhere.
 *
 * Any `<Noun>` / `<StandaloneNoun>` render must detect the sentinel and swap
 * in a burned placeholder rather than passing it to the SVG builder (which
 * would index into ImageData arrays with -1 and crash).
 */
export const BURNED_NOUN_SEED: INounSeed = {
  accessory: -1,
  background: -1,
  body: -1,
  glasses: -1,
  head: -1,
};

export const isBurnedSeed = (seed: INounSeed | undefined | null): boolean =>
  !!seed &&
  seed.accessory === -1 &&
  seed.background === -1 &&
  seed.body === -1 &&
  seed.glasses === -1 &&
  seed.head === -1;

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

    return () => {
      cancelled = true;
    };
  }, [seeds]);

  return seeds;
};

// Ponder response shape for the burned-auction lookup
interface BurnedAuctionsResponse {
  auctions: { items: Array<{ nounId: string }> };
}

/**
 * Returns the set of nounIds that were burned at settlement (reserve-not-met).
 * Backed by Ponder's `auctions.burned` column. Used by gallery surfaces to
 * desaturate burned nouns while keeping the seed-driven art intact.
 */
export const useBurnedNounIds = (): Set<bigint> | undefined => {
  const [ids, setIds] = useState<Set<bigint> | undefined>(undefined);

  useEffect(() => {
    const url = import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined;
    if (!url) return;

    let cancelled = false;
    (async () => {
      const all: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        try {
          const afterClause = cursor ? `, after: "${cursor}"` : '';
          const q = `query { auctions(where: { burned: true }, limit: 1000${afterClause}) { items { nounId } pageInfo { hasNextPage endCursor } } }`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q }),
          });
          const json = (await res.json()) as {
            data: BurnedAuctionsResponse & {
              auctions: { pageInfo?: { hasNextPage: boolean; endCursor: string } };
            };
          };
          const items = json.data?.auctions?.items;
          if (!items || items.length === 0) break;
          all.push(...items.map(i => i.nounId));
          const pageInfo = json.data?.auctions?.pageInfo;
          if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
          cursor = pageInfo.endCursor;
        } catch {
          break;
        }
      }
      if (!cancelled) setIds(new Set(all.map(id => BigInt(id))));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return ids;
};

export const useNounSeed = (nounId: bigint): INounSeed | undefined => {
  const seeds = useNounSeeds();
  const seed = seeds?.[Number(nounId)];

  // Post-reservePrice raise: burned nouns have no seed on-chain, so this
  // call reverts with "ERC721: invalid token ID". Capture `isError` and
  // return the burned sentinel so <Noun> components can render a
  // placeholder instead of spinning forever or crashing on undefined.
  const { data: response, isError: seedsCallFailed } = useReadNounsTokenSeeds({
    args: [nounId],
    query: {
      enabled: !seed,
      // One retry is enough to distinguish a transient RPC hiccup from
      // a deterministic revert. Revert errors never succeed on retry.
      retry: 1,
    },
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
  if (seed !== undefined) {
    return {
      accessory: Number(seed.accessory),
      background: Number(seed.background),
      body: Number(seed.body),
      glasses: Number(seed.glasses),
      head: Number(seed.head),
    };
  }
  // No cached seed AND the on-chain read reverted — treat as burned.
  if (seedsCallFailed) return BURNED_NOUN_SEED;
  return undefined;
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

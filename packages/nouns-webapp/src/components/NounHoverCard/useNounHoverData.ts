import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { getNounColors } from '@/components/NounPalette';
import { useReadNounsTokenSeeds } from '@/contracts';
import { traitName } from '@/lib/traitName';
import { execute } from '@/subgraphs/execute';
import { auctionQuery } from '@/wrappers/subgraph';
import { INounSeed } from '@/wrappers/nounToken';

interface TraitNames {
  background: string;
  body: string;
  accessory: string;
  head: string;
  glasses: string;
}

interface AuctionData {
  amount: bigint | null;
  winner: string | null;
  bidCount: number;
  settled: boolean;
  /** Reserve-not-met: noun burned by the auction house contract. */
  burned: boolean;
}

interface ColorInfo {
  hex: string;
  pixels: number;
}

export interface NounHoverData {
  nounId: bigint;
  seed: INounSeed | null;
  traits: TraitNames | null;
  owner: string | null;
  auction: AuctionData | null;
  colors: ColorInfo[];
  isLoading: boolean;
}

interface AuctionQueryResult {
  auction: {
    nounId: string;
    amount: string | null;
    settled: boolean;
    winner: string | null;
    burned?: boolean;
    noun: { owner: string };
    bids: { items: Array<{ value: string; bidder: string }> };
  } | null;
}

export function useNounHoverData(
  nounId: bigint,
  providedSeed?: INounSeed,
): NounHoverData {
  // Seed: use provided or fetch from contract
  const { data: fetchedSeed } = useReadNounsTokenSeeds({
    args: [nounId],
    query: {
      enabled: !providedSeed,
      select: data => {
        if (!data) return null;
        return {
          background: Number(data[0]),
          body: Number(data[1]),
          accessory: Number(data[2]),
          head: Number(data[3]),
          glasses: Number(data[4]),
        };
      },
    },
  });

  const seed = providedSeed ?? fetchedSeed ?? null;

  // Auction data: fetched lazily via TanStack Query
  const { data: auctionData, isLoading: auctionLoading } = useQuery({
    queryKey: ['noun-hover-auction', nounId.toString()],
    queryFn: async () => {
      const { query, variables } = auctionQuery(nounId.toString());
      return execute<AuctionQueryResult>(query, variables);
    },
    staleTime: 60_000, // cache 1 minute
  });

  // Derive traits from seed
  const traits = useMemo<TraitNames | null>(() => {
    if (!seed) return null;
    return {
      background: traitName('background', seed.background),
      body: traitName('body', seed.body),
      accessory: traitName('accessory', seed.accessory),
      head: traitName('head', seed.head),
      glasses: traitName('glasses', seed.glasses),
    };
  }, [seed]);

  // Colors from seed (pure function, no network call)
  const colors = useMemo(() => (seed ? getNounColors(seed) : []), [seed]);

  // Parse auction result
  const auction = useMemo<AuctionData | null>(() => {
    if (!auctionData?.auction) return null;
    const a = auctionData.auction;
    // Fall back on shape detection for auctions indexed before the burned
    // column was added (winner=null + amount=0 on a settled auction).
    const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
    const amountIsZero = !a.amount || a.amount === '0';
    const noWinner = !a.winner || a.winner.toLowerCase() === ZERO_ADDR;
    const burnedFallback = !!a.settled && noWinner && amountIsZero;
    return {
      amount: a.amount ? BigInt(a.amount) : null,
      winner: a.winner,
      bidCount: a.bids?.items?.length ?? 0,
      settled: a.settled,
      burned: a.burned ?? burnedFallback,
    };
  }, [auctionData]);

  const owner = auctionData?.auction?.noun?.owner ?? null;

  return {
    nounId,
    seed,
    traits,
    owner,
    auction,
    colors,
    isLoading: auctionLoading,
  };
}

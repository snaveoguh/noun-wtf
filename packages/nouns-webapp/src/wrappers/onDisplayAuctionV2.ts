import { useQuery } from '@tanstack/react-query';
import { readContract } from '@wagmi/core';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { config as wagmiConfig } from '@/wagmi';
import { Address } from '@/utils/types';

import type { Auction } from './nounsAuction';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Reads the live `auction()` tuple from the NounV2 auction house and
 * returns it in the same shape as the mainnet `useOnDisplayAuction` hook
 * — so the big `<Auction>` component can consume either one via its
 * `auction` prop.
 *
 * Avoids wagmi's React hooks (`useReadContract` / `useChainId`) on purpose
 * — an earlier experiment crashed with `useSyncExternalStore` null
 * getSnapshot when `useOnDisplayAuction` was imported along a path that
 * resolved outside the WagmiProvider subtree under StrictMode double-
 * mount. Using `@wagmi/core`'s `readContract` inside TanStack's
 * `useQuery` is React-render-safe: the QueryClient is a sibling of
 * WagmiProvider and the wagmi config is resolved via a direct import.
 *
 * Only the current auction is synthesised here. v2 has no Ponder indexer
 * yet, so past/bid history is skipped — `<Auction>` tolerates missing
 * bid history via the existing fallbacks in `AuctionActivity`.
 */
export default function useV2OnDisplayAuction(): Auction | undefined {
  const isConfigured = NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS;

  const { data } = useQuery({
    queryKey: ['nounv2-on-display-auction', NOUNV2_AUCTION_HOUSE_ADDRESS],
    queryFn: async (): Promise<Auction | undefined> => {
      const result = (await readContract(wagmiConfig, {
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        functionName: 'auction',
      })) as readonly [bigint, bigint, bigint, bigint, `0x${string}`, boolean];

      const [nounId, amount, startTime, endTime, bidder, settled] = result;

      const normalizedBidder: Address | undefined =
        bidder && bidder.toLowerCase() !== ZERO_ADDRESS ? (bidder as Address) : undefined;

      return {
        nounId,
        amount,
        startTime,
        endTime,
        bidder: normalizedBidder,
        settled,
        clientId: null,
        burned: false,
      };
    },
    enabled: isConfigured,
    // Same cadence the NounV2AuctionHero uses — keep the UI fresh while
    // avoiding excess RPC traffic. Countdown rerender comes from local
    // setInterval in `<Auction>` so we don't need sub-second polling.
    refetchInterval: 12_000,
    staleTime: 6_000,
    gcTime: 60_000,
    // Cap retries so a hung publicnode WS / HTTP transport can't keep the
    // hero panel stuck in skeleton state — TanStack's default 3+exp-backoff
    // would otherwise queue ~30s of retry latency before surfacing data.
    retry: 2,
  });

  return data;
}

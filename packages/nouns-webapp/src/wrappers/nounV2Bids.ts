import { useQuery } from '@tanstack/react-query';
import { getPublicClient } from '@wagmi/core';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { Address, Bid } from '@/utils/types';
import { config as wagmiConfig } from '@/wagmi';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// V2 was deployed at this block. Filtering from here keeps log scans cheap.
const V2_DEPLOY_BLOCK = 24951808n;

/**
 * Read AuctionBid events from the NounV2 auction house and synthesize the
 * mainnet `Bid[]` shape so `<BidHistoryModal>` can render v2 bids without
 * any code changes downstream.
 *
 * Uses @wagmi/core directly via TanStack useQuery — same pattern as
 * useV2OnDisplayAuction, which sidesteps the WagmiProvider context
 * fragility we hit on a previous attempt.
 */
export function useV2AuctionBids(nounId: bigint): Bid[] | undefined {
  const isConfigured = NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS;

  const { data } = useQuery({
    queryKey: ['nounv2-bids', NOUNV2_AUCTION_HOUSE_ADDRESS, nounId.toString()],
    queryFn: async (): Promise<Bid[]> => {
      const client = getPublicClient(wagmiConfig);
      if (!client) return [];
      const events = await client.getContractEvents({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        eventName: 'AuctionBid',
        args: { nounId },
        fromBlock: V2_DEPLOY_BLOCK,
        toBlock: 'latest',
      });
      // Cache block timestamps per blockNumber so multiple bids in the same
      // block don't trigger N getBlock calls.
      const tsCache = new Map<bigint, bigint>();
      const out: Bid[] = [];
      for (const ev of events) {
        let ts = tsCache.get(ev.blockNumber);
        if (ts === undefined) {
          const blk = await client.getBlock({ blockNumber: ev.blockNumber });
          ts = blk.timestamp;
          tsCache.set(ev.blockNumber, ts);
        }
        const args = ev.args as {
          nounId?: bigint;
          sender?: Address;
          value?: bigint;
          extended?: boolean;
        };
        if (args.sender == null || args.value == null) continue;
        out.push({
          nounId,
          sender: args.sender,
          value: args.value,
          extended: args.extended ?? false,
          transactionHash: ev.transactionHash ?? '0x',
          transactionIndex: ev.transactionIndex ?? 0,
          timestamp: ts,
          clientId: null,
        });
      }
      // Highest bids first
      return out.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
    },
    enabled: isConfigured,
    refetchInterval: 12_000,
    staleTime: 8_000,
  });

  return data;
}

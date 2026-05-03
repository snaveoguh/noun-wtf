import { useQuery } from '@tanstack/react-query';
import { getPublicClient } from '@wagmi/core';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { Address, Bid } from '@/utils/types';
import { config as wagmiConfig } from '@/wagmi';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// V2 was deployed at this block. Floor so we never scan before V2 existed.
const V2_DEPLOY_BLOCK = 24951808n;

// Each auction runs ~24h ≈ 7200 mainnet blocks. Capping the scan at the
// last ~8k blocks covers any in-progress auction and one fully-settled
// recent auction with safety margin — and stays under public-RPC eth_getLogs
// caps (publicnode.com etc. typically reject ranges over 10k blocks and
// return empty without an error). For older historical bids a Ponder
// indexer would be needed; this hook only powers the live "View all bids"
// button on the V2 hero, which is always the current auction.
const RECENT_BLOCK_WINDOW = 8000n;

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
      // Compute a tight fromBlock so the scan stays under the RPC's
      // eth_getLogs limit. Floor at V2 deploy so we never request pre-V2
      // blocks.
      const head = await client.getBlockNumber();
      const fromBlock =
        head > RECENT_BLOCK_WINDOW
          ? head - RECENT_BLOCK_WINDOW > V2_DEPLOY_BLOCK
            ? head - RECENT_BLOCK_WINDOW
            : V2_DEPLOY_BLOCK
          : V2_DEPLOY_BLOCK;
      const events = await client.getContractEvents({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        eventName: 'AuctionBid',
        args: { nounId },
        fromBlock,
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

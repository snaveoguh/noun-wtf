import { getPublicClient } from '@wagmi/core';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { config as wagmiConfig } from '@/wagmi';

import type { ActivityEvent } from './useActivityFeed';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const V2_DEPLOY_BLOCK = 24951808n;
const MAX_EVENTS = 50;

/**
 * Fallback: read v2 AuctionHouse events directly from chain when the
 * `/api/nounv2-feed` endpoint isn't available (Railway redeploy issues).
 * Returns recent V2_BID, V2_SETTLED, V2_AUCTION events sorted block-desc.
 */
export async function fetchV2ChainEvents(): Promise<ActivityEvent[]> {
  if (NOUNV2_AUCTION_HOUSE_ADDRESS === ZERO_ADDRESS) return [];
  const client = getPublicClient(wagmiConfig);
  if (!client) return [];

  const [bids, settles, creates] = await Promise.all([
    client.getContractEvents({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      eventName: 'AuctionBid',
      fromBlock: V2_DEPLOY_BLOCK,
      toBlock: 'latest',
    }),
    client.getContractEvents({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      eventName: 'AuctionSettled',
      fromBlock: V2_DEPLOY_BLOCK,
      toBlock: 'latest',
    }),
    client.getContractEvents({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      eventName: 'AuctionCreated',
      fromBlock: V2_DEPLOY_BLOCK,
      toBlock: 'latest',
    }),
  ]);

  const tsCache = new Map<bigint, bigint>();
  const lookupTs = async (blockNumber: bigint): Promise<bigint> => {
    let ts = tsCache.get(blockNumber);
    if (ts === undefined) {
      const blk = await client.getBlock({ blockNumber });
      ts = blk.timestamp;
      tsCache.set(blockNumber, ts);
    }
    return ts;
  };

  const events: ActivityEvent[] = [];

  for (const ev of bids) {
    const args = ev.args as { nounId?: bigint; sender?: string; value?: bigint };
    const ts = await lookupTs(ev.blockNumber);
    events.push({
      type: 'V2_BID',
      blockNumber: Number(ev.blockNumber),
      timestamp: String(ts),
      txHash: ev.transactionHash ?? '',
      data: {
        nounId: String(args.nounId ?? 0n),
        bidder: args.sender ?? '',
        value: String(args.value ?? 0n),
      },
    });
  }

  for (const ev of settles) {
    const args = ev.args as { nounId?: bigint; winner?: string; amount?: bigint };
    const ts = await lookupTs(ev.blockNumber);
    events.push({
      type: 'V2_SETTLED',
      blockNumber: Number(ev.blockNumber),
      timestamp: String(ts),
      txHash: ev.transactionHash ?? '',
      data: {
        nounId: String(args.nounId ?? 0n),
        winner: args.winner ?? '',
        amount: String(args.amount ?? 0n),
      },
    });
  }

  for (const ev of creates) {
    const args = ev.args as { nounId?: bigint };
    const ts = await lookupTs(ev.blockNumber);
    events.push({
      type: 'V2_AUCTION',
      blockNumber: Number(ev.blockNumber),
      timestamp: String(ts),
      txHash: ev.transactionHash ?? '',
      data: {
        nounId: String(args.nounId ?? 0n),
      },
    });
  }

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  return events.slice(0, MAX_EVENTS);
}

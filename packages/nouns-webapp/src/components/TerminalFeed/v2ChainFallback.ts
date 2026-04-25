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
// publicnode (the default fallback RPC in src/wagmi.ts) caps eth_getLogs
// at 50_000 blocks. v2 currently lives within that window from deploy →
// head, but in ~3.5 days the range will exceed 50k and the fallback would
// silently 502. Trail the head with a max window so this keeps working.
const LOOKBACK_BLOCKS = 49_000n;

/**
 * Fallback: read v2 AuctionHouse events directly from chain when the
 * `/api/nounv2-feed` endpoint isn't available (Railway redeploy issues).
 * Returns recent V2_BID, V2_SETTLED, V2_AUCTION events sorted block-desc.
 */
export async function fetchV2ChainEvents(): Promise<ActivityEvent[]> {
  if (NOUNV2_AUCTION_HOUSE_ADDRESS === ZERO_ADDRESS) return [];
  const client = getPublicClient(wagmiConfig);
  if (client == null) return [];

  // Pull head once (number + timestamp). Lower bound = max(deploy_block,
  // head - 49_000) so we never exceed the RPC's 50k-block window even as
  // v2 ages past launch. We also use the head timestamp to derive each
  // event's timestamp without a per-event getBlock call (used to be ~10s
  // for a 50-event feed) — accurate within ~12s for "X mins ago" display.
  const headBlock = await client.getBlock({ blockTag: 'latest' });
  const headNumber = headBlock.number;
  const headTs = headBlock.timestamp;
  const lookbackFloor = headNumber > LOOKBACK_BLOCKS ? headNumber - LOOKBACK_BLOCKS : 0n;
  const fromBlock = lookbackFloor > V2_DEPLOY_BLOCK ? lookbackFloor : V2_DEPLOY_BLOCK;
  // The feed renderer parses `timestamp` via `new Date(timestamp)`, so we
  // emit ISO strings instead of unix seconds — `new Date("1714066800")`
  // is invalid and produces "NaNmo" labels.
  const tsForBlock = (b: bigint): string => {
    const seconds = Number(headTs - (headNumber - b) * 12n);
    return new Date(seconds * 1000).toISOString();
  };

  const [bids, settles, creates] = await Promise.all([
    client.getContractEvents({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      eventName: 'AuctionBid',
      fromBlock,
      toBlock: 'latest',
    }),
    client.getContractEvents({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      eventName: 'AuctionSettled',
      fromBlock,
      toBlock: 'latest',
    }),
    client.getContractEvents({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      eventName: 'AuctionCreated',
      fromBlock,
      toBlock: 'latest',
    }),
  ]);

  const events: ActivityEvent[] = [];

  for (const ev of bids) {
    const args = ev.args as { nounId?: bigint; sender?: string; value?: bigint };
    events.push({
      type: 'V2_BID',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
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
    events.push({
      type: 'V2_SETTLED',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
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
    events.push({
      type: 'V2_AUCTION',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        nounId: String(args.nounId ?? 0n),
      },
    });
  }

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  return events.slice(0, MAX_EVENTS);
}

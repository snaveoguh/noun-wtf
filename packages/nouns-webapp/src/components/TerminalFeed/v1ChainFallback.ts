import { getPublicClient } from '@wagmi/core';

import {
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
} from '@/contracts/nouns-auction-house.gen';
import { config as wagmiConfig, defaultChain } from '@/wagmi';

import type { ActivityEvent } from './useActivityFeed';

const MAX_EVENTS = 50;
// publicnode (the default fallback RPC in src/wagmi.ts) caps eth_getLogs
// at 50_000 blocks. Querying any wider returns -32701 and the whole
// fallback returns []. 49_000 keeps a safe margin while still covering
// ~6.8 days @ 12s blocks (one auction/day → ~6 settlements visible).
const LOOKBACK_BLOCKS = 49_000n;

/**
 * Fallback: read v1 AuctionHouse events directly from chain when the
 * `/api/activity` endpoint isn't available (Railway redeploy issues post-
 * NounV2 launch). Returns recent BID, SETTLED, AUCTION_CREATED events
 * sorted block-desc, last ~7 days.
 *
 * Mirrors v2ChainFallback. We only fetch events when `/api/activity` has
 * already failed, so the cost only applies in the dead-Railway path.
 */
export async function fetchV1ChainEvents(): Promise<ActivityEvent[]> {
  const chainId = defaultChain.id as keyof typeof nounsAuctionHouseAddress;
  const address = nounsAuctionHouseAddress[chainId];
  // The lookup is statically guaranteed by the keyof constraint above when
  // the deploy chain is one of the supported chains; the runtime guard
  // exists for the case where defaultChain.id drifts to an unsupported id.
  if (address == null) return [];

  const client = getPublicClient(wagmiConfig);
  if (client == null) return [];

  // Pull head info once. We derive each event's timestamp from the head
  // block's timestamp + (event_block - head_block) * 12s instead of doing
  // one getBlock per event (which made the fallback take ~10s on a feed
  // of 50 events). The 12s assumption is the post-merge target — accurate
  // to within a few seconds, which is plenty for "X mins ago" display.
  const headBlock = await client.getBlock({ blockTag: 'latest' });
  const headNumber = headBlock.number;
  const headTs = headBlock.timestamp;
  // The feed renderer parses `timestamp` via `new Date(timestamp)`, so we
  // emit ISO strings instead of unix seconds — `new Date("1714066800")`
  // is invalid and produces "NaNmo" labels.
  const tsForBlock = (b: bigint): string => {
    const seconds = Number(headTs - (headNumber - b) * 12n);
    return new Date(seconds * 1000).toISOString();
  };

  const fromBlock = headNumber > LOOKBACK_BLOCKS ? headNumber - LOOKBACK_BLOCKS : 0n;

  // Skip AuctionCreated — the renderer's NOUN_CREATED case wants
  // `data.owner` (sourced from a separate NounsToken Transfer mint event)
  // which we don't have here, and every AuctionCreated is paired with an
  // AuctionSettled in the same tx anyway, so SETTLED rows already cover
  // the boundary visually.
  const [bids, settles] = await Promise.all([
    client.getContractEvents({
      address,
      abi: nounsAuctionHouseAbi,
      eventName: 'AuctionBid',
      fromBlock,
      toBlock: 'latest',
    }),
    client.getContractEvents({
      address,
      abi: nounsAuctionHouseAbi,
      eventName: 'AuctionSettled',
      fromBlock,
      toBlock: 'latest',
    }),
  ]);

  const events: ActivityEvent[] = [];

  for (const ev of bids) {
    const args = ev.args as { nounId?: bigint; sender?: string; value?: bigint };
    events.push({
      type: 'BID',
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
      type: 'AUCTION_SETTLED',
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

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  return events.slice(0, MAX_EVENTS);
}

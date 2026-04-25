import { getPublicClient } from '@wagmi/core';

import {
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
} from '@/contracts/nouns-auction-house.gen';
import { config as wagmiConfig, defaultChain } from '@/wagmi';

import type { ActivityEvent } from './useActivityFeed';

const MAX_EVENTS = 50;
// ~7 days @ 12s blocks. The mainnet AH log history goes back to 2021 — we
// can't query the full range from a public RPC (most cap log queries at
// 10k blocks), so we trail the head. Bumping the window changes the depth
// of the chain-fallback feed; one auction/day means ~7 settlements visible.
const LOOKBACK_BLOCKS = 50_400n;

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

  const head = await client.getBlockNumber();
  const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;

  const [bids, settles, creates] = await Promise.all([
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
    client.getContractEvents({
      address,
      abi: nounsAuctionHouseAbi,
      eventName: 'AuctionCreated',
      fromBlock,
      toBlock: 'latest',
    }),
  ]);

  // One getBlock call per unique block — auctions are sparse so this is
  // bounded to ~tens of calls per fallback fetch.
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
      type: 'BID',
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
      type: 'AUCTION_SETTLED',
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
      type: 'NOUN_CREATED',
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

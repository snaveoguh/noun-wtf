import type { ActivityEvent } from './useActivityFeed';

import { getPublicClient } from '@wagmi/core';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { NOUNV2_TREASURY_ADDRESS, nounV2TreasuryAbi } from '@/contracts/nounv2-treasury';
import { config as wagmiConfig, defaultChain } from '@/wagmi';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const V2_DEPLOY_BLOCK = 24951808n;
const MAX_EVENTS = 50;
// publicnode (the default RPC in src/wagmi.ts) only serves eth_getLogs for
// roughly the last 10k blocks — anything older is 403 "Archive requests
// require a personal token" (verified 2026-10-22; it used to allow 50k).
// 9k blocks ≈ 30h, which still covers a V2 proposal's whole 12h vote + 12h
// timelock, so a live treasury proposal is always visible from chain.
const LOOKBACK_BLOCKS = 9_000n;

/**
 * Fallback: read v2 AuctionHouse + Treasury events directly from chain when
 * the `/api/nounv2-feed` endpoint is down or its indexer has stalled.
 * Returns recent V2_BID, V2_SETTLED, V2_AUCTION, V2_PROP, V2_VOTE and
 * V2_PROP_{QUEUED,EXECUTED,CANCELED} events sorted block-desc.
 */
export async function fetchV2ChainEvents(): Promise<ActivityEvent[]> {
  if (NOUNV2_AUCTION_HOUSE_ADDRESS === ZERO_ADDRESS) return [];
  const client = getPublicClient(wagmiConfig, { chainId: defaultChain.id });
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

  const hasTreasury = NOUNV2_TREASURY_ADDRESS !== ZERO_ADDRESS;
  const treasuryEvents = <
    N extends
      | 'ProposalCreated'
      | 'VoteCast'
      | 'ProposalQueued'
      | 'ProposalExecuted'
      | 'ProposalCanceled',
  >(
    eventName: N,
  ) =>
    hasTreasury
      ? client.getContractEvents({
          address: NOUNV2_TREASURY_ADDRESS,
          abi: nounV2TreasuryAbi,
          eventName,
          fromBlock,
          toBlock: 'latest',
        })
      : Promise.resolve([]);

  const [bids, settles, creates, props, votes, queued, executed, canceled] = await Promise.all([
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
    treasuryEvents('ProposalCreated'),
    treasuryEvents('VoteCast'),
    treasuryEvents('ProposalQueued'),
    treasuryEvents('ProposalExecuted'),
    treasuryEvents('ProposalCanceled'),
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
        // NounV2AuctionHouse burns the noun when nobody bid — no treasury path.
        ...(args.winner == null || args.winner.toLowerCase() === ZERO_ADDRESS
          ? { burned: true }
          : {}),
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

  const titleById = new Map<string, string>();
  for (const ev of props) {
    const args = ev.args as { id?: bigint; proposer?: string; description?: string };
    const id = String(args.id ?? 0n);
    const description = args.description ?? '';
    const title = titleFromDescription(description);
    titleById.set(id, title);
    events.push({
      type: 'V2_PROP',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        proposalId: id,
        proposer: args.proposer ?? '',
        title,
        description: description.slice(0, 4000),
      },
    });
  }

  for (const ev of votes) {
    const args = ev.args as {
      voter?: string;
      proposalId?: bigint;
      support?: number;
      votes?: bigint;
      reason?: string;
    };
    events.push({
      type: 'V2_VOTE',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        voter: args.voter ?? '',
        proposalId: String(args.proposalId ?? 0n),
        support: args.support ?? 0,
        votes: String(args.votes ?? 0n),
        reason: args.reason ?? '',
      },
    });
  }

  // Status changes can outlive the lookback window's ProposalCreated (a
  // queued prop executes up to 7 days later), so fetch missing titles.
  const statusLogs = [
    ...queued.map(ev => ({ ev, type: 'V2_PROP_QUEUED' })),
    ...executed.map(ev => ({ ev, type: 'V2_PROP_EXECUTED' })),
    ...canceled.map(ev => ({ ev, type: 'V2_PROP_CANCELED' })),
  ];
  const missingIds = [
    ...new Set(
      statusLogs
        .map(({ ev }) => (ev.args as { id?: bigint }).id)
        .filter((id): id is bigint => id != null && !titleById.has(String(id))),
    ),
  ];
  await Promise.all(
    missingIds.map(async id => {
      try {
        const description = await client.readContract({
          address: NOUNV2_TREASURY_ADDRESS,
          abi: nounV2TreasuryAbi,
          functionName: 'getDescription',
          args: [id],
        });
        titleById.set(String(id), titleFromDescription(description));
      } catch {
        // untitled is fine
      }
    }),
  );

  for (const { ev, type } of statusLogs) {
    const args = ev.args as { id?: bigint; eta?: bigint };
    const id = String(args.id ?? 0n);
    events.push({
      type,
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        proposalId: id,
        title: titleById.get(id) ?? `Prop ${id}`,
        ...(args.eta != null ? { eta: Number(args.eta) } : {}),
      },
    });
  }

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  return events.slice(0, MAX_EVENTS);
}

function titleFromDescription(description: string): string {
  const first = description.replace(/^\s+/, '').split('\n')[0] ?? '';
  return first.replace(/^#+\s*/, '').slice(0, 120) || 'Untitled';
}

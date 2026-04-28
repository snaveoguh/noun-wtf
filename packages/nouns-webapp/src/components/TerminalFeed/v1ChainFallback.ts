import { getPublicClient } from '@wagmi/core';

import {
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
} from '@/contracts/nouns-auction-house.gen';
import {
  nounsGovernorAbi,
  nounsGovernorAddress,
} from '@/contracts/nouns-governor.gen';
import { config as wagmiConfig, defaultChain } from '@/wagmi';

import type { ActivityEvent } from './useActivityFeed';

/** Pull a clean title from a markdown-ish proposal description (drops
 *  HTML comments + leading whitespace, then takes the first line). */
function descriptionToTitle(desc: string | undefined): string {
  if (!desc) return 'Untitled';
  const stripped = desc.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\r\n]+/, '');
  const first = stripped.split('\n')[0] ?? '';
  return first.replace(/^#+\s*/, '').slice(0, 120) || 'Untitled';
}

const MAX_EVENTS = 50;
// publicnode (the default fallback RPC in src/wagmi.ts) caps eth_getLogs
// at 50_000 blocks. Querying any wider returns -32701 and the whole
// fallback returns []. 49_000 keeps a safe margin while still covering
// ~6.8 days @ 12s blocks (one auction/day → ~6 settlements visible).
const LOOKBACK_BLOCKS = 49_000n;

// V1 governor's `ProposalCreatedWithRequirements` is overloaded — two ABI
// items share the name. The post-clients variant (the one with `clientId`)
// lives in the governor ABI but viem's `eventName` lookup picks the first
// match, so we pass the ABI item inline to disambiguate.
const PROPOSAL_CREATED_WITH_CLIENT_ID_EVENT = {
  type: 'event',
  anonymous: false,
  name: 'ProposalCreatedWithRequirements',
  inputs: [
    { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
    { name: 'signers', internalType: 'address[]', type: 'address[]', indexed: false },
    { name: 'updatePeriodEndBlock', internalType: 'uint256', type: 'uint256', indexed: false },
    { name: 'proposalThreshold', internalType: 'uint256', type: 'uint256', indexed: false },
    { name: 'quorumVotes', internalType: 'uint256', type: 'uint256', indexed: false },
    { name: 'clientId', internalType: 'uint32', type: 'uint32', indexed: true },
  ],
} as const;

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
  // Governor address may be missing on chains we don't have bindings for
  // (sepolia variants, local hardhat). Skip governor reads in that case.
  const governorAddress = nounsGovernorAddress[chainId];

  const [bids, bidsWithClientId, settles, votes, votesWithClientId, props, propsWithClientId] =
    await Promise.all([
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
        eventName: 'AuctionBidWithClientId',
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
      governorAddress != null
        ? client.getContractEvents({
            address: governorAddress,
            abi: nounsGovernorAbi,
            eventName: 'VoteCast',
            fromBlock,
            toBlock: 'latest',
          })
        : Promise.resolve([]),
      governorAddress != null
        ? client.getContractEvents({
            address: governorAddress,
            abi: nounsGovernorAbi,
            eventName: 'VoteCastWithClientId',
            fromBlock,
            toBlock: 'latest',
          })
        : Promise.resolve([]),
      governorAddress != null
        ? client.getContractEvents({
            address: governorAddress,
            abi: nounsGovernorAbi,
            eventName: 'ProposalCreated',
            fromBlock,
            toBlock: 'latest',
          })
        : Promise.resolve([]),
      governorAddress != null
        ? client.getContractEvents({
            address: governorAddress,
            abi: [PROPOSAL_CREATED_WITH_CLIENT_ID_EVENT],
            eventName: 'ProposalCreatedWithRequirements',
            fromBlock,
            toBlock: 'latest',
          })
        : Promise.resolve([]),
    ]);

  // Build clientId lookup tables from the *WithClientId companion events
  // emitted alongside the canonical ones in the same tx. We key by txHash
  // since each user action (bid/vote/propose) is one tx and only fires
  // one of each event pair.
  const bidClientByTx = new Map<string, number>();
  for (const ev of bidsWithClientId) {
    const args = ev.args as { clientId?: number };
    if (ev.transactionHash != null && args.clientId != null) {
      bidClientByTx.set(ev.transactionHash, Number(args.clientId));
    }
  }
  const voteClientByTx = new Map<string, number>();
  for (const ev of votesWithClientId) {
    const args = ev.args as { clientId?: number };
    if (ev.transactionHash != null && args.clientId != null) {
      voteClientByTx.set(ev.transactionHash, Number(args.clientId));
    }
  }
  const propClientByTx = new Map<string, number>();
  for (const ev of propsWithClientId) {
    const args = ev.args as { clientId?: number };
    if (ev.transactionHash != null && args.clientId != null) {
      propClientByTx.set(ev.transactionHash, Number(args.clientId));
    }
  }

  const events: ActivityEvent[] = [];

  for (const ev of bids) {
    const args = ev.args as { nounId?: bigint; sender?: string; value?: bigint };
    const clientId = ev.transactionHash != null ? bidClientByTx.get(ev.transactionHash) : undefined;
    events.push({
      type: 'BID',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        nounId: String(args.nounId ?? 0n),
        bidder: args.sender ?? '',
        value: String(args.value ?? 0n),
        ...(clientId != null ? { clientId } : {}),
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

  for (const ev of votes) {
    const args = ev.args as {
      voter?: string;
      proposalId?: bigint;
      support?: number;
      votes?: bigint;
      reason?: string;
    };
    const clientId = ev.transactionHash != null ? voteClientByTx.get(ev.transactionHash) : undefined;
    events.push({
      type: 'VOTE',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        voter: args.voter ?? '',
        proposalId: String(args.proposalId ?? 0n),
        support: Number(args.support ?? 0),
        votes: String(args.votes ?? 0n),
        reason: args.reason ?? '',
        ...(clientId != null ? { clientId } : {}),
      },
    });
  }

  for (const ev of props) {
    const args = ev.args as {
      id?: bigint;
      proposer?: string;
      description?: string;
    };
    const clientId = ev.transactionHash != null ? propClientByTx.get(ev.transactionHash) : undefined;
    events.push({
      type: 'PROPOSAL_CREATED',
      blockNumber: Number(ev.blockNumber),
      timestamp: tsForBlock(ev.blockNumber),
      txHash: ev.transactionHash ?? '',
      data: {
        proposalId: String(args.id ?? 0n),
        proposer: args.proposer ?? '',
        title: descriptionToTitle(args.description),
        description: args.description ?? '',
        ...(clientId != null ? { clientId } : {}),
      },
    });
  }

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  return events.slice(0, MAX_EVENTS);
}

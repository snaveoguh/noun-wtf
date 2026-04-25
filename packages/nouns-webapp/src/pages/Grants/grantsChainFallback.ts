import { getPublicClient } from '@wagmi/core';

import {
  smallGrantsTreasuryAbi,
  SMALL_GRANTS_TREASURY_ADDRESS,
} from '@/contracts/small-grants-treasury';
import { config as wagmiConfig } from '@/wagmi';

// Mirrors enum SmallGrantsTreasury.ProposalState in the contract source.
const STATE_LABELS = [
  'ACTIVE',
  'CANCELED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
] as const;

// publicnode caps eth_getLogs at 50_000 blocks. We use the window for
// ProposalCreated events to grab descriptions for *recent* grants. Older
// grants will surface from `proposals(id)` reads with description ''.
const LOOKBACK_BLOCKS = 49_000n;

export interface ChainGrant {
  id: number;
  proposer: string;
  signer: string | null;
  description: string;
  status: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  startBlock: string;
  endBlock: string;
  executionETA: string | null;
  createdAt: string;
}

/**
 * Fallback for the /grants page when /api/grants is dead. Reads
 * proposalCount + per-proposal proposals(id) + state(id) via multicall,
 * grabs ProposalCreated event descriptions from the last ~6 days of
 * blocks, and composes the same Grant shape the API normally returns.
 *
 * Grants older than ~6 days will render with description: '' — they're
 * still listed (id, votes, status) but won't show a title beyond
 * "Untitled". Acceptable trade-off vs. scanning the full event history.
 */
export async function fetchGrantsFromChain(): Promise<ChainGrant[]> {
  const client = getPublicClient(wagmiConfig);
  if (client == null) return [];

  const proposalCount = (await client.readContract({
    address: SMALL_GRANTS_TREASURY_ADDRESS,
    abi: smallGrantsTreasuryAbi,
    functionName: 'proposalCount',
  })) as bigint;

  const count = Number(proposalCount);
  if (count === 0) return [];

  // Build the id range: 1..count (proposalCount is post-increment in the
  // contract, so the last allocated id == count).
  const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1));

  // Multicall every proposals(id) + state(id) in two parallel batches.
  // viem's multicall fans out for us — one RPC round-trip if the client
  // is configured with a multicall3 address (publicnode supports it).
  const proposalContracts = ids.map(id => ({
    address: SMALL_GRANTS_TREASURY_ADDRESS,
    abi: smallGrantsTreasuryAbi,
    functionName: 'proposals' as const,
    args: [id] as const,
  }));
  const stateContracts = ids.map(id => ({
    address: SMALL_GRANTS_TREASURY_ADDRESS,
    abi: smallGrantsTreasuryAbi,
    functionName: 'state' as const,
    args: [id] as const,
  }));

  const [proposalResults, stateResults] = await Promise.all([
    client.multicall({ contracts: proposalContracts, allowFailure: true }),
    client.multicall({ contracts: stateContracts, allowFailure: true }),
  ]);

  // Pull a 49k window of ProposalCreated events to grab descriptions.
  const head = await client.getBlockNumber();
  const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  let descMap = new Map<bigint, string>();
  let createdAtMap = new Map<bigint, bigint>();
  try {
    const created = await client.getContractEvents({
      address: SMALL_GRANTS_TREASURY_ADDRESS,
      abi: smallGrantsTreasuryAbi,
      eventName: 'ProposalCreated',
      fromBlock,
      toBlock: 'latest',
    });
    descMap = new Map(
      created
        .filter(ev => ev.args.id != null)
        .map(ev => [
          ev.args.id as bigint,
          (ev.args.description as string | undefined) ?? '',
        ]),
    );
    // Capture the block for createdAt so the UI can sort sensibly.
    createdAtMap = new Map(
      created
        .filter(ev => ev.args.id != null)
        .map(ev => [ev.args.id as bigint, ev.blockNumber]),
    );
  } catch {
    /* event scan failed — descriptions stay empty, IDs still surface */
  }

  // Pull the head timestamp once for createdAt derivation. Same trick as
  // v1ChainFallback — head_ts - (head_block - event_block) * 12s.
  const headBlock = await client.getBlock({ blockTag: 'latest' });
  const headTs = headBlock.timestamp;
  const headNumber = headBlock.number;
  const tsForBlock = (b: bigint): string => {
    const seconds = Number(headTs - (headNumber - b) * 12n);
    return new Date(seconds * 1000).toISOString();
  };

  const grants: ChainGrant[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const pRes = proposalResults[i];
    const sRes = stateResults[i];
    if (pRes.status !== 'success' || sRes.status !== 'success') continue;

    // proposals(id) returns a fixed-shape tuple. viem types this as a
    // readonly tuple of unnamed positions when the ABI outputs lack
    // explicit names on the function signature (the names are on the
    // struct fields, not the function output). Position order matches
    // the struct in SmallGrantsTreasury.sol:
    //   proposer, snapshotBlock, startBlock, endBlock, eta,
    //   forVotes, againstVotes, abstainVotes, canceled, executed, queued.
    const p = pRes.result as readonly [
      `0x${string}`, // proposer
      bigint, // snapshotBlock
      bigint, // startBlock
      bigint, // endBlock
      bigint, // eta
      bigint, // forVotes
      bigint, // againstVotes
      bigint, // abstainVotes
      boolean, // canceled
      boolean, // executed
      boolean, // queued
    ];
    const proposer = p[0];
    const startBlock = p[2];
    const endBlock = p[3];
    const eta = p[4];
    const forVotes = p[5];
    const againstVotes = p[6];
    const abstainVotes = p[7];

    const stateIndex = Number(sRes.result as number);
    const status = STATE_LABELS[stateIndex] ?? 'ACTIVE';

    const description = descMap.get(id) ?? '';

    const createdBlock = createdAtMap.get(id);
    const createdAt = createdBlock != null ? tsForBlock(createdBlock) : '';

    grants.push({
      id: Number(id),
      proposer,
      signer: null,
      description,
      status,
      forVotes: Number(forVotes),
      againstVotes: Number(againstVotes),
      abstainVotes: Number(abstainVotes),
      startBlock: String(startBlock),
      endBlock: String(endBlock),
      executionETA: eta > 0n ? String(eta) : null,
      createdAt,
    });
  }

  // Newest first — same order /api/grants returns.
  grants.sort((a, b) => b.id - a.id);
  return grants;
}

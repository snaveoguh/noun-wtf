// ─── Autopilot — governor reads (Nouns + Lil Nouns) ─────────────────────────
//
// Everything the recommendation engine and the relayer sweep need to know
// about a proposal / a voter that does NOT come from Ponder:
//
//   • on-chain `state()`, `getReceipt()`, `getPriorVotes()` for both governors
//   • Lil Nouns active proposals (Goldsky subgraph for content, on-chain
//     `state()` as the source of truth for "active", on-chain `proposals()`
//     for the vote-snapshot block)
//   • Lil Nouns votes by a wallet (subgraph)
//
// Nouns proposals come from Ponder and are listed in `api/walletProfile.ts`
// (this module must stay free of `ponder:*` imports so the self-test can run
// it under tsx).

import type { AutopilotDao } from './autopilotPrefs.js';
import type { PublicClient } from 'viem';

import { parse7702Code } from '@nouns/vote-permit';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

type Hex = `0x${string}`;

// ─── Addresses ─────────────────────────────────────────────────────────────

/** Same Goldsky deployment `api/activityFeed.ts` uses (duplicated: that module imports `ponder:*`). */
const LIL_NOUNS_SUBGRAPH =
  'https://api.goldsky.com/api/public/project_cldjvjgtylso13swq3dre13sf/subgraphs/lil-nouns-subgraph/1.0.10/gn';

export const NOUNS_GOVERNOR = '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d' as const;
export const NOUNS_TOKEN = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03' as const;
export const LIL_NOUNS_GOVERNOR = '0x5d2C31ce16924C2a71D317e5BbFd5ce387854039' as const;
export const LIL_NOUNS_TOKEN = '0x4b10701Bfd7BFEdc47d50562b76b436fbB5BdB3B' as const;

export const DAO_CONTRACTS: Record<AutopilotDao, { governor: Hex; token: Hex }> = {
  nouns: { governor: NOUNS_GOVERNOR, token: NOUNS_TOKEN },
  'lil-nouns': { governor: LIL_NOUNS_GOVERNOR, token: LIL_NOUNS_TOKEN },
};

export const SECONDS_PER_BLOCK = 12;

/** Governor state enum (Bravo + Nouns extensions). */
export const GOVERNOR_STATES = [
  'PENDING',
  'ACTIVE',
  'CANCELLED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
  'VETOED',
  'OBJECTION_PERIOD',
  'UPDATABLE',
] as const;
export type GovernorState = (typeof GOVERNOR_STATES)[number];

// ─── ABIs ──────────────────────────────────────────────────────────────────

export const GOVERNOR_READ_ABI = [
  {
    type: 'function',
    name: 'state',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'getReceipt',
    stateMutability: 'view',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'voter', type: 'address' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'hasVoted', type: 'bool' },
          { name: 'support', type: 'uint8' },
          { name: 'votes', type: 'uint96' },
        ],
      },
    ],
  },
] as const;

/** Lil Nouns governor is NounsDAOLogicV2-shaped: `proposals()` returns the 15-field condensed struct. */
const LIL_PROPOSALS_ABI = [
  {
    type: 'function',
    name: 'proposals',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'proposer', type: 'address' },
          { name: 'proposalThreshold', type: 'uint256' },
          { name: 'quorumVotes', type: 'uint256' },
          { name: 'eta', type: 'uint256' },
          { name: 'startBlock', type: 'uint256' },
          { name: 'endBlock', type: 'uint256' },
          { name: 'forVotes', type: 'uint256' },
          { name: 'againstVotes', type: 'uint256' },
          { name: 'abstainVotes', type: 'uint256' },
          { name: 'canceled', type: 'bool' },
          { name: 'vetoed', type: 'bool' },
          { name: 'executed', type: 'bool' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'creationBlock', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

export const TOKEN_VOTES_ABI = [
  {
    type: 'function',
    name: 'getPriorVotes',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'blockNumber', type: 'uint256' },
    ],
    outputs: [{ type: 'uint96' }],
  },
  {
    type: 'function',
    name: 'getCurrentVotes',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint96' }],
  },
] as const;

// ─── Client ────────────────────────────────────────────────────────────────

export const AUTOPILOT_RPC_URL =
  process.env.AGENT_RPC_URL ||
  process.env.NOUNIRL_RPC_URL ||
  process.env.PONDER_RPC_URL_1 ||
  'https://ethereum-rpc.publicnode.com';

let readClient: PublicClient | null = null;
export function getReadClient(): PublicClient {
  if (!readClient) {
    readClient = createPublicClient({ chain: mainnet, transport: http(AUTOPILOT_RPC_URL) });
  }
  return readClient;
}

// ─── Unified proposal shape ────────────────────────────────────────────────

export interface ProposalTx {
  target: string;
  value: bigint;
  signature: string;
  calldata: string;
}

/** A proposal inside its voting window, from either DAO, in one shape. */
export interface ActiveProposal {
  dao: AutopilotDao;
  id: number;
  title: string;
  description: string;
  proposer: string; // lowercase
  startBlock: bigint;
  /** Last block votes are accepted (objection period end when one is running). */
  endBlock: bigint;
  /** True while only AGAINST votes are accepted (Nouns objection period). */
  objectionOnly: boolean;
  /** Block the governor reads vote weight at. Null → fall back to startBlock. */
  snapshotBlock: bigint | null;
  txs: ProposalTx[];
}

// ─── On-chain reads ────────────────────────────────────────────────────────

export async function readProposalState(
  dao: AutopilotDao,
  proposalId: number,
  client = getReadClient(),
): Promise<GovernorState | null> {
  try {
    const code = await client.readContract({
      address: DAO_CONTRACTS[dao].governor,
      abi: GOVERNOR_READ_ABI,
      functionName: 'state',
      args: [BigInt(proposalId)],
    });
    return GOVERNOR_STATES[code] ?? null;
  } catch {
    return null;
  }
}

export async function readReceipt(
  dao: AutopilotDao,
  proposalId: number,
  voter: string,
  client = getReadClient(),
): Promise<{ hasVoted: boolean; support: number; votes: bigint }> {
  const r = await client.readContract({
    address: DAO_CONTRACTS[dao].governor,
    abi: GOVERNOR_READ_ABI,
    functionName: 'getReceipt',
    args: [BigInt(proposalId), voter as Hex],
  });
  return { hasVoted: r.hasVoted, support: r.support, votes: r.votes };
}

export async function readPriorVotes(
  dao: AutopilotDao,
  voter: string,
  blockNumber: bigint,
  client = getReadClient(),
): Promise<bigint> {
  return client.readContract({
    address: DAO_CONTRACTS[dao].token,
    abi: TOKEN_VOTES_ABI,
    functionName: 'getPriorVotes',
    args: [voter as Hex, blockNumber],
  });
}

export async function readCurrentVotes(
  dao: AutopilotDao,
  voter: string,
  client = getReadClient(),
): Promise<bigint> {
  return client.readContract({
    address: DAO_CONTRACTS[dao].token,
    abi: TOKEN_VOTES_ABI,
    functionName: 'getCurrentVotes',
    args: [voter as Hex],
  });
}

/**
 * Vote weight the governor will credit `voter` with on `proposal`. Tries the
 * snapshot block first, then startBlock (older governor semantics), so a 0
 * here really means "this vote would carry no weight". `tried` lists every
 * block consulted so a skip row can say exactly what was checked.
 */
export async function readVoteWeight(
  proposal: ActiveProposal,
  voter: string,
  client = getReadClient(),
): Promise<{ votes: bigint; block: bigint; tried: bigint[] }> {
  const blocks = [...new Set([proposal.snapshotBlock, proposal.startBlock].filter(b => b != null))];
  const tried: bigint[] = [];
  for (const block of blocks) {
    tried.push(block);
    const votes = await readPriorVotes(proposal.dao, voter, block, client);
    if (votes > 0n) return { votes, block, tried };
  }
  return { votes: 0n, block: proposal.startBlock, tried };
}

/**
 * What code the delegator's address carries. `redeemDelegations` calls INTO
 * the delegator (`executeFromExecutor`), so a bare EOA — no EIP-7702
 * designation — can never redeem: the call reverts with no data.
 */
export async function readDelegatorCode(
  address: string,
  client = getReadClient(),
): Promise<{ hasCode: boolean; delegate7702: Hex | null; isMetaMaskDelegator: boolean }> {
  const code = (await client.getCode({ address: address as Hex })) ?? '0x';
  if (!code || code === '0x')
    return { hasCode: false, delegate7702: null, isMetaMaskDelegator: false };
  const parsed = parse7702Code(code);
  return {
    hasCode: true,
    delegate7702: parsed.isDelegated ? (parsed.implementation as Hex) : null,
    isMetaMaskDelegator: parsed.isMetaMaskDelegator,
  };
}

// ─── Lil Nouns (subgraph + chain) ──────────────────────────────────────────

const LIL_CACHE_TTL = 60_000;
let lilActiveCache: { at: number; items: ActiveProposal[] } | null = null;

type SubgraphProposal = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  startBlock?: string;
  endBlock?: string;
  createdBlock?: string;
  proposer?: { id?: string };
  targets?: string[];
  values?: string[];
  signatures?: string[];
  calldatas?: string[];
};

async function lilQuery<T>(query: string): Promise<T> {
  const res = await fetch(LIL_NOUNS_SUBGRAPH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Lil Nouns subgraph ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Lil Nouns subgraph: ${json.errors[0]!.message}`);
  if (!json.data) throw new Error('Lil Nouns subgraph: empty response');
  return json.data;
}

/**
 * Lil Nouns proposals that are ACTIVE on-chain right now. The subgraph only
 * flips status on explicit events, so stale ACTIVE rows are common — every
 * candidate is confirmed with `state()` and its snapshot read from
 * `proposals()` (`creationBlock`, V2 semantics; verified 2026-09-03: the Lil
 * governor returns the 15-field condensed struct).
 */
export async function listLilActiveProposals(
  client = getReadClient(),
  opts: { fresh?: boolean } = {},
): Promise<ActiveProposal[]> {
  const now = Date.now();
  if (!opts.fresh && lilActiveCache && now - lilActiveCache.at < LIL_CACHE_TTL) {
    return lilActiveCache.items;
  }
  const latest = await client.getBlockNumber();
  // Voting period is ~4 days; 30 days of slack keeps the candidate set tiny
  // while never missing a proposal the subgraph still labels ACTIVE/PENDING.
  const minEnd = latest - 216_000n;
  const data = await lilQuery<{ proposals: SubgraphProposal[] }>(`{
    proposals(first: 50, orderBy: createdBlock, orderDirection: desc,
      where: { status_in: [ACTIVE, PENDING], endBlock_gte: "${minEnd.toString()}" }) {
      id title description status startBlock endBlock createdBlock
      proposer { id } targets values signatures calldatas
    }
  }`);
  const candidates = (data.proposals ?? []).filter(p => {
    const start = BigInt(p.startBlock ?? '0');
    const end = BigInt(p.endBlock ?? '0');
    return start <= latest && end >= latest;
  });
  if (candidates.length === 0) {
    lilActiveCache = { at: now, items: [] };
    return [];
  }
  const [states, structs] = await Promise.all([
    client.multicall({
      contracts: candidates.map(p => ({
        address: LIL_NOUNS_GOVERNOR,
        abi: GOVERNOR_READ_ABI,
        functionName: 'state' as const,
        args: [BigInt(p.id)],
      })),
      allowFailure: true,
    }),
    client.multicall({
      contracts: candidates.map(p => ({
        address: LIL_NOUNS_GOVERNOR,
        abi: LIL_PROPOSALS_ABI,
        functionName: 'proposals' as const,
        args: [BigInt(p.id)],
      })),
      allowFailure: true,
    }),
  ]);
  const items: ActiveProposal[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i]!;
    const st = states[i];
    if (st?.status !== 'success' || GOVERNOR_STATES[Number(st.result)] !== 'ACTIVE') continue;
    const s = structs[i];
    const creationBlock =
      s?.status === 'success' && s.result.creationBlock > 0n ? s.result.creationBlock : null;
    const targets = p.targets ?? [];
    items.push({
      dao: 'lil-nouns',
      id: Number(p.id),
      title: (p.title || '').trim() || `Lil Prop ${p.id}`,
      description: p.description ?? '',
      proposer: (p.proposer?.id ?? '').toLowerCase(),
      startBlock: BigInt(p.startBlock ?? '0'),
      endBlock: BigInt(p.endBlock ?? '0'),
      objectionOnly: false,
      snapshotBlock: creationBlock ?? (p.createdBlock ? BigInt(p.createdBlock) : null),
      txs: targets.map((t, j) => ({
        target: t.toLowerCase(),
        value: BigInt(p.values?.[j] ?? '0'),
        signature: p.signatures?.[j] ?? '',
        calldata: p.calldatas?.[j] ?? '0x',
      })),
    });
  }
  lilActiveCache = { at: now, items };
  return items;
}

export interface LilVote {
  proposalId: number;
  support: number;
  reason: string;
  votes: number;
  blockTimestamp: number; // seconds
}

/** A wallet's Lil Nouns votes — all of them (newest first) or only on `proposalIds`. */
export async function listLilVotesBy(
  voter: string,
  opts: { proposalIds?: number[]; limit?: number } = {},
): Promise<LilVote[]> {
  const filter = [`voter: "${voter.toLowerCase()}"`];
  if (opts.proposalIds?.length) {
    filter.push(`proposal_in: [${opts.proposalIds.map(id => `"${id}"`).join(', ')}]`);
  }
  const data = await lilQuery<{
    votes: Array<{
      proposal?: { id?: string };
      support?: number;
      supportDetailed?: number;
      reason?: string | null;
      votes?: string;
      blockTimestamp?: string;
    }>;
  }>(`{
    votes(first: ${Math.min(opts.limit ?? 60, 1000)}, orderBy: blockNumber, orderDirection: desc,
      where: { ${filter.join(', ')} }) {
      proposal { id } supportDetailed reason votes blockTimestamp
    }
  }`);
  return (data.votes ?? []).map(v => ({
    proposalId: Number(v.proposal?.id ?? 0),
    support: Number(v.supportDetailed ?? v.support ?? 2),
    reason: (v.reason ?? '').trim(),
    votes: Number(v.votes ?? 0),
    blockTimestamp: Number(v.blockTimestamp ?? 0),
  }));
}

// ─── Timing helpers ────────────────────────────────────────────────────────

export const blocksToHours = (blocks: bigint): number =>
  (Number(blocks) * SECONDS_PER_BLOCK) / 3600;

/** How long voting has been open / how long remains, in hours, at `latest`. */
export function proposalTiming(p: ActiveProposal, latest: bigint) {
  return {
    openForHours: latest >= p.startBlock ? blocksToHours(latest - p.startBlock) : 0,
    remainingHours: p.endBlock >= latest ? blocksToHours(p.endBlock - latest) : 0,
  };
}

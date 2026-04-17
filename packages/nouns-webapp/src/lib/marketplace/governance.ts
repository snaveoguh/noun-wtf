/**
 * Prediction market governance bridge.
 *
 * Fetches active Nouns/Lil Nouns proposals for prediction market display.
 * Uses our own Ponder API (spirited-flexibility) for Nouns proposals,
 * and on-chain reads via viem for Lil Nouns.
 */

import { createPublicClient, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

const MAINNET_RPC_URL =
  (import.meta.env.VITE_MAINNET_JSONRPC as string | undefined) ??
  'https://mainnet.rpc.buidlguidl.com';

const LIL_NOUNS_GOVERNOR: Address = '0x5d2C31ce16924C2a71D317e5BbFd5ce387854039';

let cachedClient: ReturnType<typeof createPublicClient> | null = null;
function getPublicClient() {
  if (cachedClient == null) {
    cachedClient = createPublicClient({
      chain: mainnet,
      transport: http(MAINNET_RPC_URL),
    });
  }
  return cachedClient;
}

const GOVERNOR_ABI = [
  {
    type: 'function',
    name: 'proposalCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'proposals',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
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
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'proposalDescriptions',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'state',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// State code → subgraph-style uppercase status label
// 0=PENDING, 1=ACTIVE, 2=CANCELLED, 3=DEFEATED, 4=SUCCEEDED, 5=QUEUED,
// 6=EXPIRED, 7=EXECUTED, 8=VETOED, 9=OBJECTION_PERIOD, 10=UPDATABLE
const STATE_CODE_TO_STATUS: readonly string[] = [
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
];

function mapStateCode(code: number): string {
  return STATE_CODE_TO_STATUS[code] ?? 'PENDING';
}

export interface PredictionProposal {
  dao: string;
  proposalId: string;
  title: string;
  status: string;
  url?: string;
  votesFor?: number;
  votesAgainst?: number;
  quorum?: number;
  votingClosed?: boolean;
}

const ACTIVE_STATUSES = ['ACTIVE', 'PENDING', 'OBJECTION_PERIOD', 'UPDATABLE'];
const RESOLVED_STATUSES = [
  'CANCELLED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
  'VETOED',
];

/** Fetch Nouns proposals from our Ponder REST API */
async function fetchNounsProposals(): Promise<PredictionProposal[]> {
  try {
    const res = await fetch(`${API_BASE}/api/proposals`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const proposals = await res.json();
    if (!Array.isArray(proposals)) return [];
    return proposals.map((p: Record<string, unknown>) => {
      const desc = (p.description as string) ?? '';
      const firstLine = desc.split('\n')[0] ?? '';
      const title =
        (p.title as string) ??
        (firstLine
          .replace(/^#+\s*/, '')
          .trim()
          .slice(0, 120) ||
          'Untitled Proposal');
      const status = ((p.status as string) ?? '').toLowerCase().replace(/_/g, '-');
      return {
        dao: 'nouns',
        proposalId: String(p.id),
        title,
        status,
        url: `/vote/${p.id}`,
        votesFor: Number(p.forVotes ?? 0),
        votesAgainst: Number(p.againstVotes ?? 0),
        quorum: Number(p.quorumVotes ?? 0),
        votingClosed: RESOLVED_STATUSES.includes(((p.status as string) ?? '').toUpperCase()),
      };
    });
  } catch {
    return [];
  }
}

export interface LilNounsProposal {
  id: number;
  proposer: string;
  title: string;
  description: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumVotes: number;
  startBlock: number;
  endBlock: number;
  status: string;
  canceled: boolean;
  vetoed: boolean;
  executed: boolean;
}

function parseTitle(description: string, fallback: string): string {
  const firstLine = description.split('\n')[0] ?? '';
  const stripped = firstLine.replace(/^#+\s*/, '').trim();
  if (stripped.length === 0) return fallback;
  return stripped.slice(0, 120);
}

/**
 * Fetch the most recent Lil Nouns proposals directly from the governor contract
 * via viem multicall. Avoids the dead Goldsky subgraph.
 */
export async function fetchLilNounsProposalsOnchain(count = 25): Promise<LilNounsProposal[]> {
  try {
    const client = getPublicClient();
    const totalCount = (await client.readContract({
      address: LIL_NOUNS_GOVERNOR,
      abi: GOVERNOR_ABI,
      functionName: 'proposalCount',
    })) as bigint;

    const total = Number(totalCount);
    if (total <= 0) return [];

    const take = Math.min(count, total);
    const start = total - take + 1;
    const ids = Array.from({ length: take }, (_, i) => start + i).reverse();

    const calls = ids.flatMap(id => [
      {
        address: LIL_NOUNS_GOVERNOR,
        abi: GOVERNOR_ABI,
        functionName: 'proposals' as const,
        args: [BigInt(id)],
      },
      {
        address: LIL_NOUNS_GOVERNOR,
        abi: GOVERNOR_ABI,
        functionName: 'state' as const,
        args: [BigInt(id)],
      },
      {
        address: LIL_NOUNS_GOVERNOR,
        abi: GOVERNOR_ABI,
        functionName: 'proposalDescriptions' as const,
        args: [BigInt(id)],
      },
    ]);

    const results = await client.multicall({ contracts: calls, allowFailure: true });

    const out: LilNounsProposal[] = [];
    for (let i = 0; i < ids.length; i++) {
      const proposalResult = results[i * 3];
      const stateResult = results[i * 3 + 1];
      const descResult = results[i * 3 + 2];

      if (proposalResult == null || stateResult == null) continue;
      if (proposalResult.status !== 'success' || stateResult.status !== 'success') continue;

      const p = proposalResult.result as unknown as readonly unknown[];
      const id = ids[i];
      if (id == null) continue;

      const description =
        descResult != null && descResult.status === 'success'
          ? String(descResult.result ?? '')
          : '';

      out.push({
        id,
        proposer: String(p[1] ?? ''),
        quorumVotes: Number(p[3] ?? 0),
        startBlock: Number(p[5] ?? 0),
        endBlock: Number(p[6] ?? 0),
        forVotes: Number(p[7] ?? 0),
        againstVotes: Number(p[8] ?? 0),
        abstainVotes: Number(p[9] ?? 0),
        canceled: Boolean(p[10]),
        vetoed: Boolean(p[11]),
        executed: Boolean(p[12]),
        status: mapStateCode(Number(stateResult.result)),
        description,
        title: parseTitle(description, `Lil Proposal ${id}`),
      });
    }
    return out;
  } catch (error) {
    console.error('[lil-nouns] Failed to fetch proposals on-chain:', error);
    return [];
  }
}

/** Subgraph proposal shape returned by our /api/lil-proposals proxy. */
interface SubgraphLilProposal {
  id: string;
  title?: string | null;
  description?: string | null;
  status: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes?: string;
  quorumVotes: string;
  startBlock: string;
  endBlock: string;
  createdBlock?: string;
  createdTimestamp?: string;
  proposer?: { id: string };
}

/**
 * Fetch Lil Nouns proposals from the subgraph via our Ponder API proxy.
 * The proxy caches briefly + shields the browser from Goldsky rate limits.
 * Falls back to direct on-chain multicall if the proxy fails.
 */
export async function fetchLilNounsProposalsFromProxy(): Promise<LilNounsProposal[]> {
  const res = await fetch(`${API_BASE}/api/lil-proposals`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`lil-proposals proxy ${res.status}`);
  const items = (await res.json()) as SubgraphLilProposal[];
  return items.map(p => {
    const description = p.description ?? '';
    const title =
      (p.title ?? '').trim().length > 0
        ? (p.title as string).trim()
        : parseTitle(description, `Lil Proposal ${p.id}`);
    return {
      id: Number(p.id),
      proposer: p.proposer?.id ?? '',
      quorumVotes: Number(p.quorumVotes),
      startBlock: Number(p.startBlock),
      endBlock: Number(p.endBlock),
      forVotes: Number(p.forVotes),
      againstVotes: Number(p.againstVotes),
      abstainVotes: Number(p.abstainVotes ?? 0),
      canceled: p.status.toUpperCase() === 'CANCELLED' || p.status.toUpperCase() === 'CANCELED',
      vetoed: p.status.toUpperCase() === 'VETOED',
      executed: p.status.toUpperCase() === 'EXECUTED',
      status: p.status.toUpperCase(),
      description,
      title,
    };
  });
}

/** Fetch Lil Nouns proposals in the PredictionProposal shape. Proxy first, on-chain fallback. */
async function fetchLilNounsProposals(): Promise<PredictionProposal[]> {
  let proposals: LilNounsProposal[];
  try {
    proposals = await fetchLilNounsProposalsFromProxy();
  } catch (err) {
    console.warn('[lil-nouns] proxy failed, falling back to on-chain multicall:', err);
    proposals = await fetchLilNounsProposalsOnchain(25);
  }
  return proposals.map(p => {
    const normalizedStatus = p.status.toLowerCase().replace(/_/g, '-');
    return {
      dao: 'lil-nouns',
      proposalId: String(p.id),
      title: p.title,
      status: normalizedStatus,
      url: `/vote/${p.id}?dao=lil`,
      votesFor: p.forVotes,
      votesAgainst: p.againstVotes,
      quorum: p.quorumVotes,
      votingClosed: RESOLVED_STATUSES.includes(p.status),
    };
  });
}

export async function fetchActivePredictionProposals(): Promise<PredictionProposal[]> {
  const [nouns, lilNouns] = await Promise.all([fetchNounsProposals(), fetchLilNounsProposals()]);

  const activeNouns = nouns.filter(p =>
    ACTIVE_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );
  const activeLilNouns = lilNouns.filter(p =>
    ACTIVE_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );

  return [...activeNouns, ...activeLilNouns];
}

export async function fetchResolvedPredictionProposals(): Promise<PredictionProposal[]> {
  const [nouns, lilNouns] = await Promise.all([fetchNounsProposals(), fetchLilNounsProposals()]);

  const resolvedNouns = nouns.filter(p =>
    RESOLVED_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );
  const resolvedLilNouns = lilNouns.filter(p =>
    RESOLVED_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );

  return [...resolvedNouns, ...resolvedLilNouns];
}

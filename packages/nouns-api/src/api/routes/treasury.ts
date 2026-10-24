import type { TreasuryFlowsResponse, TreasuryHoldings } from '../treasury/types.js';
import type { Hono } from 'hono';

import { eq, lte, sql } from 'drizzle-orm';
import { compress } from 'hono/compress';
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';

import {
  addressesNeedingCode,
  buildTreasuryFlows,
  codeKindFromBytecode,
  type BuildInput,
  type CodeKind,
} from '../treasury/buildFlows.js';
import { reconcile } from '../treasury/holdings.js';
import { readHoldings as readHoldingsWith } from '../treasury/readHoldings.js';

// ============================================================
// Treasury Flows — /api/treasury/flows (the Nonsense page)
// ============================================================
// Rows → buildTreasuryFlows (pure, unit-tested) → JSON. This file only reads
// the tables and fills two caches the builder needs: eth_getCode verdicts
// (person / Safe multisig / contract) and primary ENS names. It also reads the
// live holdings (one multicall, cached 5 min) and attaches them, with the
// reconciliation (holdings.ts), to each response.

const rpc = createPublicClient({
  chain: mainnet,
  transport: fallback([
    ...(process.env.PONDER_RPC_URL_1 ?? '')
      .split(',')
      .filter(Boolean)
      .map(u => http(u, { timeout: 15_000 })),
    http('https://ethereum-rpc.publicnode.com', { timeout: 15_000 }),
    http('https://gateway.tenderly.co/public/mainnet', { timeout: 15_000 }),
  ]),
});

// ── eth_getCode cache (code rarely changes; re-check daily for 7702 EOAs) ──
const CODE_TTL = 24 * 3600_000;
const codeCache = new Map<string, { kind: CodeKind; at: number }>();

async function lookupCode(addrs: string[]): Promise<Record<string, CodeKind>> {
  const now = Date.now();
  const todo = addrs.filter(a => {
    const c = codeCache.get(a);
    return !c || now - c.at > CODE_TTL;
  });
  for (let i = 0; i < todo.length; i += 25) {
    const batch = todo.slice(i, i + 25);
    await Promise.all(
      batch.map(async a => {
        try {
          const code = await rpc.getCode({ address: a as `0x${string}` });
          codeCache.set(a, { kind: codeKindFromBytecode(code), at: now });
        } catch {
          /* unknown — node is flagged codeUnknown */
        }
      }),
    );
  }
  const out: Record<string, CodeKind> = {};
  for (const a of addrs) {
    const c = codeCache.get(a);
    if (c) out[a] = c.kind;
  }
  return out;
}

// ── ENS: ReverseRecords.getNames (forward-verified, 1 call per 200 addrs) ──
const REVERSE_RECORDS = '0x3671aE578E63FdF66ad4F3E12CC0c0d71Ac7510C';
const reverseAbi = parseAbi(['function getNames(address[]) view returns (string[])']);
const ENS_TTL = 6 * 3600_000;
const ensCache = new Map<string, { name: string | null; at: number }>();

async function lookupEns(addrs: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const todo = addrs.filter(a => {
    const c = ensCache.get(a);
    return !c || now - c.at > ENS_TTL;
  });
  for (let i = 0; i < todo.length; i += 200) {
    const batch = todo.slice(i, i + 200);
    try {
      const names = await rpc.readContract({
        address: REVERSE_RECORDS,
        abi: reverseAbi,
        functionName: 'getNames',
        args: [batch as `0x${string}`[]],
      });
      batch.forEach((a, j) => ensCache.set(a, { name: names[j] || null, at: now }));
    } catch {
      /* leave uncached; names fall back to short addresses */
    }
  }
  const out: Record<string, string> = {};
  for (const a of addrs) {
    const n = ensCache.get(a)?.name;
    if (n) out[a] = n;
  }
  return out;
}

// Holdings are cached 5 min (stale-while-revalidate); a failed read keeps the
// last good one, and the page still loads without them.
const HOLDINGS_MS = 5 * 60_000;
let holdingsCache: { data: TreasuryHoldings; at: number } | null = null;
let holdingsInflight: Promise<TreasuryHoldings | null> | null = null;

function refreshHoldings(): Promise<TreasuryHoldings | null> {
  if (!holdingsInflight) {
    holdingsInflight = readHoldingsWith(rpc)
      .then(data => {
        holdingsCache = { data, at: Date.now() };
        return data;
      })
      .catch(err => {
        console.error('Treasury holdings read failed:', err);
        return holdingsCache?.data ?? null;
      })
      .finally(() => {
        holdingsInflight = null;
      });
  }
  return holdingsInflight;
}

async function currentHoldings(): Promise<TreasuryHoldings | null> {
  if (holdingsCache) {
    if (Date.now() - holdingsCache.at > HOLDINGS_MS) void refreshHoldings();
    return holdingsCache.data;
  }
  // First request: wait for the read, but never hold the page up for long.
  return Promise.race([
    refreshHoldings(),
    new Promise<null>(r => setTimeout(() => r(null), 12_000)),
  ]);
}

function withHoldings(
  data: TreasuryFlowsResponse,
  holdings: TreasuryHoldings | null,
): TreasuryFlowsResponse {
  return {
    ...data,
    holdings,
    reconciliation: holdings ? reconcile(data.stats, holdings) : null,
  };
}

// ── Ponder sync state (the API is served while a deploy backfills) ──
async function indexingState(): Promise<TreasuryFlowsResponse['indexing']> {
  const port = process.env.PORT ?? '42069';
  const base = `http://127.0.0.1:${port}`;
  const [ready, status] = await Promise.all([
    fetch(`${base}/ready`, { signal: AbortSignal.timeout(5_000) })
      .then(r => r.ok)
      .catch(() => false),
    fetch(`${base}/status`, { signal: AbortSignal.timeout(5_000) })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null) as Promise<{
      mainnet?: { block?: { number?: number; timestamp?: number } };
    } | null>,
  ]);
  return {
    complete: ready,
    block: status?.mainnet?.block?.number ?? null,
    timestamp: status?.mainnet?.block?.timestamp ?? null,
  };
}

async function loadRows(): Promise<Omit<BuildInput, 'now' | 'code' | 'ens' | 'indexing'>> {
  const [
    proposals,
    transactions,
    executions,
    auctions,
    nouns,
    streams,
    streamCancels,
    forkSends,
    forks,
  ] = await Promise.all([
    db
      .select({
        id: schema.proposal.id,
        proposer: schema.proposal.proposer,
        // titles only — full descriptions are megabytes
        description: sql<string>`left(${schema.proposal.description}, 400)`,
        status: schema.proposal.status,
        createdAt: schema.proposal.createdAt,
      })
      .from(schema.proposal),
    db.select().from(schema.transaction),
    db
      .select()
      .from(schema.proposalStatusChange)
      .where(eq(schema.proposalStatusChange.status, 'EXECUTED')),
    db
      .select({
        nounId: schema.auction.nounId,
        winner: schema.auction.winner,
        amount: schema.auction.amount,
        settled: schema.auction.settled,
        burned: schema.auction.burned,
        endTime: schema.auction.endTime,
        settledAt: schema.auction.settledAt,
        settledAtTransaction: schema.auction.settledAtTransaction,
      })
      .from(schema.auction),
    // nounder rewards are ids ≤ 1820 divisible by 10 (see buildFlows)
    db.select({ id: schema.noun.id }).from(schema.noun).where(lte(schema.noun.id, 1820n)),
    db.select().from(schema.stream),
    db
      .select({
        streamAddress: schema.streamEvent.streamAddress,
        amount: schema.streamEvent.amount,
        createdAt: schema.streamEvent.createdAt,
      })
      .from(schema.streamEvent)
      .where(eq(schema.streamEvent.kind, 'cancelled')),
    db.select().from(schema.treasurySend),
    db
      .select({ forkId: schema.forkEvent.forkId, forkTreasury: schema.forkEvent.forkTreasury })
      .from(schema.forkEvent)
      .where(eq(schema.forkEvent.kind, 'executed')),
  ]);
  return {
    proposals,
    transactions,
    executions,
    auctions,
    nouns,
    streams,
    streamCancels,
    forkSends,
    forks,
  };
}

export async function computeTreasuryFlows(): Promise<TreasuryFlowsResponse> {
  const [rows, indexing] = await Promise.all([loadRows(), indexingState()]);
  const now = Math.floor(Date.now() / 1000);
  const base: BuildInput = { ...rows, now, code: {}, ens: {}, indexing };
  // First pass finds the recipients; second pass types and names them.
  const draft = buildTreasuryFlows(base);
  const recipients = addressesNeedingCode(draft);
  const everyone = draft.nodes.map(n => n.id).filter(id => id.startsWith('0x'));
  const [code, ens] = await Promise.all([lookupCode(recipients), lookupEns(everyone)]);
  return buildTreasuryFlows({ ...base, code, ens });
}

// Complete results are cached 10 min; while the indexer backfills, 60 s so
// the page fills in as it syncs. One computation at a time.
const FRESH_MS = 10 * 60_000;
const BACKFILL_MS = 60_000;
let cache: { data: TreasuryFlowsResponse; at: number } | null = null;
let inflight: Promise<TreasuryFlowsResponse> | null = null;

function refresh(): Promise<TreasuryFlowsResponse> {
  if (!inflight) {
    inflight = computeTreasuryFlows()
      .then(data => {
        cache = { data, at: Date.now() };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function registerTreasuryRoutes(app: Hono) {
  // ~1 MB of JSON; gzip takes it to ~150 KB
  app.use('/api/treasury/flows', compress());
  app.get('/api/treasury/flows', async c => {
    try {
      if (cache) {
        const ttl = cache.data.indexing.complete ? FRESH_MS : BACKFILL_MS;
        if (Date.now() - cache.at > ttl) void refresh().catch(() => {}); // stale-while-revalidate
        c.header('Cache-Control', 'public, max-age=60');
        return c.json(withHoldings(cache.data, await currentHoldings()));
      }
      const [data, holdings] = await Promise.all([refresh(), currentHoldings()]);
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(withHoldings(data, holdings));
    } catch (err) {
      console.error('Treasury flows error:', err);
      return c.json({ error: 'Failed to compute treasury flows' }, 500);
    }
  });
}

import type { Hono } from 'hono';

import { LIL_NOUNS_SUBGRAPH } from '../activityFeed.js';
import { nounCheckClient } from '../lib/chain.js';
import { fetchLilNounsFromSubgraph } from '../lib/lilNouns.js';

// ============================================================
// Lil Nouns proposals proxy — fetches from Goldsky subgraph on the server,
// caches briefly, serves in the same shape as /api/proposals so the
// prediction-market UI can drop it in without branching.
// ============================================================

// LIL_NOUNS_SUBGRAPH is shared with the activity feed — see ./activityFeed.ts

// Keep the cache tight — proposals change rarely but we want new votes to land quickly.
const LIL_NOUNS_CACHE_TTL_MS = 60_000;
let lilNounsCache: { at: number; items: unknown[] } | null = null;

const LIL_NOUNS_GOVERNOR = '0x5d2C31ce16924C2a71D317e5BbFd5ce387854039' as const;
const LIL_NOUNS_GOVERNOR_STATE_ABI = [
  {
    type: 'function',
    name: 'state',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// Governor state enum → uppercase status matching the subgraph's values.
// Bravo-style states; Nouns / Lil Nouns extend with OBJECTION_PERIOD + UPDATABLE.
const GOVERNOR_STATE_CODES = [
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

// Statuses that change by block height alone, with no event the subgraph sees.
const BLOCK_DRIVEN_STATUSES = new Set(['PENDING', 'ACTIVE', 'OBJECTION_PERIOD', 'UPDATABLE']);

/**
 * Overwrite stale statuses from the subgraph with on-chain governor state.
 * The Goldsky subgraph only updates status on explicit events (Queued/Executed/
 * Cancelled/Vetoed); proposals stay stuck at PENDING after voting opens and at
 * ACTIVE after it closes, which hides the vote form and misrepresents
 * DEFEATED + EXPIRED in the UI.
 */
async function overlayOnchainStatus(
  items: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const staleIds = items
    .filter(p => typeof p.status === 'string' && BLOCK_DRIVEN_STATUSES.has(p.status.toUpperCase()))
    .map(p => p.id as string);
  if (staleIds.length === 0) return items;

  try {
    const results = await nounCheckClient.multicall({
      contracts: staleIds.map(id => ({
        address: LIL_NOUNS_GOVERNOR,
        abi: LIL_NOUNS_GOVERNOR_STATE_ABI,
        functionName: 'state' as const,
        args: [BigInt(id)],
      })),
      allowFailure: true,
    });
    const idToStatus = new Map<string, string>();
    for (let i = 0; i < staleIds.length; i++) {
      const r = results[i];
      if (r?.status === 'success' && typeof r.result === 'number') {
        idToStatus.set(staleIds[i], GOVERNOR_STATE_CODES[r.result] ?? 'PENDING');
      }
    }
    return items.map(p => {
      const mapped = idToStatus.get(p.id as string);
      return mapped !== undefined ? { ...p, status: mapped } : p;
    });
  } catch (err) {
    console.warn('[lil-proposals] onchain state overlay failed, falling back:', err);
    return items;
  }
}

// Detail endpoint — single proposal with its full vote list, for LilNounsVotePage.
// Cache per-id for LIL_NOUNS_CACHE_TTL_MS.
const lilNounsDetailCache = new Map<string, { at: number; item: unknown }>();

export function registerLilNounsRoutes(app: Hono) {
  app.get('/api/lil-proposals', async c => {
    const now = Date.now();
    if (lilNounsCache !== null && now - lilNounsCache.at < LIL_NOUNS_CACHE_TTL_MS) {
      return c.json(lilNounsCache.items);
    }
    try {
      const raw = await fetchLilNounsFromSubgraph();
      const items = await overlayOnchainStatus(raw);
      lilNounsCache = { at: now, items };
      return c.json(items);
    } catch (err) {
      // If Goldsky is down, serve stale cache if we have any.
      if (lilNounsCache !== null) {
        return c.json(lilNounsCache.items, 200, { 'x-cache': 'stale' });
      }
      return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
    }
  });

  app.get('/api/lil-proposals/:id', async c => {
    const id = c.req.param('id');
    if (!/^\d+$/.test(id)) return c.json({ error: 'invalid id' }, 400);

    const now = Date.now();
    const cached = lilNounsDetailCache.get(id);
    if (cached != null && now - cached.at < LIL_NOUNS_CACHE_TTL_MS) {
      return c.json(cached.item);
    }

    const query = `{
    proposal(id: "${id}") {
      id
      title
      description
      status
      forVotes
      againstVotes
      abstainVotes
      quorumVotes
      proposalThreshold
      startBlock
      endBlock
      createdBlock
      createdTimestamp
      executionETA
      executedTimestamp
      canceledTimestamp
      vetoedTimestamp
      queuedTimestamp
      targets
      values
      signatures
      calldatas
      totalSupply
      proposer { id }
      votes(first: 1000, orderBy: blockNumber, orderDirection: desc) {
        id
        support: supportDetailed
        votes
        reason
        blockNumber
        voter { id }
      }
    }
  }`;

    try {
      const res = await fetch(LIL_NOUNS_SUBGRAPH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Goldsky ${res.status}`);
      const json = (await res.json()) as { data?: { proposal?: Record<string, unknown> | null } };
      const proposal = json.data?.proposal;
      if (proposal == null) return c.json({ error: 'not found' }, 404);

      // Overwrite stale block-driven status with the on-chain governor state.
      const [enriched] = await overlayOnchainStatus([proposal]);
      const finalProposal = enriched ?? proposal;

      lilNounsDetailCache.set(id, { at: now, item: finalProposal });
      return c.json(finalProposal);
    } catch (err) {
      if (cached != null) {
        return c.json(cached.item, 200, { 'x-cache': 'stale' });
      }
      return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
    }
  });
}

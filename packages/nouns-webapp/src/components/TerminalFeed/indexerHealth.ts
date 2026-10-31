import { getPublicClient } from '@wagmi/core';

import { config as wagmiConfig, defaultChain } from '@/wagmi';

// The Ponder indexer can stop syncing while its HTTP server keeps answering
// (2026-10-20 05:31Z: sync froze for 2+ days, /api/activity kept serving the
// same frozen events, and V2 prop 4 — a full-treasury drain — went through
// voting and into the timelock without ever appearing in the feed). The
// chain fallbacks only ran when the API returned NOTHING, so stale-but-
// non-empty data looked healthy. Compare Ponder's own `/status` head against
// the chain head instead.
//
// The chain head is always the Nouns chain's (`defaultChain`), never the
// wallet's current one: wagmi's config also carries Polygon, and with a
// wallet on Polygon the feed read Polygon's head (~96M) against mainnet's
// ~26M and cried "70,203,480 blocks behind" (2026-10-31).

/** ~30 min of blocks. Ponder normally trails head by 0-2 blocks. */
export const STALE_LAG_BLOCKS = 150;

const CACHE_MS = 60_000;

export interface IndexerHealth {
  indexedBlock: number;
  headBlock: number;
  lag: number;
}

let cache: { at: number; value: IndexerHealth | null } | null = null;
let inflight: Promise<IndexerHealth | null> | null = null;

async function load(apiBase: string): Promise<IndexerHealth | null> {
  const client = getPublicClient(wagmiConfig, { chainId: defaultChain.id });
  if (client == null) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6_000);
  try {
    const [statusRes, head] = await Promise.all([
      fetch(`${apiBase}/status`, { signal: ac.signal }),
      client.getBlockNumber(),
    ]);
    if (!statusRes.ok) return null;
    const status = (await statusRes.json()) as { mainnet?: { block?: { number?: number } } };
    const indexedBlock = Number(status?.mainnet?.block?.number);
    if (!Number.isFinite(indexedBlock) || indexedBlock <= 0) return null;
    const headBlock = Number(head);
    return { indexedBlock, headBlock, lag: Math.max(0, headBlock - indexedBlock) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Indexer head vs chain head, cached for a minute. Returns null when either
 * side can't be read — callers treat unknown as healthy (the existing
 * empty-API fallback still covers a fully dead API).
 */
export async function fetchIndexerHealth(apiBase: string): Promise<IndexerHealth | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;
  inflight = load(apiBase).then(value => {
    cache = { at: Date.now(), value };
    inflight = null;
    return value;
  });
  return inflight;
}

export function isStale(health: IndexerHealth | null): health is IndexerHealth {
  return health != null && health.lag > STALE_LAG_BLOCKS;
}

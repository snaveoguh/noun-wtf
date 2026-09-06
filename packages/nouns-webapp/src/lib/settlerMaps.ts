/**
 * Settler / curator maps for the probe dropdowns + filters.
 *
 * Source of truth is the indexer's GET /api/settlers?dao=v1|v2 — the same maps
 * the /gamer wallet profile counts from, so "settled N" and "curated N" agree
 * everywhere. The static probe-dreams/*.json snapshots are kept only as an
 * offline fallback (they drift ~1 noun/day and are no longer refreshed by hand).
 *
 *   settler(N) = tx.from of AuctionSettled(N)  (V1 nounder nouns inherit N-1)
 *   curated(N) = settler(N-1)
 */

const API_BASE: string =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

export type SettlerDao = 'v1' | 'v2';

export interface SettlerMaps {
  /** nounId -> lowercase settler address */
  settlers: Record<string, string>;
  /** nounId -> lowercase curator address */
  curated: Record<string, string>;
  /** where the data came from — surfaced so stale fallbacks are visible in devtools */
  source: 'api' | 'snapshot';
}

const FALLBACK: Record<SettlerDao, { settlers: string; curated: string }> = {
  v1: { settlers: '/probe-dreams/settlers.json', curated: '/probe-dreams/curated.json' },
  v2: { settlers: '/probe-dreams/settlers-v2.json', curated: '/probe-dreams/curated-v2.json' },
};

const cache = new Map<SettlerDao, Promise<SettlerMaps>>();

function lowerValues(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) if (v) out[k] = v.toLowerCase();
  return out;
}

async function fetchFromApi(dao: SettlerDao): Promise<SettlerMaps> {
  const res = await fetch(`${API_BASE}/api/settlers?dao=${dao}`);
  if (!res.ok) throw new Error(`settlers ${dao}: ${res.status}`);
  const json = (await res.json()) as {
    settlers?: Record<string, string>;
    curated?: Record<string, string>;
  };
  if (!json.settlers || !json.curated || Object.keys(json.settlers).length === 0) {
    // The indexer serves empty tables for ~10-15 min after every deploy; treat
    // that as a miss so the snapshot fills in rather than showing nothing.
    throw new Error(`settlers ${dao}: empty`);
  }
  return {
    settlers: lowerValues(json.settlers),
    curated: lowerValues(json.curated),
    source: 'api',
  };
}

async function fetchFromSnapshot(dao: SettlerDao): Promise<SettlerMaps> {
  const [s, c] = await Promise.all([
    fetch(FALLBACK[dao].settlers).then(r => r.json() as Promise<Record<string, string>>),
    fetch(FALLBACK[dao].curated).then(r => r.json() as Promise<Record<string, string>>),
  ]);
  return { settlers: lowerValues(s), curated: lowerValues(c), source: 'snapshot' };
}

/** Load (and memoise per page-load) the settler + curated maps for a DAO. */
export function loadSettlerMaps(dao: SettlerDao): Promise<SettlerMaps> {
  let p = cache.get(dao);
  if (!p) {
    p = fetchFromApi(dao).catch(async err => {
      console.warn(`[settlerMaps] API unavailable for ${dao}, using static snapshot:`, err);
      const snap = await fetchFromSnapshot(dao);
      // Don't pin a stale snapshot for the whole session — let the next caller retry the API.
      cache.delete(dao);
      return snap;
    });
    cache.set(dao, p);
    p.catch(() => cache.delete(dao));
  }
  return p;
}

/** Noun ids in `map` attributed to `address` (case-insensitive). */
export function nounIdsFor(map: Record<string, string>, address: string): Set<bigint> {
  const a = address.toLowerCase();
  const ids = new Set<bigint>();
  for (const [id, addr] of Object.entries(map)) if (addr === a) ids.add(BigInt(id));
  return ids;
}

/** [address, count] pairs sorted by count desc — the dropdown shape. */
export function countByAddress(map: Record<string, string>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const addr of Object.values(map)) counts.set(addr, (counts.get(addr) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

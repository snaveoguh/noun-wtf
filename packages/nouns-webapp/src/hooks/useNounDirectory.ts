/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useEffect, useState } from 'react';

import { countByAddress, loadSettlerMaps } from '@/lib/settlerMaps';

const API_BASE =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

/** Direct GraphQL fetch to Ponder */
async function ponderQuery<T>(query: string): Promise<T> {
  // Hardcode URL to avoid env var issues
  const url = 'https://spirited-flexibility-production-3c30.up.railway.app';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Ponder query failed: ${res.status}`);
  const json = await res.json();
  console.log(
    '[NounDir] url:',
    url,
    'keys:',
    Object.keys(json?.data ?? {}),
    'raw:',
    JSON.stringify(json).slice(0, 100),
  );
  return json.data as T;
}

interface DirectoryEntry {
  address: string;
  ens: string | null;
  count: number;
}

// No module-level cache — React state handles it
let cachedOwners: DirectoryEntry[] | undefined;
let cachedSettlers: DirectoryEntry[] | undefined;
let cachedCurators: DirectoryEntry[] | undefined;

function ownersQuery(offset: number) {
  return `{ nouns(limit: 1000, offset: ${offset}, orderBy: "id", orderDirection: "desc") { items { id owner } } }`;
}

function aggregateAddresses(records: { address: string }[]): DirectoryEntry[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (!r.address) continue;
    const addr = r.address.toLowerCase();
    counts.set(addr, (counts.get(addr) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([address, count]) => ({ address, ens: null, count }))
    .sort((a, b) => b.count - a.count);
}

/** Batch resolve ENS names via Ponder API, 50 at a time */
async function resolveEnsNames(entries: DirectoryEntry[]): Promise<DirectoryEntry[]> {
  const batchSize = 50;
  const result = [...entries];

  for (let i = 0; i < result.length; i += batchSize) {
    const batch = result.slice(i, i + batchSize);
    const addrs = batch.map(e => e.address).join(',');
    try {
      const res = await fetch(`${API_BASE}/api/ens?addresses=${addrs}`);
      if (!res.ok) continue;
      const { names } = (await res.json()) as { names: Record<string, string | null> };
      for (let j = 0; j < batch.length; j++) {
        const name = names[batch[j].address] ?? names[batch[j].address.toLowerCase()];
        if (name) result[i + j] = { ...result[i + j], ens: name };
      }
    } catch {
      // silent — addresses stay unresolved
    }
  }

  return result;
}

export function useNounOwners() {
  const [owners, setOwners] = useState<DirectoryEntry[]>(cachedOwners || []);
  const [loading, setLoading] = useState(!cachedOwners);

  useEffect(() => {
    if (cachedOwners?.length) return;

    (async () => {
      try {
        // Paginate — Ponder max limit is 1000
        const allItems: { id: string; owner: string }[] = [];
        for (let offset = 0; ; offset += 1000) {
          const result = await ponderQuery<{ nouns: { items: { id: string; owner: string }[] } }>(
            ownersQuery(offset),
          );
          const items = result?.nouns?.items ?? [];
          allItems.push(...items);
          if (items.length < 1000) break;
        }
        if (allItems.length === 0) throw new Error('No nouns data');
        let entries = aggregateAddresses(allItems.map(n => ({ address: n.owner })));
        setOwners(entries);
        setLoading(false);

        // Resolve ENS in background
        entries = await resolveEnsNames(entries);
        cachedOwners = entries;
        setOwners(entries);
      } catch (err) {
        console.error('Failed to fetch noun owners:', err);
        setLoading(false);
      }
    })();
  }, []);

  return { owners, loading };
}

export function useNounSettlers() {
  const [settlers, setSettlers] = useState<DirectoryEntry[]>(cachedSettlers || []);
  const [loading, setLoading] = useState(!cachedSettlers);

  useEffect(() => {
    if (cachedSettlers?.length) return;

    (async () => {
      try {
        // Indexer-backed settler map (same source as the /gamer profile);
        // falls back to the static snapshot if the API is down.
        const { settlers: map } = await loadSettlerMaps('v1');
        let entries: DirectoryEntry[] = countByAddress(map).map(([address, count]) => ({
          address,
          ens: null,
          count,
        }));

        setSettlers(entries);
        setLoading(false);

        // Resolve ENS in background
        entries = await resolveEnsNames(entries);
        cachedSettlers = entries;
        setSettlers(entries);
      } catch (err) {
        console.error('Failed to fetch auction winners:', err);
        setLoading(false);
      }
    })();
  }, []);

  return { settlers, loading };
}

export function useNounCurators() {
  const [curators, setCurators] = useState<DirectoryEntry[]>(cachedCurators || []);
  const [loading, setLoading] = useState(!cachedCurators);

  useEffect(() => {
    if (cachedCurators?.length) return;

    (async () => {
      try {
        const { curated: map } = await loadSettlerMaps('v1');
        let entries: DirectoryEntry[] = countByAddress(map).map(([address, count]) => ({
          address,
          ens: null,
          count,
        }));

        setCurators(entries);
        setLoading(false);

        entries = await resolveEnsNames(entries);
        cachedCurators = entries;
        setCurators(entries);
      } catch (err) {
        console.error('Failed to fetch curators:', err);
        setLoading(false);
      }
    })();
  }, []);

  return { curators, loading };
}

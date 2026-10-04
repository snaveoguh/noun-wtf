import type { Address } from '@/utils/types';

import { useMemo } from 'react';

import { useQuery as useReactQuery } from '@tanstack/react-query';
import { type Log, decodeAbiParameters, parseAbiParameters } from 'viem';
import { usePublicClient } from 'wagmi';

// ─── Contract Config ──────────────────────────────────────────────────────────

const PROPDATES_ADDRESS = '0xa5Bf9A9b8f60CFD98b1cCB592f2F9F37Bb0033a4' as Address;
const DEPLOY_BLOCK = 19_399_894n;
const BLOCK_CHUNK = 50_000n;
const MAX_PARALLEL = 8;

// PostUpdate(uint256 indexed propId, bool indexed isCompleted, string update).
// Logs are matched by address + shape (3 topics, string payload), not topic0:
// the hash previously hard-coded here didn't match the event, so the filter
// returned nothing and propdates never rendered.

// The API keeps the full propdates history cached server-side; the chain scan
// below is only a fallback for when it's unreachable.
const API_BASE: string =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';
const API_TIMEOUT_MS = 8_000;

// Timestamp estimation
const ANCHOR_BLOCK = 19_399_894n;
const ANCHOR_TIMESTAMP = 1709942400; // ~Mar 9 2024
const AVG_BLOCK_TIME = 12;

function estimateTimestamp(blockNumber: bigint): number {
  return ANCHOR_TIMESTAMP + Number(blockNumber - ANCHOR_BLOCK) * AVG_BLOCK_TIME;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropdateEntry {
  propId: number;
  isCompleted: boolean;
  update: string;
  blockNumber: bigint;
  timestamp: number;
  imageUrl: string | null;
  title: string;
}

// ─── Markdown image extraction ────────────────────────────────────────────────

const MD_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/;
const HTML_IMG_RE = /<img[^>]+src=["']([^"']+)["']/i;

export function extractImageUrl(text: string): string | null {
  const mdMatch = text.match(MD_IMAGE_RE);
  if (mdMatch) return mdMatch[1];
  const htmlMatch = text.match(HTML_IMG_RE);
  if (htmlMatch) return htmlMatch[1];
  return null;
}

export function extractTitle(text: string): string {
  const firstLine = text.split('\n').find(l => l.trim().length > 0) ?? '';
  const cleaned = firstLine
    .replace(/^#+\s*/, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .trim();
  if (cleaned.length > 80) return cleaned.slice(0, 77) + '...';
  return cleaned || 'Update';
}

// ─── Parallel chunked log fetcher ─────────────────────────────────────────────

async function fetchAllLogs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  const chunks: Array<{ from: bigint; to: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n;
    chunks.push({ from: start, to: end });
  }
  if (chunks.length === 0) return [];

  const allLogs: Log[] = [];
  for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
    const batch = chunks.slice(i, i + MAX_PARALLEL);
    const results = await Promise.allSettled(
      batch.map(chunk =>
        client.getLogs({
          address,
          fromBlock: chunk.from,
          toBlock: chunk.to,
        }),
      ),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allLogs.push(...(result.value as Log[]));
      }
    }
  }
  return allLogs;
}

// ─── Decode PostUpdate logs ───────────────────────────────────────────────────

function decodePostUpdateLogs(logs: Log[]): PropdateEntry[] {
  const entries: PropdateEntry[] = [];

  for (const log of logs) {
    try {
      const topics = log.topics;
      if (topics == null || topics.length !== 3) continue;

      const propId = Number(BigInt(topics[1]!));
      const flag = BigInt(topics[2]!);
      if (flag > 1n) continue;
      const isCompleted = flag === 1n;

      const data = log.data;
      if (data == null || data === '0x') continue;

      const [update] = decodeAbiParameters(parseAbiParameters('string'), data as `0x${string}`);

      const blockNumber = log.blockNumber ?? 0n;
      const imageUrl = extractImageUrl(update);
      const title = extractTitle(update);

      entries.push({
        propId,
        isCompleted,
        update,
        blockNumber,
        timestamp: estimateTimestamp(blockNumber),
        imageUrl,
        title,
      });
    } catch {
      // Skip undecodable logs
    }
  }

  return entries;
}

// ─── API fetch ────────────────────────────────────────────────────────────────

interface ApiPropdate {
  proposalId: number;
  isCompleted: boolean;
  update: string;
  blockNumber: number;
  timestamp: number;
}

async function fetchFromApi(): Promise<PropdateEntry[] | null> {
  const res = await fetch(`${API_BASE}/api/propdates?limit=1000`, {
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { propdates?: ApiPropdate[] };
  if (!Array.isArray(body.propdates)) return null;
  return body.propdates.map(p => ({
    propId: p.proposalId,
    isCompleted: p.isCompleted,
    update: p.update,
    blockNumber: BigInt(p.blockNumber),
    timestamp: p.timestamp,
    imageUrl: extractImageUrl(p.update),
    title: extractTitle(p.update),
  }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UsePropdatesOptions {
  /** Filter to a specific proposal. Omit for all proposals. */
  propId?: number;
  /** When true, deduplicate to latest update per proposal (for banner). Default: true */
  dedupeByProp?: boolean;
  /** Max entries to return. Default: 40 */
  limit?: number;
}

export function usePropdates(options: UsePropdatesOptions = {}) {
  const { propId, dedupeByProp = true, limit = 40 } = options;
  const publicClient = usePublicClient();

  // Single shared query for all propdates — filter client-side. The key is
  // deliberately stable: keying on the block number restarted the full-history
  // scan every block, so it never finished and the UI sat on "Loading".
  const query = useReactQuery({
    queryKey: ['propdates'],
    queryFn: async (): Promise<PropdateEntry[]> => {
      const fromApi = await fetchFromApi().catch(() => null);
      if (fromApi) return fromApi;

      if (publicClient == null) return [];
      const head = await publicClient.getBlockNumber();
      const rawLogs = await fetchAllLogs(publicClient, PROPDATES_ADDRESS, DEPLOY_BLOCK, head);
      const entries = decodePostUpdateLogs(rawLogs);
      entries.sort((a, b) => Number(b.blockNumber - a.blockNumber));
      return entries;
    },
    enabled: publicClient != null,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  // Client-side filtering by propId + dedup + limit
  const filtered = useMemo(() => {
    if (query.data == null) return [];

    let entries = query.data;

    // Filter to specific proposal
    if (propId !== undefined) {
      entries = entries.filter(e => e.propId === propId);
    }

    // Deduplicate to latest update per proposal (for banner)
    if (dedupeByProp) {
      const seen = new Set<number>();
      const unique: PropdateEntry[] = [];
      for (const e of entries) {
        if (!seen.has(e.propId)) {
          seen.add(e.propId);
          unique.push(e);
        }
      }
      entries = unique;
    }

    return entries.slice(0, limit);
  }, [query.data, propId, dedupeByProp, limit]);

  return { ...query, data: filtered };
}

// ─── Agent NounIRL — Live Trait Count Cache (V1 + V2) ──────────────────────
//
// PROBLEM: Trait predictions are derived from `pseudorandomness % count`. If our
// hardcoded counts drift below the on-chain descriptor's actual counts (e.g.
// governance adds new heads), predicted indices diverge from reality and the
// bot fails to match reservations.
//
// FIX: At bot startup (and every TRAIT_COUNT_REFRESH_MS), resolve each DAO's
// live descriptor via `<Token>.descriptor()` and call its count getters. Cache
// the result per-DAO and use it in `predictSeed()`. Log loudly + emit a bridge
// event when a count changes vs the previous cached snapshot.
//
// SCOPE: both Nouns DAO V1 and V2 — the watcher runs both DAOs off one block
// feed, so both caches are load-bearing (each DAO's predictSeed pulls its own
// counts). The fallback to the hardcoded counts (`TRAIT_COUNTS` /
// `TRAIT_COUNTS_V2`) keeps prediction working if a live descriptor call fails
// at startup (with a loud warning).

import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';

import { bridgePublish } from './bridge.js';
import {
  AGENT_RPC_URL,
  selectAddresses,
  TRAIT_COUNTS,
  TRAIT_COUNTS_V2,
  type WatchedDao,
} from './constants.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TraitCounts {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

export interface TraitCountsSnapshot {
  dao: WatchedDao;
  counts: TraitCounts;
  source: 'live' | 'fallback';
  descriptor: `0x${string}` | null;
  fetchedAt: number; // unix seconds
}

// ─── ABIs ──────────────────────────────────────────────────────────────────

const NOUNS_TOKEN_DESCRIPTOR_ABI = [
  {
    type: 'function',
    name: 'descriptor',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

const DESCRIPTOR_COUNT_ABI = [
  {
    type: 'function',
    name: 'backgroundCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'bodyCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'accessoryCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'headCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'glassesCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ─── Cache State ───────────────────────────────────────────────────────────

const FALLBACK_COUNTS: Record<WatchedDao, TraitCounts> = {
  v1: { ...TRAIT_COUNTS },
  v2: { ...TRAIT_COUNTS_V2 },
};

function fallbackSnapshot(dao: WatchedDao): TraitCountsSnapshot {
  return {
    dao,
    counts: { ...FALLBACK_COUNTS[dao] },
    source: 'fallback',
    descriptor: null,
    fetchedAt: 0,
  };
}

const cache: Record<WatchedDao, TraitCountsSnapshot> = {
  v1: fallbackSnapshot('v1'),
  v2: fallbackSnapshot('v2'),
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;

// Refresh roughly once an hour — descriptor upgrades and trait adds are rare
// governance actions, so this is plenty fresh without spamming the RPC.
const TRAIT_COUNT_REFRESH_MS = 60 * 60 * 1000;

// ─── Recent trait-count changes (surfaced on /api/agent/status → terminal feed)
// When governance adds/removes art the descriptor count moves. We keep the last
// few such changes in memory so the noun.wtf terminal feed can show "🎨 accessory
// 144 → 145" the moment it happens — this is exactly the drift that caused the
// 2026-05-30 banana/phantom-settle saga. Ring is small + lost on redeploy; that's
// fine, it's a "what just changed" alert, not a permanent ledger.
export interface TraitChangeRecord {
  dao: WatchedDao;
  descriptor: `0x${string}`;
  previous: TraitCounts;
  current: TraitCounts;
  changed: (keyof TraitCounts)[];
  fetchedAt: number; // unix seconds
}

const MAX_TRAIT_CHANGES = 20;
const recentTraitChanges: TraitChangeRecord[] = [];

export function getRecentTraitChanges(): TraitChangeRecord[] {
  // newest first
  return [...recentTraitChanges].reverse();
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Synchronous accessor for the cached trait counts. Always returns a snapshot —
 * before the first successful refresh this is the hardcoded fallback so that
 * `predictSeed()` never crashes.
 */
export function getTraitCounts(dao: WatchedDao = 'v1'): TraitCounts {
  return cache[dao].counts;
}

/**
 * Full snapshot including provenance for the `/api/agent/status` endpoint.
 */
export function getTraitCountsSnapshot(dao: WatchedDao = 'v1'): TraitCountsSnapshot {
  return cache[dao];
}

/**
 * Refresh one DAO's counts against its live descriptor. Resolves the descriptor
 * address at runtime via `<Token>.descriptor()` so descriptor upgrades are
 * picked up automatically. Mutates `cache[dao]` in place on success; keeps the
 * existing (live or fallback) snapshot on failure.
 */
async function refreshOne(client: PublicClient, dao: WatchedDao): Promise<void> {
  const { token } = selectAddresses(dao);

  let descriptor: `0x${string}`;
  try {
    descriptor = (await client.readContract({
      address: token,
      abi: NOUNS_TOKEN_DESCRIPTOR_ABI,
      functionName: 'descriptor',
    })) as `0x${string}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[NounIRL:traitCounts] ⚠️  ${dao.toUpperCase()}: failed to resolve descriptor() — keeping ${cache[dao].source} counts. Reason: ${msg}`,
    );
    return;
  }

  try {
    const [background, body, accessory, head, glasses] = await Promise.all([
      client.readContract({
        address: descriptor,
        abi: DESCRIPTOR_COUNT_ABI,
        functionName: 'backgroundCount',
      }),
      client.readContract({
        address: descriptor,
        abi: DESCRIPTOR_COUNT_ABI,
        functionName: 'bodyCount',
      }),
      client.readContract({
        address: descriptor,
        abi: DESCRIPTOR_COUNT_ABI,
        functionName: 'accessoryCount',
      }),
      client.readContract({
        address: descriptor,
        abi: DESCRIPTOR_COUNT_ABI,
        functionName: 'headCount',
      }),
      client.readContract({
        address: descriptor,
        abi: DESCRIPTOR_COUNT_ABI,
        functionName: 'glassesCount',
      }),
    ]);

    const next: TraitCounts = {
      background: Number(background),
      body: Number(body),
      accessory: Number(accessory),
      head: Number(head),
      glasses: Number(glasses),
    };

    const prev = cache[dao].counts;
    const prevSource = cache[dao].source;

    cache[dao] = {
      dao,
      counts: next,
      source: 'live',
      descriptor,
      fetchedAt: Math.floor(Date.now() / 1000),
    };

    if (prevSource !== 'live') {
      console.log(
        `[NounIRL:traitCounts] ✅ ${dao.toUpperCase()}: live counts from descriptor ${descriptor}: ${JSON.stringify(next)}`,
      );
    }

    const changed = (Object.keys(next) as (keyof TraitCounts)[]).filter(k => prev[k] !== next[k]);

    if (prevSource === 'live' && changed.length > 0) {
      console.warn(
        `[NounIRL:traitCounts] 🚨 ${dao.toUpperCase()} TRAIT COUNT CHANGED on descriptor ${descriptor} — ${changed
          .map(k => `${k}: ${prev[k]} → ${next[k]}`)
          .join(', ')}. Predictions will use the new counts immediately.`,
      );

      const change: TraitChangeRecord = {
        dao,
        descriptor,
        previous: prev,
        current: next,
        changed,
        fetchedAt: cache[dao].fetchedAt,
      };
      recentTraitChanges.push(change);
      if (recentTraitChanges.length > MAX_TRAIT_CHANGES) recentTraitChanges.shift();

      bridgePublish('noun-trait-count-changed', change);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[NounIRL:traitCounts] ⚠️  ${dao.toUpperCase()}: failed to read count getters on descriptor ${descriptor} — keeping ${cache[dao].source} counts. Reason: ${msg}`,
    );
  }
}

/**
 * Run one refresh against both DAOs' live descriptors. Safe to call repeatedly.
 * Returns the V1 snapshot (callers wanting a specific DAO should use
 * `getTraitCountsSnapshot(dao)` after this resolves).
 */
export async function refreshTraitCounts(): Promise<TraitCountsSnapshot> {
  const client: PublicClient = createPublicClient({
    chain: mainnet,
    transport: http(AGENT_RPC_URL),
  });

  await Promise.all([refreshOne(client, 'v1'), refreshOne(client, 'v2')]);

  return cache.v1;
}

/**
 * Kick off the periodic refresh loop. Runs one immediate refresh, then
 * every TRAIT_COUNT_REFRESH_MS. Idempotent — safe to call from multiple
 * init paths.
 */
export function startTraitCountRefresher(): void {
  if (refreshTimer) return;

  void refreshTraitCounts().catch(err => {
    console.warn(
      `[NounIRL:traitCounts] Initial refresh threw:`,
      err instanceof Error ? err.message : err,
    );
  });

  refreshTimer = setInterval(() => {
    void refreshTraitCounts().catch(err => {
      console.warn(
        `[NounIRL:traitCounts] Scheduled refresh threw:`,
        err instanceof Error ? err.message : err,
      );
    });
  }, TRAIT_COUNT_REFRESH_MS);
}

export function stopTraitCountRefresher(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

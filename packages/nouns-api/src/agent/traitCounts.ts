// ─── Agent NounIRL — Live Trait Count Cache (V1 only) ──────────────────────
//
// PROBLEM: Trait predictions are derived from `pseudorandomness % count`. If our
// hardcoded `TRAIT_COUNTS` drift below the on-chain descriptor's actual counts
// (e.g. governance adds new heads), predicted indices diverge from reality and
// the bot fails to match reservations.
//
// FIX: At bot startup (and every TRAIT_COUNT_REFRESH_MS), resolve the live V1
// descriptor via `NounsToken.descriptor()` and call its count getters. Cache
// the result and use it in `predictSeed()`. Log loudly + emit a bridge event
// when a count changes vs the previous cached snapshot.
//
// SCOPE: V1 only. V2 prediction has separate, more serious bugs documented in
// the nounirl_settlement_bot memory — fixing V2 is intentionally out of scope.
// The fallback to the hardcoded `TRAIT_COUNTS` keeps the old V1 behaviour if
// the live descriptor call fails at startup (with a loud warning).

import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';

import { bridgePublish } from './bridge.js';
import {
  AGENT_RPC_URL,
  NOUNS_TOKEN_ADDRESS,
  TRAIT_COUNTS,
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

const FALLBACK_SNAPSHOT: TraitCountsSnapshot = {
  counts: { ...TRAIT_COUNTS },
  source: 'fallback',
  descriptor: null,
  fetchedAt: 0,
};

let cache: TraitCountsSnapshot = FALLBACK_SNAPSHOT;
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
export function getTraitCounts(): TraitCounts {
  return cache.counts;
}

/**
 * Full snapshot including provenance for the `/api/agent/status` endpoint.
 */
export function getTraitCountsSnapshot(): TraitCountsSnapshot {
  return cache;
}

/**
 * Run one refresh against the live V1 descriptor. Safe to call repeatedly.
 * Resolves the descriptor address at runtime via NounsToken.descriptor() so
 * descriptor upgrades are picked up automatically.
 */
export async function refreshTraitCounts(): Promise<TraitCountsSnapshot> {
  const client: PublicClient = createPublicClient({
    chain: mainnet,
    transport: http(AGENT_RPC_URL),
  });

  let descriptor: `0x${string}`;
  try {
    descriptor = (await client.readContract({
      address: NOUNS_TOKEN_ADDRESS,
      abi: NOUNS_TOKEN_DESCRIPTOR_ABI,
      functionName: 'descriptor',
    })) as `0x${string}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[NounIRL:traitCounts] ⚠️  Failed to resolve V1 descriptor() — keeping ${cache.source} counts. Reason: ${msg}`,
    );
    return cache;
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

    const prev = cache.counts;
    const prevSource = cache.source;

    cache = {
      counts: next,
      source: 'live',
      descriptor,
      fetchedAt: Math.floor(Date.now() / 1000),
    };

    if (prevSource !== 'live') {
      console.log(
        `[NounIRL:traitCounts] ✅ Live counts loaded from descriptor ${descriptor}: ${JSON.stringify(next)}`,
      );
    }

    const changed = (Object.keys(next) as (keyof TraitCounts)[]).filter(
      k => prev[k] !== next[k],
    );

    if (prevSource === 'live' && changed.length > 0) {
      console.warn(
        `[NounIRL:traitCounts] 🚨 TRAIT COUNT CHANGED on descriptor ${descriptor} — ${changed
          .map(k => `${k}: ${prev[k]} → ${next[k]}`)
          .join(', ')}. Predictions will use the new counts immediately.`,
      );

      const change: TraitChangeRecord = {
        descriptor,
        previous: prev,
        current: next,
        changed,
        fetchedAt: cache.fetchedAt,
      };
      recentTraitChanges.push(change);
      if (recentTraitChanges.length > MAX_TRAIT_CHANGES) recentTraitChanges.shift();

      bridgePublish('noun-trait-count-changed', change);
    }

    return cache;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[NounIRL:traitCounts] ⚠️  Failed to read count getters on descriptor ${descriptor} — keeping ${cache.source} counts. Reason: ${msg}`,
    );
    return cache;
  }
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

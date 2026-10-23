// ── Sync watchdog: restart the process when Ponder's sync freezes ────────
//
// 2026-10-20 05:31Z Ponder's realtime sync hung at block 26231722 and stayed
// there for 3+ days: zero RPC requests, zero DB writes, while the HTTP
// server (and the nounirl settler in the same process) kept answering, so
// nothing noticed. Railway only calls the healthcheck while a deploy starts
// (it never re-checks a live service), so a failing /health can't restart
// it. Instead this watches Ponder's own /status from inside the process and
// exits non-zero once the indexed block stops moving while the chain keeps
// going; railway.json's restartPolicyType ON_FAILURE brings it back.
//
// Backfill is covered too: a backfilling indexer's block still advances.
// Env: SYNC_WATCHDOG=0 turns it off; SYNC_WATCHDOG_STALL_MIN (default 15).

import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';

const CHECK_MS = 60_000;
/** Grace after boot before the first verdict (migrations, cache warmup). */
const BOOT_GRACE_MS = 10 * 60_000;
/** The chain must have moved at least this far past the frozen block. */
const MIN_CHAIN_ADVANCE = 50;

export interface WatchSample {
  /** ms */
  at: number;
  /** Ponder's indexed block (null: /status unreadable). */
  indexed: number | null;
  /** Chain head (null: RPC unreadable). */
  head: number | null;
}

/**
 * Stalled when the indexed block hasn't moved for `stallMs` while the chain
 * head moved on by at least MIN_CHAIN_ADVANCE. Unreadable samples never
 * count as evidence either way.
 */
export function isStalled(samples: readonly WatchSample[], now: number, stallMs: number): boolean {
  const ok = samples.filter(s => s.indexed !== null && s.head !== null);
  const last = ok[ok.length - 1];
  if (last === undefined) return false;
  const since = ok.filter(s => now - s.at >= stallMs);
  const ref = since[since.length - 1];
  if (ref === undefined) return false;
  return last.indexed! <= ref.indexed! && last.head! - last.indexed! >= MIN_CHAIN_ADVANCE;
}

let started = false;

export function startSyncWatchdog(): void {
  if (started || process.env.SYNC_WATCHDOG === '0') return;
  started = true;
  const stallMs = Math.max(5, Number(process.env.SYNC_WATCHDOG_STALL_MIN) || 15) * 60_000;
  const port = process.env.PORT ?? '42069';
  const statusUrl = `http://127.0.0.1:${port}/status`;
  // Not the indexer's primary RPC: the point is an independent opinion.
  const client = createPublicClient({
    chain: mainnet,
    transport: fallback([
      http('https://ethereum-rpc.publicnode.com', { timeout: 10_000 }),
      http('https://gateway.tenderly.co/public/mainnet', { timeout: 10_000 }),
      http('https://rpc.mevblocker.io', { timeout: 10_000 }),
    ]),
  });
  const bootAt = Date.now();
  const samples: WatchSample[] = [];

  const sample = async (): Promise<WatchSample> => {
    const at = Date.now();
    const [indexed, head] = await Promise.all([
      fetch(statusUrl, { signal: AbortSignal.timeout(10_000) })
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          const n = Number(
            (j as { mainnet?: { block?: { number?: number } } } | null)?.mainnet?.block?.number,
          );
          return Number.isFinite(n) && n > 0 ? n : null;
        })
        .catch(() => null),
      client
        .getBlockNumber()
        .then(Number)
        .catch(() => null),
    ]);
    return { at, indexed, head };
  };

  const tick = async () => {
    const s = await sample();
    samples.push(s);
    // keep a little more than one stall window
    while (samples.length > 0 && s.at - samples[0]!.at > stallMs + 5 * CHECK_MS) samples.shift();
    if (s.at - bootAt < BOOT_GRACE_MS) return;
    if (isStalled(samples, s.at, stallMs)) {
      console.error(
        `[sync-watchdog] Ponder sync stalled at block ${s.indexed} for ${Math.round(stallMs / 60_000)} min ` +
          `(chain head ${s.head}, ${s.head! - s.indexed!} behind) — exiting so Railway restarts the service`,
      );
      // let the log line flush
      setTimeout(() => process.exit(1), 1_000);
    }
  };

  setInterval(() => void tick(), CHECK_MS).unref();
  console.log(`[sync-watchdog] watching ${statusUrl} (stall after ${stallMs / 60_000} min)`);
}

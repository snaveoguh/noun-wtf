import { getCurrentBlock } from './chain.js';

// ============================================================
// GraphQL (Ponder) — with derived proposal status
// ============================================================

// Cache latest block for status computation (refreshed every 30s)
let cachedLatestBlock: bigint = 0n;
let cachedBlockAt = 0;

export async function getLatestBlockCached(): Promise<bigint> {
  if (Date.now() - cachedBlockAt < 30_000 && cachedLatestBlock > 0n) return cachedLatestBlock;
  try {
    cachedLatestBlock = await getCurrentBlock();
    cachedBlockAt = Date.now();
  } catch {
    /* keep stale value */
  }
  return cachedLatestBlock;
}

import type { Hono } from 'hono';

import { AUCTION_HOUSE_ABI, NOUNS_AUCTION_HOUSE } from '../lib/auctionHouse.js';
import { nounCheckClient } from '../lib/chain.js';

// Cache auction + settlements briefly to avoid hammering RPC.
const AUCTION_STATS_CACHE_TTL_MS = 15_000;
let auctionStatsCache: { at: number; payload: unknown } | null = null;

export function registerAuctionStatsRoutes(app: Hono) {
  app.get('/api/auction-stats', async c => {
    const now = Date.now();
    if (auctionStatsCache !== null && now - auctionStatsCache.at < AUCTION_STATS_CACHE_TTL_MS) {
      return c.json(auctionStatsCache.payload);
    }

    try {
      // Parallel: current live auction + most recent non-empty settlements.
      const [current, settlements] = await Promise.all([
        nounCheckClient.readContract({
          address: NOUNS_AUCTION_HOUSE,
          abi: AUCTION_HOUSE_ABI,
          functionName: 'auction',
        }),
        nounCheckClient.readContract({
          address: NOUNS_AUCTION_HOUSE,
          abi: AUCTION_HOUSE_ABI,
          functionName: 'getSettlements',
          args: [7n, true],
        }),
      ]);

      const prior7 = settlements
        .filter(s => s.amount > 0n)
        .slice(0, 7)
        .map(s => ({
          nounId: String(s.nounId),
          amount: String(s.amount),
          winner: s.winner,
          settled: true,
          endTime: Number(s.blockTimestamp),
        }));

      const avgWei =
        prior7.length > 0
          ? prior7.reduce((acc, p) => acc + BigInt(p.amount), 0n) / BigInt(prior7.length)
          : 0n;

      const payload = {
        current: {
          nounId: String(current.nounId),
          amount: String(current.amount),
          endTime: Number(current.endTime),
          settled: current.settled,
          winner: current.bidder,
        },
        prior7,
        sampleSize: prior7.length,
        avgWei: String(avgWei),
        avgEth: Number(avgWei) / 1e18,
      };

      auctionStatsCache = { at: now, payload };
      return c.json(payload);
    } catch (err) {
      if (auctionStatsCache !== null) {
        return c.json(auctionStatsCache.payload, 200, { 'x-cache': 'stale' });
      }
      return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
    }
  });
}

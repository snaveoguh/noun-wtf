import type { Hono } from 'hono';

import { and, desc, eq } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { keccak256, stringToBytes } from 'viem';

import { checkTxForSale, salePriceForLeg } from '../activityFeed.js';
import { resolveEnsBatch } from '../lib/ens.js';

// ─── Onchain feed (homepage news wire) ──────────────────────────────────
// Merges the external-collection events (punks/ens/toadz, indexed into
// onchain_event) with nouns + nounv2 activity derived from existing tables,
// newest first, and batch-reverse-resolves the addresses involved (shares
// ensCache with /api/ens).

// labelhash(uint256 decimal string) -> "name.eth", built from our own indexed
// ENS registrations (onchain_event). Rebuilt at most every 5 minutes.
let ensLabelMap: Map<string, string> | null = null;
let ensLabelMapAt = 0;
async function getEnsLabelhashNameMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (ensLabelMap && now - ensLabelMapAt < 300_000) return ensLabelMap;
  const map = new Map<string, string>();
  try {
    const regs = await db
      .select({ name: schema.onchainEvent.name })
      .from(schema.onchainEvent)
      .where(
        and(eq(schema.onchainEvent.source, 'ens'), eq(schema.onchainEvent.kind, 'registration')),
      )
      .orderBy(desc(schema.onchainEvent.createdAt))
      .limit(3000);
    for (const r of regs) {
      if (!r.name) continue;
      const label = r.name.replace(/\.eth$/, '');
      map.set(BigInt(keccak256(stringToBytes(label))).toString(), r.name);
    }
    ensLabelMap = map;
    ensLabelMapAt = now;
  } catch {
    /* keep previous map if any */
  }
  return ensLabelMap ?? map;
}

const firstLine = (s: string) =>
  s
    .split('\n')
    .map(l => l.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? '';

export function registerOnchainFeedRoutes(app: Hono) {
  app.get('/api/onchain-feed', async c => {
    const limit = Math.min(Number(c.req.query('limit') ?? 120), 300);
    const per = Math.min(limit, 120);

    type Item = {
      id: string;
      source: 'nouns' | 'nounv2' | 'punks' | 'ens' | 'toadz';
      kind: string;
      actor: string | null;
      counterparty: string | null;
      tokenId: string | null;
      name: string | null;
      valueWei: string | null;
      timestamp: number;
      txHash: string;
      via?: string; // marketplace name when a transfer is detected as a sale
    };
    const items: Item[] = [];
    // Legacy handler tables store `new Date(seconds)` (seconds-as-ms — getTime()
    // numerically equals unix seconds), while onchain_event stores real dates.
    // Normalize both to unix seconds: real-ms values are ~1.7e12, legacy ~1.7e9.
    const ts = (d: Date) => {
      const ms = new Date(d).getTime();
      return ms >= 1e11 ? Math.floor(ms / 1000) : ms;
    };

    const [external, bids, settled, transfers, props, grants, v2Auctions, v2Bids, v2Props] =
      await Promise.all([
        db
          .select()
          .from(schema.onchainEvent)
          .orderBy(desc(schema.onchainEvent.createdAt))
          .limit(per),
        db.select().from(schema.bid).orderBy(desc(schema.bid.createdAt)).limit(40),
        db
          .select()
          .from(schema.auction)
          .where(eq(schema.auction.settled, true))
          .orderBy(desc(schema.auction.endTime))
          .limit(15),
        db
          .select()
          .from(schema.nounTransfer)
          .orderBy(desc(schema.nounTransfer.createdAt))
          .limit(25),
        db.select().from(schema.proposal).orderBy(desc(schema.proposal.createdAt)).limit(10),
        db.select().from(schema.grant).orderBy(desc(schema.grant.createdAt)).limit(10),
        db
          .select()
          .from(schema.nounV2Auction)
          .where(eq(schema.nounV2Auction.settled, true))
          .orderBy(desc(schema.nounV2Auction.endTime))
          .limit(10),
        db.select().from(schema.nounV2Bid).orderBy(desc(schema.nounV2Bid.createdAt)).limit(20),
        db
          .select()
          .from(schema.nounV2Proposal)
          .orderBy(desc(schema.nounV2Proposal.createdAt))
          .limit(5),
      ]);

    for (const e of external) {
      items.push({
        id: e.id,
        source: e.source as Item['source'],
        kind: e.kind,
        actor: e.actor ?? null,
        counterparty: e.counterparty ?? null,
        tokenId: e.tokenId != null ? String(e.tokenId) : null,
        name: e.name ?? null,
        valueWei: e.value != null ? String(e.value) : null,
        timestamp: ts(e.createdAt),
        txHash: e.createdAtTransaction,
      });
    }
    for (const b of bids) {
      items.push({
        id: `nouns-bid-${b.nounId}-${b.value}`,
        source: 'nouns',
        kind: 'bid',
        actor: b.bidder,
        counterparty: null,
        tokenId: String(b.nounId),
        name: null,
        valueWei: String(b.value),
        timestamp: ts(b.createdAt),
        txHash: b.createdAtTransaction,
      });
    }
    for (const a of settled) {
      if (a.winner == null || a.amount == null || a.amount === 0n) continue;
      items.push({
        id: `nouns-settled-${a.nounId}`,
        source: 'nouns',
        kind: 'settled',
        actor: a.winner,
        counterparty: null,
        tokenId: String(a.nounId),
        name: null,
        valueWei: String(a.amount),
        timestamp: ts(a.endTime),
        txHash: a.createdAtTransaction,
      });
    }
    for (const t of transfers) {
      items.push({
        id: `nouns-transfer-${t.nounId}-${t.createdAtBlock}-${t.createdAtTransaction}`,
        source: 'nouns',
        kind: 'transfer',
        actor: t.to,
        counterparty: t.from,
        tokenId: String(t.nounId),
        name: null,
        valueWei: null,
        timestamp: ts(t.createdAt),
        txHash: t.createdAtTransaction,
      });
    }
    for (const p of props) {
      items.push({
        id: `nouns-prop-${p.id}`,
        source: 'nouns',
        kind: 'proposal',
        actor: p.proposer,
        counterparty: null,
        tokenId: String(p.id),
        name: firstLine(p.description),
        valueWei: null,
        timestamp: ts(p.createdAt),
        txHash: p.createdAtTransaction,
      });
    }
    for (const g of grants) {
      items.push({
        id: `nouns-grant-${g.id}`,
        source: 'nouns',
        kind: 'grant',
        actor: g.proposer,
        counterparty: null,
        tokenId: String(g.id),
        name: firstLine(g.description),
        valueWei: null,
        timestamp: ts(g.createdAt),
        txHash: g.createdAtTransaction,
      });
    }
    for (const a of v2Auctions) {
      if (a.winner == null || a.amount == null || a.amount === 0n) continue;
      items.push({
        id: `nounv2-settled-${a.nounId}`,
        source: 'nounv2',
        kind: 'settled',
        actor: a.winner,
        counterparty: null,
        tokenId: String(a.nounId),
        name: null,
        valueWei: String(a.amount),
        timestamp: ts(a.endTime),
        txHash: a.createdAtTransaction,
      });
    }
    for (const b of v2Bids) {
      items.push({
        id: `nounv2-bid-${b.nounId}-${b.value}`,
        source: 'nounv2',
        kind: 'bid',
        actor: b.bidder,
        counterparty: null,
        tokenId: String(b.nounId),
        name: null,
        valueWei: String(b.value),
        timestamp: ts(b.createdAt),
        txHash: b.createdAtTransaction,
      });
    }
    for (const p of v2Props) {
      items.push({
        id: `nounv2-prop-${p.id}`,
        source: 'nounv2',
        kind: 'proposal',
        actor: p.proposer,
        counterparty: null,
        tokenId: String(p.id),
        name: firstLine(p.description),
        valueWei: null,
        timestamp: ts(p.createdAt),
        txHash: p.createdAtTransaction,
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);

    // ENS registrations vastly outnumber everything else (live data: 88 of the
    // top 100) — cap ENS to ~35% of the response so the ALL view stays a mix.
    // The ENS chip still shows the full firehose via ?limit + client filter.
    const ensCap = Math.ceil(limit * 0.35);
    let ensSeen = 0;
    const sliced: typeof items = [];
    for (const it of items) {
      if (it.source === 'ens') {
        if (ensSeen >= ensCap) continue;
        ensSeen++;
      }
      sliced.push(it);
      if (sliced.length >= limit) break;
    }

    // Name ENS sales/transfers: the Transfer event only carries the labelhash
    // (tokenId = uint256(keccak(label))), but our own indexed registrations know
    // the names — build a lazy labelhash→name map and backfill.
    if (sliced.some(it => it.source === 'ens' && it.name == null)) {
      const map = await getEnsLabelhashNameMap();
      for (const it of sliced) {
        if (it.source === 'ens' && it.name == null && it.tokenId != null) {
          const hit = map.get(it.tokenId);
          if (hit) it.name = hit;
        }
      }
    }

    // Upgrade plain transfers to marketplace sales and attribute heuristic
    // sales to their venue — reuses checkTxForSale (router match + ETH/WETH/
    // Blur-pool price extraction, cached per tx).
    await Promise.all(
      sliced
        .filter(it => it.kind === 'transfer' || (it.kind === 'sale' && it.source !== 'punks'))
        .slice(0, 40)
        .map(async it => {
          const sale = await checkTxForSale(it.txHash);
          if (sale) {
            it.kind = 'sale';
            // actor = buyer (to), counterparty = seller (from) — see OnchainFeed.ts
            it.valueWei = String(salePriceForLeg(sale, it.counterparty, it.actor));
            it.via = sale.marketplace;
          }
        }),
    );

    // Reverse-resolve the addresses on screen (bounded + cached).
    const addrs = new Set<string>();
    for (const it of sliced) {
      if (it.actor) addrs.add(it.actor.toLowerCase());
      if (it.counterparty) addrs.add(it.counterparty.toLowerCase());
    }
    const resolved = await resolveEnsBatch([...addrs].slice(0, 80));

    c.header('Cache-Control', 'public, max-age=10');
    return c.json({ items: sliced, resolved });
  });
}

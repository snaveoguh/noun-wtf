import type { Hono } from 'hono';

import { desc, eq } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { nounCheckClient } from '../lib/chain.js';
import { getLatestBlockCached } from '../lib/latestBlock.js';

// ============================================================
// NounV2 — fork endpoints. Same shape as /api/grants and /api/auction-stats
// so the webapp can consume them without branching. Addresses come from env
// vars and may be zero until the mainnet deploy lands.
// ============================================================

const NOUNV2_AUCTION_HOUSE_ADDRESS = (process.env.NOUNV2_AUCTION_HOUSE_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

const NOUNV2_AUCTION_ABI = [
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [
      { name: 'nounId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'bidder', type: 'address' },
      { name: 'settled', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

const NOUNV2_CURRENT_AUCTION_CACHE_TTL_MS = 15_000;
let nounV2CurrentAuctionCache: { at: number; payload: unknown } | null = null;

/** Derived status for a NounV2 proposal (mirrors computeDerivedGrantStatus). */
function computeDerivedNounV2ProposalStatus(
  p: Record<string, unknown>,
  latestBlock: bigint,
): string {
  const status = p.status as string;
  if (['CANCELED', 'EXECUTED'].includes(status)) return status;

  // Queued proposals expire after the grace period (7d on NounV2Treasury).
  if (status === 'QUEUED') {
    if (p.executionETA) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const GRACE_PERIOD = 7 * 86400;
      if (nowSeconds >= Number(p.executionETA) + GRACE_PERIOD) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  if (status === 'ACTIVE') {
    const endBlock = BigInt(p.endBlock as string | number);
    if (latestBlock > endBlock) {
      const forVotes = Number(p.forVotes);
      const againstVotes = Number(p.againstVotes ?? 0);
      if (forVotes === 0 || forVotes <= againstVotes) return 'DEFEATED';
      return 'SUCCEEDED';
    }
  }

  return status;
}

export function registerNounV2Routes(app: Hono) {
  /** All NounV2 proposals — single JSON response with derived status. */
  app.get('/api/nounv2-proposals', async c => {
    const proposals = await db
      .select()
      .from(schema.nounV2Proposal)
      .orderBy(desc(schema.nounV2Proposal.id));
    const latestBlock = await getLatestBlockCached();
    const items = proposals.map(p => {
      const item: Record<string, unknown> = {
        ...p,
        id: String(p.id),
        startBlock: String(p.startBlock),
        endBlock: String(p.endBlock),
        createdAtBlock: String(p.createdAtBlock),
        executionETA: p.executionETA != null ? String(p.executionETA) : null,
        createdAt: String(new Date(p.createdAt).getTime()),
      };
      if (latestBlock > 0n) {
        item.status = computeDerivedNounV2ProposalStatus(item, latestBlock);
      }
      return item;
    });
    return c.json(items);
  });

  /** Single NounV2 proposal with votes, actions, status changes. */
  app.get('/api/nounv2-proposals/:id', async c => {
    const idParam = c.req.param('id');
    const allProposals = await db.select().from(schema.nounV2Proposal);
    const p = allProposals.find(pr => String(pr.id) === idParam);
    if (!p) return c.json({ error: 'not found' }, 404);

    const allVotes = await db
      .select()
      .from(schema.nounV2Vote)
      .orderBy(desc(schema.nounV2Vote.createdAtBlock));
    const votes = allVotes.filter(v => String(v.proposalId) === idParam);

    const allTxs = await db.select().from(schema.nounV2ProposalTransaction);
    const txs = allTxs.filter(t => String(t.proposalId) === idParam);

    const allChanges = await db
      .select()
      .from(schema.nounV2ProposalStatusChange)
      .orderBy(schema.nounV2ProposalStatusChange.createdAtBlock);
    const changes = allChanges.filter(sc => String(sc.proposalId) === idParam);

    const latestBlock = await getLatestBlockCached();

    const item: Record<string, unknown> = {
      ...p,
      id: String(p.id),
      startBlock: String(p.startBlock),
      endBlock: String(p.endBlock),
      createdAtBlock: String(p.createdAtBlock),
      executionETA: p.executionETA != null ? String(p.executionETA) : null,
      createdAt: String(new Date(p.createdAt).getTime()),
    };
    if (latestBlock > 0n) {
      item.status = computeDerivedNounV2ProposalStatus(item, latestBlock);
    }

    return c.json({
      proposal: item,
      votes: votes.map(v => ({
        voter: v.voter,
        support: v.support,
        votes: v.votes,
        reason: v.reason,
        createdAtBlock: String(v.createdAtBlock),
        createdAtTransaction: v.createdAtTransaction,
      })),
      actions: txs.map(t => ({
        index: t.index,
        proposalId: String(t.proposalId),
        target: t.target,
        value: String(t.value),
        signature: t.signature,
        calldata: t.calldata,
      })),
      statusChanges: changes.map(sc => ({
        status: sc.status,
        createdAtBlock: String(sc.createdAtBlock),
        createdAtTransaction: sc.createdAtTransaction,
      })),
    });
  });

  /** All NounV2 auctions from the indexer, newest first. */
  app.get('/api/nounv2-auctions', async c => {
    const auctions = await db
      .select()
      .from(schema.nounV2Auction)
      .orderBy(desc(schema.nounV2Auction.nounId));
    const allBids = await db
      .select()
      .from(schema.nounV2Bid)
      .orderBy(desc(schema.nounV2Bid.createdAtBlock));

    const bidsByNoun = new Map<string, typeof allBids>();
    for (const b of allBids) {
      const key = String(b.nounId);
      if (!bidsByNoun.has(key)) bidsByNoun.set(key, []);
      bidsByNoun.get(key)!.push(b);
    }

    const items = auctions.map(a => ({
      nounId: String(a.nounId),
      // Date.getTime() on the indexer's "seconds-as-ms" stored Date numerically equals
      // the original Unix-seconds chain timestamp — output it directly. Do NOT divide
      // by 1000; the consumer (e.g. webapp's BidHistoryModalRow) does `new Date(value * 1000)`.
      startTime: String(new Date(a.startTime).getTime()),
      endTime: String(new Date(a.endTime).getTime()),
      settled: a.settled,
      winner: a.winner,
      amount: a.amount != null ? String(a.amount) : null,
      createdAtBlock: String(a.createdAtBlock),
      createdAtTransaction: a.createdAtTransaction,
      bids: (bidsByNoun.get(String(a.nounId)) ?? []).map(b => ({
        bidder: b.bidder,
        value: String(b.value),
        extended: b.extended,
        createdAtBlock: String(b.createdAtBlock),
        createdAtTransaction: b.createdAtTransaction,
      })),
    }));
    return c.json(items);
  });

  /**
   * Single NounV2 auction with its full bid history. Powers the webapp's
   * `useV2AuctionBids` hook so the bid history modal works for any past
   * auction (not just the last ~8k blocks an eth_getLogs scan can cover).
   *
   * Bid rows include `timestamp` (chain seconds) so the row formatter can
   * show "X minutes ago" without an extra block lookup.
   */
  app.get('/api/nounv2-auctions/:nounId', async c => {
    const idParam = c.req.param('nounId');
    let nounIdBig: bigint;
    try {
      nounIdBig = BigInt(idParam);
    } catch {
      return c.json({ error: 'invalid nounId' }, 400);
    }

    const auctionRows = await db
      .select()
      .from(schema.nounV2Auction)
      .where(eq(schema.nounV2Auction.nounId, nounIdBig));
    if (auctionRows.length === 0) return c.json({ error: 'not found' }, 404);
    const a = auctionRows[0]!;

    const bidRows = await db
      .select()
      .from(schema.nounV2Bid)
      .where(eq(schema.nounV2Bid.nounId, nounIdBig))
      .orderBy(desc(schema.nounV2Bid.value));

    return c.json({
      nounId: String(a.nounId),
      // See note above: stored Date.getTime() == original Unix seconds value.
      startTime: String(new Date(a.startTime).getTime()),
      endTime: String(new Date(a.endTime).getTime()),
      settled: a.settled,
      winner: a.winner,
      amount: a.amount != null ? String(a.amount) : null,
      createdAtBlock: String(a.createdAtBlock),
      createdAtTransaction: a.createdAtTransaction,
      bids: bidRows.map(b => ({
        bidder: b.bidder,
        value: String(b.value),
        extended: b.extended,
        timestamp: String(new Date(b.createdAt).getTime()),
        transactionHash: b.createdAtTransaction,
        createdAtBlock: String(b.createdAtBlock),
      })),
    });
  });

  // /api/nounv2-feed lives in ./activityFeed.ts (registered below with /api/activity).

  /** Live NounV2 auction state — direct contract read, like /api/auction-stats. */
  app.get('/api/nounv2-auction/current', async c => {
    const now = Date.now();
    if (
      nounV2CurrentAuctionCache !== null &&
      now - nounV2CurrentAuctionCache.at < NOUNV2_CURRENT_AUCTION_CACHE_TTL_MS
    ) {
      return c.json(nounV2CurrentAuctionCache.payload);
    }

    // If the address hasn't been set yet, return a structured "not deployed" response
    // instead of 500'ing on a zero-address call.
    if (NOUNV2_AUCTION_HOUSE_ADDRESS === '0x0000000000000000000000000000000000000000') {
      const payload = { deployed: false, current: null };
      nounV2CurrentAuctionCache = { at: now, payload };
      return c.json(payload);
    }

    try {
      // viem returns a tuple for multiple named outputs; index access is stable.
      const current = (await nounCheckClient.readContract({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: NOUNV2_AUCTION_ABI,
        functionName: 'auction',
      })) as readonly [bigint, bigint, bigint, bigint, `0x${string}`, boolean];

      const payload = {
        deployed: true,
        current: {
          nounId: String(current[0]),
          amount: String(current[1]),
          startTime: Number(current[2]),
          endTime: Number(current[3]),
          bidder: current[4],
          settled: current[5],
        },
      };
      nounV2CurrentAuctionCache = { at: now, payload };
      return c.json(payload);
    } catch (err) {
      if (nounV2CurrentAuctionCache !== null) {
        return c.json(nounV2CurrentAuctionCache.payload, 200, { 'x-cache': 'stale' });
      }
      return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
    }
  });
}

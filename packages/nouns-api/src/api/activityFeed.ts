/**
 * /api/activity — the unified Nouns activity feed.
 *
 * Shape (unchanged, the webapp + sunset shells depend on it):
 *   GET /api/activity?limit=50&before=<block>&type=A,B,C
 *   → { events: ActivityEvent[], hasMore: boolean, oldestBlock: number }
 *
 * Architecture:
 *   1. `FeedSource` registry — each source declares the event types it can
 *      emit and is only queried when at least one of them is wanted. Sources
 *      run in parallel and each is fault-isolated (a failing table never
 *      empties the feed).
 *   2. Post-processors — run in sequence over the merged event list:
 *      transfer bulk-merge + marketplace sale upgrade, side-effect delegation
 *      suppression, batched proposal / sponsor enrichment.
 *   3. Final `want()` filter, sort DESC by block, slice to `limit`.
 *
 * Derived (no-tx) events — PROPOSAL_VOTING_STARTED / PROPOSAL_ENDED — are
 * computed from proposal start/end blocks and carry `txHash: ''`. They
 * paginate on `before` like everything else (blockNumber < before).
 *
 * Per-wallet mode — `GET /api/activity?address=0x…` (and the wallet profile's
 * `/api/wallet/:identity/activity`): every source narrows to rows where the
 * wallet is the actor (voter / proposer / signer / bidder / winner / settler /
 * curator / delegator / from / to / recipient / owner); sources with no
 * address column emit nothing. Without `address` behaviour is unchanged.
 *
 * Also hosts /api/nounv2-feed (same machinery, NounV2 tables).
 */
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Hono } from 'hono';

import { and, desc, eq, inArray, isNotNull, like, lt, lte, max, or, sql } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

// ─── Public types ───────────────────────────────────────────────────────────

export interface ActivityEvent {
  type: string;
  blockNumber: number;
  timestamp: string;
  txHash: string;
  data: Record<string, unknown>;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  hasMore: boolean;
  oldestBlock: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ZERO = '0x0000000000000000000000000000000000000000';
const AUCTION_HOUSE = '0x830bd73e4184cef73443c15111a1df14e495c706';
const NOUNDERS = '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5';
const SECONDS_PER_BLOCK = 12;

export const LIL_NOUNS_SUBGRAPH =
  'https://api.goldsky.com/api/public/project_cldjvjgtylso13swq3dre13sf/subgraphs/lil-nouns-subgraph/1.0.10/gn';

const MAINNET_RPC = process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com';

/** Every type the feed can emit — `want()` accepts all of them. */
export const ACTIVITY_EVENT_TYPES = [
  // auctions
  'AUCTION_CREATED',
  'AUCTION_SETTLED',
  'NOUNDER_NOUN',
  'AUCTION_CONFIG_CHANGED',
  'BID',
  'NOUN_CREATED', // legacy — accepted, never emitted
  // token
  'TRANSFER',
  'SALE',
  'DELEGATION',
  // proposals
  'PROPOSAL_CREATED',
  'PROPOSAL_UPDATED',
  'PROPOSAL_VOTING_STARTED',
  'PROPOSAL_OBJECTION_PERIOD',
  'PROPOSAL_ENDED',
  'PROPOSAL_QUEUED',
  'PROPOSAL_EXECUTED',
  'PROPOSAL_CANCELLED',
  'PROPOSAL_VETOED',
  'VOTE',
  'PROPOSAL_FEEDBACK',
  // candidates
  'CANDIDATE_CREATED',
  'CANDIDATE_UPDATED',
  'CANDIDATE_CANCELED',
  'CANDIDATE_PROMOTED',
  'CANDIDATE_FEEDBACK',
  'CANDIDATE_SPONSORED',
  // streams / forks / dao
  'STREAM_CREATED',
  'STREAM_CANCELLED',
  'STREAM_WITHDRAWN',
  'FORK_ESCROW',
  'FORK_JOIN',
  'FORK_WITHDRAW',
  'FORK_EXECUTED',
  'DAO_CONFIG_CHANGED',
  // grants
  'GRANT_CREATED',
  'GRANT_VOTE',
  'GRANT_QUEUED',
  'GRANT_EXECUTED',
  'GRANT_CANCELED',
  // lil nouns
  'LIL_BID',
  'LIL_AUCTION_SETTLED',
  'LIL_NOUN_CREATED',
  'LIL_VOTE',
  'LIL_PROPOSAL_CREATED',
  'LIL_TRANSFER',
] as const;

// ─── Small helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a stored timestamp to ISO. The indexer historically stored chain
 * seconds as if they were ms (`new Date(Number(secs))`), so anything before
 * year 2000 is treated as seconds.
 */
export function tsToISO(ts: unknown): string {
  return new Date(toUnixSeconds(ts) * 1000).toISOString();
}

export function toUnixSeconds(ts: unknown): number {
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return ms < 946_684_800_000 ? ms : Math.floor(ms / 1000);
  }
  const n = Number(ts);
  if (!Number.isFinite(n)) return Math.floor(Date.now() / 1000);
  return n < 1e12 ? n : Math.floor(n / 1000);
}

export function titleFromDescription(desc: string | null | undefined): string {
  const text = (desc || '').replace(/^\s+/, '');
  return (text.split('\n')[0] || '').replace(/^#\s*/, '').trim().slice(0, 120);
}

export type ProposalResult = 'succeeded' | 'defeated' | 'pending' | null;

/**
 * Outcome of a proposal's vote, mirroring the PROPOSAL_ENDED rule
 * (`for <= against || for < quorum` ⇒ defeated) plus the terminal statuses:
 *   - EXECUTED / QUEUED           → 'succeeded'
 *   - VETOED                      → 'defeated' (the DAO's answer was no)
 *   - CANCELLED                   → 'defeated' only when cancelled after a lost
 *                                   vote (needs `terminatedAtBlock`; without it,
 *                                   a lost vote with ≥ 1 vote cast is assumed);
 *                                   otherwise null (no outcome)
 *   - still in / before its window → 'pending'
 * `null` means the vote never produced an outcome to align with.
 */
export function proposalResult(
  p: {
    status: string;
    forVotes: number;
    againstVotes: number;
    quorumVotes: bigint | number;
    endBlock: bigint;
    objectionPeriodEndBlock: bigint | null;
  },
  latestBlock: bigint,
  /** Block of the CANCELLED / VETOED status change, when known. */
  terminatedAtBlock?: bigint | null,
): ProposalResult {
  if (p.status === 'EXECUTED' || p.status === 'QUEUED') return 'succeeded';
  if (p.status === 'VETOED') return 'defeated';
  const effectiveEnd =
    p.objectionPeriodEndBlock && p.objectionPeriodEndBlock > p.endBlock
      ? p.objectionPeriodEndBlock
      : p.endBlock;
  const ended = latestBlock > 0n && latestBlock > effectiveEnd;
  const defeated = p.forVotes <= p.againstVotes || p.forVotes < Number(p.quorumVotes);
  if (p.status === 'CANCELLED') {
    if (!ended || !defeated) return null;
    if (terminatedAtBlock != null) return terminatedAtBlock > effectiveEnd ? 'defeated' : null;
    return p.forVotes + p.againstVotes > 0 ? 'defeated' : null;
  }
  if (!ended) return 'pending';
  return defeated ? 'defeated' : 'succeeded';
}

function firstImageUrl(desc: string): string | null {
  const m = desc.match(/!\[.*?]\((https?:\/\/[^)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/);
  return m?.[1] || m?.[2] || null;
}

function parseIdList(json: string | null | undefined): number[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

const lower = (a: string | null | undefined) => (a || '').toLowerCase();

// ─── On-chain sale detection ────────────────────────────────────────────────
// Reservoir API shut down Oct 2025. Detect marketplace sales on-chain by
// checking if a NounsToken Transfer tx targeted a known marketplace router.
// When it did, convert the TRANSFER → SALE and extract price from tx.value
// (direct ETH) or the largest WETH / Blur-pool Transfer log.

/** Known NFT marketplace router contracts (lowercased). */
const MARKETPLACE_ROUTERS: Record<string, string> = {
  // Seaport 1.5 + 1.6
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': 'OpenSea',
  '0x0000000000000068f116a894984e2db1123eb395': 'OpenSea',
  // Blur
  '0x39da41747a83aee658334415666f3ef92dd0d541': 'Blur',
  '0xb2ecfe4e4d61f8790bbb9de2d1259b9e2410cea5': 'Blur',
  '0x29469395eaf6f95920e59f858042f0e28d98a20b': 'Blur',
  // LooksRare
  '0x0000000000e655fae4d56241588680f86e3b2377': 'LooksRare',
  // X2Y2
  '0x74312363e45dcaba76c59ec49a7aa8a65a67eed3': 'X2Y2',
  // Sudoswap
  '0x2b2e8cda09bba9660dca5cb6233787738ad68329': 'Sudoswap',
  // Magic Eden
  '0x9a1d00bed7cd04bcda516d721a596eb22aac6834': 'Magic Eden',
};

/** Payment token contracts whose Transfer logs indicate sale price. */
const PAYMENT_TOKENS = new Set([
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x0000000000a39bb272e79075ade125fd351887ac', // Blur Pool
]);
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface SaleInfo {
  marketplace: string;
  /** Tx-level price: direct ETH value, or the largest payment-token transfer. */
  priceWei: bigint;
  /** Payment-token wei sent per payer address (lowercased). Empty for direct-ETH sales. */
  paidBy: Map<string, bigint>;
  /** Payment-token wei received per payee address (lowercased). Empty for direct-ETH sales. */
  receivedBy: Map<string, bigint>;
  /** Number of ERC721 Transfer logs in the tx (all collections) — >1 means a bundle/sweep. */
  nftTransfers: number;
}

/**
 * Price for one (seller → buyer) leg of a marketplace tx.
 *
 * A Blur "accept bids" / sweep moves several NFTs in one tx: buyers each pay
 * the pool, the pool pays the seller one aggregated lump. The tx-level
 * `priceWei` (largest transfer) is that lump, so attributing it to every leg
 * overstates each sale. Prefer the amount this buyer paid or this seller
 * received (the smaller is the more specific — it excludes the other legs and
 * marketplace fees). With no per-address signal (direct ETH sweeps), split the
 * tx total evenly across the NFTs moved.
 */
export function salePriceForLeg(
  sale: SaleInfo,
  from: string | null | undefined,
  to: string | null | undefined,
  legTokens = 1,
): bigint {
  const buyerPaid = sale.paidBy.get(lower(to));
  const sellerGot = sale.receivedBy.get(lower(from));
  const candidates = [buyerPaid, sellerGot].filter((x): x is bigint => x != null && x > 0n);
  if (candidates.length > 0) return candidates.reduce((a, b) => (a < b ? a : b));
  if (sale.nftTransfers > 1 && legTokens < sale.nftTransfers) {
    return (sale.priceWei * BigInt(legTokens)) / BigInt(sale.nftTransfers);
  }
  return sale.priceWei;
}

/** Cache tx sale lookups: txHash → SaleInfo | null. */
const txSaleCache = new Map<string, SaleInfo | null>();
const TX_SALE_CACHE_MAX = 500;

function rememberSale(key: string, value: SaleInfo | null): SaleInfo | null {
  if (txSaleCache.size > TX_SALE_CACHE_MAX) txSaleCache.clear();
  txSaleCache.set(key, value);
  return value;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | undefined> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  const json = (await res.json()) as { result?: T };
  return json.result;
}

export async function checkTxForSale(txHash: string): Promise<SaleInfo | null> {
  const key = txHash.toLowerCase();
  const cached = txSaleCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const tx = await rpc<{ to?: string; value?: string }>('eth_getTransactionByHash', [txHash]);
    if (!tx?.to) return rememberSale(key, null);

    const marketplace = MARKETPLACE_ROUTERS[tx.to.toLowerCase()];
    if (!marketplace) return rememberSale(key, null);

    // A failed receipt fetch must not drop a direct-ETH sale — degrade to the
    // tx-level price with no per-leg / bundle info.
    const receipt = await rpc<{
      logs?: Array<{ address: string; topics: string[]; data: string }>;
    }>('eth_getTransactionReceipt', [txHash]).catch(err => {
      console.warn('[sales] receipt lookup failed:', txHash, err);
      return undefined;
    });

    // Per-address payment flows + NFT count, so multi-NFT txs can be
    // attributed per leg (see salePriceForLeg).
    const paidBy = new Map<string, bigint>();
    const receivedBy = new Map<string, bigint>();
    let nftTransfers = 0;
    let maxPaymentWei = 0n;
    const topicAddr = (t: string | undefined) => `0x${(t || '').slice(-40)}`.toLowerCase();
    for (const log of receipt?.logs ?? []) {
      if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;
      // ERC721 Transfer indexes tokenId (4 topics); ERC20 Transfer has 3.
      if (log.topics.length === 4) {
        nftTransfers++;
        continue;
      }
      if (!PAYMENT_TOKENS.has(log.address.toLowerCase()) || !log.data) continue;
      const amount = BigInt(log.data);
      if (amount > maxPaymentWei) maxPaymentWei = amount;
      const payer = topicAddr(log.topics[1]);
      const payee = topicAddr(log.topics[2]);
      paidBy.set(payer, (paidBy.get(payer) ?? 0n) + amount);
      receivedBy.set(payee, (receivedBy.get(payee) ?? 0n) + amount);
    }

    // Direct ETH payment: tx.value > 0. Sellers are paid via internal calls
    // (invisible in logs), so only the tx total + NFT count are known.
    const txValue = BigInt(tx.value || '0');
    if (txValue > 0n) {
      return rememberSale(key, {
        marketplace,
        priceWei: txValue,
        paidBy: new Map(),
        receivedBy: new Map(),
        nftTransfers,
      });
    }

    // WETH / Blur-pool sale. Marketplace tx but no extractable price still
    // counts as a sale (price 0).
    return rememberSale(key, {
      marketplace,
      priceWei: maxPaymentWei,
      paidBy,
      receivedBy,
      nftTransfers,
    });
  } catch (err) {
    console.warn('[sales] tx lookup failed:', txHash, err);
    return rememberSale(key, null);
  }
}

// ─── Lil Nouns (Goldsky subgraph) ───────────────────────────────────────────

const LIL_ACTIVITY_TTL = 30_000;
let lilActivityCache: { at: number; key: string; events: ActivityEvent[] } | null = null;

export async function fetchLilNounsActivity(
  before: bigint | undefined,
  limit: number,
): Promise<ActivityEvent[]> {
  const key = `${before ?? 'latest'}:${limit}`;
  const now = Date.now();
  if (lilActivityCache?.key === key && now - lilActivityCache.at < LIL_ACTIVITY_TTL) {
    return lilActivityCache.events;
  }

  const per = Math.max(20, Math.min(limit + 10, 100));
  const blockFilter = before ? `, where: { blockNumber_lt: "${before.toString()}" }` : '';
  const propBlockFilter = before ? `, where: { createdBlock_lt: "${before.toString()}" }` : '';
  const query = `{
    bids(first: ${per}, orderBy: blockNumber, orderDirection: desc${blockFilter}) {
      id noun { id } amount bidder { id } blockNumber blockTimestamp comment
    }
    auctions(first: ${per}, orderBy: endTime, orderDirection: desc, where: { settled: true${before ? `, endTime_lt: "${before.toString()}"` : ''} }) {
      id amount bidder { id } noun { id } endTime startTime
    }
    votes(first: ${per}, orderBy: blockNumber, orderDirection: desc${blockFilter}) {
      id voter { id } proposal { id } support: supportDetailed votes reason blockNumber blockTimestamp transactionHash
    }
    proposals(first: ${per}, orderBy: createdBlock, orderDirection: desc${propBlockFilter}) {
      id title proposer { id } createdBlock createdTimestamp description
    }
    transferEvents(first: ${per}, orderBy: blockNumber, orderDirection: desc${blockFilter}) {
      id noun { id } previousHolder { id } newHolder { id } blockNumber blockTimestamp
    }
  }`;

  type Row = Record<string, unknown>;
  let body: {
    data?: {
      bids?: Row[];
      auctions?: Row[];
      votes?: Row[];
      proposals?: Row[];
      transferEvents?: Row[];
    };
  };
  try {
    const res = await fetch(LIL_NOUNS_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Goldsky ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.warn('[activity/lil] subgraph fetch failed:', err);
    return [];
  }

  const events: ActivityEvent[] = [];
  const accId = (a: unknown): string =>
    typeof a === 'object' && a !== null && typeof (a as { id?: unknown }).id === 'string'
      ? (a as { id: string }).id
      : '';

  for (const b of body.data?.bids ?? []) {
    events.push({
      type: 'LIL_BID',
      blockNumber: Number(b.blockNumber),
      timestamp: tsToISO(b.blockTimestamp),
      txHash: '',
      data: {
        nounId: Number(accId(b.noun)),
        value: String(b.amount ?? '0'),
        bidder: accId(b.bidder),
        comment: (b.comment as string) || '',
      },
    });
  }

  // Auction entity has no blockNumber — estimate from endTime so these events
  // merge-sort sensibly against the bid/vote/transfer events that do.
  const estBlock = (ts: number): number =>
    Math.max(0, Math.floor(19_000_000 + (ts - 1_708_993_199) / SECONDS_PER_BLOCK));
  for (const a of body.data?.auctions ?? []) {
    const winner = accId(a.bidder);
    if (!winner) continue;
    const endTs = Number(a.endTime);
    events.push({
      type: 'LIL_AUCTION_SETTLED',
      blockNumber: Number.isFinite(endTs) ? estBlock(endTs) : 0,
      timestamp: tsToISO(a.endTime),
      txHash: '',
      data: { nounId: Number(accId(a.noun)), winner, amount: String(a.amount ?? '0') },
    });
  }

  for (const v of body.data?.votes ?? []) {
    events.push({
      type: 'LIL_VOTE',
      blockNumber: Number(v.blockNumber),
      timestamp: tsToISO(v.blockTimestamp),
      txHash: (v.transactionHash as string) || '',
      data: {
        voter: accId(v.voter),
        proposalId: Number(accId(v.proposal)),
        support: Number(v.support),
        votes: String(v.votes ?? '0'),
        reason: (v.reason as string) || '',
      },
    });
  }

  for (const p of body.data?.proposals ?? []) {
    const derivedTitle =
      ((p.title as string) || '').trim() || titleFromDescription(p.description as string);
    events.push({
      type: 'LIL_PROPOSAL_CREATED',
      blockNumber: Number(p.createdBlock),
      timestamp: tsToISO(p.createdTimestamp),
      txHash: '',
      data: { proposalId: Number(p.id), proposer: accId(p.proposer), title: derivedTitle },
    });
  }

  for (const t of body.data?.transferEvents ?? []) {
    const from = accId(t.previousHolder);
    const to = accId(t.newHolder);
    const nounId = Number(accId(t.noun));
    const ts = tsToISO(t.blockTimestamp);
    const block = Number(t.blockNumber);
    if (lower(from) === ZERO) {
      events.push({
        type: 'LIL_NOUN_CREATED',
        blockNumber: block,
        timestamp: ts,
        txHash: '',
        data: { nounId, owner: to },
      });
    } else {
      events.push({
        type: 'LIL_TRANSFER',
        blockNumber: block,
        timestamp: ts,
        txHash: '',
        data: { nounId, from, to },
      });
    }
  }

  lilActivityCache = { at: now, key, events };
  return events;
}

// ─── Feed source registry ───────────────────────────────────────────────────

interface FeedCtx {
  before: bigint | undefined;
  limit: number;
  /** Rows to pull per table (limit + slack so the merged page stays full). */
  perTable: number;
  want: (type: string) => boolean;
  /** Latest block the indexer has seen — gates derived events. */
  latestBlock: bigint;
  /** A source calls this when it filled its page — older rows exist. */
  markMore: () => void;
  /** Per-wallet mode: lowercased 0x address every source must scope to. */
  address?: string;
}

/**
 * How a source scopes itself to `ctx.address`: the address columns to match
 * (OR-ed), or a builder for a custom predicate (subqueries). An empty list
 * means "this source has no actor column" → emits nothing in per-wallet mode.
 */
type AddrScope = readonly PgColumn[] | ((address: string) => SQL);

/** `undefined` = no address filter; `null` = source cannot scope → no rows. */
function addressFilter(ctx: FeedCtx, scope: AddrScope): SQL | undefined | null {
  if (!ctx.address) return undefined;
  if (typeof scope === 'function') return scope(ctx.address);
  if (scope.length === 0) return null;
  if (scope.length === 1) return eq(scope[0]!, ctx.address);
  return or(...scope.map(c => eq(c, ctx.address)));
}

function whereAll(...parts: (SQL | undefined)[]): SQL | undefined {
  const xs = parts.filter((p): p is SQL => p !== undefined);
  if (xs.length === 0) return undefined;
  if (xs.length === 1) return xs[0];
  return and(...xs);
}

/** Subquery: ids of proposals authored by `address` (for status / version rows). */
const proposalsAuthoredBy = (address: string) =>
  db
    .select({ id: schema.proposal.id })
    .from(schema.proposal)
    .where(eq(schema.proposal.proposer, address as `0x${string}`));

interface FeedSource {
  name: string;
  /** Types this source can emit. Only fetched when one of them is wanted. */
  types: readonly string[];
  fetch(ctx: FeedCtx): Promise<ActivityEvent[]>;
}

type PostProcessor = (events: ActivityEvent[], ctx: FeedCtx) => Promise<ActivityEvent[]>;

/**
 * Newest-first page of `tbl` ordered by `blockCol`, honouring `ctx.before`.
 * Marks the context as having more rows when the page came back full.
 * Drizzle can't carry a per-table row type through a generic helper without
 * a wall of type gymnastics, so rows are re-typed via the table's `$inferSelect`.
 */
async function fetchRows<T extends PgTable>(
  tbl: T,
  blockCol: PgColumn,
  ctx: FeedCtx,
  limit = ctx.perTable,
  scope: AddrScope = [],
): Promise<T['$inferSelect'][]> {
  const addr = addressFilter(ctx, scope);
  if (addr === null) return [];
  const where = whereAll(ctx.before ? lt(blockCol, ctx.before) : undefined, addr);
  const q = db
    .select()
    .from(tbl as PgTable)
    .$dynamic();
  const rows = where
    ? await q.where(where).orderBy(desc(blockCol)).limit(limit)
    : await q.orderBy(desc(blockCol)).limit(limit);
  if (rows.length >= limit) ctx.markMore();
  return rows as T['$inferSelect'][];
}

const bidsSource: FeedSource = {
  name: 'bids',
  types: ['BID'],
  async fetch(ctx) {
    const rows = await fetchRows(schema.bid, schema.bid.createdAtBlock, ctx, ctx.perTable, [
      schema.bid.bidder,
    ]);
    return rows.map(b => ({
      type: 'BID',
      blockNumber: Number(b.createdAtBlock),
      timestamp: tsToISO(b.createdAt),
      txHash: b.createdAtTransaction || '',
      data: {
        nounId: Number(b.nounId),
        value: String(b.value),
        bidder: b.bidder,
        clientId: b.clientId,
        extended: Boolean(b.extended),
      },
    }));
  },
};

// nouns.camp REPOST convention: "+1\n\n> quoted reason"
export const REVOTE_RE = /^\+1\s*\n\s*\n\s*>/;
// Reply convention: first line "@0xabc…" or "@name.eth"
const REPLY_RE = /^@(0x[\da-f]{40}|[\w.-]+\.eth)\b/i;

const votesSource: FeedSource = {
  name: 'votes',
  types: ['VOTE'],
  async fetch(ctx) {
    const rows = await fetchRows(schema.vote, schema.vote.createdAtBlock, ctx, ctx.perTable, [
      schema.vote.voter,
    ]);
    const events: ActivityEvent[] = [];
    for (const v of rows) {
      const reason = v.reason || '';
      // Zero-weight votes with nothing to say are pure noise.
      if (v.votes === 0 && !reason.trim()) continue;
      const reply = reason.trimStart().match(REPLY_RE);
      events.push({
        type: 'VOTE',
        blockNumber: Number(v.createdAtBlock),
        timestamp: tsToISO(v.createdAt),
        txHash: v.createdAtTransaction || '',
        data: {
          voter: v.voter,
          proposalId: Number(v.proposalId),
          support: v.support,
          votes: v.votes,
          reason,
          clientId: v.clientId,
          isRevote: REVOTE_RE.test(reason),
          replyTo: reply?.[1] ?? null,
        },
      });
    }
    return events;
  },
};

const proposalsCreatedSource: FeedSource = {
  name: 'proposals',
  types: ['PROPOSAL_CREATED'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.proposal,
      schema.proposal.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.proposal.proposer],
    );
    return rows.map(p => {
      const descText = p.description || '';
      return {
        type: 'PROPOSAL_CREATED',
        blockNumber: Number(p.createdAtBlock),
        timestamp: tsToISO(p.createdAt),
        txHash: p.createdAtTransaction || '',
        data: {
          proposalId: Number(p.id),
          proposer: p.proposer,
          title: titleFromDescription(descText),
          status: p.status,
          description: descText.slice(0, 4000),
          imageUrl: firstImageUrl(descText),
          clientId: p.clientId,
          signers: [] as string[], // filled by attachProposalMeta
          quorumVotes: Number(p.quorumVotes),
          startBlock: Number(p.startBlock),
          endBlock: Number(p.endBlock),
        },
      };
    });
  },
};

const auctionsCreatedSource: FeedSource = {
  name: 'auctionsCreated',
  types: ['AUCTION_CREATED'],
  async fetch(ctx) {
    const rows = await fetchRows(schema.auction, schema.auction.createdAtBlock, ctx, ctx.perTable, [
      schema.auction.curator,
    ]);
    if (rows.length === 0) return [];

    // "settledNounId" = the auction this creation tx settled. Normally
    // nounId-1; nounId-2 when nounId-1 was a nounder reward (no auction row).
    const candidateIds = rows.flatMap(a => [a.nounId - 1n, a.nounId - 2n]).filter(id => id >= 0n);
    const existing = new Set(
      (
        await db
          .select({ nounId: schema.auction.nounId })
          .from(schema.auction)
          .where(inArray(schema.auction.nounId, candidateIds))
      ).map(r => r.nounId),
    );

    const settledFor = (nounId: bigint): number | null => {
      if (existing.has(nounId - 1n)) return Number(nounId - 1n);
      if (existing.has(nounId - 2n)) return Number(nounId - 2n);
      return null;
    };

    return rows.map(a => {
      const settledNounId = settledFor(a.nounId);
      return {
        type: 'AUCTION_CREATED',
        blockNumber: Number(a.createdAtBlock),
        timestamp: tsToISO(a.createdAt),
        txHash: a.createdAtTransaction || '',
        data: {
          nounId: Number(a.nounId),
          startTime: toUnixSeconds(a.startTime),
          endTime: toUnixSeconds(a.endTime),
          curator: a.curator ?? null,
          settledNounId,
        },
      };
    });
  },
};

const auctionsSettledSource: FeedSource = {
  name: 'auctionsSettled',
  types: ['AUCTION_SETTLED'],
  async fetch(ctx) {
    const col = schema.auction.settledAtBlock;
    const cond = whereAll(
      isNotNull(col),
      ctx.before ? lt(col, ctx.before) : undefined,
      addressFilter(ctx, [schema.auction.winner, schema.auction.settler]) ?? undefined,
    );
    const rows = await db
      .select()
      .from(schema.auction)
      .where(cond)
      .orderBy(desc(col))
      .limit(ctx.perTable);
    if (rows.length >= ctx.perTable) ctx.markMore();

    return rows.map(a => {
      const noWinner = !a.winner || lower(a.winner) === ZERO;
      return {
        type: 'AUCTION_SETTLED',
        blockNumber: Number(a.settledAtBlock ?? a.createdAtBlock),
        timestamp: tsToISO(a.settledAt ?? a.createdAt),
        txHash: a.settledAtTransaction || a.createdAtTransaction || '',
        data: {
          nounId: Number(a.nounId),
          winner: noWinner ? '' : a.winner,
          amount: String(a.amount || '0'),
          clientId: a.clientId,
          settler: a.settler ?? null,
          burned: Boolean(a.burned),
          // V4 AH: a no-bid auction routes the noun to nouns.eth instead of burning.
          treasury: noWinner && !a.burned,
        },
      };
    });
  },
};

const nounderNounsSource: FeedSource = {
  name: 'nounderNouns',
  types: ['NOUNDER_NOUN'],
  async fetch(ctx) {
    // NounsToken mints every noun to the treasury first and then transfers the
    // nounder reward (#0, #10, … ≤ #1820) to nounders.eth in the same tx, so
    // `noun.mintedTo` never equals nounders.eth — the reward is the transfer.
    if (ctx.address && ctx.address !== NOUNDERS) return [];
    const col = schema.nounTransfer.createdAtBlock;
    const cond = ctx.before
      ? and(eq(schema.nounTransfer.to, NOUNDERS), lt(col, ctx.before))
      : eq(schema.nounTransfer.to, NOUNDERS);
    const rows = await db
      .select()
      .from(schema.nounTransfer)
      .where(cond)
      .orderBy(desc(col))
      .limit(ctx.perTable);
    if (rows.length >= ctx.perTable) ctx.markMore();
    return rows
      .filter(t => Number(t.nounId) % 10 === 0 && Number(t.nounId) <= 1820)
      .map(t => ({
        type: 'NOUNDER_NOUN',
        blockNumber: Number(t.createdAtBlock),
        timestamp: tsToISO(t.createdAt),
        txHash: t.createdAtTransaction || '',
        data: { nounId: Number(t.nounId), owner: NOUNDERS },
      }));
  },
};

const auctionConfigSource: FeedSource = {
  name: 'auctionConfig',
  types: ['AUCTION_CONFIG_CHANGED'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.auctionConfigEvent,
      schema.auctionConfigEvent.createdAtBlock,
      ctx,
    );
    return rows.map(r => ({
      type: 'AUCTION_CONFIG_CHANGED',
      blockNumber: Number(r.createdAtBlock),
      timestamp: tsToISO(r.createdAt),
      txHash: r.createdAtTransaction || '',
      data: { param: r.param, oldValue: r.oldValue ?? null, newValue: r.newValue },
    }));
  },
};

/**
 * Raw per-noun transfers with the noise stripped: mints are never stored;
 * anything touching the auction house (treasury→AH, AH→winner settlement,
 * AH→treasury no-bid routing) is covered by AUCTION_* events. Bulk-merge and
 * marketplace-sale upgrade happen in `mergeTransfersAndSales`.
 */
const transfersSource: FeedSource = {
  name: 'transfers',
  types: ['TRANSFER', 'SALE'],
  async fetch(ctx) {
    // Sales are sparse among transfers — pull a deeper page when the
    // caller only wants SALE so the tab isn't three items long.
    const depth = ctx.want('TRANSFER')
      ? ctx.perTable
      : Math.min(200, Math.max(60, ctx.perTable * 3));
    const rows = await fetchRows(
      schema.nounTransfer,
      schema.nounTransfer.createdAtBlock,
      ctx,
      depth,
      [schema.nounTransfer.from, schema.nounTransfer.to],
    );
    const events: ActivityEvent[] = [];
    for (const t of rows) {
      const from = lower(t.from);
      const to = lower(t.to);
      if (from === ZERO || from === AUCTION_HOUSE || to === AUCTION_HOUSE) continue;
      events.push({
        type: 'TRANSFER',
        blockNumber: Number(t.createdAtBlock),
        timestamp: tsToISO(t.createdAt),
        txHash: t.createdAtTransaction || '',
        data: { nounId: Number(t.nounId), from: t.from, to: t.to },
      });
    }
    return events;
  },
};

const delegationsSource: FeedSource = {
  name: 'delegations',
  types: ['DELEGATION'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.delegationEvent,
      schema.delegationEvent.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.delegationEvent.delegator, schema.delegationEvent.toDelegate],
    );
    return rows.map(d => {
      const delegator = lower(d.delegator);
      const from = lower(d.fromDelegate);
      const to = lower(d.toDelegate);
      let kind: 'delegate' | 'undelegate' | 'redelegate' = 'delegate';
      if (to === delegator) kind = 'undelegate';
      else if (from !== ZERO && from !== delegator) kind = 'redelegate';
      return {
        type: 'DELEGATION',
        blockNumber: Number(d.createdAtBlock),
        timestamp: tsToISO(d.createdAt),
        txHash: d.createdAtTransaction || '',
        data: {
          delegator: d.delegator,
          fromDelegate: d.fromDelegate,
          toDelegate: d.toDelegate,
          nounCount: d.nounCount ?? 0,
          kind,
        },
      };
    });
  },
};

const PROPOSAL_STATUS_TYPES = [
  'PROPOSAL_QUEUED',
  'PROPOSAL_EXECUTED',
  'PROPOSAL_CANCELLED',
  'PROPOSAL_VETOED',
  'PROPOSAL_OBJECTION_PERIOD',
] as const;

const proposalStatusSource: FeedSource = {
  name: 'proposalStatus',
  types: PROPOSAL_STATUS_TYPES,
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.proposalStatusChange,
      schema.proposalStatusChange.createdAtBlock,
      ctx,
      ctx.perTable,
      a => inArray(schema.proposalStatusChange.proposalId, proposalsAuthoredBy(a)),
    );
    return rows.map(sc => ({
      type: sc.status === 'OBJECTION' ? 'PROPOSAL_OBJECTION_PERIOD' : `PROPOSAL_${sc.status}`,
      blockNumber: Number(sc.createdAtBlock),
      timestamp: tsToISO(sc.createdAt),
      txHash: sc.createdAtTransaction || '',
      // title / executionETA / objectionPeriodEndBlock filled by attachProposalMeta
      data: { proposalId: Number(sc.proposalId), status: sc.status, title: '' },
    }));
  },
};

const proposalVersionsSource: FeedSource = {
  name: 'proposalVersions',
  types: ['PROPOSAL_UPDATED'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.proposalVersion,
      schema.proposalVersion.createdAtBlock,
      ctx,
      ctx.perTable,
      a => inArray(schema.proposalVersion.proposalId, proposalsAuthoredBy(a)),
    );
    return rows.map(v => ({
      type: 'PROPOSAL_UPDATED',
      blockNumber: Number(v.createdAtBlock),
      timestamp: tsToISO(v.createdAt),
      txHash: v.createdAtTransaction || '',
      data: {
        proposalId: Number(v.proposalId),
        // transactions-only updates carry no description; attachProposalMeta fills it
        title: v.description ? titleFromDescription(v.description) : '',
        updateMessage: v.updateMessage || '',
        kind: v.kind,
      },
    }));
  },
};

/** CANCELLED / VETOED block per proposal, for "was it dead before block X" checks. */
export async function fetchTerminatedBefore(proposalIds: bigint[]): Promise<Map<bigint, bigint>> {
  const out = new Map<bigint, bigint>();
  if (proposalIds.length === 0) return out;
  const rows = await db
    .select({
      proposalId: schema.proposalStatusChange.proposalId,
      block: schema.proposalStatusChange.createdAtBlock,
    })
    .from(schema.proposalStatusChange)
    .where(
      and(
        inArray(schema.proposalStatusChange.proposalId, proposalIds),
        inArray(schema.proposalStatusChange.status, ['CANCELLED', 'VETOED']),
      ),
    );
  for (const r of rows) {
    const prev = out.get(r.proposalId);
    if (prev === undefined || r.block < prev) out.set(r.proposalId, r.block);
  }
  return out;
}

function estimateBlockTimestamp(p: {
  createdAt: Date;
  createdAtBlock: bigint;
  targetBlock: bigint;
}): string {
  const secs =
    toUnixSeconds(p.createdAt) + Number(p.targetBlock - p.createdAtBlock) * SECONDS_PER_BLOCK;
  return new Date(secs * 1000).toISOString();
}

/** DERIVED: voting opened at startBlock. No tx. */
const votingStartedSource: FeedSource = {
  name: 'votingStarted',
  types: ['PROPOSAL_VOTING_STARTED'],
  async fetch(ctx) {
    const col = schema.proposal.startBlock;
    const cond = whereAll(
      lte(col, ctx.latestBlock),
      ctx.before ? lt(col, ctx.before) : undefined,
      addressFilter(ctx, [schema.proposal.proposer]) ?? undefined,
    );
    const rows = await db
      .select()
      .from(schema.proposal)
      .where(cond)
      .orderBy(desc(col))
      .limit(ctx.perTable);
    if (rows.length >= ctx.perTable) ctx.markMore();

    const dead = await fetchTerminatedBefore(rows.map(p => p.id));
    const events: ActivityEvent[] = [];
    for (const p of rows) {
      const killedAt = dead.get(p.id);
      if (killedAt !== undefined && killedAt < p.startBlock) continue;
      events.push({
        type: 'PROPOSAL_VOTING_STARTED',
        blockNumber: Number(p.startBlock),
        timestamp: estimateBlockTimestamp({
          createdAt: p.createdAt,
          createdAtBlock: p.createdAtBlock,
          targetBlock: p.startBlock,
        }),
        txHash: '',
        data: { proposalId: Number(p.id), title: titleFromDescription(p.description) },
      });
    }
    return events;
  },
};

/** DERIVED: voting closed at endBlock (or objectionPeriodEndBlock). No tx. */
const proposalEndedSource: FeedSource = {
  name: 'proposalEnded',
  types: ['PROPOSAL_ENDED'],
  async fetch(ctx) {
    // Effective end = objectionPeriodEndBlock ?? endBlock, which is >= endBlock,
    // so filtering on endBlock is a superset; the exact gate is applied below.
    const col = schema.proposal.endBlock;
    const cond = whereAll(
      lte(col, ctx.latestBlock),
      ctx.before ? lt(col, ctx.before) : undefined,
      addressFilter(ctx, [schema.proposal.proposer]) ?? undefined,
    );
    const fetchLimit = ctx.perTable + 5;
    const rows = await db
      .select()
      .from(schema.proposal)
      .where(cond)
      .orderBy(desc(col))
      .limit(fetchLimit);
    if (rows.length >= fetchLimit) ctx.markMore();

    const dead = await fetchTerminatedBefore(rows.map(p => p.id));
    const events: ActivityEvent[] = [];
    for (const p of rows) {
      const endBlock =
        p.objectionPeriodEndBlock && p.objectionPeriodEndBlock > p.endBlock
          ? p.objectionPeriodEndBlock
          : p.endBlock;
      if (endBlock > ctx.latestBlock) continue;
      if (ctx.before !== undefined && endBlock >= ctx.before) continue;
      const killedAt = dead.get(p.id);
      if (killedAt !== undefined && killedAt < endBlock) continue;

      const quorum = Number(p.quorumVotes);
      const defeated = p.forVotes <= p.againstVotes || p.forVotes < quorum;
      events.push({
        type: 'PROPOSAL_ENDED',
        blockNumber: Number(endBlock),
        timestamp: estimateBlockTimestamp({
          createdAt: p.createdAt,
          createdAtBlock: p.createdAtBlock,
          targetBlock: endBlock,
        }),
        txHash: '',
        data: {
          proposalId: Number(p.id),
          title: titleFromDescription(p.description),
          result: defeated ? 'defeated' : 'succeeded',
          forVotes: p.forVotes,
          againstVotes: p.againstVotes,
          abstainVotes: p.abstainVotes,
          quorumVotes: quorum,
        },
      });
    }
    return events;
  },
};

const proposalFeedbackSource: FeedSource = {
  name: 'proposalFeedback',
  types: ['PROPOSAL_FEEDBACK'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.proposalFeedback,
      schema.proposalFeedback.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.proposalFeedback.voter],
    );
    return rows.map(pf => ({
      type: 'PROPOSAL_FEEDBACK',
      blockNumber: Number(pf.createdAtBlock),
      timestamp: tsToISO(pf.createdAt),
      txHash: pf.createdAtTransaction || '',
      data: {
        voter: pf.voter,
        proposalId: Number(pf.proposalId),
        support: pf.support,
        reason: pf.reason || '',
      },
    }));
  },
};

const candidatesCreatedSource: FeedSource = {
  name: 'candidates',
  types: ['CANDIDATE_CREATED'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.candidate,
      schema.candidate.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.candidate.proposer],
    );
    return rows.map(cd => {
      const descText = cd.description || '';
      const targets = parseIdList(cd.targets);
      return {
        type: 'CANDIDATE_CREATED',
        blockNumber: Number(cd.createdAtBlock),
        timestamp: tsToISO(cd.createdAt),
        txHash: cd.createdAtTransaction || '',
        data: {
          candidateId: cd.id,
          slug: cd.slug,
          proposer: cd.proposer,
          title: titleFromDescription(descText),
          description: descText.slice(0, 4000),
          imageUrl: firstImageUrl(descText),
          canceled: cd.canceled,
          isTopic: targets.length === 0 && !cd.targets?.includes('0x'),
          updatesProposalId:
            cd.proposalIdToUpdate != null && cd.proposalIdToUpdate > 0n
              ? Number(cd.proposalIdToUpdate)
              : null,
        },
      };
    });
  },
};

const candidateVersionsSource: FeedSource = {
  name: 'candidateVersions',
  types: ['CANDIDATE_UPDATED'],
  async fetch(ctx) {
    // candidate ids are `${lowercased proposer}-${slug}`
    const rows = await fetchRows(
      schema.candidateVersion,
      schema.candidateVersion.blockNumber,
      ctx,
      ctx.perTable,
      a => like(schema.candidateVersion.candidateId, `${a}-%`),
    );
    return rows.map(cv => {
      const descText = cv.description || '';
      const parts = cv.candidateId.split('-');
      return {
        type: 'CANDIDATE_UPDATED',
        blockNumber: Number(cv.blockNumber),
        timestamp: tsToISO(cv.blockTimestamp),
        txHash: cv.txHash || '',
        data: {
          candidateId: cv.candidateId,
          slug: parts.slice(1).join('-'),
          proposer: parts[0] || '',
          title: titleFromDescription(descText),
          description: descText.slice(0, 4000),
          reason: cv.reason || '',
        },
      };
    });
  },
};

async function fetchCandidatesBy(
  col: typeof schema.candidate.canceledAtBlock | typeof schema.candidate.promotedAtBlock,
  ctx: FeedCtx,
) {
  const cond = whereAll(
    isNotNull(col),
    ctx.before ? lt(col, ctx.before) : undefined,
    addressFilter(ctx, [schema.candidate.proposer]) ?? undefined,
  );
  const rows = await db
    .select()
    .from(schema.candidate)
    .where(cond)
    .orderBy(desc(col))
    .limit(ctx.perTable);
  if (rows.length >= ctx.perTable) ctx.markMore();
  return rows;
}

const candidatesCanceledSource: FeedSource = {
  name: 'candidatesCanceled',
  types: ['CANDIDATE_CANCELED'],
  async fetch(ctx) {
    const rows = await fetchCandidatesBy(schema.candidate.canceledAtBlock, ctx);
    const events: ActivityEvent[] = [];
    for (const cd of rows) {
      if (cd.canceledAtBlock == null) continue;
      events.push({
        type: 'CANDIDATE_CANCELED',
        blockNumber: Number(cd.canceledAtBlock),
        timestamp: tsToISO(cd.canceledAtTimestamp ?? cd.lastUpdatedAt ?? cd.createdAt),
        txHash: cd.canceledAtTx || '',
        data: {
          candidateId: cd.id,
          slug: cd.slug,
          proposer: cd.proposer,
          title: titleFromDescription(cd.description),
        },
      });
    }
    return events;
  },
};

const candidatesPromotedSource: FeedSource = {
  name: 'candidatesPromoted',
  types: ['CANDIDATE_PROMOTED'],
  async fetch(ctx) {
    const rows = await fetchCandidatesBy(schema.candidate.promotedAtBlock, ctx);
    const events: ActivityEvent[] = [];
    for (const cd of rows) {
      if (cd.promotedAtBlock == null) continue;
      events.push({
        type: 'CANDIDATE_PROMOTED',
        blockNumber: Number(cd.promotedAtBlock),
        timestamp: tsToISO(cd.promotedAtTimestamp ?? cd.lastUpdatedAt ?? cd.createdAt),
        txHash: cd.promotedAtTx || '',
        data: {
          candidateId: cd.id,
          slug: cd.slug,
          proposer: cd.proposer,
          title: titleFromDescription(cd.description),
          proposalId: cd.promotedToProposalId != null ? Number(cd.promotedToProposalId) : null,
        },
      });
    }
    return events;
  },
};

const candidateSignaturesSource: FeedSource = {
  name: 'candidateSignatures',
  types: ['CANDIDATE_SPONSORED'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.candidateSignature,
      schema.candidateSignature.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.candidateSignature.signer],
    );
    const events: ActivityEvent[] = [];
    for (const cs of rows) {
      if (cs.canceled) continue;
      events.push({
        type: 'CANDIDATE_SPONSORED',
        blockNumber: Number(cs.createdAtBlock),
        timestamp: tsToISO(cs.createdAt),
        txHash: cs.createdAtTransaction || '',
        data: {
          signer: cs.signer,
          candidateId: cs.candidateId,
          reason: cs.reason || '',
          votes: 0, // filled by attachSponsorVotes
          expirationTimestamp: Number(cs.expirationTimestamp),
        },
      });
    }
    return events;
  },
};

const candidateFeedbackSource: FeedSource = {
  name: 'candidateFeedback',
  types: ['CANDIDATE_FEEDBACK'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.candidateFeedback,
      schema.candidateFeedback.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.candidateFeedback.voter],
    );
    return rows.map(cf => ({
      type: 'CANDIDATE_FEEDBACK',
      blockNumber: Number(cf.createdAtBlock),
      timestamp: tsToISO(cf.createdAt),
      txHash: cf.createdAtTransaction || '',
      data: {
        voter: cf.voter,
        candidateId: cf.candidateId,
        support: cf.support,
        reason: cf.reason || '',
      },
    }));
  },
};

const streamsCreatedSource: FeedSource = {
  name: 'streams',
  types: ['STREAM_CREATED'],
  async fetch(ctx) {
    const rows = await fetchRows(schema.stream, schema.stream.createdAtBlock, ctx, ctx.perTable, [
      schema.stream.recipient,
    ]);
    return rows.map(s => ({
      type: 'STREAM_CREATED',
      blockNumber: Number(s.createdAtBlock),
      timestamp: tsToISO(s.createdAt),
      txHash: s.createdAtTransaction || '',
      data: {
        streamAddress: s.streamAddress,
        recipient: s.recipient,
        tokenAmount: String(s.tokenAmount),
        tokenAddress: s.tokenAddress || '',
        proposalId: s.proposalId ? Number(s.proposalId) : null,
        status: s.status,
      },
    }));
  },
};

const streamEventsSource: FeedSource = {
  name: 'streamEvents',
  types: ['STREAM_CANCELLED', 'STREAM_WITHDRAWN'],
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.streamEvent,
      schema.streamEvent.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.streamEvent.recipient],
    );
    return rows.map(e => {
      const base = {
        streamAddress: e.streamAddress,
        recipient: e.recipient,
        tokenAddress: e.tokenAddress,
        proposalId: e.proposalId != null ? Number(e.proposalId) : null,
      };
      return {
        type: e.kind === 'cancelled' ? 'STREAM_CANCELLED' : 'STREAM_WITHDRAWN',
        blockNumber: Number(e.createdAtBlock),
        timestamp: tsToISO(e.createdAt),
        txHash: e.createdAtTransaction || '',
        data:
          e.kind === 'cancelled'
            ? { ...base, recipientAmount: e.amount != null ? String(e.amount) : null }
            : { ...base, amount: String(e.amount ?? '0') },
      };
    });
  },
};

const FORK_TYPE_BY_KIND: Record<string, string> = {
  escrow: 'FORK_ESCROW',
  join: 'FORK_JOIN',
  withdraw: 'FORK_WITHDRAW',
  executed: 'FORK_EXECUTED',
};

const forkEventsSource: FeedSource = {
  name: 'forkEvents',
  types: Object.values(FORK_TYPE_BY_KIND),
  async fetch(ctx) {
    const rows = await fetchRows(
      schema.forkEvent,
      schema.forkEvent.createdAtBlock,
      ctx,
      ctx.perTable,
      [schema.forkEvent.owner],
    );
    return rows.map(f => {
      const common = {
        blockNumber: Number(f.createdAtBlock),
        timestamp: tsToISO(f.createdAt),
        txHash: f.createdAtTransaction || '',
      };
      if (f.kind === 'executed') {
        return {
          ...common,
          type: 'FORK_EXECUTED',
          data: {
            forkId: f.forkId,
            forkTreasury: f.forkTreasury ?? null,
            forkToken: f.forkToken ?? null,
            forkEndTimestamp: f.forkEndTimestamp != null ? Number(f.forkEndTimestamp) : null,
            tokensInEscrow: f.tokensInEscrow != null ? Number(f.tokensInEscrow) : null,
          },
        };
      }
      if (f.kind === 'withdraw') {
        return {
          ...common,
          type: 'FORK_WITHDRAW',
          data: { forkId: f.forkId, owner: f.owner ?? null, nounIds: parseIdList(f.nounIds) },
        };
      }
      return {
        ...common,
        type: FORK_TYPE_BY_KIND[f.kind] ?? 'FORK_ESCROW',
        data: {
          forkId: f.forkId,
          owner: f.owner ?? null,
          nounIds: parseIdList(f.nounIds),
          proposalIds: parseIdList(f.proposalIds),
          reason: f.reason || '',
        },
      };
    });
  },
};

const daoConfigSource: FeedSource = {
  name: 'daoConfig',
  types: ['DAO_CONFIG_CHANGED'],
  async fetch(ctx) {
    const rows = await fetchRows(schema.daoConfigEvent, schema.daoConfigEvent.createdAtBlock, ctx);
    return rows.map(r => ({
      type: 'DAO_CONFIG_CHANGED',
      blockNumber: Number(r.createdAtBlock),
      timestamp: tsToISO(r.createdAt),
      txHash: r.createdAtTransaction || '',
      data: { param: r.param, oldValue: r.oldValue ?? null, newValue: r.newValue },
    }));
  },
};

const GRANT_TYPES = [
  'GRANT_CREATED',
  'GRANT_VOTE',
  'GRANT_QUEUED',
  'GRANT_EXECUTED',
  'GRANT_CANCELED',
] as const;

const grantsSource: FeedSource = {
  name: 'grants',
  types: GRANT_TYPES,
  async fetch(ctx) {
    const [grants, grantVotes, statusChanges] = await Promise.all([
      fetchRows(schema.grant, schema.grant.createdAtBlock, ctx, ctx.perTable, [
        schema.grant.proposer,
      ]),
      fetchRows(schema.grantVote, schema.grantVote.createdAtBlock, ctx, ctx.perTable, [
        schema.grantVote.voter,
      ]),
      fetchRows(
        schema.grantStatusChange,
        schema.grantStatusChange.createdAtBlock,
        ctx,
        ctx.perTable,
        a =>
          inArray(
            schema.grantStatusChange.grantId,
            db
              .select({ id: schema.grant.id })
              .from(schema.grant)
              .where(eq(schema.grant.proposer, a as `0x${string}`)),
          ),
      ),
    ]);
    const events: ActivityEvent[] = [];
    for (const g of grants) {
      events.push({
        type: 'GRANT_CREATED',
        blockNumber: Number(g.createdAtBlock),
        timestamp: tsToISO(g.createdAt),
        txHash: g.createdAtTransaction || '',
        data: {
          grantId: Number(g.id),
          proposer: g.proposer,
          description: (g.description || '').slice(0, 4000),
          status: g.status,
          forVotes: g.forVotes,
          againstVotes: g.againstVotes,
        },
      });
    }
    for (const gv of grantVotes) {
      events.push({
        type: 'GRANT_VOTE',
        blockNumber: Number(gv.createdAtBlock),
        timestamp: tsToISO(gv.createdAt),
        txHash: gv.createdAtTransaction || '',
        data: {
          voter: gv.voter,
          grantId: Number(gv.grantId),
          support: gv.support,
          votes: gv.votes,
          reason: gv.reason || '',
        },
      });
    }
    for (const gs of statusChanges) {
      events.push({
        type: `GRANT_${gs.status}`,
        blockNumber: Number(gs.createdAtBlock),
        timestamp: tsToISO(gs.createdAt),
        txHash: gs.createdAtTransaction || '',
        data: { grantId: Number(gs.grantId), status: gs.status },
      });
    }
    return events;
  },
};

const lilNounsSource: FeedSource = {
  name: 'lilNouns',
  types: [
    'LIL_BID',
    'LIL_AUCTION_SETTLED',
    'LIL_NOUN_CREATED',
    'LIL_VOTE',
    'LIL_PROPOSAL_CREATED',
    'LIL_TRANSFER',
  ],
  // Lil Nouns rows aren't scoped per wallet (external subgraph) — skip in per-wallet mode.
  fetch: ctx => (ctx.address ? Promise.resolve([]) : fetchLilNounsActivity(ctx.before, ctx.limit)),
};

const SOURCES: readonly FeedSource[] = [
  bidsSource,
  votesSource,
  proposalsCreatedSource,
  auctionsCreatedSource,
  auctionsSettledSource,
  nounderNounsSource,
  auctionConfigSource,
  transfersSource,
  delegationsSource,
  proposalStatusSource,
  proposalVersionsSource,
  votingStartedSource,
  proposalEndedSource,
  proposalFeedbackSource,
  candidatesCreatedSource,
  candidateVersionsSource,
  candidatesCanceledSource,
  candidatesPromotedSource,
  candidateSignaturesSource,
  candidateFeedbackSource,
  streamsCreatedSource,
  streamEventsSource,
  forkEventsSource,
  daoConfigSource,
  grantsSource,
  lilNounsSource,
];

// ─── Post-processors ────────────────────────────────────────────────────────

const MAX_SALE_LOOKUPS = 40;

/**
 * Bulk-merge TRANSFER events sharing (tx, from, to) into one event with
 * `nounIds`, then upgrade marketplace txs to SALE with the tx-level price.
 */
const mergeTransfersAndSales: PostProcessor = async (events, ctx) => {
  const transfers = events.filter(e => e.type === 'TRANSFER');
  if (transfers.length === 0) return events;
  const rest = events.filter(e => e.type !== 'TRANSFER');

  const groups = new Map<string, ActivityEvent & { nounIds: number[] }>();
  for (const t of transfers) {
    const key = `${lower(t.txHash)}|${lower(t.data.from as string)}|${lower(t.data.to as string)}`;
    const g = groups.get(key);
    if (g) {
      g.nounIds.push(t.data.nounId as number);
    } else {
      groups.set(key, { ...t, nounIds: [t.data.nounId as number] });
    }
  }

  const txHashes = [...new Set([...groups.values()].map(g => g.txHash).filter(Boolean))];
  const sales = new Map<string, SaleInfo>();
  await Promise.all(
    txHashes.slice(0, MAX_SALE_LOOKUPS).map(async txHash => {
      const sale = await checkTxForSale(txHash);
      if (sale) sales.set(lower(txHash), sale);
    }),
  );

  for (const g of groups.values()) {
    const nounIds = [...new Set(g.nounIds)].sort((a, b) => a - b);
    const base = { nounIds, nounId: nounIds[0], from: g.data.from, to: g.data.to };
    const sale = sales.get(lower(g.txHash));
    if (sale) {
      const legWei = salePriceForLeg(
        sale,
        g.data.from as string,
        g.data.to as string,
        nounIds.length,
      );
      const priceEth = Number(legWei) / 1e18;
      rest.push({
        type: 'SALE',
        blockNumber: g.blockNumber,
        timestamp: g.timestamp,
        txHash: g.txHash,
        data: {
          ...base,
          priceEth,
          priceWei: legWei.toString(),
          marketplace: sale.marketplace,
          // legacy keys (older shells render these)
          collection: 'NOUN',
          collectionName: 'Noun',
          tokenId: String(nounIds[0]),
          tokenName: nounIds.length > 1 ? `${nounIds.length} Nouns` : `Noun ${nounIds[0]}`,
          priceUsd: null,
          currency: 'ETH',
        },
      });
    } else {
      rest.push({
        type: 'TRANSFER',
        blockNumber: g.blockNumber,
        timestamp: g.timestamp,
        txHash: g.txHash,
        data: base,
      });
    }
  }
  void ctx;
  return rest;
};

/**
 * nouns.camp rule: a DelegateChanged in the same tx as a Transfer / mint is a
 * side effect (wallet migrations, settlement helpers), not an intentional act.
 */
const suppressSideEffectDelegations: PostProcessor = async events => {
  const txs = [
    ...new Set(events.filter(e => e.type === 'DELEGATION' && e.txHash).map(e => e.txHash)),
  ];
  if (txs.length === 0) return events;

  const [transferTxs, mintTxs] = await Promise.all([
    db
      .selectDistinct({ tx: schema.nounTransfer.createdAtTransaction })
      .from(schema.nounTransfer)
      .where(inArray(schema.nounTransfer.createdAtTransaction, txs)),
    db
      .selectDistinct({ tx: schema.noun.createdAtTransaction })
      .from(schema.noun)
      .where(inArray(schema.noun.createdAtTransaction, txs)),
  ]);
  const noisy = new Set([...transferTxs, ...mintTxs].map(r => lower(r.tx)));
  if (noisy.size === 0) return events;
  return events.filter(e => e.type !== 'DELEGATION' || !noisy.has(lower(e.txHash)));
};

const NEEDS_PROPOSAL_META = new Set<string>([
  'PROPOSAL_CREATED',
  'PROPOSAL_UPDATED',
  ...PROPOSAL_STATUS_TYPES,
]);

/** One batched lookup for titles / quorum / ETA / signers across every proposal event. */
const attachProposalMeta: PostProcessor = async events => {
  const targets = events.filter(e => NEEDS_PROPOSAL_META.has(e.type));
  if (targets.length === 0) return events;
  const ids = [...new Set(targets.map(e => BigInt(e.data.proposalId as number)))];

  const needSigners = targets.some(e => e.type === 'PROPOSAL_CREATED');
  const [meta, signers] = await Promise.all([
    db
      .select({
        id: schema.proposal.id,
        firstLine: sql<string>`split_part(regexp_replace(${schema.proposal.description}, '^\\s+', ''), E'\\n', 1)`,
        executionETA: schema.proposal.executionETA,
        objectionPeriodEndBlock: schema.proposal.objectionPeriodEndBlock,
      })
      .from(schema.proposal)
      .where(inArray(schema.proposal.id, ids)),
    needSigners
      ? db
          .select()
          .from(schema.proposalSigner)
          .where(inArray(schema.proposalSigner.proposalId, ids))
      : Promise.resolve([] as (typeof schema.proposalSigner)['$inferSelect'][]),
  ]);

  const byId = new Map(meta.map(m => [Number(m.id), m]));
  const signersById = new Map<number, string[]>();
  for (const s of signers) {
    const list = signersById.get(Number(s.proposalId)) ?? [];
    list.push(s.signer);
    signersById.set(Number(s.proposalId), list);
  }

  for (const e of targets) {
    const id = e.data.proposalId as number;
    const m = byId.get(id);
    const title = titleFromDescription(m?.firstLine) || `Prop ${id}`;
    if (!e.data.title) e.data.title = title;
    if (e.type === 'PROPOSAL_CREATED') e.data.signers = signersById.get(id) ?? [];
    if (e.type === 'PROPOSAL_QUEUED') {
      e.data.executionETA = m?.executionETA != null ? Number(m.executionETA) : null;
    }
    if (e.type === 'PROPOSAL_OBJECTION_PERIOD') {
      e.data.objectionPeriodEndBlock =
        m?.objectionPeriodEndBlock != null ? Number(m.objectionPeriodEndBlock) : null;
    }
  }
  return events;
};

/** CANDIDATE_SPONSORED.votes = signer's current delegated vote weight. */
const attachSponsorVotes: PostProcessor = async events => {
  const targets = events.filter(e => e.type === 'CANDIDATE_SPONSORED');
  if (targets.length === 0) return events;
  const signers = [...new Set(targets.map(e => e.data.signer as `0x${string}`))];
  const rows = await db.select().from(schema.delegate).where(inArray(schema.delegate.id, signers));
  const votes = new Map(rows.map(r => [lower(r.id), r.delegatedVotes]));
  for (const e of targets) e.data.votes = votes.get(lower(e.data.signer as string)) ?? 0;
  return events;
};

const POST_PROCESSORS: readonly PostProcessor[] = [
  mergeTransfersAndSales,
  suppressSideEffectDelegations,
  attachProposalMeta,
  attachSponsorVotes,
];

// ─── Feed assembly ──────────────────────────────────────────────────────────

/** Highest block any indexed table has seen — gates derived events. */
export async function latestIndexedBlock(): Promise<bigint> {
  const probes = [
    db.select({ b: max(schema.onchainEvent.createdAtBlock) }).from(schema.onchainEvent),
    db.select({ b: max(schema.bid.createdAtBlock) }).from(schema.bid),
    db.select({ b: max(schema.vote.createdAtBlock) }).from(schema.vote),
  ];
  const results = await Promise.allSettled(probes);
  let best = 0n;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const b = r.value[0]?.b;
    if (b != null && BigInt(b) > best) best = BigInt(b);
  }
  return best;
}

export async function buildActivityFeed(params: {
  limit: number;
  before?: bigint;
  types: string[];
  /** Per-wallet mode — 0x address (any case); every source scopes to it. */
  address?: string;
}): Promise<ActivityResponse> {
  const { limit, before } = params;
  const typeFilter = params.types;
  const want = (t: string) => typeFilter.length === 0 || typeFilter.includes(t);

  const wantsDerived = want('PROPOSAL_VOTING_STARTED') || want('PROPOSAL_ENDED');
  let more = false;
  const ctx: FeedCtx = {
    before,
    limit,
    perTable: limit + 10,
    want,
    latestBlock: wantsDerived ? await latestIndexedBlock() : 0n,
    markMore: () => {
      more = true;
    },
    address: params.address ? lower(params.address) : undefined,
  };

  const active = SOURCES.filter(s => s.types.some(want));
  const batches = await Promise.all(
    active.map(s =>
      s.fetch(ctx).catch(err => {
        console.warn(`[activity] source ${s.name} failed:`, err);
        return [] as ActivityEvent[];
      }),
    ),
  );
  let events = batches.flat();

  for (const step of POST_PROCESSORS) {
    try {
      events = await step(events, ctx);
    } catch (err) {
      console.warn('[activity] post-processor failed:', err);
    }
  }

  events = events.filter(e => want(e.type));
  events.sort((a, b) => b.blockNumber - a.blockNumber);

  const sliced = events.slice(0, limit);
  const oldestBlock = sliced.length > 0 ? sliced[sliced.length - 1]!.blockNumber : 0;
  return { events: sliced, hasMore: events.length > limit || more, oldestBlock };
}

// ─── Response cache ─────────────────────────────────────────────────────────

const FEED_TTL = 30_000;
const CACHE_MAX_ENTRIES = 64;
const feedCache = new Map<string, { data: ActivityResponse; at: number }>();

function cached(key: string): ActivityResponse | null {
  const hit = feedCache.get(key);
  if (hit && Date.now() - hit.at < FEED_TTL) return hit.data;
  return null;
}

function remember(key: string, data: ActivityResponse): ActivityResponse {
  if (feedCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = feedCache.keys().next().value;
    if (oldest !== undefined) feedCache.delete(oldest);
  }
  feedCache.set(key, { data, at: Date.now() });
  return data;
}

// ─── NounV2 feed ────────────────────────────────────────────────────────────

const V2_TYPES = [
  'V2_BID',
  'V2_SETTLED',
  'V2_AUCTION',
  'V2_PROP',
  'V2_VOTE',
  'V2_PROP_QUEUED',
  'V2_PROP_EXECUTED',
  'V2_PROP_CANCELED',
] as const;

export async function buildNounV2Feed(params: {
  limit: number;
  before?: bigint;
}): Promise<ActivityResponse> {
  const { limit, before } = params;
  let more = false;
  const ctx: FeedCtx = {
    before,
    limit,
    perTable: limit + 10,
    want: () => true,
    latestBlock: 0n,
    markMore: () => {
      more = true;
    },
  };

  const [bids, auctions, proposals, votes, statusChanges] = await Promise.all([
    fetchRows(schema.nounV2Bid, schema.nounV2Bid.createdAtBlock, ctx).catch(() => []),
    fetchRows(schema.nounV2Auction, schema.nounV2Auction.createdAtBlock, ctx).catch(() => []),
    fetchRows(schema.nounV2Proposal, schema.nounV2Proposal.createdAtBlock, ctx).catch(() => []),
    fetchRows(schema.nounV2Vote, schema.nounV2Vote.createdAtBlock, ctx).catch(() => []),
    fetchRows(
      schema.nounV2ProposalStatusChange,
      schema.nounV2ProposalStatusChange.createdAtBlock,
      ctx,
    ).catch(() => []),
  ]);

  const events: ActivityEvent[] = [];

  for (const b of bids) {
    events.push({
      type: 'V2_BID',
      blockNumber: Number(b.createdAtBlock),
      timestamp: tsToISO(b.createdAt),
      txHash: b.createdAtTransaction || '',
      data: {
        nounId: Number(b.nounId),
        value: String(b.value),
        bidder: b.bidder,
        extended: b.extended,
      },
    });
  }

  for (const a of auctions) {
    // Use SETTLED only for finalized auctions; show CREATED for fresh auctions.
    if (a.settled) {
      const noWinner = !a.winner || lower(a.winner) === ZERO;
      events.push({
        type: 'V2_SETTLED',
        blockNumber: Number(a.createdAtBlock),
        timestamp: tsToISO(a.createdAt),
        txHash: a.createdAtTransaction || '',
        data: {
          nounId: Number(a.nounId),
          winner: a.winner || '',
          amount: String(a.amount || '0'),
          settler: a.settler ?? null,
          // NounV2 AH has no burn / treasury-routing path we index; a zero
          // winner is the closest signal we have.
          burned: false,
          treasury: noWinner,
        },
      });
    } else {
      events.push({
        type: 'V2_AUCTION',
        blockNumber: Number(a.createdAtBlock),
        timestamp: tsToISO(a.createdAt),
        txHash: a.createdAtTransaction || '',
        data: {
          nounId: Number(a.nounId),
          startTime: new Date(a.startTime).getTime(),
          endTime: new Date(a.endTime).getTime(),
        },
      });
    }
  }

  const titleById = new Map<number, string>();
  for (const p of proposals) {
    const descText = p.description || '';
    const title = titleFromDescription(descText);
    titleById.set(Number(p.id), title);
    events.push({
      type: 'V2_PROP',
      blockNumber: Number(p.createdAtBlock),
      timestamp: tsToISO(p.createdAt),
      txHash: p.createdAtTransaction || '',
      data: {
        proposalId: Number(p.id),
        proposer: p.proposer,
        title,
        status: p.status,
        description: descText.slice(0, 4000),
      },
    });
  }

  for (const v of votes) {
    events.push({
      type: 'V2_VOTE',
      blockNumber: Number(v.createdAtBlock),
      timestamp: tsToISO(v.createdAt),
      txHash: v.createdAtTransaction || '',
      data: {
        voter: v.voter,
        proposalId: Number(v.proposalId),
        support: v.support,
        votes: v.votes,
        reason: v.reason || '',
      },
    });
  }

  // Status changes for proposals outside the recent page need a title lookup.
  const missing = [
    ...new Set(statusChanges.map(sc => sc.proposalId).filter(id => !titleById.has(Number(id)))),
  ];
  if (missing.length > 0) {
    try {
      const rows = await db
        .select({
          id: schema.nounV2Proposal.id,
          firstLine: sql<string>`split_part(regexp_replace(${schema.nounV2Proposal.description}, '^\\s+', ''), E'\\n', 1)`,
        })
        .from(schema.nounV2Proposal)
        .where(inArray(schema.nounV2Proposal.id, missing));
      for (const r of rows) titleById.set(Number(r.id), titleFromDescription(r.firstLine));
    } catch (err) {
      console.warn('[NounV2Feed] title lookup failed:', err);
    }
  }

  for (const sc of statusChanges) {
    const type = `V2_PROP_${sc.status}`;
    if (!(V2_TYPES as readonly string[]).includes(type)) continue;
    const id = Number(sc.proposalId);
    events.push({
      type,
      blockNumber: Number(sc.createdAtBlock),
      timestamp: tsToISO(sc.createdAt),
      txHash: sc.createdAtTransaction || '',
      data: { proposalId: id, title: titleById.get(id) ?? `Prop ${id}`, status: sc.status },
    });
  }

  events.sort((a, b) => b.blockNumber - a.blockNumber);
  const sliced = events.slice(0, limit);
  const oldestBlock = sliced.length > 0 ? sliced[sliced.length - 1]!.blockNumber : 0;
  return { events: sliced, hasMore: events.length > limit || more, oldestBlock };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const EMPTY: ActivityResponse = { events: [], hasMore: false, oldestBlock: 0 };

export function registerActivityRoutes(app: Hono) {
  app.get('/api/activity', async c => {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const beforeParam = c.req.query('before');
    const before = beforeParam ? BigInt(beforeParam) : undefined;
    const types =
      c.req
        .query('type')
        ?.split(',')
        .map(t => t.trim().toUpperCase())
        .filter(Boolean) || [];

    const addressParam = c.req.query('address')?.trim();
    if (addressParam && !/^0x[\da-f]{40}$/i.test(addressParam)) {
      return c.json({ error: 'address must be a 0x address' }, 400);
    }
    const address = addressParam ? lower(addressParam) : undefined;

    const key = `activity:${limit}:${before ?? 'latest'}:${types.join(',')}:${address ?? ''}`;
    const hit = cached(key);
    if (hit) return c.json(hit);

    try {
      return c.json(remember(key, await buildActivityFeed({ limit, before, types, address })));
    } catch (err) {
      console.error('[Activity] Error:', err);
      return c.json(EMPTY, 500);
    }
  });

  app.get('/api/nounv2-feed', async c => {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const beforeParam = c.req.query('before');
    const before = beforeParam ? BigInt(beforeParam) : undefined;

    const key = `v2:${limit}:${before ?? 'latest'}`;
    const hit = cached(key);
    if (hit) return c.json(hit);

    try {
      return c.json(remember(key, await buildNounV2Feed({ limit, before })));
    } catch (err) {
      console.error('[NounV2Feed] Error:', err);
      return c.json(EMPTY, 500);
    }
  });
}

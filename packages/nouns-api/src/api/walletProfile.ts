/**
 * /api/wallet/:identity/* — the per-wallet "gamer profile".
 *
 *   GET  /api/wallet/:identity/profile           everything a wallet has done in / around Nouns
 *   GET  /api/wallet/:identity/activity          per-wallet slice of the unified activity feed
 *   GET  /api/wallet/:identity/overview          stored AI overview (or null)
 *   POST /api/wallet/:identity/overview/refresh  regenerate the overview (1 per 20 min per wallet)
 *   GET  /api/wallet/:address/autopilot          signed voting prefs + AI recommendations
 *   PUT  /api/wallet/:address/autopilot          save prefs (EIP-191 signature required)
 *
 * `:identity` is a 0x address or an ENS name. Every address in a response is
 * lowercased. Every timestamp in a response is unix MILLISECONDS (`new Date(x)`
 * just works) — chain timestamps are normalised through `toUnixSeconds` because
 * the indexer historically stored seconds as ms.
 *
 * Data comes straight from the Ponder tables via drizzle, batched (one query per
 * table, `Promise.all`, every query fault-isolated). Nothing here is N+1.
 * Persistence for the overview + autopilot uses the agent memory store
 * (`wallet:<addr>` scope) — no new tables.
 */
import type { ActivityResponse } from './activityFeed.js';
import type { SQL } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { db as ponderDb } from 'ponder:api';

import { createHash } from 'node:crypto';

import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  max,
  min,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import schema from 'ponder:schema';
import {
  createPublicClient,
  decodeAbiParameters,
  getAddress,
  http,
  isAddress,
  toFunctionSelector,
  verifyMessage,
} from 'viem';
import { mainnet } from 'viem/chains';

import { hubGenerateFull } from '../agent/hubClient.js';
import { recall, remember } from '../agent/memory.js';
import { getPerson } from '../agent/peopleDb.js';

import {
  buildActivityFeed,
  checkTxForSale,
  fetchTerminatedBefore,
  latestIndexedBlock,
  proposalResult,
  REVOTE_RE,
  titleFromDescription,
  toUnixSeconds,
} from './activityFeed.js';
import { getFarcasterIdentity, resolveEnsToAddress } from './walletMap.js';

type Db = typeof ponderDb;
type Hex = `0x${string}`;

// ─── Constants ──────────────────────────────────────────────────────────────

const ZERO = '0x0000000000000000000000000000000000000000';
const AUCTION_HOUSE = '0x830bd73e4184cef73443c15111a1df14e495c706';
/**
 * NounsToken mints every noun to its owner() (the treasury) and then transfers
 * it to the recipient in the same tx — so `noun.mintedTo` is always a treasury
 * address. Nounder reward nouns (#0, #10, … ≤ #1820) are the treasury→recipient
 * transfers of those ids.
 */
const TREASURIES: Hex[] = [
  '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71', // nouns.eth (timelock v1)
  '0x0bc3807ec262cb779b38d65b38158acc3bfede10', // NounsDAOExecutorV2
];
const LAST_NOUNDER_NOUN = 1820n;
/** Nouns Payer — pays USDC via `sendOrRegisterDebt(address,uint256)`. */
const PAYER = '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

/** Tokens we can label / denominate. Anything else is reported by address. */
const TOKENS: Record<string, { symbol: string; decimals: number; ethLike: boolean }> = {
  [USDC]: { symbol: 'USDC', decimals: 6, ethLike: false },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18, ethLike: true },
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { symbol: 'stETH', decimals: 18, ethLike: true },
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { symbol: 'wstETH', decimals: 18, ethLike: true },
  '0xae78736cd615f374d3085123a210448e74fc6393': { symbol: 'rETH', decimals: 18, ethLike: true },
};

/** "OG" = first on-chain Nouns touch before this block (≈ Nov 2021). */
const OG_BLOCK = 13_500_000n;

const PROFILE_TTL = 60_000;
const PROFILE_CACHE_MAX = 200;
const IDENTITY_TTL = 3_600_000;
const OVERVIEW_REFRESH_INTERVAL = 20 * 60_000;
const AUTOPILOT_NONCE_WINDOW = 10 * 60_000;
const AUTOPILOT_MAX_HUB_CALLS = 8;

const MAINNET_RPC = process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com';
const client = createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC) });

// ─── Small helpers ──────────────────────────────────────────────────────────

const lower = (a: string | null | undefined) => (a || '').toLowerCase();
/** Chain timestamp → unix ms. */
const ms = (ts: unknown): number => toUnixSeconds(ts) * 1000;
const eth = (wei: bigint | string | number | null | undefined): number =>
  wei == null ? 0 : Number(wei) / 1e18;
const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** First line of a description, computed in SQL so we never ship whole bodies. */
const firstLineOf = (col: SQL.Aliased | SQL | unknown) =>
  sql<string>`split_part(regexp_replace(${col}, '^\\s+', ''), E'\\n', 1)`;

/** Fault isolation: a failing table degrades to `fallback`, never the whole profile. */
async function safe<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.warn(`[walletProfile] ${label} failed:`, err);
    return fallback;
  }
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

// ─── Identity ───────────────────────────────────────────────────────────────

/** 0x address (any case) or ENS name → lowercased address, or null. */
export async function resolveIdentity(identity: string): Promise<Hex | null> {
  const raw = identity.trim();
  if (!raw) return null;
  if (isAddress(raw)) return raw.toLowerCase() as Hex;
  if (raw.startsWith('0x')) return null;
  const name = raw.includes('.') ? raw : `${raw}.eth`;
  const resolved = await resolveEnsToAddress(name);
  return resolved && isAddress(resolved) ? (resolved.toLowerCase() as Hex) : null;
}

const ensNameCache = new Map<string, { at: number; name: string | null }>();
async function reverseEns(address: Hex): Promise<string | null> {
  const hit = ensNameCache.get(address);
  if (hit && Date.now() - hit.at < IDENTITY_TTL) return hit.name;
  let name: string | null = null;
  try {
    name = (await client.getEnsName({ address: getAddress(address) })) || null;
  } catch {
    name = null;
  }
  if (ensNameCache.size > 2000) ensNameCache.clear();
  ensNameCache.set(address, { at: Date.now(), name });
  return name;
}

type Farcaster = { fid: number; username: string; displayName: string } | null;
const farcasterCache = new Map<string, { at: number; value: Farcaster }>();
async function farcaster(address: Hex): Promise<Farcaster> {
  const hit = farcasterCache.get(address);
  if (hit && Date.now() - hit.at < IDENTITY_TTL) return hit.value;
  let value: Farcaster = null;
  try {
    const fc = await getFarcasterIdentity(address);
    value = fc ? { fid: fc.fid, username: fc.username, displayName: fc.displayName } : null;
  } catch {
    value = null;
  }
  if (farcasterCache.size > 2000) farcasterCache.clear();
  farcasterCache.set(address, { at: Date.now(), value });
  return value;
}

// ─── Proposal tx decoding (asks + treasury payments) ────────────────────────

const ADDRESS_UINT = [{ type: 'address' }, { type: 'uint256' }] as const;
const TRANSFER_SELECTOR = toFunctionSelector('transfer(address,uint256)');
const PAY_SELECTOR = toFunctionSelector('sendOrRegisterDebt(address,uint256)');

/** Decode `(address,uint256)` payloads: ERC20 transfer / Payer sendOrRegisterDebt. */
function decodeAddressAmount(
  signature: string,
  calldata: string,
): { to: string; amount: bigint } | null {
  try {
    let params = calldata as Hex;
    if (signature) {
      if (!/^(transfer|sendOrRegisterDebt)\(address,uint256\)$/.test(signature)) return null;
    } else {
      const selector = calldata.slice(0, 10).toLowerCase();
      if (selector !== TRANSFER_SELECTOR && selector !== PAY_SELECTOR) return null;
      params = `0x${calldata.slice(10)}`;
    }
    const [to, amount] = decodeAbiParameters(ADDRESS_UINT, params);
    return { to: lower(to), amount };
  } catch {
    return null;
  }
}

interface AskTotals {
  eth: number;
  usdc: number;
}

/** Sum what a set of proposal transactions asks for, in ETH (+ETH-likes) and USDC. */
function sumAsks(
  txs: Array<{ target: string; value: bigint; signature: string; calldata: string }>,
): AskTotals {
  const out: AskTotals = { eth: 0, usdc: 0 };
  for (const tx of txs) {
    out.eth += eth(tx.value);
    const target = lower(tx.target);
    const token = TOKENS[target];
    if (target === PAYER || token) {
      const decoded = decodeAddressAmount(tx.signature, tx.calldata);
      if (!decoded) continue;
      if (target === PAYER || target === USDC) out.usdc += Number(decoded.amount) / 1e6;
      else if (token?.ethLike) out.eth += Number(decoded.amount) / 10 ** token.decimals;
    }
  }
  return out;
}

// ─── Profile types (the contract the webapp codes against) ─────────────────

export interface VoteRecent {
  proposalId: number;
  title: string;
  support: number;
  votes: number;
  reason: string;
  timestamp: number;
  txHash: string;
  clientId: number | null;
  proposalStatus: string;
  proposalResult: 'succeeded' | 'defeated' | 'pending' | null;
  alignedWithOutcome: boolean | null;
}

export interface WalletProfile {
  identity: {
    address: string;
    ens: string | null;
    farcaster: Farcaster;
    tags: string[];
    aliases: string[];
    associatedWallets: string[];
    firstSeen: { block: number; timestamp: number } | null;
    lastActive: { block: number; timestamp: number } | null;
    summary: string | null;
  };
  holdings: {
    nouns: Array<{
      nounId: number;
      seed: { background: number; body: number; accessory: number; glasses: number; head: number };
      since: number | null;
    }>;
    count: number;
    delegate: string | null;
    delegatedVotes: number;
    representsNouns: number[];
    delegators: string[];
  };
  voting: {
    total: number;
    for: number;
    against: number;
    abstain: number;
    withReason: number;
    participationPct: number | null;
    avgWeight: number;
    firstVote: number | null;
    lastVote: number | null;
    streakCurrent: number;
    byClient: Array<{ clientId: number | null; count: number }>;
    revotes: number;
    recent: VoteRecent[];
  };
  proposals: {
    authored: Array<{
      id: number;
      title: string;
      status: string;
      forVotes: number;
      againstVotes: number;
      abstainVotes: number;
      createdAt: number;
      executed: boolean;
      result: 'succeeded' | 'defeated' | 'pending' | null;
    }>;
    signed: Array<{ id: number; title: string; status: string }>;
    passRate: number | null;
    totalRequestedEth: number | null;
    totalRequestedUsdc: number | null;
  };
  candidates: {
    authored: Array<{
      id: string;
      slug: string;
      title: string;
      createdAt: number;
      canceled: boolean;
      promotedToProposalId: number | null;
      sponsorCount: number;
    }>;
    sponsored: Array<{
      candidateId: string;
      title: string;
      reason: string;
      createdAt: number;
      canceled: boolean;
      expirationTimestamp: number;
    }>;
    feedbackGiven: number;
    proposalFeedbackGiven: number;
  };
  auctions: {
    won: Array<{ nounId: number; amountEth: number; timestamp: number; clientId: number | null }>;
    wonCount: number;
    totalSpentEth: number;
    settled: number;
    curated: number[];
    bids: { count: number; totalEth: number; extendedCount: number; nounsBidOn: number };
    nounderRewards: number;
  };
  transfers: {
    received: number;
    sent: number;
    sales: Array<{
      nounId: number;
      priceEth: number;
      marketplace: string;
      side: 'buy' | 'sell';
      counterparty: string;
      timestamp: number;
    }>;
  };
  treasury: {
    streams: Array<{
      streamAddress: string;
      proposalId: number | null;
      tokenAddress: string;
      tokenSymbol: string;
      totalAmount: number;
      withdrawnAmount: number;
      status: string;
    }>;
    totalReceivedUsdc: number;
    totalReceivedEth: number;
    grants: { authored: number; votes: number };
  };
  forks: Array<{ forkId: number; kind: string; nounIds: number[]; timestamp: number }>;
  v2: {
    votes: number;
    for: number;
    against: number;
    abstain: number;
    proposalsAuthored: number;
    auctionsWon: number;
    bids: number;
    settled: number;
  };
  delegationHistory: Array<{
    kind: 'delegate' | 'undelegate' | 'redelegate';
    fromDelegate: string;
    toDelegate: string;
    nounCount: number;
    timestamp: number;
  }>;
  overview: Overview | null;
  autopilot: { enabled: boolean; updatedAt: number | null };
  badges: string[];
}

export interface Overview {
  text: string;
  generatedAt: number;
  model: string;
}

// ─── Profile builder ────────────────────────────────────────────────────────

function parseIdList(json: string | null | undefined): number[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

/** Track the earliest / latest (block, timestamp) across every activity table. */
class Span {
  first: { block: number; timestamp: number } | null = null;
  last: { block: number; timestamp: number } | null = null;
  add(block: unknown, ts: unknown) {
    const b = num(block);
    if (b <= 0) return;
    const t = ms(ts);
    if (!this.first || b < this.first.block) this.first = { block: b, timestamp: t };
    if (!this.last || b > this.last.block) this.last = { block: b, timestamp: t };
  }
}

const aggBlocks = <T extends { createdAtBlock: unknown; createdAt: unknown }>(t: T) => ({
  n: count(),
  minBlock: min(t.createdAtBlock as never),
  maxBlock: max(t.createdAtBlock as never),
  minAt: min(t.createdAt as never),
  maxAt: max(t.createdAt as never),
});

/**
 * Badges (derived, cheap, documented here so the UI can map them):
 *   nounder     nouns were minted directly to this wallet (nounders.eth reward mints)
 *   og          first on-chain Nouns touch before block 13.5M (≈ Nov 2021)
 *   whale       holds ≥ 10 nouns
 *   collector   won ≥ 5 auctions
 *   delegate    represents nouns delegated by other wallets
 *   builder     ≥ 1 authored proposal executed
 *   proposer    ≥ 3 authored proposals
 *   sponsor     ≥ 5 candidate sponsorships
 *   settler     settled ≥ 10 auctions
 *   voter-10 / voter-100 / voter-500   vote-count milestones (highest only)
 *   streak-10   currently voted on ≥ 10 consecutive proposals
 *   reasoner    ≥ 50% of votes carry a reason (min 10 votes)
 *   contrarian  ≥ 30% of decided votes went against the outcome (min 20 decided)
 *   funded      received a treasury stream or direct treasury payment
 *   forker      escrowed to / joined a fork
 *   v2          any NounV2 activity
 */
function deriveBadges(p: Omit<WalletProfile, 'badges' | 'overview' | 'autopilot'>): string[] {
  const b: string[] = [];
  if (p.auctions.nounderRewards > 0) b.push('nounder');
  if (p.identity.firstSeen && BigInt(p.identity.firstSeen.block) < OG_BLOCK) b.push('og');
  if (p.holdings.count >= 10) b.push('whale');
  if (p.auctions.wonCount >= 5) b.push('collector');
  if (p.holdings.delegators.length > 0) b.push('delegate');
  if (p.proposals.authored.some(x => x.executed)) b.push('builder');
  if (p.proposals.authored.length >= 3) b.push('proposer');
  if (p.candidates.sponsored.length >= 5) b.push('sponsor');
  if (p.auctions.settled >= 10) b.push('settler');
  const v = p.voting.total;
  if (v >= 500) b.push('voter-500');
  else if (v >= 100) b.push('voter-100');
  else if (v >= 10) b.push('voter-10');
  if (p.voting.streakCurrent >= 10) b.push('streak-10');
  if (v >= 10 && p.voting.withReason / v >= 0.5) b.push('reasoner');
  const decided = p.voting.recent.filter(r => r.alignedWithOutcome !== null);
  if (decided.length >= 20) {
    const against = decided.filter(r => r.alignedWithOutcome === false).length;
    if (against / decided.length >= 0.3) b.push('contrarian');
  }
  if (
    p.treasury.streams.length > 0 ||
    p.treasury.totalReceivedEth > 0 ||
    p.treasury.totalReceivedUsdc > 0
  ) {
    b.push('funded');
  }
  if (p.forks.some(f => f.kind === 'escrow' || f.kind === 'join')) b.push('forker');
  if (p.v2.votes + p.v2.proposalsAuthored + p.v2.auctionsWon + p.v2.bids + p.v2.settled > 0) {
    b.push('v2');
  }
  return b;
}

export async function buildWalletProfile(db: Db, address: Hex): Promise<WalletProfile> {
  const A = address;
  const addrHexBody = A.slice(2);

  // ── Phase 1: everything that only needs the address ──────────────────────
  const [
    ens,
    fc,
    person,
    latestBlock,
    nouns,
    delegateRow,
    representsRows,
    accountDelegateRow,
    delegatorRows,
    votes,
    authored,
    signedRows,
    won,
    settledAgg,
    curatedRows,
    bidAgg,
    nounderRewardsAgg,
    inAgg,
    outAgg,
    recentTransfers,
    streams,
    forks,
    delegationEvents,
    candidates,
    sponsorships,
    candidateFeedbackAgg,
    proposalFeedbackAgg,
    grantsAuthoredAgg,
    grantVotesAgg,
    v2Votes,
    v2PropsAgg,
    v2WonAgg,
    v2BidsAgg,
    v2SettledAgg,
    treasuryTxs,
    overview,
    autopilot,
  ] = await Promise.all([
    safe('ens', reverseEns(A), null),
    safe('farcaster', farcaster(A), null),
    safe('peopleDb', getPerson(A), null),
    safe('latestBlock', latestIndexedBlock(), 0n),
    safe('nouns', db.select().from(schema.noun).where(eq(schema.noun.owner, A)).limit(500), []),
    safe(
      'delegate',
      db.select().from(schema.delegate).where(eq(schema.delegate.id, A)).limit(1),
      [],
    ),
    safe(
      'delegateNoun',
      db
        .select({ nounId: schema.delegateNoun.nounId })
        .from(schema.delegateNoun)
        .where(eq(schema.delegateNoun.delegateId, A))
        .limit(1000),
      [],
    ),
    safe(
      'accountDelegate',
      db
        .select()
        .from(schema.accountDelegate)
        .where(eq(schema.accountDelegate.account, A))
        .limit(1),
      [],
    ),
    safe(
      'delegators',
      db
        .select({ account: schema.accountDelegate.account })
        .from(schema.accountDelegate)
        .where(eq(schema.accountDelegate.delegate, A))
        .limit(500),
      [],
    ),
    safe(
      'votes',
      db
        .select({
          proposalId: schema.vote.proposalId,
          support: schema.vote.support,
          votes: schema.vote.votes,
          reason: schema.vote.reason,
          clientId: schema.vote.clientId,
          createdAt: schema.vote.createdAt,
          createdAtBlock: schema.vote.createdAtBlock,
          createdAtTransaction: schema.vote.createdAtTransaction,
        })
        .from(schema.vote)
        .where(eq(schema.vote.voter, A))
        .orderBy(desc(schema.vote.createdAtBlock))
        .limit(3000),
      [],
    ),
    safe(
      'authored',
      db
        .select({
          id: schema.proposal.id,
          title: firstLineOf(schema.proposal.description),
          status: schema.proposal.status,
          forVotes: schema.proposal.forVotes,
          againstVotes: schema.proposal.againstVotes,
          abstainVotes: schema.proposal.abstainVotes,
          quorumVotes: schema.proposal.quorumVotes,
          endBlock: schema.proposal.endBlock,
          objectionPeriodEndBlock: schema.proposal.objectionPeriodEndBlock,
          createdAt: schema.proposal.createdAt,
          createdAtBlock: schema.proposal.createdAtBlock,
        })
        .from(schema.proposal)
        .where(eq(schema.proposal.proposer, A))
        .orderBy(desc(schema.proposal.id))
        .limit(300),
      [],
    ),
    safe(
      'signed',
      db
        .select({ proposalId: schema.proposalSigner.proposalId })
        .from(schema.proposalSigner)
        .where(eq(schema.proposalSigner.signer, A))
        .limit(300),
      [],
    ),
    safe(
      'won',
      db
        .select({
          nounId: schema.auction.nounId,
          amount: schema.auction.amount,
          settledAt: schema.auction.settledAt,
          settledAtBlock: schema.auction.settledAtBlock,
          endTime: schema.auction.endTime,
          clientId: schema.auction.clientId,
        })
        .from(schema.auction)
        .where(eq(schema.auction.winner, A))
        .orderBy(desc(schema.auction.nounId))
        .limit(500),
      [],
    ),
    safe(
      'settled',
      db
        .select({
          n: count(),
          minBlock: min(schema.auction.settledAtBlock),
          maxBlock: max(schema.auction.settledAtBlock),
          minAt: min(schema.auction.settledAt),
          maxAt: max(schema.auction.settledAt),
        })
        .from(schema.auction)
        .where(eq(schema.auction.settler, A)),
      [],
    ),
    safe(
      'curated',
      db
        .select({ nounId: schema.auction.nounId })
        .from(schema.auction)
        .where(eq(schema.auction.curator, A))
        .orderBy(desc(schema.auction.nounId))
        .limit(1000),
      [],
    ),
    safe(
      'bids',
      db
        .select({
          ...aggBlocks(schema.bid),
          total: sum(schema.bid.value),
          extended: sql<number>`count(*) filter (where ${schema.bid.extended})`,
          nounsBidOn: countDistinct(schema.bid.nounId),
        })
        .from(schema.bid)
        .where(eq(schema.bid.bidder, A)),
      [],
    ),
    safe(
      'nounderRewards',
      db
        .select({ n: count() })
        .from(schema.nounTransfer)
        .where(
          and(
            eq(schema.nounTransfer.to, A),
            inArray(schema.nounTransfer.from, TREASURIES),
            sql`${schema.nounTransfer.nounId} % 10 = 0`,
            lte(schema.nounTransfer.nounId, LAST_NOUNDER_NOUN),
          ),
        ),
      [],
    ),
    safe(
      'transfersIn',
      db
        .select(aggBlocks(schema.nounTransfer))
        .from(schema.nounTransfer)
        .where(eq(schema.nounTransfer.to, A)),
      [],
    ),
    safe(
      'transfersOut',
      db
        .select(aggBlocks(schema.nounTransfer))
        .from(schema.nounTransfer)
        .where(eq(schema.nounTransfer.from, A)),
      [],
    ),
    safe(
      'recentTransfers',
      db
        .select()
        .from(schema.nounTransfer)
        .where(or(eq(schema.nounTransfer.from, A), eq(schema.nounTransfer.to, A)))
        .orderBy(desc(schema.nounTransfer.createdAtBlock))
        .limit(120),
      [],
    ),
    safe(
      'streams',
      db
        .select()
        .from(schema.stream)
        .where(eq(schema.stream.recipient, A))
        .orderBy(desc(schema.stream.createdAtBlock))
        .limit(100),
      [],
    ),
    safe(
      'forks',
      db
        .select()
        .from(schema.forkEvent)
        .where(eq(schema.forkEvent.owner, A))
        .orderBy(desc(schema.forkEvent.createdAtBlock))
        .limit(50),
      [],
    ),
    safe(
      'delegationEvents',
      db
        .select()
        .from(schema.delegationEvent)
        .where(eq(schema.delegationEvent.delegator, A))
        .orderBy(desc(schema.delegationEvent.createdAtBlock))
        .limit(20),
      [],
    ),
    safe(
      'candidates',
      db
        .select({
          id: schema.candidate.id,
          slug: schema.candidate.slug,
          title: firstLineOf(schema.candidate.description),
          createdAt: schema.candidate.createdAt,
          createdAtBlock: schema.candidate.createdAtBlock,
          canceled: schema.candidate.canceled,
          promotedToProposalId: schema.candidate.promotedToProposalId,
        })
        .from(schema.candidate)
        .where(eq(schema.candidate.proposer, A))
        .orderBy(desc(schema.candidate.createdAtBlock))
        .limit(200),
      [],
    ),
    safe(
      'sponsorships',
      db
        .select({
          candidateId: schema.candidateSignature.candidateId,
          reason: schema.candidateSignature.reason,
          canceled: schema.candidateSignature.canceled,
          expirationTimestamp: schema.candidateSignature.expirationTimestamp,
          createdAt: schema.candidateSignature.createdAt,
          createdAtBlock: schema.candidateSignature.createdAtBlock,
        })
        .from(schema.candidateSignature)
        .where(eq(schema.candidateSignature.signer, A))
        .orderBy(desc(schema.candidateSignature.createdAtBlock))
        .limit(200),
      [],
    ),
    safe(
      'candidateFeedback',
      db
        .select({ n: count() })
        .from(schema.candidateFeedback)
        .where(eq(schema.candidateFeedback.voter, A)),
      [],
    ),
    safe(
      'proposalFeedback',
      db
        .select({ n: count() })
        .from(schema.proposalFeedback)
        .where(eq(schema.proposalFeedback.voter, A)),
      [],
    ),
    safe(
      'grantsAuthored',
      db.select({ n: count() }).from(schema.grant).where(eq(schema.grant.proposer, A)),
      [],
    ),
    safe(
      'grantVotes',
      db.select({ n: count() }).from(schema.grantVote).where(eq(schema.grantVote.voter, A)),
      [],
    ),
    safe(
      'v2Votes',
      db
        .select({ support: schema.nounV2Vote.support })
        .from(schema.nounV2Vote)
        .where(eq(schema.nounV2Vote.voter, A))
        .limit(3000),
      [],
    ),
    safe(
      'v2Props',
      db
        .select({ n: count() })
        .from(schema.nounV2Proposal)
        .where(eq(schema.nounV2Proposal.proposer, A)),
      [],
    ),
    safe(
      'v2Won',
      db
        .select({ n: count() })
        .from(schema.nounV2Auction)
        .where(eq(schema.nounV2Auction.winner, A)),
      [],
    ),
    safe(
      'v2Bids',
      db.select({ n: count() }).from(schema.nounV2Bid).where(eq(schema.nounV2Bid.bidder, A)),
      [],
    ),
    safe(
      'v2Settled',
      db
        .select({ n: count() })
        .from(schema.nounV2Auction)
        .where(eq(schema.nounV2Auction.settler, A)),
      [],
    ),
    // Proposal txs that pay this wallet: direct ETH (target = wallet) or an
    // (address,uint256) payload whose padded address contains the wallet.
    safe(
      'treasuryTxs',
      db
        .select()
        .from(schema.transaction)
        .where(
          or(
            eq(schema.transaction.target, A),
            like(schema.transaction.calldata, `%${addrHexBody}%`),
          ),
        )
        .limit(500),
      [],
    ),
    safe('overview', readOverview(A), null),
    safe('autopilot', readAutopilot(A), null),
  ]);

  // ── Phase 2: lookups that depend on phase-1 ids ──────────────────────────
  const ownedIds = nouns.map(n => n.id);
  const ownedSet = new Set(ownedIds.map(Number));
  const recentVotes = votes.slice(0, 50);
  const signedIds = signedRows.map(s => s.proposalId);
  const metaIds = [...new Set([...recentVotes.map(v => v.proposalId), ...signedIds])];
  const authoredIds = authored.map(p => p.id);
  const candidateIds = candidates.map(c => c.id);
  const sponsoredIds = [...new Set(sponsorships.map(s => s.candidateId))];
  const treasuryPropIds = [...new Set(treasuryTxs.map(t => t.proposalId))];
  const firstVoteBlock = votes.length > 0 ? votes[votes.length - 1]!.createdAtBlock : null;

  const [
    terminatedAt,
    proposalMeta,
    heldSince,
    sponsorCounts,
    sponsoredMeta,
    askTxs,
    treasuryPropStatus,
    proposalsSinceFirstVote,
    streakWindow,
  ] = await Promise.all([
    safe(
      'terminatedAt',
      fetchTerminatedBefore([...new Set([...metaIds, ...authoredIds])]),
      new Map<bigint, bigint>(),
    ),
    safe(
      'proposalMeta',
      metaIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: schema.proposal.id,
              title: firstLineOf(schema.proposal.description),
              status: schema.proposal.status,
              forVotes: schema.proposal.forVotes,
              againstVotes: schema.proposal.againstVotes,
              quorumVotes: schema.proposal.quorumVotes,
              endBlock: schema.proposal.endBlock,
              objectionPeriodEndBlock: schema.proposal.objectionPeriodEndBlock,
            })
            .from(schema.proposal)
            .where(inArray(schema.proposal.id, metaIds)),
      [],
    ),
    safe(
      'heldSince',
      ownedIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              nounId: schema.nounTransfer.nounId,
              createdAt: schema.nounTransfer.createdAt,
              createdAtBlock: schema.nounTransfer.createdAtBlock,
            })
            .from(schema.nounTransfer)
            .where(
              and(eq(schema.nounTransfer.to, A), inArray(schema.nounTransfer.nounId, ownedIds)),
            )
            .orderBy(desc(schema.nounTransfer.createdAtBlock))
            .limit(1000),
      [],
    ),
    safe(
      'sponsorCounts',
      candidateIds.length === 0
        ? Promise.resolve([])
        : db
            .select({ candidateId: schema.candidateSignature.candidateId, n: count() })
            .from(schema.candidateSignature)
            .where(
              and(
                inArray(schema.candidateSignature.candidateId, candidateIds),
                eq(schema.candidateSignature.canceled, false),
              ),
            )
            .groupBy(schema.candidateSignature.candidateId),
      [],
    ),
    safe(
      'sponsoredMeta',
      sponsoredIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: schema.candidate.id,
              title: firstLineOf(schema.candidate.description),
              canceled: schema.candidate.canceled,
            })
            .from(schema.candidate)
            .where(inArray(schema.candidate.id, sponsoredIds)),
      [],
    ),
    safe(
      'askTxs',
      authoredIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(schema.transaction)
            .where(inArray(schema.transaction.proposalId, authoredIds))
            .limit(2000),
      [],
    ),
    safe(
      'treasuryPropStatus',
      treasuryPropIds.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: schema.proposal.id, status: schema.proposal.status })
            .from(schema.proposal)
            .where(inArray(schema.proposal.id, treasuryPropIds)),
      [],
    ),
    safe(
      'proposalsSinceFirstVote',
      firstVoteBlock == null
        ? Promise.resolve([])
        : db
            .select({ n: count() })
            .from(schema.proposal)
            .where(gte(schema.proposal.createdAtBlock, firstVoteBlock)),
      [],
    ),
    safe(
      'streakWindow',
      db
        .select({
          id: schema.proposal.id,
          status: schema.proposal.status,
          startBlock: schema.proposal.startBlock,
          endBlock: schema.proposal.endBlock,
          objectionPeriodEndBlock: schema.proposal.objectionPeriodEndBlock,
        })
        .from(schema.proposal)
        .orderBy(desc(schema.proposal.id))
        .limit(150),
      [],
    ),
  ]);

  // ── Identity ────────────────────────────────────────────────────────────
  const span = new Span();
  for (const v of votes) span.add(v.createdAtBlock, v.createdAt);
  for (const p of authored) span.add(p.createdAtBlock, p.createdAt);
  for (const c of candidates) span.add(c.createdAtBlock, c.createdAt);
  for (const s of sponsorships) span.add(s.createdAtBlock, s.createdAt);
  for (const d of delegationEvents) span.add(d.createdAtBlock, d.createdAt);
  for (const f of forks) span.add(f.createdAtBlock, f.createdAt);
  for (const s of streams) span.add(s.createdAtBlock, s.createdAt);
  for (const w of won) span.add(w.settledAtBlock, w.settledAt ?? w.endTime);
  for (const n of nouns) if (lower(n.mintedTo) === A) span.add(n.createdAtBlock, n.createdAt);
  for (const agg of [bidAgg[0], inAgg[0], outAgg[0], settledAgg[0]]) {
    if (!agg || num(agg.n) === 0) continue;
    span.add(agg.minBlock, agg.minAt);
    span.add(agg.maxBlock, agg.maxAt);
  }

  // ── Holdings ────────────────────────────────────────────────────────────
  const sinceByNoun = new Map<number, number>();
  for (const t of heldSince) {
    const id = Number(t.nounId);
    if (!sinceByNoun.has(id)) sinceByNoun.set(id, ms(t.createdAt));
  }
  const delegateTo = accountDelegateRow[0] ? lower(accountDelegateRow[0].delegate) : null;
  const holdings: WalletProfile['holdings'] = {
    nouns: nouns
      .map(n => ({
        nounId: Number(n.id),
        seed: {
          background: n.background,
          body: n.body,
          accessory: n.accessory,
          glasses: n.glasses,
          head: n.head,
        },
        since: sinceByNoun.get(Number(n.id)) ?? null,
      }))
      .sort((a, b) => a.nounId - b.nounId),
    count: nouns.length,
    delegate: delegateTo && delegateTo !== A ? delegateTo : null,
    delegatedVotes: delegateRow[0]?.delegatedVotes ?? 0,
    representsNouns: representsRows
      .map(r => Number(r.nounId))
      .filter(id => !ownedSet.has(id))
      .sort((a, b) => a - b),
    delegators: delegatorRows.map(r => lower(r.account)).filter(a => a !== A),
  };

  // ── Voting ──────────────────────────────────────────────────────────────
  const metaById = new Map(proposalMeta.map(m => [Number(m.id), m]));
  const byClientMap = new Map<number | null, number>();
  let forN = 0;
  let againstN = 0;
  let abstainN = 0;
  let withReason = 0;
  let revotes = 0;
  let weight = 0;
  for (const v of votes) {
    if (v.support === 1) forN++;
    else if (v.support === 0) againstN++;
    else abstainN++;
    const reason = (v.reason || '').trim();
    if (reason) withReason++;
    if (REVOTE_RE.test(reason)) revotes++;
    weight += v.votes;
    byClientMap.set(v.clientId ?? null, (byClientMap.get(v.clientId ?? null) ?? 0) + 1);
  }
  const votedIds = new Set(votes.map(v => Number(v.proposalId)));

  const recent: VoteRecent[] = recentVotes.map(v => {
    const m = metaById.get(Number(v.proposalId));
    const result = m ? proposalResult(m, latestBlock, terminatedAt.get(m.id) ?? null) : null;
    let aligned: boolean | null = null;
    if (result === 'succeeded' && v.support !== 2) aligned = v.support === 1;
    else if (result === 'defeated' && v.support !== 2) aligned = v.support === 0;
    return {
      proposalId: Number(v.proposalId),
      title: titleFromDescription(m?.title) || `Prop ${v.proposalId}`,
      support: v.support,
      votes: v.votes,
      reason: v.reason || '',
      timestamp: ms(v.createdAt),
      txHash: v.createdAtTransaction || '',
      clientId: v.clientId ?? null,
      proposalStatus: m?.status ?? 'UNKNOWN',
      proposalResult: result,
      alignedWithOutcome: aligned,
    };
  });

  // Streak: walk newest→oldest over proposals whose vote has opened; a still-open
  // proposal without a vote doesn't break it (they may yet vote).
  let streak = 0;
  for (const p of streakWindow) {
    if (p.status === 'CANCELLED' || p.status === 'VETOED') continue;
    if (latestBlock > 0n && p.startBlock > latestBlock) continue;
    if (votedIds.has(Number(p.id))) {
      streak++;
      continue;
    }
    const end =
      p.objectionPeriodEndBlock && p.objectionPeriodEndBlock > p.endBlock
        ? p.objectionPeriodEndBlock
        : p.endBlock;
    if (latestBlock > 0n && end >= latestBlock) continue; // still open — skip
    break;
  }

  const proposalsSince = num(proposalsSinceFirstVote[0]?.n);
  const voting: WalletProfile['voting'] = {
    total: votes.length,
    for: forN,
    against: againstN,
    abstain: abstainN,
    withReason,
    participationPct:
      votes.length > 0 && proposalsSince > 0
        ? Math.min(100, Math.round((votes.length / proposalsSince) * 1000) / 10)
        : null,
    avgWeight: votes.length > 0 ? Math.round((weight / votes.length) * 100) / 100 : 0,
    firstVote: votes.length > 0 ? ms(votes[votes.length - 1]!.createdAt) : null,
    lastVote: votes.length > 0 ? ms(votes[0]!.createdAt) : null,
    streakCurrent: streak,
    byClient: [...byClientMap.entries()]
      .map(([clientId, n]) => ({ clientId, count: n }))
      .sort((a, b) => b.count - a.count),
    revotes,
    recent,
  };

  // ── Proposals ───────────────────────────────────────────────────────────
  const authoredOut = authored.map(p => ({
    id: Number(p.id),
    title: titleFromDescription(p.title) || `Prop ${p.id}`,
    status: p.status,
    forVotes: p.forVotes,
    againstVotes: p.againstVotes,
    abstainVotes: p.abstainVotes,
    createdAt: ms(p.createdAt),
    executed: p.status === 'EXECUTED',
    result: proposalResult(p, latestBlock, terminatedAt.get(p.id) ?? null),
  }));
  const decidedAuthored = authoredOut.filter(
    p => p.result === 'succeeded' || p.result === 'defeated',
  );
  const asks = sumAsks(askTxs);
  const proposals: WalletProfile['proposals'] = {
    authored: authoredOut,
    signed: signedIds
      .map(id => {
        const m = metaById.get(Number(id));
        return {
          id: Number(id),
          title: titleFromDescription(m?.title) || `Prop ${id}`,
          status: m?.status ?? 'UNKNOWN',
        };
      })
      .sort((a, b) => b.id - a.id),
    passRate:
      decidedAuthored.length > 0
        ? Math.round(
            (decidedAuthored.filter(p => p.result === 'succeeded').length /
              decidedAuthored.length) *
              1000,
          ) / 10
        : null,
    totalRequestedEth: authoredIds.length > 0 ? Math.round(asks.eth * 1000) / 1000 : null,
    totalRequestedUsdc: authoredIds.length > 0 ? Math.round(asks.usdc * 100) / 100 : null,
  };

  // ── Candidates ──────────────────────────────────────────────────────────
  const sponsorCountById = new Map(sponsorCounts.map(r => [r.candidateId, num(r.n)]));
  const sponsoredMetaById = new Map(sponsoredMeta.map(m => [m.id, m]));
  const candidatesOut: WalletProfile['candidates'] = {
    authored: candidates.map(c => ({
      id: c.id,
      slug: c.slug,
      title: titleFromDescription(c.title) || c.slug,
      createdAt: ms(c.createdAt),
      canceled: c.canceled,
      promotedToProposalId: c.promotedToProposalId != null ? Number(c.promotedToProposalId) : null,
      sponsorCount: sponsorCountById.get(c.id) ?? 0,
    })),
    sponsored: sponsorships.map(s => {
      const m = sponsoredMetaById.get(s.candidateId);
      return {
        candidateId: s.candidateId,
        title: titleFromDescription(m?.title) || s.candidateId.split('-').slice(1).join('-'),
        reason: s.reason || '',
        createdAt: ms(s.createdAt),
        canceled: s.canceled || Boolean(m?.canceled),
        expirationTimestamp: Number(s.expirationTimestamp) * 1000,
      };
    }),
    feedbackGiven: num(candidateFeedbackAgg[0]?.n),
    proposalFeedbackGiven: num(proposalFeedbackAgg[0]?.n),
  };

  // ── Auctions ────────────────────────────────────────────────────────────
  const bids = bidAgg[0];
  const auctions: WalletProfile['auctions'] = {
    won: won.map(w => ({
      nounId: Number(w.nounId),
      amountEth: eth(w.amount),
      timestamp: ms(w.settledAt ?? w.endTime),
      clientId: w.clientId ?? null,
    })),
    wonCount: won.length,
    totalSpentEth: Math.round(won.reduce((s, w) => s + eth(w.amount), 0) * 1000) / 1000,
    settled: num(settledAgg[0]?.n),
    curated: curatedRows.map(r => Number(r.nounId)),
    bids: {
      count: num(bids?.n),
      totalEth: Math.round(eth(bids?.total ?? 0) * 1000) / 1000,
      extendedCount: num(bids?.extended),
      nounsBidOn: num(bids?.nounsBidOn),
    },
    nounderRewards: num(nounderRewardsAgg[0]?.n),
  };

  // ── Transfers + marketplace sales ───────────────────────────────────────
  const marketTransfers = recentTransfers.filter(t => {
    const from = lower(t.from);
    const to = lower(t.to);
    return from !== ZERO && from !== AUCTION_HOUSE && to !== AUCTION_HOUSE;
  });
  const txHashes = [...new Set(marketTransfers.map(t => lower(t.createdAtTransaction)))]
    .filter(Boolean)
    .slice(0, 30);
  const saleByTx = new Map<string, { marketplace: string; priceWei: bigint }>();
  await Promise.all(
    txHashes.map(async h => {
      const s = await safe('sale', checkTxForSale(h), null);
      if (s) saleByTx.set(h, s);
    }),
  );
  const sales: WalletProfile['transfers']['sales'] = [];
  const seenSale = new Set<string>();
  for (const t of marketTransfers) {
    const h = lower(t.createdAtTransaction);
    const s = saleByTx.get(h);
    if (!s) continue;
    const key = `${h}:${t.nounId}`;
    if (seenSale.has(key)) continue;
    seenSale.add(key);
    const side: 'buy' | 'sell' = lower(t.to) === A ? 'buy' : 'sell';
    sales.push({
      nounId: Number(t.nounId),
      priceEth: eth(s.priceWei),
      marketplace: s.marketplace,
      side,
      counterparty: side === 'buy' ? lower(t.from) : lower(t.to),
      timestamp: ms(t.createdAt),
    });
    if (sales.length >= 50) break;
  }
  const transfers: WalletProfile['transfers'] = {
    received: num(inAgg[0]?.n),
    sent: num(outAgg[0]?.n),
    sales,
  };

  // ── Treasury ────────────────────────────────────────────────────────────
  const executedProps = new Set(
    treasuryPropStatus.filter(p => p.status === 'EXECUTED').map(p => Number(p.id)),
  );
  let receivedEth = 0;
  let receivedUsdc = 0;
  for (const tx of treasuryTxs) {
    if (!executedProps.has(Number(tx.proposalId))) continue;
    const target = lower(tx.target);
    if (target === A) {
      receivedEth += eth(tx.value);
      continue;
    }
    const token = TOKENS[target];
    if (target !== PAYER && !token) continue;
    const decoded = decodeAddressAmount(tx.signature, tx.calldata);
    if (!decoded || decoded.to !== A) continue;
    if (target === PAYER || target === USDC) receivedUsdc += Number(decoded.amount) / 1e6;
    else if (token?.ethLike) receivedEth += Number(decoded.amount) / 10 ** token.decimals;
  }
  const streamsOut = streams.map(s => {
    const token = TOKENS[lower(s.tokenAddress)];
    const decimals = token?.decimals ?? 18;
    const total = Number(s.tokenAmount) / 10 ** decimals;
    const withdrawn = Number(s.withdrawnAmount) / 10 ** decimals;
    if (token?.symbol === 'USDC') receivedUsdc += withdrawn;
    else if (token?.ethLike) receivedEth += withdrawn;
    return {
      streamAddress: lower(s.streamAddress),
      proposalId: s.proposalId != null ? Number(s.proposalId) : null,
      tokenAddress: lower(s.tokenAddress),
      tokenSymbol: token?.symbol ?? lower(s.tokenAddress).slice(0, 10),
      totalAmount: total,
      withdrawnAmount: withdrawn,
      status: s.status,
    };
  });
  const treasury: WalletProfile['treasury'] = {
    streams: streamsOut,
    totalReceivedUsdc: Math.round(receivedUsdc * 100) / 100,
    totalReceivedEth: Math.round(receivedEth * 1000) / 1000,
    grants: { authored: num(grantsAuthoredAgg[0]?.n), votes: num(grantVotesAgg[0]?.n) },
  };

  // ── Forks / V2 / delegation history ─────────────────────────────────────
  const forksOut = forks.map(f => ({
    forkId: f.forkId,
    kind: f.kind,
    nounIds: parseIdList(f.nounIds),
    timestamp: ms(f.createdAt),
  }));

  const v2: WalletProfile['v2'] = {
    votes: v2Votes.length,
    for: v2Votes.filter(v => v.support === 1).length,
    against: v2Votes.filter(v => v.support === 0).length,
    abstain: v2Votes.filter(v => v.support === 2).length,
    proposalsAuthored: num(v2PropsAgg[0]?.n),
    auctionsWon: num(v2WonAgg[0]?.n),
    bids: num(v2BidsAgg[0]?.n),
    settled: num(v2SettledAgg[0]?.n),
  };

  const delegationHistory: WalletProfile['delegationHistory'] = delegationEvents.map(d => {
    const from = lower(d.fromDelegate);
    const to = lower(d.toDelegate);
    let kind: 'delegate' | 'undelegate' | 'redelegate' = 'delegate';
    if (to === A) kind = 'undelegate';
    else if (from !== ZERO && from !== A) kind = 'redelegate';
    return {
      kind,
      fromDelegate: from,
      toDelegate: to,
      nounCount: d.nounCount ?? 0,
      timestamp: ms(d.createdAt),
    };
  });

  const core = {
    identity: {
      address: A,
      ens: ens ?? person?.ensName ?? null,
      farcaster: fc,
      tags: person?.tags ?? [],
      aliases: person?.aliases ?? [],
      associatedWallets: (person?.associatedWallets ?? []).map(lower).filter(a => a !== A),
      firstSeen: span.first,
      lastActive: span.last,
      summary: person?.profileSummary ?? null,
    },
    holdings,
    voting,
    proposals,
    candidates: candidatesOut,
    auctions,
    transfers,
    treasury,
    forks: forksOut,
    v2,
    delegationHistory,
  };

  return {
    ...core,
    overview,
    autopilot: { enabled: autopilot?.enabled ?? false, updatedAt: autopilot?.updatedAt ?? null },
    badges: deriveBadges(core),
  };
}

// ─── Profile cache ──────────────────────────────────────────────────────────

const profileCache = new Map<string, { at: number; data: WalletProfile }>();
const inflightProfiles = new Map<string, Promise<WalletProfile>>();

async function getProfile(db: Db, address: Hex, fresh = false): Promise<WalletProfile> {
  const hit = profileCache.get(address);
  if (!fresh && hit && Date.now() - hit.at < PROFILE_TTL) return hit.data;
  const running = inflightProfiles.get(address);
  if (running) return running;
  const p = buildWalletProfile(db, address)
    .then(data => {
      if (profileCache.size >= PROFILE_CACHE_MAX) {
        const oldest = profileCache.keys().next().value;
        if (oldest !== undefined) profileCache.delete(oldest);
      }
      profileCache.set(address, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflightProfiles.delete(address));
  inflightProfiles.set(address, p);
  return p;
}

// ─── AI overview ────────────────────────────────────────────────────────────

const scopeFor = (address: string) => `wallet:${lower(address)}`;

async function readJson<T>(address: string, key: string): Promise<T | null> {
  const rows = await recall(scopeFor(address), key);
  const raw = rows[0]?.content;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readOverview(address: string): Promise<Overview | null> {
  const o = await readJson<Overview>(address, 'overview');
  return o && typeof o.text === 'string' ? o : null;
}

/** Trim the profile to what the model needs: stats + recent reasons + outcomes. */
function overviewEvidence(p: WalletProfile): string {
  const name = p.identity.ens ?? p.identity.address;
  const lines: string[] = [];
  lines.push(`Wallet: ${name} (${p.identity.address})`);
  if (p.identity.farcaster) lines.push(`Farcaster: @${p.identity.farcaster.username}`);
  if (p.identity.tags.length) lines.push(`Tags: ${p.identity.tags.join(', ')}`);
  if (p.identity.aliases.length) lines.push(`Aliases: ${p.identity.aliases.join(', ')}`);
  if (p.identity.summary) lines.push(`Existing summary: ${p.identity.summary}`);
  if (p.identity.firstSeen) {
    lines.push(
      `First seen: ${new Date(p.identity.firstSeen.timestamp).toISOString().slice(0, 10)}`,
    );
  }
  if (p.identity.lastActive) {
    lines.push(
      `Last active: ${new Date(p.identity.lastActive.timestamp).toISOString().slice(0, 10)}`,
    );
  }
  lines.push(
    `Holdings: ${p.holdings.count} nouns; delegated votes represented: ${p.holdings.delegatedVotes}; ` +
      `delegates to: ${p.holdings.delegate ?? 'self'}; delegators: ${p.holdings.delegators.length}`,
  );
  lines.push(
    `Voting: ${p.voting.total} votes (${p.voting.for} for / ${p.voting.against} against / ${p.voting.abstain} abstain), ` +
      `${p.voting.withReason} with reason, avg weight ${p.voting.avgWeight}, participation ${p.voting.participationPct ?? 'n/a'}%, ` +
      `current streak ${p.voting.streakCurrent}, revotes ${p.voting.revotes}`,
  );
  const clients = p.voting.byClient
    .slice(0, 3)
    .map(c => `${c.clientId ?? 'unknown'}:${c.count}`)
    .join(', ');
  if (clients) lines.push(`Vote clients (clientId:count): ${clients}`);
  const decided = p.voting.recent.filter(r => r.alignedWithOutcome !== null);
  if (decided.length) {
    const aligned = decided.filter(r => r.alignedWithOutcome).length;
    lines.push(`Alignment with outcome (recent decided votes): ${aligned}/${decided.length}`);
  }
  lines.push(
    `Proposals authored: ${p.proposals.authored.length} (pass rate ${p.proposals.passRate ?? 'n/a'}%, ` +
      `asked ${p.proposals.totalRequestedEth ?? 0} ETH + ${p.proposals.totalRequestedUsdc ?? 0} USDC); signed: ${p.proposals.signed.length}`,
  );
  lines.push(
    `Candidates authored: ${p.candidates.authored.length}; sponsored: ${p.candidates.sponsored.length}; feedback given: ${p.candidates.feedbackGiven + p.candidates.proposalFeedbackGiven}`,
  );
  lines.push(
    `Auctions: won ${p.auctions.wonCount} (${p.auctions.totalSpentEth} ETH), ${p.auctions.bids.count} bids on ${p.auctions.bids.nounsBidOn} nouns, settled ${p.auctions.settled}, nounder rewards ${p.auctions.nounderRewards}`,
  );
  lines.push(
    `Transfers: ${p.transfers.received} in / ${p.transfers.sent} out; marketplace sales seen: ${p.transfers.sales.length}`,
  );
  lines.push(
    `Treasury: received ${p.treasury.totalReceivedEth} ETH + ${p.treasury.totalReceivedUsdc} USDC; streams: ${p.treasury.streams.length}; grants authored ${p.treasury.grants.authored}`,
  );
  if (p.forks.length) lines.push(`Forks: ${p.forks.map(f => `${f.kind}#${f.forkId}`).join(', ')}`);
  if (p.v2.votes + p.v2.auctionsWon + p.v2.bids + p.v2.proposalsAuthored > 0) {
    lines.push(
      `NounV2: ${p.v2.votes} votes, ${p.v2.proposalsAuthored} props, ${p.v2.auctionsWon} auctions won, ${p.v2.bids} bids`,
    );
  }
  lines.push(`Badges: ${p.badges.join(', ') || 'none'}`);

  if (p.proposals.authored.length) {
    lines.push('', 'Authored proposals (id · title · outcome):');
    for (const a of p.proposals.authored.slice(0, 25)) {
      lines.push(`- #${a.id} · ${a.title} · ${a.result ?? a.status.toLowerCase()}`);
    }
  }
  lines.push('', 'Last 30 votes (prop · support · outcome · reason):');
  const S = ['against', 'for', 'abstain'];
  for (const v of p.voting.recent.slice(0, 30)) {
    const reason = v.reason.replace(/\s+/g, ' ').trim().slice(0, 240);
    lines.push(
      `- #${v.proposalId} "${v.title.slice(0, 70)}" · ${S[v.support] ?? v.support} (${v.votes}) · ${v.proposalResult ?? 'n/a'}${reason ? ` · "${reason}"` : ''}`,
    );
  }
  return lines.join('\n');
}

const OVERVIEW_SYSTEM = `You write short, deadpan profiles of Nouns DAO wallets from their on-chain record.
Write exactly two short paragraphs, plain prose, no headings, no bullet lists, no hype, no adjectives you can't back with a number. Maximum 180 words total.
Paragraph 1: who this wallet is in Nouns — role (holder / delegate / builder / voter / bidder / settler), tenure, weight, how they got their nouns.
Paragraph 2: how they vote — patterns in what they fund or reject, reason-writing style (terse, essays, none), how often they land with the outcome, which clients they vote through — and one or two notable moments (a proposal they authored, a fork, a big auction).
Refer to the wallet by its ENS name when one is given, otherwise by its shortened address (0xabcd…1234). Never invent facts not in the evidence. If the record is thin, say so in one sentence rather than padding.`;

/**
 * The hub's /v1/generate routes task 'chat' to its premium tier, but Anthropic
 * is reserved for the terminal's /v1/chat unless GENERATE_ALLOW_ANTHROPIC=1 is
 * set on the hub — so today this lands on a reasoning model (gpt-oss-120b via
 * Groq) that spends `maxTokens` on hidden reasoning before answering. Give it
 * headroom, retry once with more if it comes back empty, and never persist an
 * empty answer.
 */
async function generateText(
  req: { system: string; user: string; temperature: number },
  maxTokens: number,
  retryMaxTokens: number,
): Promise<{ text: string; model: string }> {
  let res = await hubGenerateFull({ ...req, task: 'walletProfile', maxTokens });
  if (!stripFences(res.text)) {
    res = await hubGenerateFull({ ...req, task: 'walletProfile', maxTokens: retryMaxTokens });
  }
  const text = stripFences(res.text);
  if (!text) {
    throw new Error(
      `hub returned empty text (model=${res.model}, finishReason=${res.finishReason ?? 'unknown'})`,
    );
  }
  return { text, model: res.model || 'unknown' };
}

const overviewInflight = new Map<string, Promise<Overview & { cached: boolean }>>();

async function refreshOverview(db: Db, address: Hex): Promise<Overview & { cached: boolean }> {
  const existing = await readOverview(address);
  if (existing && Date.now() - existing.generatedAt < OVERVIEW_REFRESH_INTERVAL) {
    return { ...existing, cached: true };
  }
  const running = overviewInflight.get(address);
  if (running) return running;

  const job = (async () => {
    const profile = await getProfile(db, address);
    const res = await generateText(
      { system: OVERVIEW_SYSTEM, user: overviewEvidence(profile), temperature: 0.4 },
      1500,
      4000,
    );
    const text = res.text.replace(/\n{3,}/g, '\n\n');
    const overview: Overview = { text, generatedAt: Date.now(), model: res.model || 'unknown' };
    await remember(scopeFor(address), 'overview', JSON.stringify(overview));
    const cachedProfile = profileCache.get(address);
    if (cachedProfile) cachedProfile.data.overview = overview;
    return { ...overview, cached: false };
  })().finally(() => overviewInflight.delete(address));
  overviewInflight.set(address, job);
  return job;
}

// ─── Autopilot ──────────────────────────────────────────────────────────────
//
// PRODUCT NOTE — what "Autopilot" is today, and what it is not:
//   The website cannot cast votes from a user's EOA: it holds no key. So today
//   Autopilot = AI recommendations, generated from the wallet's signed
//   preferences + its own voting history, which the user confirms with one
//   click (the webapp turns each recommendation into a signable
//   `castRefundableVoteWithReason` tx). True hands-off voting would need the
//   user to delegate to a per-user vote-proxy contract that the nounirl relayer
//   can drive — that is NOT part of this task.
//
// Preferences are saved with an EIP-191 signature over a fixed message:
//   noun.wtf autopilot\naddress: <lowercase addr>\nnonce: <unix ms>\nprefs: <sha256 hex of JSON.stringify(prefs)>
// The client MUST hash the exact `prefs` object it sends (same key order) —
// the server hashes the raw body object, then validates it.

export type Stance = -2 | -1 | 0 | 1 | 2;
export const STANCE_KEYS = [
  'art',
  'infrastructure',
  'events',
  'media',
  'grants',
  'protocolChanges',
  'treasuryOps',
] as const;
export type StanceKey = (typeof STANCE_KEYS)[number];

export interface AutopilotPrefs {
  philosophy: string;
  stances: Record<StanceKey, Stance>;
  maxAskEth: number | null;
  blockedProposers: string[];
  trustedProposers: string[];
  defaultWhenUnsure: 'abstain' | 'skip' | 'against';
  voteReasonStyle: 'none' | 'short' | 'full';
}

interface AutopilotRecord {
  enabled: boolean;
  prefs: AutopilotPrefs;
  prefsHash: string;
  updatedAt: number;
  lastNonce: number;
}

interface Recommendation {
  proposalId: number;
  title: string;
  support: 0 | 1 | 2 | null;
  confidence: number;
  reason: string;
  generatedAt: number;
  model?: string;
  alreadyVoted?: boolean;
  pending?: boolean;
}

interface CachedRec {
  prefsHash: string;
  support: 0 | 1 | 2 | null;
  confidence: number;
  reason: string;
  generatedAt: number;
  model: string;
}

async function readAutopilot(address: string): Promise<AutopilotRecord | null> {
  const r = await readJson<AutopilotRecord>(address, 'autopilot');
  return r && r.prefs && typeof r.enabled === 'boolean' ? r : null;
}

const isStance = (x: unknown): x is Stance =>
  Number.isInteger(x) && (x as number) >= -2 && (x as number) <= 2;

/** Validate + normalise prefs. Returns an error string on failure. */
function parsePrefs(raw: unknown): { prefs: AutopilotPrefs } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'prefs must be an object' };
  const r = raw as Record<string, unknown>;
  const philosophy = typeof r.philosophy === 'string' ? r.philosophy.trim() : '';
  if (philosophy.length > 1000) return { error: 'philosophy must be ≤ 1000 chars' };
  const stancesRaw = (r.stances ?? {}) as Record<string, unknown>;
  if (typeof stancesRaw !== 'object') return { error: 'stances must be an object' };
  const stances = {} as Record<StanceKey, Stance>;
  for (const k of STANCE_KEYS) {
    const v = stancesRaw[k] ?? 0;
    if (!isStance(v)) return { error: `stances.${k} must be an integer in -2..2` };
    stances[k] = v;
  }
  let maxAskEth: number | null = null;
  if (r.maxAskEth != null) {
    const n = Number(r.maxAskEth);
    if (!Number.isFinite(n) || n < 0)
      return { error: 'maxAskEth must be a non-negative number or null' };
    maxAskEth = n;
  }
  const addrList = (key: string): string[] | string => {
    const v = r[key] ?? [];
    if (!Array.isArray(v) || v.length > 200) return `${key} must be an array of ≤ 200 addresses`;
    const out: string[] = [];
    for (const a of v) {
      if (typeof a !== 'string' || !isAddress(a)) return `${key} contains a non-address`;
      out.push(a.toLowerCase());
    }
    return [...new Set(out)];
  };
  const blocked = addrList('blockedProposers');
  if (typeof blocked === 'string') return { error: blocked };
  const trusted = addrList('trustedProposers');
  if (typeof trusted === 'string') return { error: trusted };
  const dwu = r.defaultWhenUnsure ?? 'abstain';
  if (dwu !== 'abstain' && dwu !== 'skip' && dwu !== 'against') {
    return { error: "defaultWhenUnsure must be 'abstain' | 'skip' | 'against'" };
  }
  const style = r.voteReasonStyle ?? 'short';
  if (style !== 'none' && style !== 'short' && style !== 'full') {
    return { error: "voteReasonStyle must be 'none' | 'short' | 'full'" };
  }
  return {
    prefs: {
      philosophy,
      stances,
      maxAskEth,
      blockedProposers: blocked,
      trustedProposers: trusted,
      defaultWhenUnsure: dwu,
      voteReasonStyle: style,
    },
  };
}

const AUTOPILOT_MESSAGE_RE =
  /^noun\.wtf autopilot\naddress: (0x[\da-f]{40})\nnonce: (\d{1,16})\nprefs: ([\da-f]{64})$/;

async function verifyAutopilotSignature(address: Hex, message: string, signature: string) {
  const checksummed = getAddress(address);
  const sig = signature as Hex;
  try {
    if (await verifyMessage({ address: checksummed, message, signature: sig })) return true;
  } catch {
    /* fall through to ERC-1271 */
  }
  try {
    // Smart-contract wallets (Safe etc.) — ERC-1271 via the public client.
    return await client.verifyMessage({ address: checksummed, message, signature: sig });
  } catch {
    return false;
  }
}

/** Proposals currently inside their voting window (incl. objection period). */
async function activeProposals(db: Db, latestBlock: bigint) {
  const rows = await db
    .select({
      id: schema.proposal.id,
      proposer: schema.proposal.proposer,
      description: schema.proposal.description,
      status: schema.proposal.status,
      startBlock: schema.proposal.startBlock,
      endBlock: schema.proposal.endBlock,
      objectionPeriodEndBlock: schema.proposal.objectionPeriodEndBlock,
    })
    .from(schema.proposal)
    .where(
      and(
        inArray(schema.proposal.status, ['PENDING', 'ACTIVE']),
        gte(schema.proposal.endBlock, latestBlock - 50_400n), // ≈ 7 days of slack for objection periods
      ),
    )
    .orderBy(desc(schema.proposal.id))
    .limit(40);
  return rows.filter(p => {
    if (p.startBlock > latestBlock) return false;
    const end =
      p.objectionPeriodEndBlock && p.objectionPeriodEndBlock > p.endBlock
        ? p.objectionPeriodEndBlock
        : p.endBlock;
    return end >= latestBlock;
  });
}

function stanceWord(s: Stance): string {
  return ['strongly against', 'leaning against', 'neutral', 'leaning for', 'strongly for'][s + 2]!;
}

function recommendationSystemPrompt(
  prefs: AutopilotPrefs,
  reasons: string[],
  voterName: string,
): string {
  const stanceLines = STANCE_KEYS.map(
    k => `  ${k}: ${stanceWord(prefs.stances[k])} (${prefs.stances[k]})`,
  );
  const styleRule = {
    none: 'reason must be an empty string.',
    short: 'reason is ONE plain sentence, ≤ 140 characters.',
    full: 'reason is 2–3 plain sentences, ≤ 280 characters.',
  }[prefs.voteReasonStyle];
  return [
    `You are the voting brain of the Nouns DAO voter ${voterName}, running "Autopilot" on noun.wtf.`,
    'Decide how THIS voter would vote on the proposal, strictly from their stated preferences and past vote reasons. Never invent facts about the proposal.',
    'Output ONLY a JSON object: {"support": 0|1|2|null, "confidence": 0..1, "reason": "..."}',
    'support: 1 = for, 0 = against, 2 = abstain, null = skip (do not vote). confidence: how sure you are this matches the voter.',
    `Reason style: written in first person as the voter's own on-chain vote reason, no hype, no emojis, no hashtags. ${styleRule}`,
    'Hard rules (apply before anything else):',
    `  - proposer on the blocked list → support 0.`,
    prefs.maxAskEth != null
      ? `  - total ask above ${prefs.maxAskEth} ETH (USDC counted at ~1/3500 ETH) → support 0 unless the proposer is trusted.`
      : '  - no ask cap set.',
    `  - proposer on the trusted list → lean for unless the ask clearly contradicts the philosophy.`,
    `  - when confidence < 0.5 → use the default: ${prefs.defaultWhenUnsure} (abstain → 2, skip → null, against → 0).`,
    '',
    'VOTER PREFERENCES',
    `Philosophy: ${prefs.philosophy || '(none given)'}`,
    'Category stances (-2 strongly against … +2 strongly for):',
    ...stanceLines,
    `Blocked proposers: ${prefs.blockedProposers.join(', ') || 'none'}`,
    `Trusted proposers: ${prefs.trustedProposers.join(', ') || 'none'}`,
    '',
    reasons.length
      ? `VOTER'S RECENT VOTE REASONS (style + values evidence):\n${reasons.map(r => `- ${r}`).join('\n')}`
      : "VOTER'S RECENT VOTE REASONS: none on record.",
  ].join('\n');
}

function parseRecommendation(
  text: string,
): { support: 0 | 1 | 2 | null; confidence: number; reason: string } | null {
  try {
    const cleaned = stripFences(text);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    const j = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const s = j.support;
    const support: 0 | 1 | 2 | null = s === 0 || s === 1 || s === 2 ? s : null;
    const c = Number(j.confidence);
    const confidence = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5;
    const reason = typeof j.reason === 'string' ? j.reason.trim().slice(0, 280) : '';
    return { support, confidence, reason };
  } catch {
    return null;
  }
}

async function buildRecommendations(
  db: Db,
  address: Hex,
  record: AutopilotRecord,
): Promise<Recommendation[]> {
  let latestBlock = await safe('latestBlock', latestIndexedBlock(), 0n);
  if (latestBlock === 0n) latestBlock = await safe('rpcBlock', client.getBlockNumber(), 0n);
  if (latestBlock === 0n) return [];

  const active = await safe('activeProposals', activeProposals(db, latestBlock), []);
  if (active.length === 0) return [];
  const ids = active.map(p => p.id);

  const [myVotes, txs, reasonRows, cachedRows] = await Promise.all([
    safe(
      'myVotes',
      db
        .select({
          proposalId: schema.vote.proposalId,
          support: schema.vote.support,
          reason: schema.vote.reason,
          createdAt: schema.vote.createdAt,
        })
        .from(schema.vote)
        .where(and(eq(schema.vote.voter, address), inArray(schema.vote.proposalId, ids))),
      [],
    ),
    safe(
      'activeTxs',
      db
        .select()
        .from(schema.transaction)
        .where(inArray(schema.transaction.proposalId, ids))
        .limit(1000),
      [],
    ),
    safe(
      'reasons',
      db
        .select({ reason: schema.vote.reason, support: schema.vote.support })
        .from(schema.vote)
        .where(eq(schema.vote.voter, address))
        .orderBy(desc(schema.vote.createdAtBlock))
        .limit(60),
      [],
    ),
    Promise.all(
      ids.map(id => safe(`rec:${id}`, readJson<CachedRec>(address, `autopilot:rec:${id}`), null)),
    ),
  ]);

  const votedById = new Map(myVotes.map(v => [Number(v.proposalId), v]));
  const txsByProp = new Map<number, typeof txs>();
  for (const t of txs) {
    const list = txsByProp.get(Number(t.proposalId)) ?? [];
    list.push(t);
    txsByProp.set(Number(t.proposalId), list);
  }
  const S = ['against', 'for', 'abstain'];
  const reasons = reasonRows
    .map(r => ({ reason: (r.reason || '').replace(/\s+/g, ' ').trim(), support: r.support }))
    .filter(r => r.reason.length > 0)
    .slice(0, 15)
    .map(r => `(${S[r.support] ?? r.support}) ${r.reason.slice(0, 300)}`);
  const voterName =
    ensNameCache.get(address)?.name ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
  const system = recommendationSystemPrompt(record.prefs, reasons, voterName);
  const blocked = new Set(record.prefs.blockedProposers);
  const trusted = new Set(record.prefs.trustedProposers);

  const out: Recommendation[] = [];
  let hubCalls = 0;
  const pending: Array<() => Promise<void>> = [];

  for (let i = 0; i < active.length; i++) {
    const p = active[i]!;
    const id = Number(p.id);
    const title = titleFromDescription(p.description) || `Prop ${id}`;
    const voted = votedById.get(id);
    if (voted) {
      out.push({
        proposalId: id,
        title,
        support: voted.support as 0 | 1 | 2,
        confidence: 1,
        reason: voted.reason || '',
        generatedAt: ms(voted.createdAt),
        alreadyVoted: true,
      });
      continue;
    }
    const cachedRec = cachedRows[i];
    if (cachedRec && cachedRec.prefsHash === record.prefsHash) {
      out.push({
        proposalId: id,
        title,
        support: cachedRec.support,
        confidence: cachedRec.confidence,
        reason: cachedRec.reason,
        generatedAt: cachedRec.generatedAt,
        model: cachedRec.model,
      });
      continue;
    }
    if (hubCalls >= AUTOPILOT_MAX_HUB_CALLS) {
      out.push({
        proposalId: id,
        title,
        support: null,
        confidence: 0,
        reason: '',
        generatedAt: 0,
        pending: true,
      });
      continue;
    }
    hubCalls++;
    const slot = out.length;
    out.push({
      proposalId: id,
      title,
      support: null,
      confidence: 0,
      reason: '',
      generatedAt: 0,
      pending: true,
    });
    pending.push(async () => {
      const asks = sumAsks(txsByProp.get(id) ?? []);
      const proposer = lower(p.proposer);
      const flags = [blocked.has(proposer) ? 'BLOCKED' : '', trusted.has(proposer) ? 'TRUSTED' : '']
        .filter(Boolean)
        .join(', ');
      const user = [
        `Proposal #${id}: ${title}`,
        `Proposer: ${proposer}${flags ? ` (${flags})` : ''}`,
        `Ask: ${asks.eth.toFixed(2)} ETH, ${asks.usdc.toFixed(0)} USDC`,
        '',
        'Description:',
        (p.description || '').slice(0, 3000),
      ].join('\n');
      try {
        const res = await generateText({ system, user, temperature: 0.3 }, 900, 2500);
        const parsed = parseRecommendation(res.text);
        if (!parsed) return;
        let { support, confidence } = parsed;
        // Deterministic guard-rails on top of the model.
        const ethEquivalentAsk = asks.eth + asks.usdc / 3500;
        if (blocked.has(proposer)) {
          support = 0;
          confidence = Math.max(confidence, 0.9);
        } else if (
          record.prefs.maxAskEth != null &&
          ethEquivalentAsk > record.prefs.maxAskEth &&
          !trusted.has(proposer)
        ) {
          support = 0;
          confidence = Math.max(confidence, 0.8);
        } else if (confidence < 0.5) {
          support = { abstain: 2, skip: null, against: 0 }[record.prefs.defaultWhenUnsure] as
            | 0
            | 2
            | null;
        }
        const reason = record.prefs.voteReasonStyle === 'none' ? '' : parsed.reason;
        const rec: CachedRec = {
          prefsHash: record.prefsHash,
          support,
          confidence: Math.round(confidence * 100) / 100,
          reason,
          generatedAt: Date.now(),
          model: res.model || 'unknown',
        };
        await remember(scopeFor(address), `autopilot:rec:${id}`, JSON.stringify(rec));
        out[slot] = {
          proposalId: id,
          title,
          support: rec.support,
          confidence: rec.confidence,
          reason: rec.reason,
          generatedAt: rec.generatedAt,
          model: rec.model,
        };
      } catch (err) {
        console.warn(`[walletProfile] autopilot rec for #${id} failed:`, err);
      }
    });
  }
  await Promise.all(pending.map(fn => fn()));
  return out;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export function registerWalletProfileRoutes(app: Hono, db: Db) {
  const resolveOr400 = async (c: { req: { param: (k: string) => string | undefined } }) => {
    const identity = c.req.param('identity') ?? c.req.param('address') ?? '';
    return resolveIdentity(identity);
  };

  app.get('/api/wallet/:identity/profile', async c => {
    const address = await resolveOr400(c);
    if (!address) return c.json({ error: 'could not resolve identity' }, 400);
    try {
      return c.json(await getProfile(db, address));
    } catch (err) {
      console.error('[walletProfile] profile failed:', err);
      return c.json({ error: 'profile unavailable' }, 500);
    }
  });

  const activityCache = new Map<string, { at: number; data: ActivityResponse }>();
  app.get('/api/wallet/:identity/activity', async c => {
    const address = await resolveOr400(c);
    if (!address) return c.json({ error: 'could not resolve identity' }, 400);
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
    const beforeParam = c.req.query('before');
    let before: bigint | undefined;
    try {
      before = beforeParam ? BigInt(beforeParam) : undefined;
    } catch {
      return c.json({ error: 'before must be a block number' }, 400);
    }
    const types =
      c.req
        .query('type')
        ?.split(',')
        .map(t => t.trim().toUpperCase())
        .filter(Boolean) || [];
    const key = `${address}:${limit}:${before ?? 'latest'}:${types.join(',')}`;
    const hit = activityCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return c.json(hit.data);
    try {
      const data = await buildActivityFeed({ limit, before, types, address });
      if (activityCache.size > 200) activityCache.clear();
      activityCache.set(key, { at: Date.now(), data });
      return c.json(data);
    } catch (err) {
      console.error('[walletProfile] activity failed:', err);
      return c.json({ events: [], hasMore: false, oldestBlock: 0 }, 500);
    }
  });

  app.get('/api/wallet/:identity/overview', async c => {
    const address = await resolveOr400(c);
    if (!address) return c.json({ error: 'could not resolve identity' }, 400);
    return c.json(await safe('overview', readOverview(address), null));
  });

  app.post('/api/wallet/:identity/overview/refresh', async c => {
    const address = await resolveOr400(c);
    if (!address) return c.json({ error: 'could not resolve identity' }, 400);
    try {
      return c.json(await refreshOverview(db, address));
    } catch (err) {
      console.error('[walletProfile] overview refresh failed:', err);
      const existing = await safe('overview', readOverview(address), null);
      if (existing) return c.json({ ...existing, cached: true, error: 'generation failed' }, 503);
      return c.json({ error: 'overview generation unavailable' }, 503);
    }
  });

  app.get('/api/wallet/:address/autopilot', async c => {
    const address = await resolveOr400(c);
    if (!address) return c.json({ error: 'could not resolve address' }, 400);
    const record = await safe('autopilot', readAutopilot(address), null);
    if (!record) {
      return c.json({ enabled: false, prefs: null, updatedAt: null, recommendations: [] });
    }
    const wantRecs = record.enabled && c.req.query('recommendations') !== 'false';
    const recommendations = wantRecs
      ? await safe('recommendations', buildRecommendations(db, address, record), [])
      : [];
    return c.json({
      enabled: record.enabled,
      prefs: record.prefs,
      updatedAt: record.updatedAt,
      recommendations,
    });
  });

  app.put('/api/wallet/:address/autopilot', async c => {
    const address = await resolveOr400(c);
    if (!address) return c.json({ error: 'could not resolve address' }, 400);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { message, signature } = body;
    if (
      typeof message !== 'string' ||
      typeof signature !== 'string' ||
      !/^0x[\da-f]+$/i.test(signature)
    ) {
      return c.json({ error: 'message and signature are required' }, 400);
    }
    if (typeof body.enabled !== 'boolean')
      return c.json({ error: 'enabled must be a boolean' }, 400);

    const m = AUTOPILOT_MESSAGE_RE.exec(message);
    if (!m) return c.json({ error: 'message format invalid' }, 400);
    const [, msgAddress, nonceStr, msgHash] = m;
    if (msgAddress !== address) return c.json({ error: 'message address does not match' }, 401);

    const nonce = Number(nonceStr);
    if (Math.abs(Date.now() - nonce) > AUTOPILOT_NONCE_WINDOW) {
      return c.json({ error: 'nonce outside the ±10 minute window' }, 409);
    }

    // Hash the raw object exactly as sent — the client signed that serialisation.
    const rawHash = sha256(JSON.stringify(body.prefs ?? null));
    if (rawHash !== msgHash) return c.json({ error: 'prefs hash does not match message' }, 400);
    const parsed = parsePrefs(body.prefs);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);

    if (!(await verifyAutopilotSignature(address, message, signature))) {
      return c.json({ error: 'signature invalid' }, 401);
    }

    const existing = await safe('autopilot', readAutopilot(address), null);
    if (existing && nonce <= existing.lastNonce) return c.json({ error: 'stale nonce' }, 409);

    const record: AutopilotRecord = {
      enabled: body.enabled,
      prefs: parsed.prefs,
      prefsHash: sha256(JSON.stringify(parsed.prefs)),
      updatedAt: Date.now(),
      lastNonce: nonce,
    };
    try {
      await remember(scopeFor(address), 'autopilot', JSON.stringify(record));
    } catch (err) {
      console.error('[walletProfile] autopilot save failed:', err);
      return c.json({ error: 'could not persist preferences' }, 503);
    }
    const cachedProfile = profileCache.get(address);
    if (cachedProfile) {
      cachedProfile.data.autopilot = { enabled: record.enabled, updatedAt: record.updatedAt };
    }
    return c.json({ enabled: record.enabled, prefs: record.prefs, updatedAt: record.updatedAt });
  });
}

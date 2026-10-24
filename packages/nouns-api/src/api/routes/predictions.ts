/* eslint-disable unicorn/no-nested-ternary */
import type { Hono } from 'hono';

import { desc, inArray } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { AUCTION_HOUSE_ABI, NOUNS_AUCTION_HOUSE } from '../lib/auctionHouse.js';
import { nounCheckClient } from '../lib/chain.js';
import { getLatestBlockCached } from '../lib/latestBlock.js';
import { fetchLilNounsFromSubgraph } from '../lib/lilNouns.js';
import { computeDerivedStatus } from '../lib/proposalStatus.js';

// ============================================================
// Prediction markets — combined listing of noun auction markets
// + proposal markets, for the /predictions page's "Markets" table.
// Public, read-only; resolve() is permissionless on both contracts.
// ============================================================

const AUCTION_PRICE_MARKET_ADDRESS =
  (process.env.AUCTION_PRICE_MARKET_ADDRESS as `0x${string}` | undefined) ??
  '0xC9c201A7AfB67Ecc08238Cbd690d39658Aed39b6';

const PREDICTION_MARKET_ADDRESS =
  (process.env.PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined) ??
  '0x2ea7502C4db5B8cfB329d8a9866EB6705b036608';

const AUCTION_PRICE_MARKET_ABI = [
  {
    type: 'function',
    name: 'getMarket',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [
      { name: 'higherPool', type: 'uint256' },
      { name: 'lowerPool', type: 'uint256' },
      { name: 'higherStakers', type: 'uint256' },
      { name: 'lowerStakers', type: 'uint256' },
      { name: 'higherOddsBps', type: 'uint256' },
      { name: 'lowerOddsBps', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'priceWei', type: 'uint256' },
      { name: 'avgWei', type: 'uint256' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

const PREDICTION_MARKET_ABI = [
  {
    type: 'function',
    name: 'getMarket',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
    ],
    outputs: [
      { name: 'forPool', type: 'uint256' },
      { name: 'againstPool', type: 'uint256' },
      { name: 'forStakers', type: 'uint256' },
      { name: 'againstStakers', type: 'uint256' },
      { name: 'forOddsBps', type: 'uint256' },
      { name: 'againstOddsBps', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

type MarketEntry = {
  kind: 'auction' | 'proposal';
  id: string;
  nounId?: string;
  daoKey?: 'nouns' | 'lil-nouns';
  proposalId?: string;
  title: string;
  link?: string;
  outcome: number;
  totalPoolWei: string;
  stakers: number;
  status: 'needs-resolution' | 'live' | 'resolved' | 'pending';
  closesAt?: number;
  note?: string;
};

const PREDICTION_MARKETS_CACHE_TTL_MS = 30_000;
let predictionMarketsCache: {
  at: number;
  payload: { entries: MarketEntry[]; generatedAt: number };
} | null = null;

const ACTIVE_PROPOSAL_STATUSES = ['ACTIVE', 'PENDING', 'OBJECTION_PERIOD', 'UPDATABLE'];
const RESOLVED_PROPOSAL_STATUSES = [
  'CANCELLED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
  'VETOED',
  'ENDED',
];

/**
 * The Lil Nouns subgraph only moves a proposal's status on events (created,
 * queued, executed, cancelled, vetoed). Voting simply ending (defeated, or
 * passed but not yet queued) emits nothing, so those proposals stay ACTIVE
 * there forever. Past their end block they've ended either way: their markets
 * need resolving (the contract reads the governor's real state).
 */
export function lilProposalStatus(
  status: string,
  endBlock: bigint | null,
  latestBlock: bigint,
): string {
  const s = status.toUpperCase();
  if (
    (s === 'ACTIVE' || s === 'PENDING') &&
    endBlock != null &&
    latestBlock > 0n &&
    latestBlock > endBlock
  ) {
    return 'ENDED';
  }
  return s;
}

/** Pick a market status bucket from the proposal status + market outcome. */
function classifyProposalMarket(proposalStatus: string, outcome: number): MarketEntry['status'] {
  const s = proposalStatus.toUpperCase();
  if (outcome === 1 || outcome === 2 || outcome === 3) return 'resolved';
  if (RESOLVED_PROPOSAL_STATUSES.includes(s)) return 'needs-resolution';
  if (ACTIVE_PROPOSAL_STATUSES.includes(s)) return 'live';
  return 'pending';
}

/** Extract a short title from a proposal description (first markdown heading or line). */
function extractProposalTitle(description: string, fallback: string): string {
  const first = (description.split('\n')[0] ?? '').replace(/^#+\s*/, '').trim();
  if (!first) return fallback;
  return first.slice(0, 120);
}

export function registerPredictionRoutes(app: Hono) {
  app.get('/api/predictions/markets', async c => {
    const now = Date.now();
    if (
      predictionMarketsCache !== null &&
      now - predictionMarketsCache.at < PREDICTION_MARKETS_CACHE_TTL_MS
    ) {
      return c.json(predictionMarketsCache.payload);
    }

    try {
      // ── 1. Current nounId + recent settlement timestamps ────────────────────
      const [currentAuction, settlements] = await Promise.all([
        nounCheckClient.readContract({
          address: NOUNS_AUCTION_HOUSE,
          abi: AUCTION_HOUSE_ABI,
          functionName: 'auction',
        }),
        nounCheckClient.readContract({
          address: NOUNS_AUCTION_HOUSE,
          abi: AUCTION_HOUSE_ABI,
          functionName: 'getSettlements',
          args: [50n, false],
        }),
      ]);

      const currentNounId = Number(currentAuction.nounId);
      const settlementByNounId = new Map<number, { amount: bigint; endTime: number }>();
      for (const s of settlements) {
        settlementByNounId.set(Number(s.nounId), {
          amount: s.amount,
          endTime: Number(s.blockTimestamp),
        });
      }

      // ── 2. Multicall the last 50 auction markets ────────────────────────────
      const auctionNounIds = Array.from({ length: 50 }, (_, i) => currentNounId - i).filter(
        n => n >= 0,
      );
      const [auctionResults, auctionRows] = await Promise.all([
        nounCheckClient.multicall({
          allowFailure: true,
          contracts: auctionNounIds.map(id => ({
            address: AUCTION_PRICE_MARKET_ADDRESS,
            abi: AUCTION_PRICE_MARKET_ABI,
            functionName: 'getMarket' as const,
            args: [BigInt(id)] as const,
          })),
        }),
        db
          .select()
          .from(schema.auction)
          .where(
            inArray(
              schema.auction.nounId,
              auctionNounIds.map(id => BigInt(id)),
            ),
          ),
      ]);

      const auctionByNounId = new Map<number, { endTime: number; settled: boolean }>();
      for (const row of auctionRows as Array<Record<string, unknown>>) {
        const rawEnd = row.endTime;
        const endMs =
          rawEnd instanceof Date
            ? rawEnd.getTime() < 946684800000
              ? rawEnd.getTime() * 1000
              : rawEnd.getTime()
            : Number(rawEnd) * (Number(rawEnd) < 1e12 ? 1000 : 1);
        auctionByNounId.set(Number(row.nounId), {
          endTime: Math.floor(endMs / 1000),
          settled: Boolean(row.settled),
        });
      }

      const auctionEntries: MarketEntry[] = [];
      for (let i = 0; i < auctionNounIds.length; i++) {
        const res = auctionResults[i];
        if (!res || res.status !== 'success') continue;
        const tuple = res.result as unknown as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          number,
          bigint,
          bigint,
          number,
          boolean,
        ];
        const higherPool = tuple[0];
        const lowerPool = tuple[1];
        const higherStakers = tuple[2];
        const lowerStakers = tuple[3];
        const outcome = tuple[6];
        const exists = tuple[10];
        if (!exists) continue;
        const nounId = auctionNounIds[i]!;
        const settlement = settlementByNounId.get(nounId);
        const indexed = auctionByNounId.get(nounId);
        const closesAt = settlement?.endTime ?? indexed?.endTime;
        const isCurrent = nounId === currentNounId;
        const nowSec = Math.floor(now / 1000);
        const auctionEnded =
          !isCurrent &&
          (settlement != null ||
            indexed?.settled === true ||
            (closesAt != null && closesAt <= nowSec));
        const outcomeNum = Number(outcome);
        let status: MarketEntry['status'];
        if (outcomeNum === 1 || outcomeNum === 2 || outcomeNum === 3) {
          status = 'resolved';
        } else if (auctionEnded) {
          status = 'needs-resolution';
        } else {
          status = 'live';
        }

        auctionEntries.push({
          kind: 'auction',
          id: `auction-${nounId}`,
          nounId: String(nounId),
          title: `Noun #${nounId} · Higher/Lower`,
          link: `/noun/${nounId}`,
          outcome: outcomeNum,
          totalPoolWei: String(higherPool + lowerPool),
          stakers: Number(higherStakers) + Number(lowerStakers),
          status,
          closesAt,
        });
      }

      // ── 3. Gather proposal markets (Nouns + LilNouns) ───────────────────────
      const nounsProposalsRaw = await db
        .select()
        .from(schema.proposal)
        .orderBy(desc(schema.proposal.createdAtBlock));
      const latestBlock = await getLatestBlockCached();

      type ProposalLookup = {
        daoKey: 'nouns' | 'lil-nouns';
        proposalId: string;
        title: string;
        status: string;
        link: string;
        createdAtBlock: number;
      };

      const nounsProposals: ProposalLookup[] = (
        nounsProposalsRaw as Array<Record<string, unknown>>
      ).map(p => {
        const derivedStatus =
          latestBlock > 0n
            ? computeDerivedStatus(
                {
                  status: p.status as string,
                  forVotes: p.forVotes as number,
                  againstVotes: p.againstVotes as number,
                  quorumVotes: BigInt(p.quorumVotes as string | number | bigint),
                  endBlock: BigInt(p.endBlock as string | number | bigint),
                  objectionPeriodEndBlock:
                    p.objectionPeriodEndBlock != null
                      ? BigInt(p.objectionPeriodEndBlock as string | number | bigint)
                      : null,
                  executionETA:
                    p.executionETA != null
                      ? BigInt(p.executionETA as string | number | bigint)
                      : null,
                  onTimelockV1: p.onTimelockV1 as boolean,
                  startBlock: BigInt(p.startBlock as string | number | bigint),
                },
                latestBlock,
              )
            : p.status;
        return {
          daoKey: 'nouns' as const,
          proposalId: String(p.id),
          title: extractProposalTitle(
            (p.description as string | undefined) ?? '',
            `Proposal ${String(p.id)}`,
          ),
          status: String(derivedStatus),
          link: `/vote/${String(p.id)}`,
          createdAtBlock: Number(p.createdAtBlock),
        };
      });

      let lilNounsProposals: ProposalLookup[] = [];
      try {
        const raw = await fetchLilNounsFromSubgraph();
        lilNounsProposals = raw.map(p => ({
          daoKey: 'lil-nouns' as const,
          proposalId: String(p.id),
          title:
            ((p.title as string | null | undefined) ?? '').trim() ||
            extractProposalTitle((p.description as string) ?? '', `Lil Proposal ${p.id}`),
          status: lilProposalStatus(
            String(p.status ?? ''),
            p.endBlock != null ? BigInt(p.endBlock as string | number | bigint) : null,
            latestBlock,
          ),
          link: `/vote/${p.id}?dao=lil`,
          createdAtBlock: Number(p.createdBlock ?? 0),
        }));
      } catch (err) {
        console.warn('[predictions/markets] lil subgraph failed:', err);
      }

      const allProposals = [...nounsProposals, ...lilNounsProposals];

      const proposalResults = await nounCheckClient.multicall({
        allowFailure: true,
        contracts: allProposals.map(p => ({
          address: PREDICTION_MARKET_ADDRESS,
          abi: PREDICTION_MARKET_ABI,
          functionName: 'getMarket' as const,
          args: [p.daoKey, p.proposalId] as const,
        })),
      });

      const proposalEntries: MarketEntry[] = [];
      for (let i = 0; i < allProposals.length; i++) {
        const res = proposalResults[i];
        if (!res || res.status !== 'success') continue;
        const tuple = res.result as unknown as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          number,
          boolean,
        ];
        const forPool = tuple[0];
        const againstPool = tuple[1];
        const forStakers = tuple[2];
        const againstStakers = tuple[3];
        const outcome = tuple[6];
        const exists = tuple[7];
        if (!exists) continue;
        const p = allProposals[i]!;
        proposalEntries.push({
          kind: 'proposal',
          id: `${p.daoKey}-${p.proposalId}`,
          daoKey: p.daoKey,
          proposalId: p.proposalId,
          title: p.title,
          link: p.link,
          outcome: Number(outcome),
          totalPoolWei: String(forPool + againstPool),
          stakers: Number(forStakers) + Number(againstStakers),
          status: classifyProposalMarket(p.status, Number(outcome)),
        });
      }

      // ── 4. Merge + sort: needs-resolution → live → pending → resolved ───────
      const priority: Record<MarketEntry['status'], number> = {
        'needs-resolution': 0,
        live: 1,
        pending: 2,
        resolved: 3,
      };
      const entries = [...auctionEntries, ...proposalEntries].sort((a, b) => {
        const pa = priority[a.status];
        const pb = priority[b.status];
        if (pa !== pb) return pa - pb;
        // within bucket: auctions first (by nounId desc), proposals by id desc
        if (a.kind === 'auction' && b.kind === 'auction') {
          return Number(b.nounId) - Number(a.nounId);
        }
        if (a.kind === 'proposal' && b.kind === 'proposal') {
          return Number(b.proposalId) - Number(a.proposalId);
        }
        return a.kind === 'auction' ? -1 : 1;
      });

      const payload = { entries, generatedAt: now };
      predictionMarketsCache = { at: now, payload };
      return c.json(payload);
    } catch (err) {
      if (predictionMarketsCache !== null) {
        return c.json(predictionMarketsCache.payload, 200, { 'x-cache': 'stale' });
      }
      return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
    }
  });
}

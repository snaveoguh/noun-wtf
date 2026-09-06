/**
 * Settler / curator maps — the single source of truth for "who settled noun N"
 * and "who curated noun N", built from the indexer's auction tables.
 *
 * Definitions (identical to the old static probe-dreams/*.json snapshots the
 * webapp used to ship, so the probe dropdowns keep their historical meaning):
 *
 *   settler(N)  = tx.from of the AuctionSettled(N) tx.
 *                 V1 nounder nouns (id % 10 == 0, id <= 1820) were never
 *                 auctioned; they were minted by the tx that settled N-1, so
 *                 they inherit settler(N-1). Noun 0 has no prior auction and
 *                 is attributed to its deployer.
 *   curated(N)  = settler(N-1). Settling N-1 rolls the block hash that seeds
 *                 N's traits, so the settler of N-1 "curated" N.
 *
 * Exposed as GET /api/settlers?dao=v1|v2 and reused by the wallet profile so
 * the /gamer page, the probe Settler/Curated dropdowns and any agent tool all
 * count from the same maps.
 */
import type { Hono } from 'hono';
import type { db as ponderDb } from 'ponder:api';

import { eq } from 'drizzle-orm';
import schema from 'ponder:schema';

type Db = typeof ponderDb;
export type Dao = 'v1' | 'v2';

export interface SettlerMaps {
  dao: Dao;
  /** nounId -> lowercase settler address */
  settlers: Record<string, string>;
  /** nounId -> lowercase curator address (settler of nounId - 1) */
  curated: Record<string, string>;
  /** highest noun id present in `settlers` */
  maxNounId: number;
  /** V1 nounder ids whose settler was inherited from N-1 */
  nounderIds: number[];
  updatedAt: number;
}

/** NounsToken mints every 10th noun to nounders while `_currentNounId <= 1820`. */
export const LAST_V1_NOUNDER_ID = 1820;
export const isV1NounderNoun = (id: number): boolean => id % 10 === 0 && id <= LAST_V1_NOUNDER_ID;

/** Noun 0 was minted by the NounsToken deployer, not by settling an auction. */
const NOUN_ZERO_MINTER = '0x44d6e8933f8271abcf253c72f9ed7e0e01d5f68b';

const CACHE_TTL_MS = 60_000;
const cache = new Map<Dao, { at: number; data: SettlerMaps }>();
const inflight = new Map<Dao, Promise<SettlerMaps>>();

async function buildV1(db: Db): Promise<SettlerMaps> {
  const rows = await db
    .select({ nounId: schema.auction.nounId, settler: schema.auction.settler })
    .from(schema.auction)
    .where(eq(schema.auction.settled, true));

  const settlers: Record<string, string> = {};
  let maxNounId = -1;
  for (const r of rows) {
    if (!r.settler) continue;
    const id = Number(r.nounId);
    settlers[String(id)] = r.settler.toLowerCase();
    if (id > maxNounId) maxNounId = id;
  }

  // Nounder fill: every 10th noun up to 1820 was minted by the tx that
  // settled N-1, so it inherits that settler.
  const nounderIds: number[] = [];
  if (maxNounId >= 0) settlers['0'] = NOUN_ZERO_MINTER;
  for (let id = 10; id <= LAST_V1_NOUNDER_ID && id <= maxNounId + 1; id += 10) {
    const prev = settlers[String(id - 1)];
    if (!prev || settlers[String(id)]) continue;
    settlers[String(id)] = prev;
    nounderIds.push(id);
    if (id > maxNounId) maxNounId = id;
  }

  return {
    dao: 'v1',
    settlers,
    curated: shift(settlers),
    maxNounId,
    nounderIds,
    updatedAt: Date.now(),
  };
}

async function buildV2(db: Db): Promise<SettlerMaps> {
  const rows = await db
    .select({ nounId: schema.nounV2Auction.nounId, settler: schema.nounV2Auction.settler })
    .from(schema.nounV2Auction)
    .where(eq(schema.nounV2Auction.settled, true));

  const settlers: Record<string, string> = {};
  let maxNounId = -1;
  for (const r of rows) {
    if (!r.settler) continue;
    const id = Number(r.nounId);
    settlers[String(id)] = r.settler.toLowerCase();
    if (id > maxNounId) maxNounId = id;
  }
  return {
    dao: 'v2',
    settlers,
    curated: shift(settlers),
    maxNounId,
    nounderIds: [],
    updatedAt: Date.now(),
  };
}

/** curated(N) = settler(N-1) */
function shift(settlers: Record<string, string>): Record<string, string> {
  const curated: Record<string, string> = {};
  for (const [id, addr] of Object.entries(settlers)) curated[String(Number(id) + 1)] = addr;
  return curated;
}

export async function getSettlerMaps(db: Db, dao: Dao, fresh = false): Promise<SettlerMaps> {
  const hit = cache.get(dao);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const pending = inflight.get(dao);
  if (pending) return pending;
  const p = (dao === 'v2' ? buildV2(db) : buildV1(db))
    .then(data => {
      cache.set(dao, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(dao));
  inflight.set(dao, p);
  return p;
}

/** Per-wallet view over the maps — what the profile page renders. */
export function walletSettlerStats(
  maps: SettlerMaps,
  address: string,
): { settled: number[]; curated: number[] } {
  const a = address.toLowerCase();
  const settled: number[] = [];
  const curated: number[] = [];
  for (const [id, addr] of Object.entries(maps.settlers)) if (addr === a) settled.push(Number(id));
  for (const [id, addr] of Object.entries(maps.curated)) if (addr === a) curated.push(Number(id));
  settled.sort((x, y) => y - x);
  curated.sort((x, y) => y - x);
  return { settled, curated };
}

export function registerSettlerRoutes(app: Hono, db: Db) {
  app.get('/api/settlers', async c => {
    const daoParam = (c.req.query('dao') ?? 'v1').toLowerCase();
    if (daoParam !== 'v1' && daoParam !== 'v2') {
      return c.json({ error: 'dao must be v1 or v2' }, 400);
    }
    const address = c.req.query('address')?.toLowerCase();
    const maps = await getSettlerMaps(db, daoParam);
    c.header('Cache-Control', 'public, max-age=60');
    if (address) {
      return c.json({
        dao: maps.dao,
        address,
        ...walletSettlerStats(maps, address),
        updatedAt: maps.updatedAt,
      });
    }
    return c.json(maps);
  });
}

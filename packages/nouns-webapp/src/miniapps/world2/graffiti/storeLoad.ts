// ── The graffiti store, and fetching it before Noun World opens ─────────
//
// The plaza's painted walls (~3,400 of them, a few MB) come from the
// permanent store 40 at a time. Fetched only once the game had started, the
// loader waited on them every time. The homepage now starts this download
// when it's idle (`prefetchWalls`), so by the time you press play most walls
// are already in memory; the game takes what's there (`takePrefetched`) and
// fetches the rest itself. No three.js here: the homepage imports this.

import { inParallel, nearestFirst, retry } from './loadOrder';
import { CELL_H_MM, CELL_W_MM } from './strokes';

export const STORE_URL = '/.netlify/functions/world-graffiti';
export const STORE_BATCH = 40;
/** Store batches in flight at once while loading. */
export const STORE_PARALLEL = 4;
/** Goes at each store read, and the first wait between them (doubling). */
export const STORE_TRIES = 4;
const STORE_RETRY_MS = 1_000;

export const CELL_W = CELL_W_MM / 1000;
export const CELL_H = CELL_H_MM / 1000;

export const storeWait = (n: number) =>
  new Promise<void>(r => setTimeout(r, STORE_RETRY_MS * 2 ** n));

/** One read of the store (null on a miss). */
export async function storeGet<T>(level: string, query: string): Promise<T | null> {
  const r = await fetch(`${STORE_URL}?level=${level}${query}`, { cache: 'no-store' });
  return r.ok ? ((await r.json()) as T) : null;
}

/** A wall the prefetch read: its tags (empty when the store had none), or null if its batch failed. */
export type PrefetchedWall = { tags: string[] } | null;

export interface Prefetched {
  /** The store's index of painted walls (null if it couldn't be read). */
  index: Promise<string[] | null>;
  /** Filled as soon as the index is in: one promise per wall. */
  walls: Map<string, Promise<PrefetchedWall>>;
}

const prefetched = new Map<string, Prefetched>();

/**
 * Start downloading a level's stored walls before the game needs them,
 * nearest `at` first. Once per level per page load; a failed index read
 * leaves nothing behind, so the game simply fetches as before.
 */
export function prefetchWalls(level: string, at: { x: number; y: number; z: number }) {
  if (prefetched.has(level)) return;
  const walls = new Map<string, Promise<PrefetchedWall>>();
  const index = retry(() => storeGet<{ walls: string[] }>(level, ''), STORE_TRIES, storeWait).then(
    r => (r !== null && Array.isArray(r.walls) ? r.walls : null),
  );
  prefetched.set(level, { index, walls });
  // Registered first, so `walls` is filled before anyone awaiting `index` resumes
  void index.then(ids => {
    if (ids === null) {
      prefetched.delete(level);
      return;
    }
    const order = nearestFirst(ids, at, CELL_W, CELL_H);
    const batches: { ids: string[]; done: (w: Record<string, string[]> | null) => void }[] = [];
    for (let i = 0; i < order.length; i += STORE_BATCH) {
      const batchIds = order.slice(i, i + STORE_BATCH);
      let done: (w: Record<string, string[]> | null) => void = () => undefined;
      const got = new Promise<Record<string, string[]> | null>(r => (done = r));
      for (const id of batchIds)
        walls.set(
          id,
          got.then(w => {
            if (w === null) return null;
            const tags = w[id];
            return { tags: Array.isArray(tags) ? tags : [] };
          }),
        );
      batches.push({ ids: batchIds, done });
    }
    void inParallel(batches, STORE_PARALLEL, async b => {
      const got = await retry(
        () =>
          storeGet<{ walls: Record<string, string[]> }>(
            level,
            `&ids=${encodeURIComponent(JSON.stringify(b.ids))}`,
          ),
        STORE_TRIES,
        storeWait,
      ).catch(() => null);
      b.done(got?.walls ?? null);
    });
  });
}

/** Plaza walls are ordered from its centre before the rider exists. */
export const PLAZA_CENTRE = { x: 0, y: 1.5, z: 0 };

/**
 * Worth downloading a few MB of graffiti on spec? Not on data saver or a
 * slow connection (the game still loads them itself when it opens).
 */
export function prefetchAllowed(): boolean {
  const c = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  if (c?.saveData === true) return false;
  return c?.effectiveType === undefined || c.effectiveType === '4g';
}

/** Hand a level's prefetch to the game (once): null if none was started. */
export function takePrefetched(level: string): Prefetched | null {
  const p = prefetched.get(level) ?? null;
  prefetched.delete(level);
  return p;
}

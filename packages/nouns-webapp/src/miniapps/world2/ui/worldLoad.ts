// ── The world loader's readiness: level up, every graffiti piece on the walls ──
//
// A plain /world load opens on the noun.wtf wordmark with one shimmer pass
// across it (ui/WorldLoader.tsx) and goes straight into CREATE YOUR RIDER
// once the game is ready AND the graffiti's arrival load has finished, so the
// character select and CAMP's opening shot open with every piece up (~3,400
// walls on the plaza: slow but moving is fine, it waits). A dead graffiti
// endpoint can't hold play forever: once no wall has come in for
// GRAFFITI_STALL_MS (or GRAFFITI_CAP_MS after the level, whatever happens),
// the loader lets go anyway and the walls keep filling in behind.
// Pure: the component feeds it what it reads off the game each frame.

/** No new wall for this long once the level is in: the graffiti store is stuck, go. */
export const GRAFFITI_STALL_MS = 15_000;
/** Never wait on graffiti longer than this after the level. */
export const GRAFFITI_CAP_MS = 90_000;

/** The level's share of the shimmer; graffiti fills the rest. */
const LEVEL_SHARE = 0.45;
/** The level's part of the sweep creeps toward its share on this time scale (no real progress to read). */
const LEVEL_TAU_MS = 5_000;

export interface WorldLoadState {
  /** The game finished start() (hud.loading is null). */
  levelReady: boolean;
  /** Graffiti exists (it's made once the level is in). */
  graffiti: { done: number; total: number | null } | null;
  /** Graffiti's arrival load finished. */
  graffitiArrived: boolean;
  /** Since the loader appeared. */
  elapsedMs: number;
  /** Since the level was ready (0 before). */
  sinceLevelMs: number;
  /** Since the last wall came in, or the level was ready if none has (0 before). */
  stalledMs: number;
}

/** True once the loader can hand over to the character select. */
export function worldLoaded(s: WorldLoadState): boolean {
  if (!s.levelReady) return false;
  return s.graffitiArrived || s.stalledMs >= GRAFFITI_STALL_MS || s.sinceLevelMs >= GRAFFITI_CAP_MS;
}

/**
 * Where the shimmer's band should be heading, 0..1: the level's share creeps
 * up with time until it's in, then the graffiti's share follows the walls
 * actually fetched. 1 once loaded.
 */
export function loadTarget(s: WorldLoadState): number {
  if (worldLoaded(s)) return 1;
  const level = s.levelReady
    ? LEVEL_SHARE
    : LEVEL_SHARE * 0.95 * (1 - Math.exp(-s.elapsedMs / LEVEL_TAU_MS));
  if (!s.levelReady) return level;
  const g = s.graffiti;
  let frac = 0;
  if (g !== null && g.total !== null) frac = g.total === 0 ? 1 : g.done / g.total;
  // never quite there until it's really done
  return level + (1 - LEVEL_SHARE) * Math.min(0.97, Math.max(0, frac));
}

/**
 * One frame of the band: eases toward the target, never backwards, and runs
 * the last stretch quickly once loaded so the sweep finishes cleanly.
 */
export function stepShimmer(shown: number, target: number, dtMs: number, loaded: boolean): number {
  const rate = loaded ? 1 / 350 : 1 / 600; // fraction of the gap per ms
  const k = 1 - Math.exp(-dtMs * rate);
  let next = shown + (target - shown) * k;
  if (loaded) next = Math.min(1, Math.max(next, shown + dtMs / 500));
  return Math.max(shown, Math.min(1, next));
}

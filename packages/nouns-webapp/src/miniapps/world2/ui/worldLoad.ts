// ── The world loader's wordmark: Pip3's five versions of each letter ──
//
// A plain /world load opens on a small noun.wtf wordmark (ui/WorldLoader.tsx)
// shimmering on a loop while one letter at a time pops to another of Pip3's
// five versions of itself. It hands over to CREATE YOUR RIDER once the level
// is in and every graffiti wall round the rider is painted, so nothing pops
// in on screen (the homepage already started downloading them:
// graffiti/storeLoad.ts); the far walls finish behind the select. A dead
// graffiti store can't hold play: after GRAFFITI_STALL_MS with no new wall,
// or GRAFFITI_CAP_MS after the level, it goes anyway. Pure.

/** Walls this close to the rider must be up before the select shows (m). */
export const NEAR_WALLS_M = 60;
/** No new wall for this long once the level is in: the graffiti store is stuck, go. */
export const GRAFFITI_STALL_MS = 15_000;
/** Never wait on graffiti longer than this after the level. */
export const GRAFFITI_CAP_MS = 45_000;

export interface WorldLoadState {
  /** The game finished start() and graffiti exists. */
  levelReady: boolean;
  /** Every wall within NEAR_WALLS_M of the rider is painted. */
  nearWallsUp: boolean;
  /** Since the level was ready (0 before). */
  sinceLevelMs: number;
  /** Since the last wall came in, or the level was ready if none has (0 before). */
  stalledMs: number;
}

/** True once the loader can hand over to the character select. */
export function worldLoaded(s: WorldLoadState): boolean {
  if (!s.levelReady) return false;
  return s.nearWallsUp || s.stalledMs >= GRAFFITI_STALL_MS || s.sinceLevelMs >= GRAFFITI_CAP_MS;
}

/** Pip3 draws every letter five ways: its `rand` feature picks one, 1–5. */
export const PIP3_VARIANTS = 5;

/**
 * One flick of the wordmark: `count` random letters (never the same one
 * twice) each change to a different drawing, 1..PIP3_VARIANTS. Returns a new
 * array; `rand` is Math.random in the page.
 */
export function flickVariants(v: readonly number[], rand: () => number, count = 2): number[] {
  const out = [...v];
  const picked = new Set<number>();
  for (let n = 0; n < Math.min(count, out.length); n++) {
    let i = Math.floor(rand() * out.length);
    while (picked.has(i)) i = (i + 1) % out.length;
    picked.add(i);
    // any of the other four
    const step = 1 + Math.floor(rand() * (PIP3_VARIANTS - 1));
    out[i] = ((out[i]! - 1 + step) % PIP3_VARIANTS) + 1;
  }
  return out;
}

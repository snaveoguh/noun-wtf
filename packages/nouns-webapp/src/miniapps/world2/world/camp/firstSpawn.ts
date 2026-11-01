// ── The first spawn: inside NOUNS CAMP (pure, tested) ─────────────────────
//
// A plain /world load wakes every rider up in CAMP (CampSystem.spawnInside,
// once per page load, after the loader / the character select). Deep
// links and modes that put you somewhere themselves skip it, and
// `?spawn=plaza` keeps the old plaza spawn (the perf harness uses it so
// its numbers stay comparable).

/** `?spawn=plaza`: start out on the plaza as before. */
export const SPAWN_PARAM = 'spawn';

/** Deep links / modes that set their own spawn (or are dev scenes). */
const SETS_OWN_SPAWN = ['play', 'drop', 'mode', 'spot', 'megaramp', 'town', 'dressing'] as const;

/** Should a page with this query string wake up in CAMP? */
export function firstSpawnInCamp(search: string): boolean {
  const q = new URLSearchParams(search);
  if (q.get(SPAWN_PARAM) === 'plaza') return false;
  return !SETS_OWN_SPAWN.some(k => q.has(k));
}

/** Which of CAMP's spawn spots (spread riders out; `rnd` in [0, 1)). */
export function pickSpawn(count: number, rnd: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(rnd * count)));
}

/**
 * Tiny fuzzy matcher for Spotlight. ~30 LOC, no deps.
 *
 * Scoring tiers (highest first):
 *   1. Exact / prefix / substring match on name        (1000 + ...)
 *   2. Initials match — query letters land on word starts ("af" → "Auction
 *      Feed")                                                (700 + ...)
 *   3. In-order subsequence — every query char appears in target in order
 *      (300 + ...)
 *   4. No match                                              (-Infinity)
 *
 * Tie-breaker: shorter targets win (favours the more specific result).
 */

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Tier 1: exact + substring.
  if (q === t) return 2000;
  if (t.startsWith(q)) return 1500 - t.length;
  const idx = t.indexOf(q);
  if (idx !== -1) return 1000 - idx * 5 - t.length;

  // Tier 2: initials. Split on non-alphanumeric runs.
  const words = t.split(/[^a-z0-9]+/i).filter(Boolean);
  const initials = words.map(w => w[0]).join('');
  if (initials.startsWith(q)) return 800 - t.length;
  if (initials.includes(q)) return 700 - t.length;

  // Tier 3: in-order subsequence.
  let qi = 0;
  let lastHit = -1;
  let gapPenalty = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastHit !== -1) gapPenalty += ti - lastHit - 1;
      lastHit = ti;
      qi++;
    }
  }
  if (qi === q.length) return 300 - gapPenalty - t.length;

  return -Infinity;
}

/** Score every candidate against the query and return matches in rank order. */
export function fuzzySearch<T>(
  query: string,
  items: ReadonlyArray<T>,
  getStrings: (item: T) => string | string[],
): FuzzyMatch<T>[] {
  if (!query.trim()) {
    return items.map(item => ({ item, score: 0 }));
  }
  const matches: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const stringsRaw = getStrings(item);
    const strings = Array.isArray(stringsRaw) ? stringsRaw : [stringsRaw];
    let best = -Infinity;
    for (const s of strings) {
      const score = fuzzyScore(query, s);
      if (score > best) best = score;
    }
    if (best > -Infinity) matches.push({ item, score: best });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

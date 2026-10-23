// ── NOUN FM floor: who else on the page is making radio noise ───────────
//
// The site-wide NOUN FM player (components/NounFm) pauses while something
// else has the floor, e.g. Noun World's own radio when a rider turns it on
// or stands by the ice cream van. Claims are keyed so each source releases
// only its own.

const claims = new Set<string>();
const listeners = new Set<() => void>();

export function claimAudio(key: string, on: boolean): void {
  const had = claims.has(key);
  if (on === had) return;
  if (on) claims.add(key);
  else claims.delete(key);
  for (const l of listeners) l();
}

export function audioClaimed(): boolean {
  return claims.size > 0;
}

export function onClaimsChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

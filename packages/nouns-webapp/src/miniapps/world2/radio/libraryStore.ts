// ── NOUN FM: the set library as the panel sees it ───────────────────────
//
// One copy of the last fetched library for the whole page (so switching tabs
// doesn't refetch-flash), plus sharing a set from the booking form or the
// saved-sets list.

import type { FmTrack } from '../../../../../nouns-party/src/fmStation';

import { useCallback, useEffect, useState } from 'react';

import { fetchLibrary, libSetKey, publishSet, type LibSet } from './library';
import { type NounFm } from './NounFm';

export interface SetDraft {
  dj: string;
  name: string;
  tracks: FmTrack[];
}

let libCache: { sets: LibSet[]; total: number } | null = null;
const libListeners = new Set<(v: typeof libCache) => void>();
export function getLibCache() {
  return libCache;
}

export function setLibCache(v: typeof libCache) {
  libCache = v;
  for (const l of libListeners) l(v);
}

export function useLibrary() {
  const [lib, setLib] = useState(libCache);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    libListeners.add(setLib);
    return () => {
      libListeners.delete(setLib);
    };
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true);
    const r = await fetchLibrary();
    setBusy(false);
    if (r.ok) {
      setErr(null);
      setLibCache({ sets: r.sets, total: r.total });
    } else setErr(r.reason);
  }, []);
  return { lib, err, busy, refresh };
}

/** Is this set (by DJ, name, tracks) already in the library we last fetched? */
export function inLibrary(s: SetDraft): boolean {
  const k = libSetKey(s.dj, s.name, s.tracks);
  return libCache?.sets.some(x => libSetKey(x.dj, x.name, x.tracks) === k) ?? false;
}

/** Share a set to the library; a short human answer. */
export async function shareSet(fm: NounFm, s: SetDraft): Promise<{ ok: boolean; msg: string }> {
  const r = await publishSet(fm.libraryKey(), s);
  if (!r.ok) return { ok: false, msg: `not shared: ${r.reason}` };
  // pick it up on the next look at the library
  void fetchLibrary().then(l => {
    if (l.ok) setLibCache({ sets: l.sets, total: l.total });
  });
  return {
    ok: true,
    msg: r.dup ? 'already in the library: bumped to the top' : 'shared to the library',
  };
}

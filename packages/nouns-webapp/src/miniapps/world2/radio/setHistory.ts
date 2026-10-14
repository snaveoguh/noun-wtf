// ── NOUN FM: your saved DJ sets ──────────────────────────────────────────
//
// Every set you book is remembered on this device so it can be reloaded
// into the booking form and booked again another day. Newest first,
// de-duplicated by name + track list, capped.

import type { FmTrack } from '../../../../../nouns-party/src/fmStation';

const KEY = 'noun-fm-set-history';
export const SET_HISTORY_MAX = 20;

export interface SavedSet {
  dj: string;
  name: string;
  tracks: FmTrack[];
  /** When it was last booked (ms). */
  at: number;
}

const trackId = (t: FmTrack) => JSON.stringify(t.src);
const sameSet = (a: SavedSet, b: SavedSet) =>
  a.name === b.name &&
  a.tracks.length === b.tracks.length &&
  a.tracks.every((t, i) => trackId(t) === trackId(b.tracks[i]!));

function valid(x: unknown): x is SavedSet {
  const s = x as SavedSet;
  return (
    s !== null &&
    typeof s === 'object' &&
    typeof s.dj === 'string' &&
    typeof s.name === 'string' &&
    typeof s.at === 'number' &&
    Array.isArray(s.tracks) &&
    s.tracks.length > 0 &&
    s.tracks.every(t => t !== null && typeof t === 'object' && typeof t.title === 'string')
  );
}

export function loadSetHistory(): SavedSet[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter(valid).slice(0, SET_HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function store(list: SavedSet[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // private mode / quota: history just isn't kept
  }
}

/** Remember a booked set (moves an identical one to the top). */
export function rememberSet(set: Omit<SavedSet, 'at'>, at = Date.now()): SavedSet[] {
  if (set.tracks.length === 0) return loadSetHistory();
  const entry: SavedSet = { ...set, at };
  const list = [entry, ...loadSetHistory().filter(s => !sameSet(s, entry))].slice(
    0,
    SET_HISTORY_MAX,
  );
  store(list);
  return list;
}

export function forgetSet(index: number): SavedSet[] {
  const list = loadSetHistory().filter((_, i) => i !== index);
  store(list);
  return list;
}

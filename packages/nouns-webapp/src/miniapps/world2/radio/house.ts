// ── NOUN FM house programme: what's on when nothing's queued ─────────────
//
// When no DJ set is on and nobody has queued a track, NOUN FM runs its own
// programme instead of falling back to the pirate generator: the owner's own
// songs (public/world2/fm/songs/manifest.json) randomly interleaved with
// tracks from DJ sets in the shared set library (~50/50), never the same
// track twice within an hour. Like a real station it sometimes cuts a song
// short (a quick tape-stop) to drop a Noun F-M jingle or a WORLDWIDE ALERT
// news break; ordinary changes get the usual ident in the 4.5 s gap.
//
// It's a pure function of (UTC day, catalogue): every client builds the same
// day's schedule from the same seed and looks up the server-synced clock in
// it, so riders tuned in or standing by the van hear the same song at the
// same moment. The catalogue has to be identical everywhere, so library sets
// only count once they were published before the day started.

import { FM_GAP_MS, srcKey, type FmTrack } from '../../../../../nouns-party/src/fmStation';

export const HOUSE_DAY_MS = 24 * 3600_000;
/** Never the same track twice within this window. */
export const HOUSE_NO_REPEAT_MS = 3600_000;
/** Chance a song gets cut short for a break. */
export const HOUSE_CUT_P = 0.25;
/** A cut lands somewhere in this fraction of the song. */
export const HOUSE_CUT_RANGE: [number, number] = [0.6, 0.8];
/** Songs shorter than this always play out. */
export const HOUSE_CUT_MIN_S = 40;
/** Chance a break is a WORLDWIDE ALERT (else a jingle / interlude). */
export const HOUSE_ALERT_P = 0.5;
/** Chance a song that plays out is followed by a full Noun F-M jingle. */
export const HOUSE_JINGLE_P = 0.35;
/**
 * Pirate blocks: between house songs the procedural pirate station takes
 * over for a while (the house leaves a hole, NounFm falls back to it), so a
 * small catalogue doesn't loop the same few songs.
 */
export const HOUSE_PIRATE_MIN_MS = 6 * 60_000;
export const HOUSE_PIRATE_MAX_MS = 12 * 60_000;
/** With at least this many tracks, pirate blocks get rarer. */
export const HOUSE_BIG_CATALOGUE = 12;
/** Chance of a pirate block after a song when the catalogue is big. */
export const HOUSE_PIRATE_P_BIG = 0.25;
/** Length of a WORLDWIDE ALERT break (sting + one spoken line). */
export const HOUSE_ALERT_S = 12;

export interface HouseTrack extends FmTrack {
  origin: 'owner' | 'library';
  /** For library tracks: the set's DJ (credited in the label). */
  dj?: string;
}

export interface HouseCatalog {
  owner: HouseTrack[];
  library: HouseTrack[];
  /** Full lengths (s) of the Noun F-M jingles / interludes, by manifest index. */
  breaks: number[];
}

export type HouseBreak = { type: 'interlude'; index: number } | { type: 'alert' };

export type HouseItem =
  | {
      kind: 'song';
      key: string;
      track: HouseTrack;
      /** Window start: the ident gap before the song (== startAt after a break). */
      at: number;
      startAt: number;
      /** End (cut short when `cut`). */
      endAt: number;
      cut: boolean;
    }
  | { kind: 'break'; key: string; brk: HouseBreak; at: number; endAt: number };

export function dayStart(ms: number): number {
  return Math.floor(ms / HOUSE_DAY_MS) * HOUSE_DAY_MS;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** mulberry32: small, fast, same everywhere. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function usable(t: HouseTrack): boolean {
  return Number.isFinite(t.dur) && t.dur >= 5 && t.dur <= 900;
}

/** Same catalogue in, same order out (dedup by source, sorted). */
export function normCatalog(c: HouseCatalog): HouseCatalog {
  const norm = (ts: HouseTrack[], seen: Set<string>) => {
    const out: HouseTrack[] = [];
    for (const t of ts) {
      const k = srcKey(t.src);
      if (!usable(t) || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out.sort((a, b) => (srcKey(a.src) < srcKey(b.src) ? -1 : 1));
  };
  const seen = new Set<string>();
  const owner = norm(c.owner, seen);
  return {
    owner,
    library: norm(c.library, seen),
    breaks: c.breaks.filter(d => Number.isFinite(d) && d > 0),
  };
}

export function catalogPrint(c: HouseCatalog): string {
  const f = (ts: HouseTrack[]) => ts.map(t => `${srcKey(t.src)}@${Math.round(t.dur)}`).join(',');
  return `${f(c.owner)}|${f(c.library)}|${c.breaks.map(d => Math.round(d * 10)).join(',')}`;
}

/**
 * The day's programme from `day` (UTC midnight, ms) to the next midnight.
 * Empty when there's nothing to play.
 */
export function houseDay(cat: HouseCatalog, day: number): HouseItem[] {
  const c = normCatalog(cat);
  const all = [...c.owner, ...c.library];
  if (all.length === 0) return [];
  const r = rng(hash(`${day}|${catalogPrint(c)}`));
  const last = new Map<string, number>();
  const items: HouseItem[] = [];
  const end = day + HOUSE_DAY_MS;
  let t = day;
  let afterBreak = false;
  let n = 0;
  while (t < end) {
    const startAt = t + (afterBreak ? 0 : FM_GAP_MS);
    const fresh = (ts: HouseTrack[]) =>
      ts.filter(x => startAt - (last.get(srcKey(x.src)) ?? -Infinity) >= HOUSE_NO_REPEAT_MS);
    const first = c.owner.length > 0 && (c.library.length === 0 || r() < 0.5) ? c.owner : c.library;
    const other = first === c.owner ? c.library : c.owner;
    let pool = fresh(first);
    if (pool.length === 0) pool = fresh(other);
    let track: HouseTrack;
    if (pool.length > 0) track = pool[Math.floor(r() * pool.length)]!;
    else {
      // everything played within the hour (a tiny catalogue): least recent first
      track = all.reduce((a, b) =>
        (last.get(srcKey(a.src)) ?? -Infinity) <= (last.get(srcKey(b.src)) ?? -Infinity) ? a : b,
      );
      r();
    }
    last.set(srcKey(track.src), startAt);
    const full = track.dur * 1000;
    // (a break is always possible: WORLDWIDE ALERTs need no files)
    // the owner's own songs always play out; only library tracks get cut
    const cut = track.origin !== 'owner' && track.dur >= HOUSE_CUT_MIN_S && r() < HOUSE_CUT_P;
    const frac = HOUSE_CUT_RANGE[0] + (HOUSE_CUT_RANGE[1] - HOUSE_CUT_RANGE[0]) * r();
    const songEnd = startAt + (cut ? Math.round(full * frac) : full);
    items.push({
      kind: 'song',
      key: `house:${day}:${n++}`,
      track,
      at: t,
      startAt,
      endAt: songEnd,
      cut,
    });
    t = songEnd;
    afterBreak = false;
    if (cut) {
      const alert = c.breaks.length === 0 || r() < HOUSE_ALERT_P;
      const index = Math.floor(r() * Math.max(1, c.breaks.length));
      const brk: HouseBreak = alert ? { type: 'alert' } : { type: 'interlude', index };
      const len = alert ? HOUSE_ALERT_S * 1000 : Math.round(c.breaks[index]! * 1000);
      items.push({ kind: 'break', key: `house:${day}:${n++}`, brk, at: t, endAt: t + len });
      t += len;
      afterBreak = true;
    } else if (c.breaks.length > 0 && r() < HOUSE_JINGLE_P) {
      // jingles always play in full, as their own break (never squeezed into the gap)
      const index = Math.floor(r() * c.breaks.length);
      const len = Math.round(c.breaks[index]! * 1000);
      const brk: HouseBreak = { type: 'interlude', index };
      items.push({ kind: 'break', key: `house:${day}:${n++}`, brk, at: t, endAt: t + len });
      t += len;
      afterBreak = true;
    }
    if (all.length < HOUSE_BIG_CATALOGUE || r() < HOUSE_PIRATE_P_BIG) {
      // a hole: the pirate station plays until the next house song
      t += HOUSE_PIRATE_MIN_MS + Math.round(r() * (HOUSE_PIRATE_MAX_MS - HOUSE_PIRATE_MIN_MS));
      afterBreak = false;
    }
  }
  return items;
}

/** The item on at `now` (binary search), or null outside the day. */
export function houseAt(items: HouseItem[], now: number): HouseItem | null {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = items[mid]!;
    if (now < it.at) hi = mid - 1;
    else if (now >= it.endAt) lo = mid + 1;
    else return it;
  }
  return null;
}

/**
 * What the house plays at `now`: nothing while the station has something of
 * its own on (a booked DJ set or a queued track always pre-empts it).
 */
export function houseSlot(stationLive: boolean, items: HouseItem[], now: number): HouseItem | null {
  return stationLive ? null : houseAt(items, now);
}

/** Library sets → house tracks: only sets published before `day` (so every client agrees). */
export function libraryTracks(
  sets: { dj: string; at: number; tracks: FmTrack[] }[],
  day: number,
): HouseTrack[] {
  const out: HouseTrack[] = [];
  for (const s of sets) {
    if (!(s.at > 0 && s.at < day)) continue;
    for (const t of s.tracks) out.push({ ...t, origin: 'library', dj: s.dj });
  }
  return out;
}

// ── NOUN BEATS: which hip-hop track plays next, and when to give up on YouTube ──
//
// NOUN BEATS is the rider's own hip-hop station: real tracks from the NOUN FM
// playlist (public/fm/playlist.json), filtered to hip-hop by genre tag and
// weighted towards the instrumental / boom bap / jazz rap end, which works
// under a ride. Shuffled per player, no jingles. The generated worklet beats
// (radioWorklet.ts) are only the fallback when YouTube can't play here.

import type { FmItem } from '@/components/NounFm/station';

/**
 * Hip-hop genre tags in the playlist and how likely each track is picked,
 * relative to the others. Anything not listed isn't hip-hop for NOUN BEATS.
 */
export const BEATS_WEIGHTS: Readonly<Record<string, number>> = {
  'instrumental hip hop': 5,
  'boom bap': 3,
  'jazz rap': 3,
  'abstract hip hop': 1.5,
  soulquarians: 1.5,
  'underground hip hop': 1,
  'uk hip hop': 1,
  'aotearoa hip hop': 1,
  'aussie hip hop': 1,
  'latin hip hop': 1,
  'cloud rap': 1,
};

/** The favoured riding-soundtrack tags. */
export const BEATS_FAVOURED: readonly string[] = ['instrumental hip hop', 'boom bap', 'jazz rap'];

/** Long mixes / DJ cuts aren't a station track. */
export const BEATS_MAX_DUR_S = 660;
/** Ids remembered so the shuffle doesn't repeat itself. */
export const BEATS_RECENT_MAX = 120;

export interface BeatsTrack extends FmItem {
  weight: number;
}

export function beatsWeight(genre: string): number {
  return BEATS_WEIGHTS[genre.trim().toLowerCase()] ?? 0;
}

/** The hip-hop music in the playlist, each with its pick weight. */
export function hipHopPool(items: readonly FmItem[]): BeatsTrack[] {
  const out: BeatsTrack[] = [];
  for (const i of items) {
    if (i.kind !== 'music') continue;
    if (i.dur > BEATS_MAX_DUR_S) continue;
    const weight = beatsWeight(i.genre);
    if (weight > 0) out.push({ ...i, weight });
  }
  return out;
}

export interface BeatsPickState {
  /** Most recent first. */
  recent: readonly string[];
  /** Ids YouTube refused (gone, embedding off). */
  blocked: ReadonlySet<string>;
  lastArtist: string;
}

function weighted(pool: readonly BeatsTrack[], rng: () => number): BeatsTrack | null {
  let total = 0;
  for (const t of pool) total += t.weight;
  if (total <= 0) return pool[0] ?? null;
  let r = rng() * total;
  for (const t of pool) {
    r -= t.weight;
    if (r < 0) return t;
  }
  return pool[pool.length - 1] ?? null;
}

/**
 * A weighted shuffle: skips refused ids, recent ids and the artist that just
 * played, relaxing those rules rather than ever returning nothing.
 */
export function pickBeat(
  pool: readonly BeatsTrack[],
  s: BeatsPickState,
  rng: () => number,
): BeatsTrack | null {
  const live = pool.filter(t => !s.blocked.has(t.id));
  if (live.length === 0) return null;
  const recent = new Set(s.recent);
  const artist = s.lastArtist.toLowerCase();
  const tiers = [
    live.filter(t => !recent.has(t.id) && (artist === '' || t.artist.toLowerCase() !== artist)),
    live.filter(t => !recent.has(t.id)),
    live.filter(t => t.id !== s.recent[0]),
    live,
  ];
  return weighted(tiers.find(t => t.length > 0) ?? live, rng);
}

export function afterBeat(s: BeatsPickState, t: FmItem): BeatsPickState {
  return {
    ...s,
    recent: [t.id, ...s.recent.filter(id => id !== t.id)].slice(0, BEATS_RECENT_MAX),
    lastArtist: t.artist,
  };
}

/** "artist – title" for the now-playing chip. */
export function beatsTrackLabel(t: Pick<FmItem, 'artist' | 'title'>): string {
  const title = t.title.trim().slice(0, 48);
  const artist = t.artist.trim().slice(0, 28);
  return artist !== '' ? `${artist} – ${title}` : title;
}

// ── YouTube or the offline beats ─────────────────────────────────────────

/** Tracks in a row the deck errored on / refused before the station goes offline. */
export const BEATS_MAX_STRIKES = 3;

export interface BeatsEnv {
  /** `?offline=1`. */
  offline: boolean;
  /** Running inside the Capacitor app. */
  native: boolean;
  /** The app's webview is known to refuse YouTube embeds. */
  nativeEmbedsBlocked: boolean;
  /** Tracks in a row that errored (reset by one that plays). */
  strikes: number;
}

export type BeatsSource = 'youtube' | 'offline';

/** Real tracks from YouTube, or the generated worklet beats as a fallback. */
export function beatsSource(e: BeatsEnv): BeatsSource {
  if (e.offline) return 'offline';
  if (e.native && e.nativeEmbedsBlocked) return 'offline';
  if (e.strikes >= BEATS_MAX_STRIKES) return 'offline';
  return 'youtube';
}

/**
 * Whether this page runs in the Capacitor app (noun-world-app loads the live
 * site with `?source=app`, and the native bridge injects `window.Capacitor`).
 */
export function isNativeApp(search: string, w: unknown): boolean {
  const cap = (w as { Capacitor?: { isNativePlatform?: () => boolean } } | null)?.Capacitor;
  try {
    if (cap?.isNativePlatform?.() === true) return true;
  } catch {
    // no bridge
  }
  return new URLSearchParams(search).get('source') === 'app';
}

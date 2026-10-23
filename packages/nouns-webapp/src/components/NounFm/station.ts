// ── NOUN FM (site-wide): what plays next ────────────────────────────────
//
// Pure picking rules for the personal stream: a NOUN FM jingle, then a
// random YouTube pick from the seeded playlist (public/fm/playlist.json),
// then a jingle, and so on. Every listener gets their own shuffle; skip
// only affects them.

export type FmKind = 'music' | 'video' | 'podcast';

export interface FmItem {
  /** YouTube video id. */
  id: string;
  title: string;
  artist: string;
  genre: string;
  kind: FmKind;
  /** Seconds (from the YouTube listing when the playlist was built). */
  dur: number;
}

export interface FmJingle {
  id: string;
  title: string;
  /** ~4 s sting. */
  sting: string;
  /** The full jingle (10-18 s). */
  full: string;
}

/** A video or podcast after roughly this many songs. */
export const TALK_EVERY = 8;
/** Every Nth break is a full jingle; the rest are stings. */
export const FULL_JINGLE_EVERY = 4;
/** Ids remembered (per listener) so the shuffle doesn't repeat itself. */
export const RECENT_MAX = 400;

const ID_RE = /^[\w-]{11}$/;
const KINDS: readonly FmKind[] = ['music', 'video', 'podcast'];

/** Keep only well-formed playlist rows. */
export function parsePlaylist(raw: unknown): FmItem[] {
  const rows = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(rows)) return [];
  const out: FmItem[] = [];
  const seen = new Set<string>();
  for (const r of rows as Record<string, unknown>[]) {
    const id = r?.id;
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
    const kind = KINDS.includes(r.kind as FmKind) ? (r.kind as FmKind) : 'music';
    seen.add(id);
    out.push({
      id,
      title: typeof r.title === 'string' ? r.title : '',
      artist: typeof r.artist === 'string' ? r.artist : '',
      genre: typeof r.genre === 'string' ? r.genre : '',
      kind,
      dur: typeof r.dur === 'number' && Number.isFinite(r.dur) ? r.dur : 0,
    });
  }
  return out;
}

export interface PickState {
  /** Most recent first. */
  recent: readonly string[];
  /** Ids YouTube refused (embedding off, removed). */
  blocked: ReadonlySet<string>;
  /** Songs since the last video/podcast. */
  sinceTalk: number;
  lastArtist: string;
}

/**
 * The next item: a video/podcast once `TALK_EVERY` songs have played (when
 * there are any), otherwise a song. Avoids recent ids and the artist that
 * just played; relaxes those rules rather than ever returning nothing.
 */
export function pickNext(items: readonly FmItem[], s: PickState, rng: () => number): FmItem | null {
  const live = items.filter(i => !s.blocked.has(i.id));
  if (live.length === 0) return null;
  const wantTalk = s.sinceTalk >= TALK_EVERY && live.some(i => i.kind !== 'music');
  const pool = live.filter(i => (wantTalk ? i.kind !== 'music' : i.kind === 'music'));
  const base = pool.length > 0 ? pool : live;
  const recent = new Set(s.recent);
  const artist = s.lastArtist.toLowerCase();
  const tiers = [
    base.filter(i => !recent.has(i.id) && (artist === '' || i.artist.toLowerCase() !== artist)),
    base.filter(i => !recent.has(i.id)),
    base.filter(i => i.id !== s.recent[0]),
    base,
  ];
  const from = tiers.find(t => t.length > 0) ?? base;
  return from[Math.floor(rng() * from.length)] ?? null;
}

/** State after `item` started playing. */
export function afterPlay(s: PickState, item: FmItem): PickState {
  return {
    ...s,
    recent: [item.id, ...s.recent.filter(id => id !== item.id)].slice(0, RECENT_MAX),
    sinceTalk: item.kind === 'music' ? s.sinceTalk + 1 : 0,
    lastArtist: item.artist,
  };
}

/** The jingle for break number `n` (0-based): a sting, or the full cut every Nth break. */
export function jingleFor(
  jingles: readonly FmJingle[],
  n: number,
  lastId: string,
  rng: () => number,
): { jingle: FmJingle; url: string } | null {
  if (jingles.length === 0) return null;
  const pool = jingles.length > 1 ? jingles.filter(j => j.id !== lastId) : jingles;
  const jingle = pool[Math.floor(rng() * pool.length)] ?? jingles[0]!;
  const full = n % FULL_JINGLE_EVERY === 0;
  return { jingle, url: full ? jingle.full : jingle.sting };
}

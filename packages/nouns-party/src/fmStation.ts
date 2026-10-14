// ── NOUN FM: the ice cream van's radio station (shared, pure) ──────────
//
// Everything both ends agree on: the track sources we accept, the queue
// and DJ-set rules, and the timeline that says what is on air at a given
// server time. No partykit, DOM or three.js imports, so the PartyKit relay
// (fmRelay.ts) and the webapp (world2/radio) run the same code and the
// webapp's tests cover it.
//
// The timeline is a pure function of (state, now): `advance` moves the
// queue on at the exact times tracks end, so a client projecting forward
// between server broadcasts lands on the same track at the same position
// as everyone else. Each track is preceded by FM_GAP_MS of station ident.
//
// Sources (see classifyUrl):
//   youtube → only a video id, played by the official IFrame Player API
//             (visible player, YouTube's own ads). No audio extraction.
//   audius  → an audius.co track permalink, resolved through Audius' public
//             API to a stream for an <audio> element.
//   direct  → an https link straight to an audio file the DJ hosts.

export const FM_GAP_MS = 4500;
export const FM_MAX_TRACK_S = 600;
export const FM_MIN_TRACK_S = 5;
/** Tracks one rider may have waiting in the open queue. */
export const FM_PER_RIDER = 3;
export const FM_QUEUE_MAX = 40;
export const FM_SET_MAX_TRACKS = 20;
export const FM_SET_MAX_MS = 2 * 3600_000;
/** Sets are booked for "today": starting within the next 24 hours. */
export const FM_SET_AHEAD_MS = 24 * 3600_000;
export const FM_SETS_MAX = 24;
export const FM_URL_MAX = 500;

export type FmSrc =
  /** `url` is the audius.co permalink; `id` the resolved track id. */
  | { kind: 'audius'; id: string; url: string }
  | { kind: 'youtube'; id: string }
  | { kind: 'direct'; url: string };

export interface FmTrack {
  src: FmSrc;
  title: string;
  artist: string;
  /** Seconds. */
  dur: number;
}

export interface FmEntry extends FmTrack {
  id: string;
  /** Display name of the rider who queued it. */
  by: string;
  /** Owner: the rider's private key on the server, its public tag in broadcasts. */
  owner: string;
}

export interface FmSet {
  id: string;
  dj: string;
  name: string;
  owner: string;
  startAt: number;
  tracks: FmTrack[];
}

export interface FmState {
  queue: FmEntry[];
  current: { entry: FmEntry; startAt: number } | null;
  /** When the open queue last went free (its next track starts FM_GAP_MS after). */
  freeAt: number;
  sets: FmSet[];
}

export function emptyFmState(): FmState {
  return { queue: [], current: null, freeAt: 0, sets: [] };
}

// ── URLs ────────────────────────────────────────────────────────────────

export type Classified = { ok: true; src: FmSrc } | { ok: false; reason: string };

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);
const AUDIUS_HOSTS = new Set(['audius.co', 'www.audius.co']);
const AUDIO_EXT = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac)$/i;
const YT_ID = /^[\w-]{11}$/;
const AUDIUS_ID = /^[\dA-Za-z]{1,24}$/;

/**
 * Services and hosts that pull audio out of YouTube (or proxy its streams).
 * Anything mentioning them is refused outright: YouTube plays only through
 * its own embedded player.
 */
const RIPPERS = [
  'googlevideo',
  'y2mate',
  'ytmp3',
  'yt1s',
  'yt5s',
  'savefrom',
  'ssyoutube',
  'loader.to',
  'cobalt',
  'tubemp3',
  'flvto',
  'convert2mp3',
  'onlinevideoconverter',
  'mp3juice',
  'ytdl',
  'yt-dlp',
  'youtube-dl',
  'youtubedl',
  'invidious',
  'piped',
  'x2download',
  'snapsave',
  '9convert',
  'keepvid',
  'clipconverter',
  'genyoutube',
  'notube',
  'vevioz',
  'ytop',
  'tomp3',
  'yt2mp3',
  'mp3y',
];

/** The WHATWG URL bits we use (the party tsconfig has no DOM lib; workers and browsers both have URL). */
interface UrlLike {
  hostname: string;
  protocol: string;
  pathname: string;
  username: string;
  password: string;
  hash: string;
  searchParams: { get(k: string): string | null };
  toString(): string;
}
const URLCtor = (globalThis as unknown as { URL: new (s: string) => UrlLike }).URL;

function parse(raw: string): UrlLike | null {
  try {
    return new URLCtor(raw);
  } catch {
    return null;
  }
}

/** Decide what kind of link this is, or why we won't play it. */
export function classifyUrl(input: unknown): Classified {
  if (typeof input !== 'string') return { ok: false, reason: 'paste a link' };
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'paste a link' };
  if (raw.length > FM_URL_MAX) return { ok: false, reason: 'that link is too long' };
  const u = parse(raw);
  if (u === null) return { ok: false, reason: "that isn't a link" };
  const host = u.hostname.toLowerCase();
  const lower = raw.toLowerCase();
  if (RIPPERS.some(r => lower.includes(r)))
    return {
      ok: false,
      reason: 'YouTube rippers and proxies are not allowed: paste the YouTube link itself',
    };
  if (u.username !== '' || u.password !== '')
    return { ok: false, reason: 'links with logins are not allowed' };

  if (YT_HOSTS.has(host)) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      return { ok: false, reason: 'unsupported link' };
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = /^\/(shorts|embed|live|v)\/([^#/?]+)/.exec(u.pathname);
      if (m !== null) id = m[2];
    }
    if (id === null || !YT_ID.test(id))
      return { ok: false, reason: 'paste a single YouTube video link (not a playlist or channel)' };
    return { ok: true, src: { kind: 'youtube', id } };
  }

  if (u.protocol !== 'https:') return { ok: false, reason: 'only https links play on NOUN FM' };

  if (AUDIUS_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter((p: string) => p !== '');
    if (parts.length !== 2 || ['playlist', 'album', 'search', 'trending'].includes(parts[1]!))
      return { ok: false, reason: 'paste an Audius track link (audius.co/artist/track)' };
    return {
      ok: true,
      src: { kind: 'audius', id: '', url: `https://audius.co/${parts[0]}/${parts[1]}` },
    };
  }

  // Direct audio file
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(?:\d+\.){3}\d+$/.test(host) ||
    host.startsWith('[') ||
    !host.includes('.')
  )
    return { ok: false, reason: 'that host is not allowed' };
  if (lower.includes('youtube') || lower.includes('youtu.be'))
    return {
      ok: false,
      reason: 'YouTube audio must play through YouTube: paste the YouTube link itself',
    };
  if (!AUDIO_EXT.test(u.pathname))
    return {
      ok: false,
      reason: 'unsupported link: use YouTube, Audius, or an https link to an .mp3/.ogg/.m4a file',
    };
  u.hash = '';
  return { ok: true, src: { kind: 'direct', url: u.toString() } };
}

/** A source as it arrives from a client: re-check it against the rules. */
export function validSrc(v: unknown): FmSrc | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (s.kind === 'youtube')
    return typeof s.id === 'string' && YT_ID.test(s.id) ? { kind: 'youtube', id: s.id } : null;
  if (s.kind === 'audius') {
    if (typeof s.id !== 'string' || !AUDIUS_ID.test(s.id)) return null;
    const c = classifyUrl(s.url);
    return c.ok && c.src.kind === 'audius' ? { kind: 'audius', id: s.id, url: c.src.url } : null;
  }
  if (s.kind === 'direct') {
    const c = classifyUrl(s.url);
    return c.ok && c.src.kind === 'direct' ? c.src : null;
  }
  return null;
}

/** Same track? (Used to spot duplicates in the queue.) */
export function srcKey(s: FmSrc): string {
  return s.kind === 'direct' ? `d:${s.url}` : `${s.kind === 'youtube' ? 'y' : 'a'}:${s.id}`;
}

// ── Text ────────────────────────────────────────────────────────────────

/** Free text (titles, artists): printable, no markup, single-spaced. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f<>\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Names (riders, DJs, sets): a tighter alphabet. */
export function cleanName(v: unknown, max = 20, fallback = 'NOUN'): string {
  if (typeof v !== 'string') return fallback;
  const s = v
    .replace(/[^\p{L}\p{N} _.'&!?#⌐◨-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return s === '' ? fallback : s;
}

/** A track as it arrives from a client, cleaned and checked, or why not. */
export function validTrack(v: unknown): FmTrack | string {
  if (typeof v !== 'object' || v === null) return 'bad track';
  const t = v as Record<string, unknown>;
  const src = validSrc(t.src);
  if (src === null) return 'that link is not allowed on NOUN FM';
  const dur = Number(t.dur);
  if (!Number.isFinite(dur) || dur < FM_MIN_TRACK_S) return 'track length unknown or too short';
  if (dur > FM_MAX_TRACK_S) return `tracks are capped at ${FM_MAX_TRACK_S / 60} minutes`;
  return {
    src,
    title: cleanText(t.title, 80) || 'untitled',
    artist: cleanText(t.artist, 48) || 'unknown',
    dur: Math.round(dur * 10) / 10,
  };
}

/** Public tag for a private rider key (FNV-1a, two lanes): shows "mine" without leaking the key. */
export function ownerTag(key: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (a >>> 7), 0x01000193) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

// ── Timeline ────────────────────────────────────────────────────────────

/** Total length of a set: each track gets its ident in front. */
export function setLength(tracks: FmTrack[]): number {
  let ms = 0;
  for (const t of tracks) ms += FM_GAP_MS + t.dur * 1000;
  return ms;
}

export function setEnd(s: FmSet): number {
  return s.startAt + setLength(s.tracks);
}

/**
 * Bring the open queue up to `now`: finished tracks drop off and the next
 * one starts FM_GAP_MS after the last ended (never at the time somebody
 * happened to look). A DJ set cuts in at its start time and the queue
 * waits until it ends. Pure and idempotent: advance(s, t2) gives the same
 * result as advance(s, t1) then advance(s, t2). Returns true on a change.
 */
export function advance(s: FmState, now: number): boolean {
  let changed = false;
  for (let guard = 0; guard < 256; guard++) {
    const c = s.current;
    if (c !== null) {
      const end = c.startAt + c.entry.dur * 1000;
      const cut = s.sets.find(x => x.startAt > c.startAt - FM_GAP_MS && x.startAt < end);
      if (cut !== undefined && cut.startAt <= now) {
        s.current = null;
        s.freeAt = setEnd(cut);
        changed = true;
        continue;
      }
      if (end <= now) {
        s.current = null;
        s.freeAt = end;
        changed = true;
        continue;
      }
      break;
    }
    if (s.queue.length === 0) break;
    const free = s.freeAt;
    const blocking = s.sets.find(x => x.startAt <= free + FM_GAP_MS && setEnd(x) > free);
    if (blocking !== undefined) {
      s.freeAt = setEnd(blocking);
      changed = true;
      continue;
    }
    if (free > now) break;
    s.current = { entry: s.queue.shift()!, startAt: free + FM_GAP_MS };
    changed = true;
  }
  const n = s.sets.length;
  s.sets = s.sets.filter(x => setEnd(x) > now - 60_000);
  return changed || n !== s.sets.length;
}

export interface FmOnAir {
  source: 'set' | 'queue' | 'fallback';
  /** Unique per play (seeds the ident, spots changes). '' for the fallback. */
  key: string;
  track: (FmTrack & { id?: string; by?: string; owner?: string }) | null;
  /** Track start (server ms); the ident runs in the FM_GAP_MS before it. */
  startAt: number;
  endAt: number;
  set: { id: string; dj: string; name: string; index: number; count: number } | null;
}

const FALLBACK: FmOnAir = {
  source: 'fallback',
  key: '',
  track: null,
  startAt: 0,
  endAt: 0,
  set: null,
};

/**
 * What's on air at `now` (call `advance` first): a scheduled set wins, then
 * the open queue, else the procedural pirate station.
 */
export function onAir(s: FmState, now: number): FmOnAir {
  const live = s.sets.find(x => x.startAt <= now && now < setEnd(x));
  if (live !== undefined) {
    let t = live.startAt;
    for (let i = 0; i < live.tracks.length; i++) {
      const tr = live.tracks[i]!;
      const start = t + FM_GAP_MS;
      const end = start + tr.dur * 1000;
      if (now < end)
        return {
          source: 'set',
          key: `${live.id}:${i}`,
          track: tr,
          startAt: start,
          endAt: end,
          set: { id: live.id, dj: live.dj, name: live.name, index: i, count: live.tracks.length },
        };
      t = end;
    }
  }
  const c = s.current;
  if (c !== null && now >= c.startAt - FM_GAP_MS && now < c.startAt + c.entry.dur * 1000)
    return {
      source: 'queue',
      key: c.entry.id,
      track: c.entry,
      startAt: c.startAt,
      endAt: c.startAt + c.entry.dur * 1000,
      set: null,
    };
  return FALLBACK;
}

/** When the on-air answer next changes (for the server's wake-up timer). */
export function nextChange(s: FmState, now: number): number | null {
  let best = Infinity;
  const at = (t: number) => {
    if (t > now && t < best) best = t;
  };
  for (const x of s.sets) {
    at(x.startAt);
    let t = x.startAt;
    for (const tr of x.tracks) {
      t += FM_GAP_MS + tr.dur * 1000;
      at(t);
    }
  }
  if (s.current !== null) {
    at(s.current.startAt);
    at(s.current.startAt + s.current.entry.dur * 1000);
  }
  if (s.queue.length > 0) at(s.freeAt + FM_GAP_MS);
  return best === Infinity ? null : best;
}

// ── Queue + set rules (owner = the rider's private key) ────────────────

export function addEntry(
  s: FmState,
  track: unknown,
  owner: string,
  by: unknown,
  now: number,
  id: string,
): string | null {
  const t = validTrack(track);
  if (typeof t === 'string') return t;
  advance(s, now);
  if (s.queue.filter(e => e.owner === owner).length >= FM_PER_RIDER)
    return `you already have ${FM_PER_RIDER} tracks waiting`;
  if (s.queue.length >= FM_QUEUE_MAX) return 'the queue is full, try again later';
  const k = srcKey(t.src);
  if (s.queue.some(e => srcKey(e.src) === k) || (s.current && srcKey(s.current.entry.src) === k))
    return "that track's already queued";
  // An idle station starts from now, not from whenever it last went quiet
  if (s.current === null && s.queue.length === 0) s.freeAt = Math.max(s.freeAt, now);
  s.queue.push({ ...t, id, by: cleanName(by, 20), owner });
  advance(s, now);
  return null;
}

export function removeEntry(s: FmState, id: string, owner: string): string | null {
  const i = s.queue.findIndex(e => e.id === id);
  if (i < 0) return 'not in the queue';
  if (s.queue[i]!.owner !== owner) return 'you can only remove your own tracks';
  s.queue.splice(i, 1);
  return null;
}

/** Swap one of your entries with your next one up (-1) or down (+1); others keep their places. */
export function moveEntry(s: FmState, id: string, owner: string, dir: number): string | null {
  const i = s.queue.findIndex(e => e.id === id);
  if (i < 0) return 'not in the queue';
  if (s.queue[i]!.owner !== owner) return 'you can only move your own tracks';
  const step = dir < 0 ? -1 : 1;
  for (let j = i + step; j >= 0 && j < s.queue.length; j += step) {
    if (s.queue[j]!.owner === owner) {
      const a = s.queue[i]!;
      s.queue[i] = s.queue[j]!;
      s.queue[j] = a;
      return null;
    }
  }
  return null; // already at the end of your own run
}

/** End the current queue track now (its owner, or an admin). */
export function skipCurrent(s: FmState, owner: string | null, now: number): string | null {
  advance(s, now);
  const c = s.current;
  if (c === null) return 'nothing from the queue is playing';
  if (owner !== null && c.entry.owner !== owner) return 'only whoever queued it can skip it';
  s.current = null;
  s.freeAt = now;
  advance(s, now);
  return null;
}

export function addSet(
  s: FmState,
  input: unknown,
  owner: string,
  now: number,
  id: string,
): string | null {
  if (typeof input !== 'object' || input === null) return 'bad set';
  const d = input as Record<string, unknown>;
  const raw = Array.isArray(d.tracks) ? d.tracks : [];
  if (raw.length === 0) return 'add at least one track to the set';
  if (raw.length > FM_SET_MAX_TRACKS) return `sets are capped at ${FM_SET_MAX_TRACKS} tracks`;
  const tracks: FmTrack[] = [];
  for (const r of raw) {
    const t = validTrack(r);
    if (typeof t === 'string') return t;
    tracks.push(t);
  }
  const startAt = Math.round(Number(d.startAt));
  if (!Number.isFinite(startAt)) return 'pick a start time';
  if (startAt < now - 60_000) return 'that time has passed';
  if (startAt > now + FM_SET_AHEAD_MS) return 'sets are booked for today (the next 24 hours)';
  const len = setLength(tracks);
  if (len > FM_SET_MAX_MS) return `sets are capped at ${FM_SET_MAX_MS / 3600_000} hours`;
  advance(s, now);
  const mine = s.sets.find(x => x.owner === owner);
  if (mine !== undefined && mine.startAt <= now) return 'your set is live: cancel it first';
  const end = startAt + len;
  const clash = s.sets.find(x => x !== mine && x.startAt < end && setEnd(x) > startAt);
  if (clash !== undefined) return `that slot overlaps ${clash.dj}'s set`;
  if (mine === undefined && s.sets.length >= FM_SETS_MAX) return "today's schedule is full";
  s.sets = s.sets.filter(x => x !== mine);
  s.sets.push({
    id,
    dj: cleanName(d.dj, 20, 'DJ NOUN'),
    name: cleanName(d.name, 32, 'untitled set'),
    owner,
    startAt,
    tracks,
  });
  s.sets.sort((a, b) => a.startAt - b.startAt);
  advance(s, now);
  return null;
}

/** Cancel a set (its DJ, or an admin when owner is null). A live set ends now. */
export function cancelSet(
  s: FmState,
  id: string,
  owner: string | null,
  now: number,
): string | null {
  const x = s.sets.find(y => y.id === id);
  if (x === undefined) return 'no such set';
  if (owner !== null && x.owner !== owner) return 'only its DJ can cancel a set';
  s.sets = s.sets.filter(y => y !== x);
  if (s.current === null && s.freeAt > now) s.freeAt = now;
  advance(s, now);
  return null;
}

/** Snapshot from storage or the wire, re-validated (null if unusable). */
export function loadState(v: unknown): FmState | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  const s = emptyFmState();
  s.freeAt = Number(d.freeAt) || 0;
  const entry = (e: unknown): FmEntry | null => {
    if (typeof e !== 'object' || e === null) return null;
    const r = e as Record<string, unknown>;
    const t = validTrack(r);
    if (typeof t === 'string' || typeof r.id !== 'string' || typeof r.owner !== 'string')
      return null;
    return { ...t, id: r.id.slice(0, 40), by: cleanName(r.by, 20), owner: r.owner.slice(0, 80) };
  };
  if (Array.isArray(d.queue))
    for (const e of d.queue.slice(0, FM_QUEUE_MAX)) {
      const x = entry(e);
      if (x !== null) s.queue.push(x);
    }
  const c = d.current as Record<string, unknown> | null | undefined;
  if (c !== null && c !== undefined) {
    const x = entry(c.entry);
    const at = Number(c.startAt);
    if (x !== null && Number.isFinite(at)) s.current = { entry: x, startAt: at };
  }
  if (Array.isArray(d.sets))
    for (const r of d.sets.slice(0, FM_SETS_MAX)) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      const tracks: FmTrack[] = [];
      for (const t of Array.isArray(o.tracks) ? o.tracks.slice(0, FM_SET_MAX_TRACKS) : []) {
        const v2 = validTrack(t);
        if (typeof v2 !== 'string') tracks.push(v2);
      }
      const startAt = Number(o.startAt);
      if (tracks.length === 0 || !Number.isFinite(startAt) || typeof o.id !== 'string') continue;
      s.sets.push({
        id: o.id.slice(0, 40),
        dj: cleanName(o.dj, 20, 'DJ NOUN'),
        name: cleanName(o.name, 32, 'untitled set'),
        owner: typeof o.owner === 'string' ? o.owner.slice(0, 80) : '',
        startAt,
        tracks,
      });
    }
  s.sets.sort((a, b) => a.startAt - b.startAt);
  return s;
}

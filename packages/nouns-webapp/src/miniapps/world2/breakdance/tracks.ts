// ── Noun Breaks songs: the track manifest and the song ↔ battle clock map ─
//
// Battle music is either the generated break beat (view/drums.ts, the
// default "house" entry, no file) or a real song: a file in
// public/breaks/tracks/ listed in public/breaks/tracks.json as
//
//   { id, title, artist, file, bpm, offset, license, source? }
//
// `bpm` is the song's tempo (the battle runs at it) and `offset` the seconds
// from the start of the file to its first downbeat. That downbeat is the
// battle's first beat (battle clock 0, the intro bar), so every bar of the
// song lines up with the battle's bars: battle time t plays the file at
// offset + t. A song shorter than the battle loops on whole bars.
//
// `scripts/breaks/analyze.mjs <file>` estimates bpm + offset for a new track.
// The host's track id rides in BattleConfig.track; a client that can't load
// the file plays the generated beat at the same bpm (it's the same grid).

import { INTRO_BEATS, MAX_BPM, MIN_BPM } from './sim/clock';

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  /** File name in public/breaks/tracks/, or null for the generated beat. */
  file: string | null;
  /** Tempo; null = the battle format's own (the generated beat follows any). */
  bpm: number | null;
  /** Seconds from the start of the file to the first downbeat. */
  offset: number;
  license: string;
  /** Where the file came from (a URL), for the license. */
  source?: string;
}

export const HOUSE_ID = 'house';

export const HOUSE_TRACK: TrackInfo = {
  id: HOUSE_ID,
  title: 'NOUN BREAKS (house beat)',
  artist: 'noun.wtf',
  file: null,
  bpm: null,
  offset: 0,
  license: 'generated in the browser, no file',
};

export const MANIFEST_URL = '/breaks/tracks.json';
export const TRACKS_DIR = '/breaks/tracks/';

const ID = /^[\da-z][\d_a-z-]{0,39}$/;
const FILE = /^[\dA-Za-z][\w .-]{0,95}\.(mp3|ogg|opus|m4a|aac|wav|flac|webm)$/;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The manifest, checked: bad entries dropped, the generated beat always first. */
export function readManifest(v: unknown): TrackInfo[] {
  const out: TrackInfo[] = [HOUSE_TRACK];
  if (!Array.isArray(v)) return out;
  for (const e of v.slice(0, 64)) {
    if (e === null || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!ID.test(id)) continue;
    if (id === HOUSE_ID) {
      // The generated beat can be retitled, never given a file
      out[0] = {
        ...HOUSE_TRACK,
        title: str(r.title, 60) || HOUSE_TRACK.title,
        license: str(r.license, 200) || HOUSE_TRACK.license,
      };
      continue;
    }
    if (out.some(t => t.id === id)) continue;
    const file = typeof r.file === 'string' && FILE.test(r.file) ? r.file : null;
    const bpm = typeof r.bpm === 'number' && Number.isFinite(r.bpm) ? r.bpm : NaN;
    const offset = typeof r.offset === 'number' && Number.isFinite(r.offset) ? r.offset : 0;
    const license = str(r.license, 200);
    // A song needs a file, a tempo the battle clock can run at, and a license
    if (file === null || !(bpm >= MIN_BPM && bpm <= MAX_BPM) || license === '') continue;
    const t: TrackInfo = {
      id,
      title: str(r.title, 60) || id,
      artist: str(r.artist, 60),
      file,
      bpm,
      offset: Math.min(600, Math.max(0, offset)),
      license,
    };
    const src = str(r.source, 300);
    if (/^https:\/\//.test(src)) t.source = src;
    out.push(t);
  }
  return out;
}

let manifest: Promise<TrackInfo[]> | null = null;

/** Fetch the manifest once (the generated beat alone when it isn't there). */
export function loadManifest(fetchFn: typeof fetch = fetch): Promise<TrackInfo[]> {
  manifest ??= fetchFn(MANIFEST_URL)
    .then(r => (r.ok ? r.json() : null))
    .then(readManifest, () => [HOUSE_TRACK]);
  return manifest;
}

export function trackById(list: readonly TrackInfo[], id: string | undefined): TrackInfo {
  return list.find(t => t.id === id) ?? HOUSE_TRACK;
}

export function trackUrl(t: TrackInfo): string | null {
  return t.file === null ? null : TRACKS_DIR + encodeURIComponent(t.file);
}

const bytes = new Map<string, Promise<ArrayBuffer | null>>();

/** The track's file (fetched once, shared by the menu preload and the view). */
export function fetchTrack(
  t: TrackInfo,
  fetchFn: typeof fetch = fetch,
): Promise<ArrayBuffer | null> {
  const url = trackUrl(t);
  if (url === null) return Promise.resolve(null);
  let p = bytes.get(url);
  if (p === undefined) {
    p = fetchFn(url).then(
      r => (r.ok ? r.arrayBuffer() : null),
      () => null,
    );
    bytes.set(url, p);
    void p.then(b => {
      if (b === null) bytes.delete(url);
    });
  }
  return p;
}

// ── the song on the battle clock (pure, tested) ──

/** File position (s) at battle time `t`: the first downbeat is battle time 0. */
export function songPos(t: number, offset: number): number {
  return offset + t;
}

/** Battle time (s) of beat `beat` at `bpm` (sim/clock's grid). */
export function beatTime(beat: number, bpm: number): number {
  return ((beat + INTRO_BEATS) * 60) / bpm;
}

/**
 * The whole bars of the song after its first downbeat, as a loop
 * [start, end) in file seconds; null when there isn't a bar.
 */
export function songLoop(
  duration: number,
  offset: number,
  bpm: number,
): { start: number; end: number } | null {
  const bar = (4 * 60) / bpm;
  const bars = Math.floor((duration - offset) / bar + 1e-6);
  return bars >= 1 ? { start: offset, end: offset + bars * bar } : null;
}

/** Wrap a file position into the loop (positions before it stay as they are). */
export function wrapPos(pos: number, loop: { start: number; end: number } | null): number {
  if (loop === null || pos < loop.end) return pos;
  const len = loop.end - loop.start;
  return loop.start + ((pos - loop.start) % len);
}

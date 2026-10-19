// ── NOUN FM's own recordings: jingles, interludes, house songs ───────────
//
// Owner-made files under public/world2/fm/ (built by scripts/fm-audio.ts):
//   interludes/manifest.json  { interludes: [{ id, title, file (≤4.3 s sting),
//                               duration, full, fullDuration, intro }] }
//   songs/manifest.json       { songs: [{ id, title, artist, file, duration }] }
// Manifests load once per page; audio is fetched + decoded once and cached.

import { identSeed } from './idents';

export const FM_BASE = '/world2/fm';

export interface Interlude {
  id: string;
  title: string;
  /** The ≤4.3 s sting (URL). */
  sting: string;
  stingDur: number;
  /** The full-length file (URL). */
  full: string;
  fullDur: number;
  /** Weight in the start-of-game intro rotation. */
  intro: number;
}

export interface HouseSong {
  id: string;
  title: string;
  artist: string;
  url: string;
  dur: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function str(v: unknown, max = 80): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

const SAFE_FILE = /^[\w.-]{1,80}\.(mp3|m4a|ogg)$/;

export function parseInterludes(v: unknown): Interlude[] {
  const raw = (v as { interludes?: unknown } | null)?.interludes;
  if (!Array.isArray(raw)) return [];
  const out: Interlude[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (typeof r !== 'object' || r === null) continue;
    const file = str(r.file);
    const full = str(r.full);
    if (!SAFE_FILE.test(file) || !SAFE_FILE.test(full)) continue;
    const stingDur = num(r.duration);
    const fullDur = num(r.fullDuration);
    if (stingDur === 0 || fullDur === 0) continue;
    out.push({
      id: str(r.id, 60) || file,
      title: str(r.title) || 'Noun F-M',
      sting: `${FM_BASE}/interludes/${file}`,
      stingDur,
      full: `${FM_BASE}/interludes/${full}`,
      fullDur,
      intro: Math.max(0, Number(r.intro) || 0),
    });
  }
  return out;
}

export function parseSongs(v: unknown): HouseSong[] {
  const raw = (v as { songs?: unknown } | null)?.songs;
  if (!Array.isArray(raw)) return [];
  const out: HouseSong[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (typeof r !== 'object' || r === null) continue;
    const file = str(r.file);
    const dur = num(r.duration);
    if (!SAFE_FILE.test(file) || dur < 5) continue;
    out.push({
      id: str(r.id, 60) || file,
      title: str(r.title) || file,
      artist: str(r.artist, 40) || 'NOUN FM',
      url: `${FM_BASE}/songs/${file}`,
      dur,
    });
  }
  return out;
}

/** Share of between-song gaps that get a recorded sting (when there are any). */
export const FILE_STING_P = 0.6;

/**
 * What fills the gap before play `key`: one of the recorded stings or the
 * synth ident. Seeded by the key, so every listener hears the same.
 */
export function pickGapSound(
  key: string,
  stings: number,
): { kind: 'file'; index: number } | { kind: 'synth' } {
  if (stings <= 0) return { kind: 'synth' };
  const h = identSeed(`${key}|sting`);
  if (h % 1000 >= FILE_STING_P * 1000) return { kind: 'synth' };
  return { kind: 'file', index: (h >>> 10) % stings };
}

/**
 * The intro's second jingle (after the first song): a weighted pick by
 * `intro` among the recordings other than the main jingle (the first entry),
 * so it's never the same one twice in a row.
 */
export function pickSecondJingle(list: Interlude[], r: number): Interlude | null {
  const pool = list.slice(1).filter(i => i.intro > 0);
  if (pool.length === 0) return null;
  const total = pool.reduce((s, i) => s + i.intro, 0);
  let x = r * total;
  for (const i of pool) {
    x -= i.intro;
    if (x < 0) return i;
  }
  return pool[pool.length - 1]!;
}

// ── Loading ─────────────────────────────────────────────────────────────

let manifests: Promise<{ interludes: Interlude[]; songs: HouseSong[] }> | null = null;

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** Both manifests (empty lists if they're missing). */
export function loadFmManifests(): Promise<{ interludes: Interlude[]; songs: HouseSong[] }> {
  manifests ??= Promise.all([
    getJson(`${FM_BASE}/interludes/manifest.json`).then(parseInterludes, () => []),
    getJson(`${FM_BASE}/songs/manifest.json`).then(parseSongs, () => []),
  ]).then(([interludes, songs]) => ({ interludes, songs }));
  return manifests;
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Fetch + decode once per URL (null when it can't load or decode). */
export function loadBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (p === undefined) {
    p = fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(b => ctx.decodeAudioData(b))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

/** Play a decoded buffer into `out`; returns a stop(fadeS) handle. */
export function playBuffer(
  ctx: BaseAudioContext,
  out: AudioNode,
  buf: AudioBuffer,
  opts: { gain?: number; offset?: number; onEnded?: () => void } = {},
): { stop: (fade?: number) => void; seconds: number } {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = opts.gain ?? 1;
  src.connect(g).connect(out);
  const off = Math.max(0, Math.min(buf.duration, opts.offset ?? 0));
  let done = false;
  src.onended = () => {
    if (done) return;
    done = true;
    g.disconnect();
    opts.onEnded?.();
  };
  src.start(ctx.currentTime + 0.02, off);
  return {
    seconds: buf.duration - off,
    stop: (fade = 0.3) => {
      if (done) return;
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
      try {
        src.stop(t + Math.max(0.01, fade) + 0.02);
      } catch {
        // already stopped
      }
    },
  };
}

// ── Voice Booth: line keys, clip limits, trimming and who says what ──────
//
// Pure (no DOM, no WebAudio): shared by the booth UI, the rider in game and
// the `world-voice` Netlify function, so client and server apply the same
// rules.
//
// A clip is one live recording of one callout line, keyed `<event>.<index>`
// (the line's place in callouts.ts) plus `.c` for a line's clean
// alternative. The recording is kept exactly as the browser's MediaRecorder
// made it (opus in webm, or AAC in mp4 on Safari); silence trimming and the
// level are stored beside it as `t0`/`t1`/`gain` and applied at playback, so
// nothing is re-encoded and the upload stays small.
//
// Where a rider's line comes from (VoiceSource), best first:
//   'recording'   the player's own clip for that line
//   'local-model' a Piper voice model the player trained on their own voice
//                 and loaded into this browser (never uploaded; only the
//                 player hears it)
//   'tts'         the stock Piper voice from their Noun seed
// A future server-side cloning backend slots in as one more source here (and
// one more manifest field) without migrating stored clips.

import { CALLOUTS, lineText, type CalloutEvent } from '../callouts';

export type VoiceSource = 'recording' | 'local-model' | 'tts';

/** Every source, best first (the fallback order). */
export const SOURCE_ORDER: readonly VoiceSource[] = ['recording', 'local-model', 'tts'];

/** Longest callout clip (s) and the recorder's hard stop. */
export const CLIP_MAX_S = 4;
/** Longest training sentence (s). */
export const TRAIN_MAX_S = 8;
/** Biggest uploaded clip (bytes). */
export const CLIP_MAX_BYTES = 64 * 1024;
/** Most clips one player can have on the server. */
export const MAX_CLIPS = 40;
/** Audio the server accepts (codec params allowed after a `;`). */
export const CLIP_MIMES = ['audio/webm', 'audio/mp4', 'audio/ogg'] as const;
export type ClipMime = (typeof CLIP_MIMES)[number];

const EVENTS: readonly CalloutEvent[] = ['bail', 'speed', 'record'];
const KEY_RE = /^(bail|speed|record)\.(\d{1,2})(\.c)?$/;
/** A player's public voice tag (hash of their private rider id, see world-voice.ts). */
export const TAG_RE = /^[\da-f]{24}$/;

/** A line's recording key. `clean` only changes the key when the line has a clean alternative. */
export function clipKey(ev: CalloutEvent, index: number, clean: boolean): string {
  const l = CALLOUTS[ev][index];
  return clean && l?.clean !== undefined ? `${ev}.${index}.c` : `${ev}.${index}`;
}

/** A key → its line (null for anything that isn't a real line). */
export function parseClipKey(
  key: unknown,
): { ev: CalloutEvent; index: number; clean: boolean; text: string } | null {
  if (typeof key !== 'string') return null;
  const m = KEY_RE.exec(key);
  if (m === null) return null;
  const ev = m[1] as CalloutEvent;
  const index = Number(m[2]);
  const line = CALLOUTS[ev][index];
  if (line === undefined) return null;
  const clean = m[3] !== undefined;
  if (clean && line.clean === undefined) return null;
  return { ev, index, clean, text: lineText(line, clean) };
}

/** Every key that exists (both versions of lines with a clean alternative). */
export function allClipKeys(): string[] {
  const out: string[] = [];
  for (const ev of EVENTS)
    CALLOUTS[ev].forEach((l, i) => {
      out.push(clipKey(ev, i, false));
      if (l.clean !== undefined) out.push(clipKey(ev, i, true));
    });
  return out;
}

export interface BoothLine {
  key: string;
  ev: CalloutEvent;
  index: number;
  text: string;
  /** The swear version of a line that clean mode replaces. */
  swear: boolean;
}

/**
 * The lines the booth lists. Clean mode: the clean alternatives (plus the
 * swear versions when the player asks for them). Otherwise the lines as the
 * rider says them.
 */
export function boothLines(clean: boolean, withSwears: boolean): BoothLine[] {
  const out: BoothLine[] = [];
  for (const ev of EVENTS)
    CALLOUTS[ev].forEach((l, index) => {
      const key = clipKey(ev, index, clean);
      out.push({
        key,
        ev,
        index,
        text: lineText(l, clean),
        swear: !clean && l.clean !== undefined,
      });
      if (clean && withSwears && l.clean !== undefined)
        out.push({ key: clipKey(ev, index, false), ev, index, text: l.say, swear: true });
    });
  return out;
}

/** Mime as the server stores it: the bare type, if it's allowed. */
export function baseMime(mime: unknown): ClipMime | null {
  if (typeof mime !== 'string') return null;
  const b = mime.split(';')[0]!.trim().toLowerCase();
  return (CLIP_MIMES as readonly string[]).includes(b) ? (b as ClipMime) : null;
}

/** Do the bytes look like the container they claim to be? */
export function sniffMime(bytes: Uint8Array, mime: ClipMime): boolean {
  if (bytes.length < 12) return false;
  if (mime === 'audio/webm')
    return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === 'audio/ogg')
    return bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  // mp4: a box size, then 'ftyp'
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

/** Playback trim + level, stored next to a clip. */
export interface ClipShape {
  /** Start and end of the speech (s into the recording). */
  t0: number;
  t1: number;
  /** Gain that brings the speech's peak to the target level. */
  gain: number;
  /** The recording's whole length (s). */
  dur: number;
}

/** What the server keeps per clip (the manifest entry). */
export interface ClipMeta extends ClipShape {
  mime: ClipMime;
  bytes: number;
  /** Version (upload time, ms): clip URLs carry it, so they cache forever. */
  v: number;
  /** Hidden by a moderator: never served. */
  hidden?: boolean;
}

export interface VoiceManifest {
  tag: string;
  clips: Record<string, ClipMeta>;
}

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** A clip's trim/level fields, as posted (rounded, bounded). */
export function validateShape(raw: unknown, maxS = CLIP_MAX_S): Check<ClipShape> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const dur = num(o.dur);
  const t0 = num(o.t0);
  const t1 = num(o.t1);
  const gain = num(o.gain);
  // A little slack: MediaRecorder stops a frame or two after the timer
  if (!(dur > 0 && dur <= maxS + 0.6)) return { ok: false, error: `clips are ${maxS} s at most` };
  if (!(t0 >= 0 && t1 > t0 && t1 <= dur + 0.05)) return { ok: false, error: 'bad trim' };
  if (!(gain > 0 && gain <= GAIN_MAX)) return { ok: false, error: 'bad gain' };
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { ok: true, value: { t0: r(t0), t1: r(t1), gain: r(gain), dur: r(dur) } };
}

/** An upload's fields (not the audio bytes: see validateClipBytes). */
export function validateClip(raw: unknown): Check<ClipShape & { key: string; mime: ClipMime }> {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (parseClipKey(o.key) === null) return { ok: false, error: 'unknown line' };
  const mime = baseMime(o.mime);
  if (mime === null) return { ok: false, error: 'audio must be webm, mp4 or ogg' };
  const s = validateShape(o);
  if (!s.ok) return s;
  return { ok: true, value: { ...s.value, key: o.key as string, mime } };
}

/** The audio bytes themselves: size cap and container check. */
export function validateClipBytes(bytes: Uint8Array, mime: ClipMime): Check<Uint8Array> {
  if (bytes.length === 0) return { ok: false, error: 'empty clip' };
  if (bytes.length > CLIP_MAX_BYTES) return { ok: false, error: 'clip too big (64 KB max)' };
  if (!sniffMime(bytes, mime)) return { ok: false, error: `that is not ${mime}` };
  return { ok: true, value: bytes };
}

// ── Trim + normalise (from decoded samples) ──────────────────────────────

/** Peak the speech is brought to. */
export const TARGET_PEAK = 0.89;
/** Never boost more than this (a whisper stays a whisper, noise isn't pumped). */
export const GAIN_MAX = 8;
/** Below this peak there's nothing there. */
const SILENT_PEAK = 0.02;

/**
 * Where the speech is in a recording, and the gain for a steady level.
 * Speech = 10 ms windows whose RMS clears a threshold set from the loudest
 * window (so a noisy room still trims), padded 60 ms each side.
 * null when the clip is silence.
 */
export function analyseClip(samples: Float32Array, rate: number): ClipShape | null {
  const n = samples.length;
  const dur = n / rate;
  if (n === 0 || rate <= 0) return null;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
  }
  if (peak < SILENT_PEAK) return null;
  const win = Math.max(1, Math.round(rate * 0.01));
  const rms: number[] = [];
  let loud = 0;
  for (let i = 0; i < n; i += win) {
    let s = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) s += samples[j]! * samples[j]!;
    const r = Math.sqrt(s / (end - i));
    rms.push(r);
    if (r > loud) loud = r;
  }
  const thr = Math.max(0.006, loud * 0.12);
  let a = rms.findIndex(r => r >= thr);
  let b = rms.length - 1;
  while (b > a && rms[b]! < thr) b--;
  if (a < 0) a = 0;
  const pad = 0.06;
  const t0 = Math.max(0, (a * win) / rate - pad);
  const t1 = Math.min(dur, ((b + 1) * win) / rate + pad);
  // Peak inside the trimmed region
  let p = 0;
  for (let i = Math.floor(t0 * rate); i < Math.min(n, Math.ceil(t1 * rate)); i++) {
    const v = Math.abs(samples[i]!);
    if (v > p) p = v;
  }
  const gain = Math.min(GAIN_MAX, TARGET_PEAK / Math.max(p, 1e-4));
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { t0: r(t0), t1: r(t1), gain: r(gain), dur: r(dur) };
}

// ── Who says a line ──────────────────────────────────────────────────────

export interface SourceInputs {
  /** A recording exists for the line's key. */
  hasClip: boolean;
  /** The player's "use my voice" (own rider) or "hear other players' voices" (others). */
  allowClip: boolean;
  /** A trained voice model is loaded (own rider only). */
  localModel: boolean;
  /** Stock real voices allowed right now. */
  tts: boolean;
}

/** Best available source for a line, recording > local model > TTS (null: stay quiet). */
export function pickSource(i: SourceInputs): VoiceSource | null {
  if (i.hasClip && i.allowClip) return 'recording';
  if (i.localModel) return 'local-model';
  if (i.tts) return 'tts';
  return null;
}

export interface ResolvedLine {
  key: string;
  text: string;
  source: VoiceSource | null;
}

/**
 * A callout heard from someone: which recording plays, or what text the
 * fallback says. The listener's clean mode wins: a swear line from a rider
 * whose game isn't clean plays their clean recording (or the clean text).
 * Without a clean recording, a clean listener never hears the swear clip.
 */
export function resolveCallout(o: {
  ev: CalloutEvent;
  index: number;
  /** The sender's mode when it fired. */
  clean: boolean;
  /** The listener's clean mode. */
  listenerClean: boolean;
  /** Keys with a playable recording (a manifest, or the player's own clips). */
  clips: ReadonlySet<string> | Record<string, unknown>;
  allowClip: boolean;
  localModel?: boolean;
  tts: boolean;
}): ResolvedLine | null {
  const line = CALLOUTS[o.ev]?.[o.index];
  if (line === undefined) return null;
  const clean = o.clean || o.listenerClean;
  const key = clipKey(o.ev, o.index, clean);
  const has =
    o.clips instanceof Set ? o.clips.has(key) : Object.prototype.hasOwnProperty.call(o.clips, key);
  const source = pickSource({
    hasClip: has,
    allowClip: o.allowClip,
    localModel: o.localModel === true,
    tts: o.tts,
  });
  return { key, text: lineText(line, clean), source };
}

/** Visible clips of a manifest from the server (hidden ones and unknown keys dropped). */
export function playableClips(m: unknown): Record<string, ClipMeta> {
  const out: Record<string, ClipMeta> = {};
  const clips = ((m ?? {}) as { clips?: unknown }).clips;
  if (clips === null || typeof clips !== 'object') return out;
  for (const [k, v] of Object.entries(clips as Record<string, unknown>)) {
    if (parseClipKey(k) === null || v === null || typeof v !== 'object') continue;
    const c = v as ClipMeta;
    if (c.hidden === true || baseMime(c.mime) === null || !(c.v > 0)) continue;
    const s = validateShape(c);
    if (!s.ok) continue;
    out[k] = { ...c, ...s.value };
  }
  return out;
}

/** "X of N recorded" for the lines the booth lists. */
export function progress(lines: readonly BoothLine[], have: ReadonlySet<string>) {
  const done = lines.filter(l => have.has(l.key)).length;
  return { done, total: lines.length };
}

// ── Character voices: who sounds like what, and when each syllable lands ──
//
// Pure (no WebAudio): VoiceBox.ts turns a plan from here into sound.
//
// Every voice is derived from a real Noun seed, deterministically: the same
// seed always gives the same pitch, timbre, formant scale and speed, so a
// character sounds the same for everyone and every session. A few of the cast
// get a hand-tuned preset on top (the Oracle low and slow with a crystal
// shimmer, the Twins two voices in unison).
//
// Speech is Animal Crossing-style babble: one short vowel "blip" per syllable
// as the text types out. `charTimes` is the single clock for both: the
// subtitle typewriter reveals character i at times[i], and the syllables fire
// on the letters that start them, so sound and text always line up.

export type Wave = 'square' | 'sawtooth' | 'triangle';

export interface VoiceParams {
  /** Fundamental (Hz). */
  base: number;
  /** Random pitch spread per syllable (semitones). */
  range: number;
  /** Typing speed (characters per second). */
  speed: number;
  wave: Wave;
  /** Formant scale (1 = adult; above is smaller / brighter, below is bigger / darker). */
  formant: number;
  /** Breath noise mixed in (0..1). */
  breath: number;
  /** Crystal shimmer: an octave-up partial into a short feedback echo (0..1). */
  shimmer: number;
  /** Voices in unison (the Twins are 2). */
  unison: number;
  /** Detune between unison voices (cents). */
  detune: number;
  /** Output level (0..1). */
  gain: number;
}

/** [background, body, accessory, head, glasses], like an on-chain seed. */
export type SeedLike = readonly number[] | { [k: string]: number };

function seedArray(s: SeedLike): number[] {
  if (Array.isArray(s)) return s.map(Number);
  const o = s as Record<string, number>;
  return [o.background ?? 0, o.body ?? 0, o.accessory ?? 0, o.head ?? 0, o.glasses ?? 0];
}

/** FNV-1a over the seed's parts: a stable 32-bit hash. */
export function hashSeed(s: SeedLike): number {
  let h = 0x811c9dc5;
  for (const v of seedArray(s)) {
    const x = Math.floor(Math.abs(v)) >>> 0;
    for (let k = 0; k < 4; k++) {
      h ^= (x >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
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

const WAVES: Wave[] = ['square', 'sawtooth', 'triangle'];

/** A voice for any Noun seed (then a preset on top, if given). */
export function deriveVoice(seed: SeedLike, preset: Partial<VoiceParams> = {}): VoiceParams {
  const r = rng(hashSeed(seed));
  const v: VoiceParams = {
    base: 130 + r() * 170,
    range: 3 + r() * 5,
    speed: 15 + r() * 8,
    wave: WAVES[Math.floor(r() * WAVES.length)]!,
    formant: 0.85 + r() * 0.4,
    breath: 0.08 + r() * 0.2,
    shimmer: 0,
    unison: 1,
    detune: 0,
    gain: 0.5,
  };
  return { ...v, ...preset };
}

/** Hand-tuned voices for the mission cast (merged over their seed's own voice). */
export const VOICE_PRESETS: Record<string, Partial<VoiceParams>> = {
  // Low, slow, round, with a crystal-ball shimmer
  oracle: {
    base: 96,
    range: 2.5,
    speed: 12,
    wave: 'triangle',
    formant: 0.82,
    shimmer: 1,
    breath: 0.18,
  },
  // Dry and clipped, a little metallic
  keymaker: { base: 118, range: 3, speed: 14, wave: 'square', formant: 0.9, breath: 0.12 },
  // Two of them, in unison, slightly apart
  twins: { base: 215, range: 4, speed: 19, wave: 'sawtooth', unison: 2, detune: 22, formant: 1.15 },
  dj: { base: 140, range: 6, speed: 19, wave: 'sawtooth', formant: 0.95 },
  writer: { base: 205, range: 5, speed: 16, wave: 'triangle', formant: 1.1 },
  courier: { base: 175, range: 6, speed: 22, wave: 'square', formant: 1.05 },
  captain: { base: 150, range: 4, speed: 15, wave: 'sawtooth', formant: 0.92 },
  baller: { base: 185, range: 7, speed: 20, wave: 'square', formant: 1.0 },
};

// ── Timing ──────────────────────────────────────────────────────────────

const PAUSE: Record<string, number> = {
  ',': 0.16,
  ';': 0.2,
  ':': 0.2,
  '.': 0.34,
  '!': 0.34,
  '?': 0.34,
  '…': 0.4,
  '—': 0.22,
};

/**
 * When each character appears (s from the start of the line), and the line's
 * length: one character per 1/speed, spaces quicker, a beat after punctuation.
 */
export function charTimes(text: string, speed: number): { times: number[]; total: number } {
  const step = 1 / Math.max(1, speed);
  const chars = [...text];
  const times: number[] = new Array(chars.length);
  let t = 0;
  for (let i = 0; i < chars.length; i++) {
    times[i] = t;
    const c = chars[i]!;
    t += c === ' ' ? step * 0.5 : step;
    // A pause after punctuation, but not inside "..." or before a closing quote
    const next = chars[i + 1];
    if (PAUSE[c] !== undefined && (next === undefined || next === ' ')) t += PAUSE[c]!;
  }
  return { times, total: t };
}

/** How many characters are showing at time t (times from charTimes). */
export function revealed(times: readonly number[], t: number): number {
  if (t < 0) return 0;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Seconds a line takes to say (plus a short hold so it can be read). */
export function lineDuration(text: string, v: Pick<VoiceParams, 'speed'>, hold = 0.9): number {
  return charTimes(text, v.speed).total + hold;
}

// ── Syllables ───────────────────────────────────────────────────────────

/** Vowel formants (F1, F2 Hz) for an adult voice: a, e, i, o, u. */
export const VOWELS: readonly (readonly [number, number])[] = [
  [800, 1200],
  [500, 1900],
  [320, 2300],
  [500, 900],
  [340, 800],
];

const isLetter = (c: string) => /\p{L}|\p{N}/u.test(c);

/** The vowel a letter "sounds" like: vowels themselves, consonants by a stable map. */
export function vowelOf(c: string): number {
  const l = c.toLowerCase();
  const i = 'aeiou'.indexOf(l);
  if (i >= 0) return i;
  if (l === 'y') return 2;
  return (l.codePointAt(0) ?? 0) % 5;
}

export interface Syllable {
  /** Start (s from the line's start). */
  t: number;
  dur: number;
  /** Pitch at the start and end of the syllable (Hz). */
  f0: number;
  f1: number;
  /** Vowel index into VOWELS. */
  vowel: number;
  /** 0..1 loudness. */
  amp: number;
}

export interface Plan {
  syllables: Syllable[];
  times: number[];
  total: number;
}

/**
 * The syllables of a line: one on each word's first letter, then every second
 * letter; pitch wanders by the voice's range (deterministic per voice + text),
 * rises into a "?", lifts and gets louder on a "!", settles down on a ".".
 */
export function syllablePlan(text: string, v: VoiceParams): Plan {
  const { times, total } = charTimes(text, v.speed);
  const chars = [...text];
  const r = rng(
    hashSeed([
      Math.round(v.base * 10),
      Math.round(v.speed * 10),
      text.length,
      ...[...text].slice(0, 8).map(c => c.codePointAt(0) ?? 0),
    ]),
  );
  const out: Syllable[] = [];
  let inWord = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (!isLetter(c)) {
      inWord = 0;
      continue;
    }
    const fire = inWord % 2 === 0;
    inWord++;
    if (!fire) continue;
    // The punctuation that ends this sentence shapes the contour
    let end = '';
    let j = i;
    while (j < chars.length && !/[!.?…]/.test(chars[j]!)) j++;
    if (j < chars.length) end = chars[j]!;
    const toEnd = j < chars.length ? times[j]! - times[i]! : Infinity;
    let semis = (r() * 2 - 1) * v.range;
    let amp = 0.75 + r() * 0.25;
    if (end === '?' && toEnd < 0.45) semis += 5 * (1 - toEnd / 0.45);
    if (end === '!') {
      semis += 2.5;
      amp = Math.min(1, amp + 0.15);
    }
    if (end === '.' && toEnd < 0.3) semis -= 2;
    const f0 = v.base * 2 ** (semis / 12);
    // A small glide inside the syllable (up on questions)
    const glide = end === '?' && toEnd < 0.45 ? 1.06 : 0.97 + r() * 0.04;
    out.push({ t: times[i]!, dur: 0, f0, f1: f0 * glide, vowel: vowelOf(c), amp });
  }
  // Each blip lasts until the next one (capped), so fast talkers stay crisp
  for (let k = 0; k < out.length; k++) {
    const next = out[k + 1]?.t ?? total;
    out[k]!.dur = Math.max(0.035, Math.min(0.14, (next - out[k]!.t) * 0.85));
  }
  return { syllables: out, times, total };
}

// ── Noun Breaks: the break beat, as pure data and samples ───────────────
//
// The battle's music is a looped breakbeat at the battle's bpm (the
// world's NOUN BEATS station is a free-running worklet with its own
// tempo, so it can't follow the sim's beat clock). Drum hits are rendered
// once into sample arrays here (no Web Audio needed, so tests can check
// them) and audio.ts schedules them with AudioBufferSourceNode.start(when)
// on the beat clock: sample-accurate downbeats.

/** One 16th step's hits (velocities 0..1; 0 = silent). */
export interface Step {
  kick: number;
  snare: number;
  hat: number;
  open: number;
  /** Bass note (semitones from the root), or null. */
  bass: number | null;
  /** Chord stab (semitones from the root), or null. */
  stab: number | null;
}

// An Amen-ish two-bar break: kicks on 1 and the "a" of 2/3, backbeat
// snares with ghost notes, eighth hats with 16th ghosts.
const K = [
  [1, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.7, 0, 0, 0, 0],
  [1, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.6, 0],
];
const S = [
  [0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0.4, 0, 0, 1, 0, 0, 0.35],
  [0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0.4, 0, 0, 1, 0, 0.3, 0],
];
const BASS = [
  [0, null, null, null, null, null, null, null, null, null, 0, -2, null, null, null, null],
  [3, null, null, null, null, null, null, null, null, null, 5, null, null, null, 3, null],
] as const;
const STAB = [
  [null, null, null, null, null, null, 0, null, null, null, null, null, null, null, 0, null],
  [null, null, null, null, null, null, 5, null, null, null, null, null, null, null, null, null],
] as const;

/** The pattern at bar `bar`, 16th `step` (0..15). Every 4th bar ends in a snare fill. */
export function breakStep(bar: number, step: number): Step {
  const b = ((bar % 2) + 2) % 2;
  const s = ((step % 16) + 16) % 16;
  const fill = ((bar % 4) + 4) % 4 === 3 && s >= 12;
  const hat = s % 2 === 0 ? (s % 4 === 0 ? 0.9 : 0.7) : 0.28;
  return {
    kick: fill ? (s === 12 ? 0.8 : 0) : K[b][s],
    snare: fill ? [0.7, 0.55, 0.8, 1][s - 12] : S[b][s],
    hat: fill ? 0 : s === 14 && b === 1 ? 0 : hat,
    open: !fill && s === 14 && b === 1 ? 0.8 : 0,
    bass: fill ? null : BASS[b][s],
    stab: STAB[b][s],
  };
}

/** When a 16th lands (audio-clock seconds), swung. Step 0 of every bar is exactly on its downbeat. */
export function stepTime(
  anchorTime: number,
  anchorBeat: number,
  step16: number,
  spb: number,
  swing = 0.54,
) {
  const beat = step16 / 4;
  const odd = ((step16 % 2) + 2) % 2 === 1;
  const late = odd ? (swing - 0.5) * 2 * (spb / 4) : 0;
  return anchorTime + (beat - anchorBeat) * spb + late;
}

// ── sample synthesis ────────────────────────────────────────────────────

/** Deterministic noise (tests want the same samples every time). */
function noiseGen(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

export function renderKick(sr: number): Float32Array {
  const n = Math.floor(sr * 0.42);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 48 + 110 * Math.exp(-t * 32);
    ph += (2 * Math.PI * f) / sr;
    const env = Math.exp(-t * 7.5);
    const click = Math.exp(-t * 400) * 0.35;
    out[i] = Math.tanh((Math.sin(ph) * env + click) * 1.6) * 0.95;
  }
  return out;
}

export function renderSnare(sr: number): Float32Array {
  const n = Math.floor(sr * 0.3);
  const out = new Float32Array(n);
  const rnd = noiseGen(1234567);
  let lp = 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = rnd();
    lp += (w - lp) * 0.55;
    const hp = w - lp; // crude highpass: crack
    ph += (2 * Math.PI * (185 + 40 * Math.exp(-t * 40))) / sr;
    const body = Math.sin(ph) * Math.exp(-t * 28) * 0.55;
    const crack = (hp * 0.9 + w * 0.35) * Math.exp(-t * 17);
    out[i] = Math.tanh((body + crack) * 1.3) * 0.85;
  }
  return out;
}

export function renderHat(sr: number, open: boolean): Float32Array {
  const n = Math.floor(sr * (open ? 0.32 : 0.06));
  const out = new Float32Array(n);
  const rnd = noiseGen(open ? 777 : 4242);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = rnd();
    const hp = w - prev; // first difference: bright
    prev = w;
    out[i] = hp * Math.exp(-t * (open ? 9 : 75)) * 0.45;
  }
  return out;
}

/** A round bass note (root), pitched with playbackRate. */
export function renderBass(sr: number): Float32Array {
  const n = Math.floor(sr * 0.5);
  const out = new Float32Array(n);
  const f = 55; // A1
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 200) * Math.exp(-t * 4.5);
    const s = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t);
    out[i] = Math.tanh(s * 1.4) * env * 0.7;
  }
  return out;
}

/** A dusty minor-7 stab (A, C, E, G), pitched with playbackRate. */
export function renderStab(sr: number): Float32Array {
  const n = Math.floor(sr * 0.38);
  const out = new Float32Array(n);
  const notes = [220, 261.63, 329.63, 392];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 300) * Math.exp(-t * 9);
    let s = 0;
    for (const f of notes)
      s += Math.sin(
        2 * Math.PI * f * t + Math.sin(2 * Math.PI * f * 2 * t) * 0.6 * Math.exp(-t * 6),
      );
    out[i] = (s / notes.length) * env * 0.55;
  }
  return out;
}

/** The record under the DJ's hand: a vowel-ish "ahh" to scratch. */
export function renderVox(sr: number): Float32Array {
  const n = Math.floor(sr * 0.6);
  const out = new Float32Array(n);
  const rnd = noiseGen(99);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f0 = 150 + 30 * Math.sin(t * 6);
    p += f0 / sr;
    const saw = (p % 1) * 2 - 1;
    // Formant-ish: emphasise ~700 Hz and ~1200 Hz with resonant sines
    const v = saw * 0.5 + Math.sin(2 * Math.PI * 700 * t) * 0.25 * (0.5 + 0.5 * saw) + rnd() * 0.05;
    out[i] = v * Math.min(1, t * 40) * Math.min(1, (0.6 - t) * 20) * 0.6;
  }
  return out;
}

/**
 * Scratch the record: read `src` at a moving playhead (forward and back
 * strokes, a "baby" scratch then a chirp), with the fader cutting in and
 * out. Pure resampling, so it plays backwards too.
 */
export function renderScratch(sr: number, src: Float32Array, dur = 1.2, seed = 1): Float32Array {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const len = src.length;
  const strokes = 6 + (seed % 3);
  let pos = len * 0.15;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const k = t * strokes;
    const st = Math.floor(k);
    const u = k - st;
    // Each stroke: fast push then pull (speed ∝ the curve's slope)
    const dir = st % 2 === 0 ? 1 : -1;
    const speed = Math.sin(Math.PI * u) * 2.2 * dir;
    pos += speed;
    if (pos < 0) pos = 0;
    if (pos > len - 2) pos = len - 2;
    const i0 = Math.floor(pos);
    const fr = pos - i0;
    const s = src[i0] * (1 - fr) + src[i0 + 1] * fr;
    // Crossfader: chirps cut every other stroke's tail
    const fader = st % 2 === 1 && u > 0.55 ? 0 : 1;
    out[i] = s * Math.abs(Math.sin(Math.PI * u)) ** 0.3 * fader;
  }
  return out;
}

/** Peak |x| of a sample array. */
export function peak(a: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}

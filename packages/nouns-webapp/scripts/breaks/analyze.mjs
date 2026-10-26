#!/usr/bin/env node
// Noun Breaks: estimate a song's tempo and first downbeat, for the battle
// track manifest (public/breaks/tracks.json).
//
//   node scripts/breaks/analyze.mjs <audio file> [--id my-song] [--title "…"] [--artist "…"]
//
// Prints a manifest entry: { id, title, artist, file, bpm, offset, license }.
// `bpm` is the tempo, `offset` the seconds from the start of the file to the
// first downbeat (the "1" of the first full bar once the music starts). The
// battle lines that downbeat up with its first beat, so check it by ear: if
// the battle's bars feel a beat off, add or take away one beat (60 / bpm s).
//
// Any format ffmpeg reads works (mp3, m4a, ogg, flac, wav…); without ffmpeg
// on the PATH, only PCM .wav files. No other dependencies.
//
// How: an onset envelope (rises in energy, a low band for kicks plus a high
// band for snares and hats), its autocorrelation for the tempo (a gentle
// preference for hip hop tempos, 85–105), refined over the whole song; the
// beat phase that lines up with the most onsets; and of the four beats in a
// bar, the one carrying the most kick is the downbeat.
//
// Then: copy the file into public/breaks/tracks/, add the entry to
// public/breaks/tracks.json with its real license (and a `source` URL), and
// it shows up in the battle menu's song picker.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const SR = 22050;
const HOP = 256;
const WIN = 1024;

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/breaks/analyze.mjs <audio file> [--id x] [--title x] [--artist x]',
  );
  process.exit(1);
}

// ── decode ──

function decodeFfmpeg(path) {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'],
    { maxBuffer: 1 << 30 },
  );
  if (r.error || r.status !== 0) return null;
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/** PCM / float WAV → mono at its own rate, resampled (linear) to SR. */
function decodeWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const len = b.readUInt32LE(p + 4);
    if (id === 'fmt ')
      fmt = {
        format: b.readUInt16LE(p + 8),
        ch: b.readUInt16LE(p + 10),
        rate: b.readUInt32LE(p + 12),
        bits: b.readUInt16LE(p + 22),
      };
    else if (id === 'data') data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) return null;
  const bps = fmt.bits / 8;
  const frames = Math.floor(data.length / (bps * fmt.ch));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bps;
      if (fmt.format === 3 && fmt.bits === 32) s += data.readFloatLE(o);
      else if (fmt.bits === 16) s += data.readInt16LE(o) / 32768;
      else if (fmt.bits === 24) s += data.readIntLE(o, 3) / 8388608;
      else if (fmt.bits === 32) s += data.readInt32LE(o) / 2147483648;
      else if (fmt.bits === 8) s += (data[o] - 128) / 128;
    }
    mono[i] = s / fmt.ch;
  }
  if (fmt.rate === SR) return mono;
  const n = Math.floor((frames * SR) / fmt.rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * fmt.rate) / SR;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (mono[j] ?? 0) * (1 - f) + (mono[j + 1] ?? 0) * f;
  }
  return out;
}

// ── analysis ──

/** Onset strength per hop: rises in log energy of a low band and a high band. */
function onsets(x) {
  const n = Math.floor((x.length - WIN) / HOP);
  const low = new Float32Array(n);
  const high = new Float32Array(n);
  // One-pole low pass ≈ 150 Hz for the kick band; the rest is the high band
  const a = Math.exp((-2 * Math.PI * 150) / SR);
  let lp = 0;
  const lpx = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    lp = (1 - a) * x[i] + a * lp;
    lpx[i] = lp;
  }
  for (let f = 0; f < n; f++) {
    let el = 0;
    let eh = 0;
    for (let i = f * HOP, e = i + WIN; i < e; i++) {
      const l = lpx[i];
      const h = x[i] - l;
      el += l * l;
      eh += h * h;
    }
    low[f] = Math.log1p(1e3 * el);
    high[f] = Math.log1p(1e3 * eh);
  }
  const env = new Float32Array(n);
  const kick = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const dl = Math.max(0, low[f] - low[f - 1]);
    const dh = Math.max(0, high[f] - high[f - 1]);
    kick[f] = dl;
    env[f] = dl + dh;
  }
  // Take out the slow trend (a running mean) so loud sections don't win
  const w = 16;
  const out = new Float32Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) {
    acc += env[f] - (f >= w ? env[f - w] : 0);
    out[f] = Math.max(0, env[f] - acc / Math.min(f + 1, w));
  }
  return { env: out, kick, energy: high.map((h, i) => h + low[i]) };
}

const fps = SR / HOP;

/** Sum of the envelope on a beat grid (period p frames, phase ph), interpolated. */
function comb(env, p, ph) {
  let s = 0;
  let k = 0;
  for (let t = ph; t < env.length - 1; t += p, k++) {
    const i = Math.floor(t);
    const f = t - i;
    s += env[i] * (1 - f) + env[i + 1] * f;
  }
  return k > 0 ? s / k : 0;
}

function bestPhase(env, p, steps = 64) {
  let best = 0;
  let bs = -1;
  for (let k = 0; k < steps; k++) {
    const ph = (k / steps) * p;
    const s = comb(env, p, ph);
    if (s > bs) {
      bs = s;
      best = ph;
    }
  }
  return { phase: best, score: bs };
}

function tempo(env) {
  // Autocorrelation over 60–200 bpm, weighted toward hip hop tempos
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 60);
  const ac = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    const bpm = (fps * 60) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 95) / 0.9) ** 2);
    ac.push({ lag, bpm, s: s * prior });
  }
  ac.sort((a, b) => b.s - a.s);
  const coarse = ac[0].bpm;
  // Refine over the whole song: the tempo whose beat grid gathers the most onsets
  let best = coarse;
  let bs = -1;
  for (let b = coarse * 0.97; b <= coarse * 1.03; b += 0.01) {
    const { score } = bestPhase(env, (fps * 60) / b, 32);
    if (score > bs) {
      bs = score;
      best = b;
    }
  }
  const alts = ac
    .slice(1)
    .filter(x => Math.abs(x.bpm - coarse) / coarse > 0.08)
    .slice(0, 2)
    .map(x => Math.round(x.bpm * 10) / 10);
  return { bpm: best, alts };
}

function analyze(x) {
  const { env, kick, energy } = onsets(x);
  if (env.length < fps * 8) throw new Error('need at least 8 seconds of audio');
  const { bpm, alts } = tempo(env);
  const p = (fps * 60) / bpm;
  const { phase } = bestPhase(env, p, 128);
  // Which of the 4 beats in a bar is the "1": the one with the most kick
  const bars = [0, 1, 2, 3].map(j => comb(kick, 4 * p, phase + j * p));
  // (1 and 3 often both carry the kick: of near-ties, the earlier beat)
  const top = Math.max(...bars);
  const j = bars.findIndex(v => v >= 0.9 * top);
  let first = phase + j * p;
  // Skip a silent / sparse intro: the first downbeat where the music is going
  const mean = energy.reduce((s, v) => s + v, 0) / energy.length;
  const barLen = Math.round(4 * p);
  for (let t = first; t < env.length - barLen; t += 4 * p) {
    let e = 0;
    for (let i = Math.floor(t); i < Math.floor(t) + barLen; i++) e += energy[i];
    if (e / barLen > 0.6 * mean) {
      first = t;
      break;
    }
  }
  // Frame index → seconds: frame f covers [f·HOP, f·HOP + WIN), and a hit's
  // energy rise registers about half a window plus half a hop in (checked
  // against synthetic loops: within a few ms)
  const offset = Math.max(0, (first * HOP + WIN / 2 + HOP / 2) / SR);
  const conf = bars[j] / (bars.reduce((s, v) => s + v, 0) / 4 || 1);
  return { bpm, offset, alts, downbeatConfidence: conf };
}

// ── main ──

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) usage();
const opt = k => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
let x = decodeFfmpeg(file);
if (x === null && extname(file).toLowerCase() === '.wav') x = decodeWav(file);
if (x === null) usage(`can't decode ${file} (install ffmpeg, or give a PCM .wav)`);
const r = analyze(x);
const name = basename(file);
const id =
  opt('id') ??
  name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
const entry = {
  id,
  title: opt('title') ?? name.replace(/\.[^.]+$/, ''),
  artist: opt('artist') ?? '',
  file: name,
  bpm: Math.round(r.bpm * 100) / 100,
  offset: Math.round(r.offset * 1000) / 1000,
  license: 'FILL IN (e.g. CC0 1.0, with a source URL)',
};
console.log(JSON.stringify(entry, null, 2));
console.error(
  `\n${(x.length / SR).toFixed(1)} s analysed · ${entry.bpm} bpm` +
    (r.alts.length ? ` (also plausible: ${r.alts.join(', ')})` : '') +
    ` · first downbeat ${entry.offset} s · downbeat confidence ${r.downbeatConfidence.toFixed(2)}` +
    ' (≈1 = unsure: check by ear, nudge offset by one beat = ' +
    (60 / entry.bpm).toFixed(3) +
    ' s)',
);

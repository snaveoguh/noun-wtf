// ── NOUN PIRATE RADIO: audio-thread engine ──────────────────────────────
//
// The whole station (sequencer, synths, reverb, delay, mix) runs inside an
// AudioWorklet, so the music can't drop out when the 3D frame loop stalls
// on shader compiles, level loads or GC.
//
// Every song is generated from scratch: key, tempo, scale, progression,
// drum programming, 808 line, motif, lead instruments and song form. Within
// a song, patterns keep mutating (hat rolls, kick variants, motif
// inversions, fills, drops), so it can run for hours without repeating.

/* eslint-disable @typescript-eslint/no-unused-vars */
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const SR = sampleRate;
const TAU = Math.PI * 2;

// ── randomness ───────────────────────────────────────────────────────────

type Rng = () => number;
function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng: Rng = mulberry(Date.now());
const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)]!;
const chance = (p: number) => rng() < p;
const range = (lo: number, hi: number) => lo + rng() * (hi - lo);
const irange = (lo: number, hi: number) => Math.floor(range(lo, hi + 1));

// Fast white noise (xorshift)
let ns = 0x9e3779b9;
function noise(): number {
  ns ^= ns << 13;
  ns ^= ns >>> 17;
  ns ^= ns << 5;
  return (ns >>> 0) / 2147483648 - 1;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const decayCoef = (seconds: number) => Math.exp(-1 / Math.max(1, seconds * SR));

// ── DSP building blocks ──────────────────────────────────────────────────

/** Zero-delay-feedback state-variable filter (Simper/Cytomic). */
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  lp = 0;
  bp = 0;
  hp = 0;
  constructor(fc = 1000, q = 0.707) {
    this.set(fc, q);
  }
  set(fc: number, q: number) {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 20), SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  tick(v: number) {
    const v3 = v - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v - this.k * v1 - v2;
  }
}

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(
    len: number,
    public fb: number,
    public damp: number,
  ) {
    this.buf = new Float32Array(len);
  }
  tick(x: number) {
    const y = this.buf[this.i]!;
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.fb;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(len: number) {
    this.buf = new Float32Array(len);
  }
  tick(x: number) {
    const b = this.buf[this.i]!;
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
}

/** Freeverb: 8 damped combs + 4 allpasses per channel. */
class Reverb {
  private cl: Comb[];
  private cr: Comb[];
  private al: Allpass[];
  private ar: Allpass[];
  l = 0;
  r = 0;
  constructor() {
    const s = SR / 44100;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const aps = [556, 441, 341, 225];
    this.cl = combs.map(c => new Comb(Math.round(c * s), 0.86, 0.35));
    this.cr = combs.map(c => new Comb(Math.round((c + 23) * s), 0.86, 0.35));
    this.al = aps.map(a => new Allpass(Math.round(a * s)));
    this.ar = aps.map(a => new Allpass(Math.round((a + 23) * s)));
  }
  setSize(room: number, damp: number) {
    for (const c of this.cl.concat(this.cr)) {
      c.fb = room;
      c.damp = damp;
    }
  }
  tick(x: number) {
    const inp = x * 0.015;
    let l = 0;
    let r = 0;
    for (let i = 0; i < 8; i++) {
      l += this.cl[i]!.tick(inp);
      r += this.cr[i]!.tick(inp);
    }
    for (let i = 0; i < 4; i++) {
      l = this.al[i]!.tick(l);
      r = this.ar[i]!.tick(r);
    }
    this.l = l * 3;
    this.r = r * 3;
  }
}

/** Dark ping-pong delay, tempo-synced by the song. */
class PingPong {
  private bl = new Float32Array(Math.ceil(SR * 2.5));
  private br = new Float32Array(Math.ceil(SR * 2.5));
  private w = 0;
  private lpl = 0;
  private lpr = 0;
  time = SR * 0.33;
  fb = 0.45;
  l = 0;
  r = 0;
  tick(x: number) {
    const n = this.bl.length;
    let ri = this.w - this.time;
    if (ri < 0) ri += n;
    const i0 = Math.floor(ri);
    const yl = this.bl[i0 % n]!;
    const yr = this.br[i0 % n]!;
    this.lpl += (yl - this.lpl) * 0.35;
    this.lpr += (yr - this.lpr) * 0.35;
    this.bl[this.w] = x + this.lpr * this.fb;
    this.br[this.w] = this.lpl * this.fb;
    if (++this.w >= n) this.w = 0;
    this.l = yl;
    this.r = yr;
  }
}

// ── voices ───────────────────────────────────────────────────────────────

const BUS_DRUM = 0;
const BUS_MUSIC = 1;

abstract class Voice {
  done = false;
  age = 0;
  gl = 0.707;
  gr = 0.707;
  rev = 0;
  dly = 0;
  bus = BUS_MUSIC;
  /** Ducked by the kick (sidechain pump). */
  duck = true;
  pan(p: number) {
    const a = ((p + 1) * Math.PI) / 4;
    this.gl = Math.cos(a);
    this.gr = Math.sin(a);
    return this;
  }
  sends(rev: number, dly = 0) {
    this.rev = rev;
    this.dly = dly;
    return this;
  }
  abstract tick(): number;
}

class Kick extends Voice {
  private ph = 0;
  private env = 1;
  private penv = 1;
  private ec: number;
  private pc = decayCoef(0.045);
  constructor(
    private f0: number,
    private f1: number,
    decay: number,
    private drive: number,
    private vel: number,
  ) {
    super();
    this.bus = BUS_DRUM;
    this.duck = false;
    this.ec = decayCoef(decay);
  }
  tick() {
    const f = this.f1 + (this.f0 - this.f1) * this.penv;
    this.penv *= this.pc;
    this.ph += f / SR;
    let s = Math.sin(TAU * this.ph) * this.env;
    if (this.age < SR * 0.004) s += noise() * 0.35 * (1 - this.age / (SR * 0.004));
    this.env *= this.ec;
    if (++this.age > SR * 1.5 || this.env < 1e-4) this.done = true;
    return Math.tanh(s * this.drive) * 0.5 * this.vel;
  }
}

class Snare extends Voice {
  private ph = 0;
  private tone = 1;
  private nz = 1;
  private tc = decayCoef(0.07);
  private nc: number;
  private f: SVF;
  private bursts: number;
  constructor(
    private vel: number,
    decay: number,
    color: number,
    clap: boolean,
  ) {
    super();
    this.bus = BUS_DRUM;
    this.duck = false;
    this.nc = decayCoef(decay);
    this.f = new SVF(color, clap ? 1.4 : 0.8);
    this.bursts = clap ? 3 : 0;
  }
  tick() {
    this.ph += (175 + 40 * this.tone) / SR;
    const t = Math.sin(TAU * this.ph) * this.tone * 0.5;
    this.tone *= this.tc;
    // Clap: a few retriggered bursts before the body
    let amp = this.nz;
    if (this.bursts > 0) {
      const ms = (this.age / SR) * 1000;
      if (ms < 30) amp = Math.exp(-(ms % 10) / 2.2);
    }
    this.f.tick(noise());
    const s = (this.f.bp * 1.6 + this.f.hp * 0.35) * amp + (this.bursts > 0 ? 0 : t);
    this.nz *= this.nc;
    if (++this.age > SR * 2 || this.nz < 1e-4) this.done = true;
    return s * this.vel * 0.85;
  }
}

/** 808-style metallic hat: six detuned squares + noise, highpassed. */
class Hat extends Voice {
  private phs = [0, 0, 0, 0, 0, 0];
  private fr: number[];
  private env = 1;
  private ec: number;
  private f: SVF;
  constructor(
    private vel: number,
    decay: number,
    tone: number,
  ) {
    super();
    this.bus = BUS_DRUM;
    this.duck = false;
    this.ec = decayCoef(decay);
    this.fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map(f => (f * tone) / SR);
    this.f = new SVF(7500 * tone, 0.9);
  }
  choke() {
    this.ec = decayCoef(0.01);
  }
  tick() {
    let m = 0;
    for (let i = 0; i < 6; i++) {
      this.phs[i] = (this.phs[i]! + this.fr[i]!) % 1;
      m += this.phs[i]! < 0.5 ? 1 : -1;
    }
    this.f.tick(m * 0.12 + noise() * 0.6);
    const s = this.f.hp * this.env;
    this.env *= this.ec;
    if (++this.age > SR * 2 || this.env < 1e-4) this.done = true;
    return s * this.vel * 0.32;
  }
}

class Perc extends Voice {
  private ph = 0;
  private env = 1;
  private ec: number;
  constructor(
    private hz: number,
    private vel: number,
    decay: number,
  ) {
    super();
    this.bus = BUS_DRUM;
    this.duck = false;
    this.ec = decayCoef(decay);
  }
  tick() {
    this.ph += this.hz / SR;
    const s = (Math.sin(TAU * this.ph) + 0.4 * Math.sin(TAU * this.ph * 2.31)) * this.env;
    this.env *= this.ec;
    if (++this.age > SR || this.env < 1e-4) this.done = true;
    return s * this.vel * 0.18;
  }
}

/** The 808: one mono voice that glides between notes, saturated. */
class Bass808 extends Voice {
  private ph = 0;
  private hz = 50;
  private target = 50;
  private glide = 0.002;
  private env = 0;
  private gate = 0;
  private relC = decayCoef(0.09);
  private punch = 0;
  drive = 1.8;
  level = 0.3;
  constructor() {
    super();
    this.bus = BUS_DRUM;
    this.duck = false;
  }
  trigger(hz: number, len: number, slide: boolean, glideMs: number) {
    this.glide = 1 - Math.exp(-1 / Math.max(1, (glideMs / 1000) * SR));
    if (slide && this.gate > 0) {
      this.target = hz;
    } else {
      this.hz = hz;
      this.target = hz;
      this.punch = 1;
      if (this.env < 0.05) this.ph = 0;
    }
    this.gate = len;
  }
  kill() {
    this.gate = 0;
  }
  tick() {
    this.hz += (this.target - this.hz) * this.glide;
    const f = this.hz * (1 + this.punch * 0.9);
    this.punch *= 0.9985;
    this.ph += f / SR;
    if (this.ph > 1) this.ph -= 1;
    if (this.gate > 0) {
      this.gate--;
      this.env += (1 - this.env) * 0.02;
    } else this.env *= this.relC;
    const x = Math.sin(TAU * this.ph) + 0.25 * Math.sin(TAU * this.ph * 2);
    return (Math.tanh(x * this.drive) / Math.tanh(this.drive)) * this.env * this.level;
  }
}

/** Washed pad note: detuned saws through a breathing lowpass. */
class PadNote extends Voice {
  private p1 = Math.random();
  private p2 = Math.random();
  private p3 = Math.random();
  private f1: number;
  private f2: number;
  private f3: number;
  private f: SVF;
  private lfo = Math.random() * TAU;
  constructor(
    hz: number,
    private len: number,
    private cutoff: number,
    private att: number,
    private vel: number,
    private choir: boolean,
  ) {
    super();
    this.f1 = (hz * 0.996) / SR;
    this.f2 = (hz * 1.004) / SR;
    this.f3 = (hz * 0.5) / SR;
    this.f = new SVF(cutoff, choir ? 6 : 0.6);
    if (choir) this.f.set(pick([700, 800, 1100, 450]), 6);
  }
  tick() {
    const a = this.age;
    if ((a & 63) === 0 && !this.choir) {
      this.lfo += (64 * TAU * 0.11) / SR;
      this.f.set(this.cutoff * (0.75 + 0.35 * Math.sin(this.lfo)), 0.6);
    }
    this.p1 = (this.p1 + this.f1) % 1;
    this.p2 = (this.p2 + this.f2) % 1;
    this.p3 = (this.p3 + this.f3) % 1;
    const x = this.p1 * 2 - 1 + (this.p2 * 2 - 1) + 0.4 * (this.p3 * 2 - 1);
    this.f.tick(x);
    const att = this.att * SR;
    const rel = 1.2 * SR;
    let e: number;
    if (a < att) e = (a + 1) / att;
    else if (a < this.len) e = 1;
    else e = 1 - (a - this.len) / rel;
    if (e <= 0) {
      this.done = true;
      return 0;
    }
    this.age++;
    return (this.choir ? this.f.bp * 0.5 : this.f.lp) * e * e * this.vel * 0.035;
  }
}

/** FM bell / music box / glass: carrier + decaying modulator. */
class Bell extends Voice {
  private pc = 0;
  private pm = 0;
  private env = 1;
  private ec: number;
  private ic: number;
  private idx: number;
  constructor(
    private hz: number,
    private ratio: number,
    index: number,
    decay: number,
    private vel: number,
  ) {
    super();
    this.idx = index;
    this.ec = decayCoef(decay);
    this.ic = decayCoef(decay * 0.35);
  }
  tick() {
    this.pm += (this.hz * this.ratio) / SR;
    this.pc += this.hz / SR;
    const s = Math.sin(TAU * this.pc + this.idx * Math.sin(TAU * this.pm)) * this.env;
    this.env *= this.ec;
    this.idx *= this.ic;
    if (++this.age > SR * 6 || this.env < 1e-4) this.done = true;
    return s * this.vel * 0.26;
  }
}

/** Karplus-Strong pluck. */
class Pluck extends Voice {
  private buf: Float32Array;
  private i = 0;
  constructor(
    hz: number,
    private vel: number,
    private damp: number,
  ) {
    super();
    const n = Math.max(2, Math.round(SR / hz));
    this.buf = new Float32Array(n);
    let lp = 0;
    for (let k = 0; k < n; k++) {
      lp += (noise() - lp) * 0.5;
      this.buf[k] = lp;
    }
  }
  tick() {
    const n = this.buf.length;
    const y = this.buf[this.i]!;
    const j = (this.i + 1) % n;
    this.buf[this.i] = (y + this.buf[j]!) * 0.5 * this.damp;
    this.i = j;
    if (++this.age > SR * 4) this.done = true;
    return y * this.vel * 1.0;
  }
}

/** Breathy flute / whistle with delayed vibrato. */
class Flute extends Voice {
  private ph = 0;
  private vib = 0;
  private f = new SVF(1800, 1.2);
  constructor(
    private hz: number,
    private len: number,
    private vel: number,
  ) {
    super();
  }
  tick() {
    const a = this.age;
    this.vib += (5.2 * TAU) / SR;
    const depth = a > SR * 0.18 ? 0.006 : 0;
    this.ph += (this.hz * (1 + depth * Math.sin(this.vib))) / SR;
    this.f.tick(noise());
    const x = Math.sin(TAU * this.ph) + 0.12 * Math.sin(TAU * this.ph * 2) + this.f.bp * 0.25;
    const att = SR * 0.04;
    const rel = SR * 0.18;
    let e: number;
    if (a < att) e = (a + 1) / att;
    else if (a < this.len) e = 1;
    else e = 1 - (a - this.len) / rel;
    if (e <= 0) {
      this.done = true;
      return 0;
    }
    this.age++;
    return x * e * this.vel * 0.16;
  }
}

const VOWELS: [number, number][] = [
  [800, 1150],
  [450, 800],
  [325, 700],
  [400, 2000],
  [600, 1000],
];

/** Chopped vocal: pulse through two formant filters, gated. */
class Chop extends Voice {
  private ph = 0;
  private a = new SVF();
  private b = new SVF();
  private len: number;
  constructor(
    private hz: number,
    len: number,
    private vel: number,
    vowel: [number, number],
  ) {
    super();
    this.len = len;
    this.a.set(vowel[0], 8);
    this.b.set(vowel[1], 10);
  }
  tick() {
    const a = this.age;
    this.ph = (this.ph + this.hz / SR) % 1;
    const x = this.ph < 0.3 ? 1 : -0.43;
    this.a.tick(x);
    this.b.tick(x);
    const att = SR * 0.006;
    const rel = SR * 0.05;
    let e: number;
    if (a < att) e = (a + 1) / att;
    else if (a < this.len) e = 1 - 0.3 * ((a - att) / this.len);
    else e = 0.7 * (1 - (a - this.len) / rel);
    if (e <= 0) {
      this.done = true;
      return 0;
    }
    this.age++;
    return (this.a.bp + this.b.bp * 0.6) * e * this.vel * 0.12;
  }
}

/** Detuned saw lead with filter envelope. */
class SawLead extends Voice {
  private p = [Math.random(), Math.random(), Math.random()];
  private fr: number[];
  private f = new SVF(1200, 1.4);
  constructor(
    hz: number,
    private len: number,
    private vel: number,
    private bright: number,
  ) {
    super();
    this.fr = [0.993, 1, 1.007].map(d => (hz * d) / SR);
  }
  tick() {
    const a = this.age;
    let x = 0;
    for (let i = 0; i < 3; i++) {
      this.p[i] = (this.p[i]! + this.fr[i]!) % 1;
      x += this.p[i]! * 2 - 1;
    }
    if ((a & 31) === 0) this.f.set(this.bright * (0.5 + 1.5 * Math.exp(-a / (SR * 0.15))), 1.4);
    this.f.tick(x);
    const att = SR * 0.008;
    const rel = SR * 0.12;
    let e: number;
    if (a < att) e = (a + 1) / att;
    else if (a < this.len) e = 1;
    else e = 1 - (a - this.len) / rel;
    if (e <= 0) {
      this.done = true;
      return 0;
    }
    this.age++;
    return this.f.lp * e * this.vel * 0.11;
  }
}

/** Noise sweep riser over `len` samples. */
class Riser extends Voice {
  private f = new SVF(300, 2);
  constructor(
    private len: number,
    private vel: number,
  ) {
    super();
    this.duck = false;
  }
  tick() {
    const t = this.age / this.len;
    if ((this.age & 31) === 0) this.f.set(250 * Math.pow(30, t), 2.5);
    this.f.tick(noise());
    if (++this.age >= this.len) this.done = true;
    return this.f.bp * t * t * this.vel * 0.45;
  }
}

/** Crash + sub boom on a hook landing. */
class Impact extends Voice {
  private env = 1;
  private ec = decayCoef(0.9);
  private ph = 0;
  private f = new SVF(5000, 0.7);
  constructor(private vel: number) {
    super();
    this.bus = BUS_DRUM;
    this.duck = false;
  }
  tick() {
    this.ph += (48 + 30 * this.env * this.env) / SR;
    this.f.tick(noise());
    const s = this.f.hp * 0.45 * this.env + Math.sin(TAU * this.ph) * this.env * this.env * 0.7;
    this.env *= this.ec;
    if (++this.age > SR * 4 || this.env < 1e-4) this.done = true;
    return s * this.vel;
  }
}

// ── song generation ──────────────────────────────────────────────────────

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

type Lead = 'bell' | 'musicbox' | 'glass' | 'pluck' | 'flute' | 'chop' | 'saw';
type SectionKind = 'intro' | 'verse' | 'hook' | 'break' | 'outro';

interface Note {
  step: number;
  deg: number;
  len: number;
}

interface Song {
  name: string;
  bpm: number;
  root: number;
  scale: number[];
  prog: number[];
  swing: number;
  kicks: number[][];
  snareFull: boolean;
  hatDiv: number;
  openHats: number[];
  percSteps: number[];
  percHz: number;
  bassNotes: number[];
  motif: Note[];
  counter: Note[];
  lead: Lead;
  lead2: Lead;
  pad: 'saw' | 'choir' | 'glass';
  padCutoff: number;
  kickTune: number;
  kickDecay: number;
  drive: number;
  snareColor: number;
  snareDecay: number;
  clap: boolean;
  hatTone: number;
  rain: number;
  form: { kind: SectionKind; bars: number }[];
  glide: number;
}

const WORDS_A = [
  'sad', 'frozen', 'drowned', 'pixel', 'ghost', 'ether', 'glass', 'static', 'neon', 'ice',
  'velvet', 'hollow', 'plaza', 'midnight', 'crystal', 'faded', 'lucid', 'broken', 'silent',
  'chrome', 'acid', 'dusk', 'cloud', 'bleach', 'paper',
];
const WORDS_B = [
  'noggles', 'treasury', 'ladder', 'moat', 'lantern', 'raid', 'grail', 'ginseng', 'rain',
  'frost', 'skate', 'auction', 'heads', 'ollie', 'signal', 'wall', 'garden', 'saint', 'ocean',
  'tape', 'mirror', 'angel', 'reserve', 'basement', 'halo',
];

function genMotif(len: number, density: number, lo: number, hi: number): Note[] {
  const notes: Note[] = [];
  let d = irange(lo + 2, hi - 2);
  for (let s = 0; s < len; s++) {
    const strong = s % 4 === 0;
    const p = strong ? density * 1.5 : s % 2 === 0 ? density : density * 0.55;
    if (!chance(p)) continue;
    const r = rng();
    d += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.82 ? 2 : r < 0.94 ? -2 : pick([4, -3, 5, -4]);
    if (d > hi) d -= 2;
    if (d < lo) d += 2;
    notes.push({ step: s, deg: d, len: 1 });
  }
  if (notes.length < 3) notes.push({ step: 0, deg: lo + 4, len: 2 }, { step: 8, deg: lo + 2, len: 2 });
  notes.sort((a, b) => a.step - b.step);
  for (let i = 0; i < notes.length; i++) {
    const next = i + 1 < notes.length ? notes[i + 1]!.step : len;
    notes[i]!.len = Math.max(1, Math.min(next - notes[i]!.step, irange(1, 4)));
  }
  return notes;
}

function genForm(): { kind: SectionKind; bars: number }[] {
  const forms: [SectionKind, number][][] = [
    [['intro', 4], ['verse', 8], ['hook', 8], ['verse', 8], ['break', 4], ['hook', 8], ['hook', 8], ['outro', 4]],
    [['intro', 8], ['hook', 8], ['verse', 16], ['break', 4], ['hook', 16], ['outro', 4]],
    [['intro', 4], ['verse', 16], ['hook', 8], ['break', 8], ['hook', 8], ['verse', 8], ['hook', 8], ['outro', 8]],
    [['intro', 8], ['verse', 8], ['verse', 8], ['hook', 16], ['break', 4], ['hook', 8], ['outro', 4]],
    [['intro', 4], ['hook', 8], ['verse', 8], ['hook', 8], ['break', 4], ['verse', 8], ['hook', 16], ['outro', 4]],
  ];
  return pick(forms).map(([kind, bars]) => ({ kind, bars }));
}

function genSong(): Song {
  const scaleName = pick(['minor', 'minor', 'phrygian', 'dorian', 'harmonic']);
  const progs = [
    [0, 5, 2, 6], [0, 0, 5, 3], [0, 3, 5, 4], [0, 5, 6, 4], [0, 6, 5, 6],
    [0, 2, 5, 4], [0, 3, 0, 5], [5, 3, 0, 6], [0, 1, 0, 6], [0, 5, 3, 4, 0, 5, 6, 6],
  ];
  const prog = pick(progs).slice();
  if (chance(0.3)) prog[prog.length - 1] = pick([4, 6, 1]);

  const kickPool = [3, 6, 7, 10, 11, 13, 14];
  const base = [0];
  const nExtra = irange(1, 3);
  for (let i = 0; i < nExtra; i++) {
    const s = pick(kickPool);
    if (!base.includes(s)) base.push(s);
  }
  const vary = (k: number[]) => {
    const v = k.slice();
    if (chance(0.5) && v.length > 1) v.splice(irange(1, v.length - 1), 1);
    const s = pick(kickPool);
    if (!v.includes(s)) v.push(s);
    return v.sort((a, b) => a - b);
  };
  const kicks = [base.sort((a, b) => a - b), vary(base), vary(base)];

  const leads: Lead[] = ['bell', 'musicbox', 'glass', 'pluck', 'flute', 'chop', 'saw'];
  const lead = pick(leads);
  let lead2 = pick(leads);
  if (lead2 === lead) lead2 = pick(leads);
  const bpm = Math.round(range(128, 152));
  const beat = 60 / bpm;

  return {
    name: `${pick(WORDS_A)} ${pick(WORDS_B)}`,
    bpm,
    root: irange(36, 46),
    scale: SCALES[scaleName]!,
    prog,
    swing: chance(0.5) ? range(0, 0.12) : 0,
    kicks,
    snareFull: chance(0.18),
    hatDiv: chance(0.6) ? 2 : 1,
    openHats: chance(0.5) ? [pick([6, 14, 10])] : [],
    percSteps: [pick([3, 5, 7, 11, 13, 15]), pick([3, 5, 7, 11, 13, 15])],
    percHz: pick([800, 1200, 1600, 2400, 520]),
    bassNotes: [0, 0, 0, pick([4, 7, -3]), pick([0, 7, 2])],
    motif: genMotif(32, range(0.22, 0.42), 0, 11),
    counter: genMotif(32, range(0.1, 0.2), -2, 7),
    lead,
    lead2,
    pad: pick(['saw', 'saw', 'choir', 'glass']),
    padCutoff: range(700, 2000),
    kickTune: range(42, 55),
    kickDecay: range(0.25, 0.5),
    drive: range(1.4, 3.2),
    snareColor: range(1300, 2600),
    snareDecay: range(0.12, 0.28),
    clap: chance(0.45),
    hatTone: range(0.85, 1.3),
    rain: chance(0.5) ? range(0.2, 1) : 0,
    form: genForm(),
    glide: range(35, 110) * (beat / 0.43),
  };
}

// ── the processor ────────────────────────────────────────────────────────

interface Ev {
  t: number;
  fn: () => void;
}

class NounRadio extends AudioWorkletProcessor {
  private voices: Voice[] = [];
  private queue: Ev[] = [];
  private bass = new Bass808();
  private reverb = new Reverb();
  private delay = new PingPong();
  private musicL = new SVF(18000, 0.7);
  private musicR = new SVF(18000, 0.7);
  private musicCut = 18000;
  private musicCutTarget = 18000;
  private rainF = new SVF(2600, 0.5);
  private duckEnv = 0;
  private duckC = decayCoef(0.14);
  private dcL = 0;
  private dcR = 0;
  private now = 0;
  private nextStep = 0;
  private stepLen = 0;
  private step = 0;
  private bar = 0;
  private section = 0;
  private sectionBar = 0;
  private song: Song = genSong();
  private playing = false;
  private gain = 0;
  private gainTarget = 0;
  private openHat: Hat | null = null;
  private hatRolls: Map<number, number> = new Map();
  private kickVar = 0;
  private motifOp = 0;

  constructor(options?: { processorOptions?: { autoplay?: boolean; seed?: number } }) {
    super();
    const po = options?.processorOptions;
    if (po?.seed !== undefined) rng = mulberry(po.seed);
    if (po?.autoplay === true) {
      this.startSong(genSong());
      this.playing = true;
      this.gainTarget = 1;
    }
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; seed?: number };
      if (m.type === 'play') {
        if (m.seed !== undefined) rng = mulberry(m.seed);
        if (!this.playing) this.startSong(genSong());
        this.playing = true;
        this.gainTarget = 1;
      } else if (m.type === 'stop') {
        this.gainTarget = 0;
      } else if (m.type === 'next') {
        this.gainTarget = 1;
        this.playing = true;
        this.voices.push(new Riser(Math.round(SR * 0.9), 0.8).sends(0.6));
        this.queue.push({ t: this.now + SR * 0.9, fn: () => this.startSong(genSong()) });
      }
    };
  }

  private startSong(s: Song) {
    this.song = s;
    this.stepLen = (60 / s.bpm / 4) * SR;
    this.nextStep = this.now + SR * 0.05;
    this.step = 0;
    this.bar = 0;
    this.section = 0;
    this.sectionBar = 0;
    this.queue = [];
    this.bass.kill();
    this.bass.drive = s.drive;
    this.delay.time = this.stepLen * 3; // dotted eighth
    this.delay.fb = range(0.3, 0.55);
    this.reverb.setSize(range(0.82, 0.9), range(0.25, 0.5));
    this.newBarPatterns();
    this.port.postMessage({ type: 'song', name: s.name, bpm: s.bpm });
  }

  private get kind(): SectionKind {
    return this.song.form[this.section]?.kind ?? 'outro';
  }

  private get nextKind(): SectionKind | null {
    return this.song.form[this.section + 1]?.kind ?? null;
  }

  private newBarPatterns() {
    // Fresh hat rolls every bar: where, and what kind
    this.hatRolls.clear();
    const k = this.kind;
    const n = k === 'hook' ? irange(1, 3) : k === 'verse' ? irange(0, 2) : 0;
    for (let i = 0; i < n; i++) this.hatRolls.set(pick([3, 6, 7, 10, 11, 14, 15]), pick([2, 3, 4, 6]));
    if (this.bar % 4 === 0) this.kickVar = chance(0.6) ? 0 : irange(1, 2);
    if (this.bar % 4 === 0) this.motifOp = this.kind === 'hook' ? pick([0, 0, 0, 1, 2, 3]) : pick([0, 1, 2, 3, 4, 5]);
    // Section filter
    const lastOfSection = this.sectionBar === (this.song.form[this.section]?.bars ?? 1) - 1;
    if (k === 'intro') this.musicCutTarget = 1600 + 6000 * (this.sectionBar / 8);
    else if (k === 'break') this.musicCutTarget = lastOfSection ? 6000 : 1100;
    else if (k === 'outro') this.musicCutTarget = Math.max(500, 6000 - this.sectionBar * 1200);
    else this.musicCutTarget = 18000;
  }

  private at(offset: number, fn: () => void) {
    const t = this.now + offset;
    const ev = { t, fn };
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.t > t) i--;
    this.queue.splice(i, 0, ev);
  }

  private noteMidi(deg: number, octave: number) {
    const sc = this.song.scale;
    const n = sc.length;
    const o = Math.floor(deg / n);
    return this.song.root + 12 * octave + sc[((deg % n) + n) % n]! + 12 * o;
  }

  private chordDeg() {
    return this.song.prog[this.bar % this.song.prog.length]!;
  }

  private add(v: Voice) {
    if (this.voices.length > 90) {
      // Too dense: drop the oldest melodic voice instead of glitching
      const i = this.voices.findIndex(x => x.bus === BUS_MUSIC);
      if (i >= 0) this.voices.splice(i, 1);
    }
    this.voices.push(v);
  }

  private playLead(kind: Lead, deg: number, lenSteps: number, vel: number, oct: number, pan: number) {
    const hz = midiHz(this.noteMidi(deg, oct));
    const len = Math.round(lenSteps * this.stepLen);
    let v: Voice;
    switch (kind) {
      case 'bell':
        v = new Bell(hz, 3.5, 2.2, 1.4, vel).sends(0.55, 0.45);
        break;
      case 'musicbox':
        v = new Bell(hz * 2, 4, 1.4, 0.9, vel * 0.9).sends(0.5, 0.35);
        break;
      case 'glass':
        v = new Bell(hz, 1.0, 3, 2.2, vel * 0.4).sends(0.7, 0.4);
        break;
      case 'pluck':
        v = new Pluck(hz, vel, 0.996).sends(0.45, 0.5);
        break;
      case 'flute':
        v = new Flute(hz, len, vel).sends(0.6, 0.35);
        break;
      case 'chop':
        v = new Chop(hz * 0.5, Math.min(len, this.stepLen * 2), vel * 1.2, pick(VOWELS)).sends(0.5, 0.45);
        break;
      default:
        v = new SawLead(hz, len, vel, range(1500, 4000)).sends(0.45, 0.3);
    }
    this.add(v.pan(pan));
  }

  /** Motif with the current variation applied. */
  private motifNotes(): Note[] {
    const s = this.song;
    const base = s.motif;
    const half = (this.bar % 2) * 16;
    const inBar = base.filter(n => n.step >= half && n.step < half + 16).map(n => ({ ...n, step: n.step - half }));
    switch (this.motifOp) {
      case 1: // octave lift on the answer bar
        return this.bar % 2 === 1 ? inBar.map(n => ({ ...n, deg: n.deg + 7 })) : inBar;
      case 2: // inversion around the middle
        return inBar.map(n => ({ ...n, deg: 10 - n.deg }));
      case 3: // rhythmic displacement
        return inBar.map(n => ({ ...n, step: (n.step + 2) % 16 }));
      case 4: // thinned
        return inBar.filter((_, i) => i % 2 === 0);
      case 5: // retrograde
        return inBar.map(n => ({ ...n, step: 15 - n.step - (n.len - 1) })).filter(n => n.step >= 0);
      default:
        return inBar;
    }
  }

  private doStep() {
    const s = this.song;
    const st = this.step;
    const k = this.kind;
    const swing = st % 2 === 1 ? s.swing * this.stepLen : 0;
    const sixteenth = this.stepLen;
    const sectionBars = s.form[this.section]?.bars ?? 4;
    const lastBar = this.sectionBar === sectionBars - 1;
    const preHook = lastBar && this.nextKind === 'hook';
    const dropBeat = preHook && st >= 12; // silence before the hook lands
    const chord = this.chordDeg();
    const drumsOn = k === 'verse' || k === 'hook' || (k === 'outro' && this.sectionBar < sectionBars / 2);
    const fullDrums = drumsOn && !dropBeat;

    // Section landing
    if (st === 0 && this.sectionBar === 0) {
      if (k === 'hook') this.add(new Impact(0.7).sends(0.4).pan(0));
    }
    // Riser into hooks and out of breaks
    if (st === 0 && lastBar && (this.nextKind === 'hook' || k === 'break'))
      this.add(new Riser(Math.round(sixteenth * 16), k === 'break' ? 1 : 0.6).sends(0.5).pan(0));

    // Pads: a chord per bar
    if (st === 0) {
      const padVel = k === 'hook' ? 0.8 : k === 'verse' ? 0.6 : 1;
      const tones = [0, 2, 4, 6, chance(0.5) ? 8 : 9];
      const barLen = sixteenth * 16;
      tones.forEach((t, i) => {
        const hz = midiHz(this.noteMidi(chord + t, 1));
        if (s.pad === 'glass') {
          if (i < 4) this.add(new Bell(hz, 1, 1.2, 2.6, 0.2 * padVel).sends(0.85).pan(i % 2 ? 0.5 : -0.5));
        } else
          this.add(
            new PadNote(hz, barLen * 1.02, s.padCutoff, s.pad === 'choir' ? 0.5 : 0.35, padVel, s.pad === 'choir')
              .sends(0.75)
              .pan(i % 2 ? 0.55 : -0.55),
          );
      });
    }

    // Lead / motif
    const leadOn = k === 'hook' || (k === 'break' && chance(0.7)) || (k === 'intro' && this.sectionBar >= 2);
    if (leadOn && !dropBeat) {
      for (const n of this.motifNotes()) {
        if (n.step !== st) continue;
        let d = n.deg;
        // Snap strong beats to chord tones so it always sits on the harmony
        if (st % 4 === 0) {
          const tones = [chord, chord + 2, chord + 4].map(x => ((x % 7) + 7) % 7);
          const m = ((d % 7) + 7) % 7;
          if (!tones.includes(m)) d += tones.includes((m + 1) % 7) ? 1 : -1;
        }
        const vel = k === 'intro' ? 0.6 : 0.9;
        this.at(swing, () => this.playLead(s.lead, d, n.len, vel, 2, range(-0.3, 0.3)));
      }
    }
    // Counter melody in verses (and doubling in hooks)
    if ((k === 'verse' || (k === 'hook' && this.bar % 2 === 1)) && !dropBeat) {
      for (const n of s.counter) {
        if (n.step % 16 !== st || Math.floor(n.step / 16) !== this.bar % 2) continue;
        this.at(swing, () => this.playLead(s.lead2, n.deg, n.len, 0.6, 2, pick([-0.6, 0.6])));
      }
    }

    // Drums
    if (fullDrums) {
      const kickPat = s.kicks[this.kickVar] ?? s.kicks[0]!;
      const fillBar = this.bar % 4 === 3;
      if (kickPat.includes(st) || (fillBar && st === 14 && chance(0.5))) {
        this.at(swing, () => {
          this.add(new Kick(160, s.kickTune, s.kickDecay, 1.6, 1).pan(0));
          this.duckEnv = 1;
        });
        // 808 rides the kick
        const bn = pick(s.bassNotes);
        let len = 1;
        while (len < 16 && !kickPat.includes((st + len) % 16)) len++;
        const slide = chance(fillBar ? 0.5 : 0.18);
        const hz = midiHz(this.noteMidi(chord + bn, -1));
        this.at(swing, () => this.bass.trigger(hz, Math.round(len * sixteenth * 0.95), false, s.glide));
        if (slide)
          this.at(swing + sixteenth * Math.max(1, len - 2), () =>
            this.bass.trigger(hz * pick([2, 1.5, 0.75]), Math.round(sixteenth * 2), true, s.glide),
          );
      }
      const snareSteps = s.snareFull ? [4, 12] : [8];
      if (snareSteps.includes(st))
        this.at(swing, () => this.add(new Snare(1, s.snareDecay, s.snareColor, s.clap).sends(0.35).pan(0)));
      // Ghost snares / snare roll fill on the last bar before a change
      if (lastBar && st >= 12 && !dropBeat && chance(0.6))
        for (let r = 0; r < 2; r++)
          this.at(swing + (r * sixteenth) / 2, () =>
            this.add(new Snare(0.35 + 0.15 * r, 0.08, s.snareColor, false).sends(0.3).pan(0.1)),
          );
      else if (chance(0.06)) this.at(swing, () => this.add(new Snare(0.25, 0.06, s.snareColor, false).sends(0.2)));

      // Hats
      const roll = this.hatRolls.get(st);
      if (roll !== undefined) {
        for (let r = 0; r < roll; r++)
          this.at(swing + (r * sixteenth) / roll, () =>
            this.add(new Hat(0.45 + (0.5 * r) / roll, 0.03, s.hatTone * (1 + r * 0.04)).sends(0.1).pan(0.25)),
          );
      } else if (st % s.hatDiv === 0) {
        const vel = st % 4 === 0 ? 0.95 : 0.6 + rng() * 0.2;
        this.at(swing, () => {
          this.openHat?.choke();
          this.add(new Hat(vel, 0.04, s.hatTone).sends(0.08).pan(0.25));
        });
      }
      if (s.openHats.includes(st) && k === 'hook')
        this.at(swing, () => {
          const h = new Hat(0.6, 0.35, s.hatTone * 0.9);
          this.openHat = h;
          this.add(h.sends(0.2).pan(-0.25));
        });
      // Perc
      if (k === 'hook' && s.percSteps.includes(st))
        this.at(swing, () => this.add(new Perc(s.percHz, 0.9, 0.05).sends(0.35, 0.3).pan(-0.4)));
    } else if (k === 'break' && st === 0 && this.sectionBar === 0) {
      // One long 808 under the break
      const hz = midiHz(this.noteMidi(chord, -1));
      this.bass.trigger(hz, Math.round(sixteenth * 12), false, s.glide);
    } else if (dropBeat && st === 12) {
      this.bass.kill();
    } else if (k === 'intro' && this.sectionBar >= sectionBars - 2 && st % 2 === 0) {
      // Hats creep in at the end of the intro
      this.at(swing, () => this.add(new Hat(0.35, 0.03, s.hatTone).sends(0.1).pan(0.25)));
    }
  }

  private advance() {
    this.doStep();
    this.step++;
    if (this.step >= 16) {
      this.step = 0;
      this.bar++;
      this.sectionBar++;
      const sec = this.song.form[this.section];
      if (sec !== undefined && this.sectionBar >= sec.bars) {
        this.sectionBar = 0;
        this.section++;
        if (this.section >= this.song.form.length) {
          // Song over: straight into a brand-new one
          this.startSong(genSong());
          return;
        }
      }
      this.newBarPatterns();
    }
    this.nextStep += this.stepLen;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    if (out === undefined || out.length === 0) return true;
    const L = out[0]!;
    const R = out[1] ?? out[0]!;
    const n = L.length;
    if (!this.playing && this.gain < 1e-4) {
      L.fill(0);
      if (R !== L) R.fill(0);
      this.now += n;
      return true;
    }
    const rainLvl = this.song.rain * 0.035;
    for (let i = 0; i < n; i++) {
      if (this.playing) {
        while (this.now >= this.nextStep) this.advance();
        while (this.queue.length > 0 && this.queue[0]!.t <= this.now) this.queue.shift()!.fn();
      }
      if ((i & 63) === 0) {
        this.musicCut += (this.musicCutTarget - this.musicCut) * 0.02;
        this.musicL.set(this.musicCut, 0.8);
        this.musicR.set(this.musicCut, 0.8);
      }
      const duck = 1 - 0.55 * this.duckEnv;
      this.duckEnv *= this.duckC;

      let dl = 0;
      let dr = 0;
      let ml = 0;
      let mr = 0;
      let rev = 0;
      let dly = 0;
      for (let v = 0; v < this.voices.length; v++) {
        const vo = this.voices[v]!;
        let x = vo.tick();
        if (vo.duck) x *= duck;
        if (vo.bus === BUS_DRUM) {
          dl += x * vo.gl;
          dr += x * vo.gr;
        } else {
          ml += x * vo.gl;
          mr += x * vo.gr;
        }
        rev += x * vo.rev;
        dly += x * vo.dly;
      }
      const b = this.bass.tick();
      dl += b;
      dr += b;
      // Rain / vinyl bed
      if (rainLvl > 0) {
        this.rainF.tick(noise());
        const crackle = noise() > 0.9996 ? noise() * 0.4 : 0;
        ml += (this.rainF.bp * rainLvl + crackle * 0.08) * duck;
        mr += (this.rainF.bp * rainLvl * 0.9 - crackle * 0.08) * duck;
      }
      this.delay.tick(dly);
      this.reverb.tick(rev + (this.delay.l + this.delay.r) * 0.25);
      ml += this.delay.l * 0.5 + this.reverb.l * 0.5 * duck;
      mr += this.delay.r * 0.5 + this.reverb.r * 0.5 * duck;
      this.musicL.tick(ml);
      this.musicR.tick(mr);
      let l = dl + this.musicL.lp;
      let r = dr + this.musicR.lp;
      // DC block + glue saturation
      this.dcL += (l - this.dcL) * 0.0008;
      this.dcR += (r - this.dcR) * 0.0008;
      l -= this.dcL;
      r -= this.dcR;
      this.gain += (this.gainTarget - this.gain) * 0.0006;
      L[i] = Math.tanh(l * 1.1) * 0.85 * this.gain;
      R[i] = Math.tanh(r * 1.1) * 0.85 * this.gain;
      this.now++;
    }
    if (this.gainTarget === 0 && this.gain < 1e-3) {
      this.playing = false;
      this.voices = [];
      this.queue = [];
      this.bass.kill();
    }
    // Reap finished voices
    let w = 0;
    for (let v = 0; v < this.voices.length; v++) {
      const vo = this.voices[v]!;
      if (!vo.done) this.voices[w++] = vo;
    }
    this.voices.length = w;
    return true;
  }
}

registerProcessor('noun-radio', NounRadio);

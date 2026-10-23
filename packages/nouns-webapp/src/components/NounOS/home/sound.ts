// noun.wtf's sound design, synthesized live with WebAudio (no files).
//
//   ident()      the "tu-DUM": a boom-bap kick + muted stab, then a warm sub
//                drop under a dusty minor-9 chord through a short room.
//   motif(game)  a short hover stinger per featured game.
//
// Browsers only let audio start after the visitor interacts with the page,
// so on a cold first load the intro is silent; that's fine. Nothing here
// throws: no AudioContext, a suspended one, or a blocked one all just mean
// silence.

import type { GameId } from './rows';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let room: ConvolverNode | null = null;

function audio(): Ctx | null {
  if (ctx) return ctx;
  try {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (AC === undefined) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    room = ctx.createConvolver();
    room.buffer = impulse(ctx, 1.6, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    room.connect(wet).connect(master);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Try to start audio (call from a click / key handler). Resolves true if it's running. */
export async function unlockAudio(): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  if (c.state === 'running') return true;
  try {
    await Promise.race([c.resume(), new Promise(r => setTimeout(r, 250))]);
  } catch {
    return false;
  }
  // `state` changed under us while awaiting resume()
  return (c.state as AudioContextState) === 'running';
}

export function audioRunning(): boolean {
  return ctx?.state === 'running';
}

function impulse(c: Ctx, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function noiseBuffer(c: Ctx, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Soft saturation curve: warmth on the sub. */
function warmCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

interface Out {
  dry: AudioNode;
  wet: AudioNode | null;
}

function outs(level: number): Out | null {
  const c = audio();
  if (!c || !master || c.state !== 'running') return null;
  const g = c.createGain();
  g.gain.value = level;
  g.connect(master);
  if (room) g.connect(room);
  return { dry: g, wet: room };
}

function kick(c: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.35);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noiseHit(
  c: Ctx,
  out: AudioNode,
  t: number,
  dur: number,
  vol: number,
  type: BiquadFilterType,
  freq: number,
  q = 1,
) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, dur + 0.05);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.05);
}

/** Detuned saw chord through a closing low-pass: the dusty stab. */
function stab(
  c: Ctx,
  out: AudioNode,
  t: number,
  freqs: number[],
  dur: number,
  vol: number,
  cutoff: [number, number],
) {
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(cutoff[0], t);
  f.frequency.exponentialRampToValueAtTime(cutoff[1], t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(out);
  for (const fr of freqs)
    for (const det of [-9, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * The ident. `soft` is the quieter replay when someone turns hero sound on.
 * Timing matches the intro: tu at +0.18s (lenses unfold), DUM at +0.62s
 * (noggles lock in).
 */
export function ident(soft = false): void {
  const base = outs(soft ? 0.45 : 0.9);
  const c = ctx;
  if (!base || !c || !master) return;
  // Its own long hall + a dark echo so the DUM rings out (like a held piano
  // note) instead of stopping dead; built per play, it's a one-off.
  const hall = c.createConvolver();
  hall.buffer = impulse(c, 4.5, 2.2);
  const hallG = c.createGain();
  hallG.gain.value = soft ? 0.35 : 0.55;
  const echo = c.createDelay(1);
  echo.delayTime.value = 0.38;
  const fb = c.createGain();
  fb.gain.value = 0.34;
  const echoTone = c.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 1400;
  const echoG = c.createGain();
  echoG.gain.value = 0.3;
  base.dry.connect(hall).connect(hallG).connect(master);
  base.dry.connect(echo).connect(echoTone).connect(fb).connect(echo);
  echoTone.connect(echoG);
  echoG.connect(hall);
  echoG.connect(master);
  const o = base;
  const t0 = c.currentTime + 0.05;
  // timed to the intro: tu as the lenses swing open, DUM as the pupils snap in
  const tu = t0 + (soft ? 0 : 0.27);
  const dum = tu + (soft ? 0.44 : 1.05);

  // tu: tight kick + muted stab + a vinyl tick
  kick(c, o.dry, tu, 110, 38, 0.3, 0.75);
  stab(c, o.dry, tu, [hz(41), hz(48), hz(51)], 0.24, 0.08, [900, 220]);
  noiseHit(c, o.dry, tu - 0.02, 0.04, 0.12, 'highpass', 2600);

  // DUM: sub drop with warmth, Fm9 stab, snare-ish crack, crackle bed
  const sub = c.createOscillator();
  const subG = c.createGain();
  const shaper = c.createWaveShaper();
  shaper.curve = warmCurve(2.2);
  sub.type = 'sine';
  sub.frequency.setValueAtTime(65, dum);
  sub.frequency.exponentialRampToValueAtTime(30, dum + 1.4);
  subG.gain.setValueAtTime(0.0001, dum);
  subG.gain.exponentialRampToValueAtTime(0.95, dum + 0.01);
  subG.gain.exponentialRampToValueAtTime(0.0001, dum + 2.6);
  sub.connect(shaper).connect(subG).connect(o.dry);
  sub.start(dum);
  sub.stop(dum + 2.7);

  // F1 Ab2 C3 Eb3 G3: F minor 9 an octave down, dark and warm
  stab(c, o.dry, dum, [hz(29), hz(44), hz(48), hz(51), hz(55)], 2.4, 0.12, [1500, 260]);
  noiseHit(c, o.dry, dum, 0.24, 0.2, 'bandpass', 800, 0.8);
  noiseHit(c, o.dry, dum, 2.0, 0.035, 'bandpass', 1500, 0.5);
}

/** Hover stingers for the hero, one per game. */
export function motif(game: GameId): void {
  const o = outs(0.5);
  const c = ctx;
  if (!o || !c) return;
  const t = c.currentTime + 0.02;
  if (game === 'world') {
    // board roll + a lazy major-7 arp
    noiseHit(c, o.dry, t, 0.9, 0.06, 'lowpass', 500, 0.7);
    [hz(65), hz(69), hz(72), hz(76)].forEach((f, i) =>
      stab(c, o.dry, t + i * 0.11, [f], 0.5, 0.05, [3000, 700]),
    );
  } else if (game === 'hoops') {
    // two dribbles and a sneaker squeak
    kick(c, o.dry, t, 210, 90, 0.16, 0.6);
    kick(c, o.dry, t + 0.28, 210, 90, 0.14, 0.45);
    const sq = c.createOscillator();
    const g = c.createGain();
    sq.type = 'triangle';
    sq.frequency.setValueAtTime(1800, t + 0.5);
    sq.frequency.exponentialRampToValueAtTime(2900, t + 0.62);
    g.gain.setValueAtTime(0.0001, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.52);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
    sq.connect(g).connect(o.dry);
    sq.start(t + 0.5);
    sq.stop(t + 0.7);
  } else {
    // paintball pops + a hard stab
    [0, 0.09, 0.2].forEach((d, i) => {
      noiseHit(c, o.dry, t + d, 0.07, 0.3 - i * 0.07, 'bandpass', 900 + i * 300, 1.4);
      kick(c, o.dry, t + d, 320, 120, 0.06, 0.25);
    });
    stab(c, o.dry, t + 0.32, [hz(50), hz(57), hz(62)], 0.5, 0.07, [2200, 400]);
  }
}

/** A tiny tick for focusing cards with the keyboard (sound on only). */
export function tick(): void {
  const o = outs(0.25);
  const c = ctx;
  if (!o || !c) return;
  noiseHit(c, o.dry, c.currentTime, 0.025, 0.12, 'highpass', 4000);
}

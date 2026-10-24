// noun.wtf's sound design, synthesized live with WebAudio (no files).
//
//   ident()      the "tu-DUM": a boom-bap kick + muted stab, then a warm sub
//                drop under a dusty minor-9 chord through a short room.
//   motif(game)  a short hover stinger per featured game.
//   playFile()   a file: the hero's voice-over (voiceOver.ts).
//   courtBed()   the Noun Hoops slide's bed (bed.ts): a looping groove file
//                and a synthesised court (dribbles, squeaks, swish, crowd).
//
// Browsers only let audio start after the visitor interacts with the page,
// so on a cold first load the intro is silent; that's fine. Nothing here
// throws: no AudioContext, a suspended one, or a blocked one all just mean
// silence.

import type { GameId } from './rows';

import { BED_AMBIENCE_LEVEL, BED_FADE_IN, BED_FADE_OUT, BED_TRACK_LEVEL } from './bed';

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

const files = new Map<string, Promise<AudioBuffer | null>>();

/** A decoded audio file (fetched once per page view). */
function loadFile(c: Ctx, url: string): Promise<AudioBuffer | null> {
  let p = files.get(url);
  if (p === undefined) {
    p = fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(b => c.decodeAudioData(b))
      .catch(() => {
        files.delete(url); // try again next time
        return null;
      });
    files.set(url, p);
  }
  return p;
}

export interface Playback {
  /** Fade out and stop (safe to call any time, any number of times). */
  stop(): void;
  /** Resolves when it finishes, is stopped, or couldn't play. */
  done: Promise<void>;
}

/**
 * Play a voice-over file through the master bus (dry: the file carries its own
 * room). Only while audio is already running, so it can never be the thing
 * that makes a page start talking before the visitor turned sound on.
 */
export function playFile(url: string, level = 1): Playback | null {
  const c = audio();
  if (!c || !master || c.state !== 'running') return null;
  const g = c.createGain();
  g.gain.value = level;
  g.connect(master);
  let src: AudioBufferSourceNode | null = null;
  let stopped = false;
  let finish: () => void = () => undefined;
  const done = new Promise<void>(r => (finish = r));
  const end = () => {
    finish();
    setTimeout(() => g.disconnect(), 400);
  };
  void loadFile(c, url).then(buf => {
    if (stopped || buf === null || c.state !== 'running') return end();
    src = c.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.onended = end;
    src.start(c.currentTime + 0.05);
  });
  return {
    done,
    stop() {
      if (stopped) return;
      stopped = true;
      if (src === null) return end();
      const now = c.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0, now, 0.08);
      try {
        src.stop(now + 0.35);
      } catch {
        end();
      }
    },
  };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The Noun Hoops slide's bed (bed.ts): `track` on loop plus a synthesised
 * court under it: dribble runs, sneaker squeaks, a swish now and then with
 * the crowd lifting and a scatter of claps, all over a low crowd murmur in
 * the room. Fades in; `stop()` fades it out. Only while audio is already
 * running, like playFile.
 */
export function courtBed(track: string): Playback | null {
  const c = audio();
  if (!c || !master || c.state !== 'running') return null;
  const t0 = c.currentTime;
  // One fade on the dry bus and one on the room send, ramped together
  const fade = c.createGain();
  const send = c.createGain();
  for (const [g, to] of [
    [fade, 1],
    [send, 0.45],
  ] as const) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.setTargetAtTime(to, t0, BED_FADE_IN / 3);
  }
  fade.connect(master);
  if (room) send.connect(room);

  const music = c.createGain();
  music.gain.value = BED_TRACK_LEVEL;
  music.connect(fade);
  const court = c.createGain();
  court.gain.value = BED_AMBIENCE_LEVEL;
  court.connect(fade);
  court.connect(send);

  const noise = noiseBuffer(c, 2);
  const sources: AudioScheduledSourceNode[] = [];

  // Crowd murmur: looped noise through two voice-ish bands, breathing slowly
  const murmur = c.createBufferSource();
  murmur.buffer = noise;
  murmur.loop = true;
  const crowd = c.createGain();
  crowd.gain.value = 0.1;
  for (const [f, q, v] of [
    [420, 0.9, 1],
    [1150, 1.4, 0.45],
  ] as const) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.value = v;
    murmur.connect(bp).connect(g).connect(crowd);
  }
  crowd.connect(court);
  murmur.start(t0);
  sources.push(murmur);

  const panned = (pan: number): AudioNode => {
    if (typeof c.createStereoPanner !== 'function') return court;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(court);
    return p;
  };
  // A short burst of the shared noise buffer, filtered
  const burst = (
    out: AudioNode,
    t: number,
    dur: number,
    vol: number,
    type: BiquadFilterType,
    f0: number,
    f1 = f0,
    q = 1,
  ) => {
    const s = c.createBufferSource();
    s.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, rnd(0, 1.5));
    s.stop(t + dur + 0.05);
  };
  const dribble = (out: AudioNode, t: number, vol: number) => {
    kick(c, out, t, rnd(180, 220), 85, 0.14, vol);
    burst(out, t, 0.035, vol * 0.3, 'bandpass', 1300, 1300, 1.2);
  };
  const squeak = (out: AudioNode, t: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    const f = rnd(1700, 2600);
    const d = rnd(0.06, 0.13);
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * rnd(1.15, 1.5), t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(rnd(0.04, 0.08), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.03);
  };
  const swish = (t: number) => {
    const out = panned(rnd(-0.3, 0.3));
    burst(out, t - 0.05, 0.05, 0.08, 'bandpass', 900, 900, 3); // rim kiss
    burst(out, t, 0.38, 0.16, 'bandpass', 2600, 6500, 1.1); // the net
    // the crowd lifts, then a scatter of claps
    crowd.gain.setTargetAtTime(0.24, t + 0.15, 0.12);
    crowd.gain.setTargetAtTime(0.1, t + 1.2, 0.5);
    for (let i = 0; i < 14; i++)
      burst(panned(rnd(-0.8, 0.8)), t + rnd(0.25, 1.4), 0.03, rnd(0.04, 0.09), 'highpass', 1500);
  };

  // Lookahead scheduler: plans events a little ahead of the audio clock
  let nextDribble = t0 + 0.4;
  let runLeft = 0;
  let runOut: AudioNode = court;
  let runVol = 0.4;
  let nextSqueak = t0 + rnd(0.8, 2);
  let nextSwish = t0 + rnd(4, 6);
  const plan = () => {
    const until = c.currentTime + 0.3;
    while (nextDribble < until) {
      if (runLeft <= 0) {
        runLeft = Math.floor(rnd(4, 10));
        runOut = panned(rnd(-0.6, 0.6));
        runVol = rnd(0.3, 0.5);
      }
      dribble(runOut, nextDribble, runVol * rnd(0.85, 1));
      runLeft--;
      nextDribble += runLeft > 0 ? rnd(0.36, 0.46) : rnd(0.8, 1.8);
    }
    while (nextSqueak < until) {
      const out = panned(rnd(-0.7, 0.7));
      squeak(out, nextSqueak);
      if (Math.random() < 0.4) squeak(out, nextSqueak + rnd(0.08, 0.16));
      nextSqueak += rnd(0.9, 3);
    }
    while (nextSwish < until) {
      swish(nextSwish);
      nextSwish += rnd(6, 10);
    }
  };
  plan();
  const timer = window.setInterval(plan, 100);

  // The groove, once it's decoded
  let stopped = false;
  void loadFile(c, track).then(buf => {
    if (stopped || buf === null) return;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(music);
    s.start(c.currentTime + 0.05);
    sources.push(s);
  });

  let finish: () => void = () => undefined;
  const done = new Promise<void>(r => (finish = r));
  return {
    done,
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      const now = c.currentTime;
      for (const g of [fade, send]) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, BED_FADE_OUT / 3);
      }
      const end = now + BED_FADE_OUT * 2;
      for (const s of sources)
        try {
          s.stop(end);
        } catch {
          // already stopped
        }
      setTimeout(
        () => {
          fade.disconnect();
          send.disconnect();
          finish();
        },
        BED_FADE_OUT * 2000 + 100,
      );
    },
  };
}

/** A tiny tick for focusing cards with the keyboard (sound on only). */
export function tick(): void {
  const o = outs(0.25);
  const c = ctx;
  if (!o || !c) return;
  noiseHit(c, o.dry, c.currentTime, 0.025, 0.12, 'highpass', 4000);
}

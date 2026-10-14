// ── NOUN FM idents: the "radio knock" between songs ────────────────────
//
// All synthesised on the spot in WebAudio (no recordings, nothing
// copyrighted): a noggles chime, a sweep + sub drop, a party airhorn, and a
// robot station voice. The voice uses the browser's speech synthesis
// (pitched right down) when there is one and we're tuned in directly; it
// can't go through WebAudio, so out at the van's speakers (spatial) and on
// browsers without it a formant "talkbox" synth says the call sign instead.
// The play's key seeds the choice, so everyone tuned in hears the same one.

export const IDENT_KINDS = [
  'chime',
  'sweep',
  'airhorn',
  'voice',
  'chime+voice',
  'sweep+horn',
] as const;
export type IdentKind = (typeof IDENT_KINDS)[number];

const LINES = [
  "you're tuned to noun F M",
  'noun F M, live from the ice cream van',
  'noun F M. noggles on.',
  'this is noun F M. keep pushing.',
  'noun F M. the plaza station.',
];

/** Stable 32-bit hash of the play key (same ident for everyone). */
export function identSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function pickIdent(key: string): { kind: IdentKind; line: string; pitch: number } {
  const h = identSeed(key);
  return {
    kind: IDENT_KINDS[h % IDENT_KINDS.length]!,
    line: LINES[(h >>> 8) % LINES.length]!,
    // a few semitones of variety
    pitch: 2 ** ((((h >>> 16) % 7) - 3) / 12),
  };
}

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** ⌐◨-◨ chime: four bell notes (sine + inharmonic partial) with an echo. */
function chime(ctx: BaseAudioContext, out: AudioNode, t: number, p: number) {
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.23;
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  echo.connect(fb).connect(echo);
  echo.connect(out);
  [523.25, 783.99, 659.25, 1046.5].forEach((f, i) => {
    const at = t + i * 0.16;
    for (const [mul, lvl] of [
      [1, 0.28],
      [2.76, 0.07],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * p * mul;
      const g = ctx.createGain();
      env(g, at, 0.005, lvl, i === 3 ? 1.4 : 0.6);
      o.connect(g);
      g.connect(out);
      g.connect(echo);
      o.start(at);
      o.stop(at + 1.6);
    }
  });
  return 1.9;
}

/** Noise riser into a sub drop. */
function sweep(ctx: BaseAudioContext, out: AudioNode, t: number, p: number, noise: AudioBuffer) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 4;
  bp.frequency.setValueAtTime(220, t);
  bp.frequency.exponentialRampToValueAtTime(7000 * p, t + 1.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 1.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 1.45);
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(140 * p, t + 1.3);
  sub.frequency.exponentialRampToValueAtTime(38, t + 2.3);
  const sg = ctx.createGain();
  env(sg, t + 1.3, 0.01, 0.6, 1.0);
  sub.connect(sg).connect(out);
  sub.start(t + 1.3);
  sub.stop(t + 2.4);
  return 2.4;
}

/** Party airhorn: three blasts of a detuned saw stack, the last one long. */
function airhorn(ctx: BaseAudioContext, out: AudioNode, t: number, p: number) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 2.5);
  shaper.curve = curve;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1300;
  bp.Q.value = 0.8;
  shaper.connect(bp).connect(out);
  const blasts: [number, number][] = [
    [0, 0.16],
    [0.24, 0.16],
    [0.48, 0.75],
  ];
  for (const [at, len] of blasts) {
    for (const det of [0, 7, -9, 12.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = 466 * p * (1 + det / 1000);
      o.frequency.setValueAtTime(f * 0.94, t + at);
      o.frequency.linearRampToValueAtTime(f, t + at + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.linearRampToValueAtTime(0.09, t + at + 0.02);
      g.gain.setValueAtTime(0.09, t + at + len);
      g.gain.linearRampToValueAtTime(0.0001, t + at + len + 0.06);
      o.connect(g).connect(shaper);
      o.start(t + at);
      o.stop(t + at + len + 0.1);
    }
  }
  return 1.35;
}

/** Formant "talkbox": a buzzy saw through two moving bandpass filters saying the call sign. */
function talkbox(ctx: BaseAudioContext, out: AudioNode, t: number, p: number) {
  // (vowel formants F1/F2, length): "noun" "ef" "em"
  const syl: [number, number, number][] = [
    [300, 870, 0.32],
    [530, 1840, 0.22],
    [530, 1840, 0.18],
    [360, 1100, 0.3],
  ];
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 92 * p;
  const vib = ctx.createOscillator();
  vib.frequency.value = 38; // robotic ring-mod wobble
  const vg = ctx.createGain();
  vg.gain.value = 18;
  vib.connect(vg).connect(o.frequency);
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.type = f2.type = 'bandpass';
  f1.Q.value = 9;
  f2.Q.value = 12;
  const g = ctx.createGain();
  g.gain.value = 0;
  o.connect(f1).connect(g);
  o.connect(f2).connect(g);
  g.connect(out);
  let at = t;
  for (const [a, b, len] of syl) {
    f1.frequency.setTargetAtTime(a, at, 0.02);
    f2.frequency.setTargetAtTime(b, at, 0.02);
    g.gain.setTargetAtTime(0.9, at, 0.015);
    g.gain.setTargetAtTime(0.0001, at + len - 0.05, 0.02);
    at += len + 0.04;
  }
  o.start(t);
  vib.start(t);
  o.stop(at + 0.2);
  vib.stop(at + 0.2);
  return at - t + 0.2;
}

function speak(line: string, volume: number): boolean {
  const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (ss === undefined || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    const u = new SpeechSynthesisUtterance(line);
    u.pitch = 0.1;
    u.rate = 0.9;
    u.volume = Math.max(0, Math.min(1, volume));
    ss.cancel();
    ss.speak(u);
    return true;
  } catch {
    return false;
  }
}

/**
 * Play one ident into `out` (the FM bus). `speech`: may use the browser
 * voice (only when tuned in directly). Returns its length in seconds.
 */
export function playIdent(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  key: string,
  opts: { speech: boolean; volume: number },
): { kind: IdentKind; seconds: number } {
  const { kind, line, pitch } = pickIdent(key);
  const t = ctx.currentTime + 0.05;
  let s = 0;
  const voice = (at: number) => {
    // a little ring-mod buzz under the synthetic voice so it reads as a robot
    if (opts.speech && speak(line, opts.volume)) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 55;
      const g = ctx.createGain();
      env(g, at, 0.05, 0.05, 1.6);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 1.8);
      return 1.9;
    }
    return talkbox(ctx, out, at, pitch);
  };
  switch (kind) {
    case 'chime':
      s = chime(ctx, out, t, pitch);
      break;
    case 'sweep':
      s = sweep(ctx, out, t, pitch, noise);
      break;
    case 'airhorn':
      s = airhorn(ctx, out, t, pitch);
      break;
    case 'voice':
      s = voice(t);
      break;
    case 'chime+voice':
      s = Math.max(chime(ctx, out, t, pitch), 0.7 + voice(t + 0.7));
      break;
    case 'sweep+horn':
      s = Math.max(sweep(ctx, out, t, pitch, noise), 1.4 + airhorn(ctx, out, t + 1.4, pitch));
      break;
  }
  return { kind, seconds: s };
}

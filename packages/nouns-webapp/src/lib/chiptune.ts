/**
 * Tiny Web Audio chiptune engine for the Borgs breeding chamber.
 *
 * The slow jam is an ORIGINAL composition in a 70s-soul mood (think
 * Marvin-adjacent, not Marvin — the actual melody/recording is copyrighted,
 * so this is our own baby-making progression on 8-bit voices).
 */

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Note {
  /** start time in beats from loop start */
  t: number;
  /** midi note */
  m: number;
  /** length in beats */
  d: number;
  /** 0..1 velocity */
  v?: number;
}

const BPM = 66;
const BEAT = 60 / BPM;
const LOOP_BEATS = 32; // 8 bars of 4/4

// Ebmaj7 -> Cm7 -> Abmaj7 -> Bb9, two bars each. A stock soul vamp.
const CHORDS: { t: number; notes: number[] }[] = [
  { t: 0, notes: [51, 55, 58, 62] }, // Ebmaj7
  { t: 8, notes: [48, 51, 55, 58] }, // Cm7
  { t: 16, notes: [44, 48, 51, 55] }, // Abmaj7
  { t: 24, notes: [46, 50, 53, 60] }, // Bb9 (no 5th)
];

const BASS: Note[] = [
  // laid-back root/fifth walk
  { t: 0, m: 39, d: 2.5 },
  { t: 3, m: 46, d: 1 },
  { t: 4, m: 39, d: 2 },
  { t: 6.5, m: 43, d: 1.5 },
  { t: 8, m: 36, d: 2.5 },
  { t: 11, m: 43, d: 1 },
  { t: 12, m: 36, d: 2 },
  { t: 14.5, m: 39, d: 1.5 },
  { t: 16, m: 32, d: 2.5 },
  { t: 19, m: 39, d: 1 },
  { t: 20, m: 32, d: 2 },
  { t: 22.5, m: 36, d: 1.5 },
  { t: 24, m: 34, d: 2.5 },
  { t: 27, m: 41, d: 1 },
  { t: 28, m: 34, d: 1.5 },
  { t: 30, m: 36, d: 1 },
  { t: 31, m: 38, d: 1 },
];

// Original lead phrase — sparse, syncopated, Eb pentatonic with a blue note.
const LEAD: Note[] = [
  { t: 1.5, m: 70, d: 1, v: 0.9 },
  { t: 3, m: 67, d: 1.5, v: 0.8 },
  { t: 6, m: 65, d: 0.5, v: 0.6 },
  { t: 6.5, m: 67, d: 1.5, v: 0.8 },
  { t: 9.5, m: 63, d: 1, v: 0.8 },
  { t: 11, m: 60, d: 2, v: 0.7 },
  { t: 14.5, m: 62, d: 0.5, v: 0.5 },
  { t: 15, m: 63, d: 1, v: 0.7 },
  { t: 17.5, m: 67, d: 1, v: 0.85 },
  { t: 19, m: 68, d: 0.5, v: 0.6 },
  { t: 19.5, m: 67, d: 1.5, v: 0.8 },
  { t: 22, m: 63, d: 1.5, v: 0.7 },
  { t: 25.5, m: 65, d: 1, v: 0.8 },
  { t: 27, m: 62, d: 1, v: 0.7 },
  { t: 28.5, m: 58, d: 2.5, v: 0.75 },
];

function scheduleVoice(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  note: Note,
  opts: { type: OscillatorType; gain: number; detune?: number; vibrato?: boolean },
) {
  const start = when + note.t * BEAT;
  const stop = start + note.d * BEAT;
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.value = midiToFreq(note.m);
  if (opts.detune) osc.detune.value = opts.detune;
  if (opts.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6; // cents
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    lfo.start(start);
    lfo.stop(stop);
  }
  const g = ctx.createGain();
  const vel = opts.gain * (note.v ?? 1);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(vel, start + 0.03);
  g.gain.setValueAtTime(vel, Math.max(start + 0.03, stop - 0.12));
  g.gain.linearRampToValueAtTime(0.0001, stop);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(stop + 0.05);
}

function scheduleLoop(ctx: AudioContext, dest: AudioNode, when: number) {
  // chords: two soft detuned squares per note, rhodes-ish
  for (const chord of CHORDS) {
    for (const m of chord.notes) {
      scheduleVoice(ctx, dest, when, { t: chord.t, m, d: 7.5 }, { type: 'square', gain: 0.028 });
      scheduleVoice(
        ctx,
        dest,
        when,
        { t: chord.t, m, d: 7.5 },
        { type: 'square', gain: 0.02, detune: 8 },
      );
    }
  }
  for (const n of BASS) scheduleVoice(ctx, dest, when, n, { type: 'triangle', gain: 0.22 });
  for (const n of LEAD)
    scheduleVoice(ctx, dest, when, n, { type: 'square', gain: 0.07, vibrato: true });

  // percussion: soft sine thump on 1+3, hush noise hat on offbeats
  for (let beat = 0; beat < LOOP_BEATS; beat++) {
    const t = when + beat * BEAT;
    if (beat % 2 === 0) {
      const kick = ctx.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(95, t);
      kick.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.16, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      kick.connect(kg);
      kg.connect(dest);
      kick.start(t);
      kick.stop(t + 0.2);
    }
    const hatT = t + BEAT / 2;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(dest);
    noise.start(hatT);
  }
}

/**
 * Start the breeding slow jam. Returns a stop function (fades out and
 * releases the AudioContext). Safe to call from a click handler only —
 * browsers gate AudioContext on a user gesture.
 */
export function startSlowJam(): () => void {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => undefined;
  }
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2); // ease in
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200; // take the 8-bit edge off — it's a slow jam
  master.connect(lp);
  lp.connect(ctx.destination);

  const loopSeconds = LOOP_BEATS * BEAT;
  let nextLoopAt = ctx.currentTime + 0.1;
  let stopped = false;
  scheduleLoop(ctx, master, nextLoopAt);
  nextLoopAt += loopSeconds;
  const timer = setInterval(() => {
    if (stopped) return;
    if (ctx.currentTime > nextLoopAt - loopSeconds / 2) {
      scheduleLoop(ctx, master, nextLoopAt);
      nextLoopAt += loopSeconds;
    }
  }, 1000);

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      setTimeout(() => void ctx.close().catch(() => undefined), 1000);
    } catch {
      void ctx.close().catch(() => undefined);
    }
  };
}

/** Short celebratory arpeggio for mint / birth reveals. */
export function playTada() {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);
  const now = ctx.currentTime + 0.02;
  // Eb major sparkle: Eb5 G5 Bb5 Eb6
  [75, 79, 82, 87].forEach((m, i) => {
    const t = now + i * 0.09;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = midiToFreq(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + (i === 3 ? 0.7 : 0.25));
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.8);
  });
  setTimeout(() => void ctx.close().catch(() => undefined), 1500);
}

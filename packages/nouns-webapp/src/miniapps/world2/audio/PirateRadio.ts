// ── NOUN PIRATE RADIO — procedural Jet Set Radio-style soundtrack ───────
//
// Everything is synthesized live with WebAudio (no samples, no licensing):
// breakbeat drums with swing + ghost notes, a funky gliding bassline, chord
// stabs, an organ/lead hook, scratch fills, vinyl crackle and a little
// station-ID sting. Each "station" is a seeded song description; bars
// evolve (fills every 4/8 bars, breakdowns, drops) so it doesn't loop dead.
//
// Live streams (e.g. a partner radio) plug in through RADIO_STREAMS.

export interface StreamStation {
  name: string;
  url: string;
}

/** Add live internet-radio streams here (direct mp3/aac/icecast URLs). */
export const RADIO_STREAMS: StreamStation[] = [];

interface Song {
  name: string;
  bpm: number;
  swing: number; // 0..0.3 of a 16th
  root: number; // MIDI note of the key
  minor: boolean;
  progression: number[]; // scale degrees per bar (2 bars each)
  kick: number[];
  snare: number[];
  hat: number[];
  bass: (number | null)[]; // scale degree offsets per 16th (null = rest)
  stab: number[]; // 16th positions for chord stabs
  lead: (number | null)[];
  leadWave: OscillatorType;
  bassWave: OscillatorType;
  stabCutoff: number;
}

const STEPS = 16;
const p = (s: string) =>
  s.split('').map(c => (c === 'x' ? 1 : c === 'o' ? 0.45 : c === '.' ? 0 : 0.7));

const SONGS: Song[] = [
  {
    name: 'Noggle Funk',
    bpm: 98,
    swing: 0.18,
    root: 40, // E
    minor: true,
    progression: [0, 0, 3, 4],
    kick: p('x..x..x...x.x...'),
    snare: p('....x..o.o..x..o'),
    hat: p('x.xox.xox.xox.xx'),
    bass: [0, null, null, 0, null, 7, null, 0, null, null, 3, null, 5, null, 3, null],
    stab: [2, 7, 10],
    lead: [null, null, 7, null, 10, null, 7, null, null, null, 12, null, 10, 7, null, null],
    leadWave: 'square',
    bassWave: 'sawtooth',
    stabCutoff: 1800,
  },
  {
    name: 'Shibuya ⌐◨-◨',
    bpm: 112,
    swing: 0.08,
    root: 45, // A
    minor: true,
    progression: [0, 5, 3, 4],
    kick: p('x.....x.x.x.....'),
    snare: p('....x.......x.o.'),
    hat: p('xxxxxxxxxxxxxxxx'),
    bass: [0, null, 0, null, null, 0, null, 7, 0, null, 0, null, 10, null, 7, null],
    stab: [0, 3, 6, 10, 13],
    lead: [12, null, null, 10, null, null, 7, null, 12, null, 14, null, 12, null, null, null],
    leadWave: 'sawtooth',
    bassWave: 'square',
    stabCutoff: 2600,
  },
  {
    name: 'Treasury Breaks',
    bpm: 90,
    swing: 0.22,
    root: 38, // D
    minor: true,
    progression: [0, 0, 5, 3],
    kick: p('x.x.......x..x..'),
    snare: p('....x..o....x...'),
    hat: p('x.x.x.xox.x.x.xo'),
    bass: [0, null, null, null, null, null, 0, 3, null, null, 5, null, null, 7, 5, null],
    stab: [4, 12],
    lead: [null, null, null, null, 7, 8, 7, null, null, null, 5, null, 3, null, null, null],
    leadWave: 'triangle',
    bassWave: 'sawtooth',
    stabCutoff: 1400,
  },
  {
    name: 'Prop House Boogie',
    bpm: 120,
    swing: 0.12,
    root: 43, // G
    minor: false,
    progression: [0, 4, 5, 3],
    kick: p('x...x...x...x...'),
    snare: p('....x.......x...'),
    hat: p('..x...x...x...xo'),
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, 10, 7, null, 5, null],
    stab: [2, 6, 10, 14],
    lead: [null, 12, null, 11, null, 12, null, 14, null, 12, null, 11, 9, null, 7, null],
    leadWave: 'square',
    bassWave: 'square',
    stabCutoff: 3000,
  },
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export type RadioMode = 'off' | 'pirate' | 'stream';

export class PirateRadio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackle: AudioBufferSourceNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  songIndex = 0;
  mode: RadioMode = 'off';
  volume = 0.55;
  streamIndex = 0;
  private audioEl: HTMLAudioElement | null = null;
  /** Called with a "now playing" label whenever the track/station changes. */
  onNowPlaying?: (label: string) => void;

  get song() {
    return SONGS[this.songIndex];
  }

  get label(): string {
    if (this.mode === 'pirate') return `NOUN PIRATE RADIO · ${this.song.name}`;
    if (this.mode === 'stream') return RADIO_STREAMS[this.streamIndex]?.name ?? 'stream';
    return 'radio off';
  }

  /** Attach to an existing AudioContext + destination (the game mix). */
  attach(ctx: AudioContext, destination: AudioNode, noise: AudioBuffer | null) {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);
    // Music bus with a touch of saturation + lowpass "radio" colour
    this.music = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 9000;
    this.music.connect(shaper).connect(tone).connect(this.out);
    this.noise = noise ?? this.makeNoise();
  }

  private makeNoise() {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out !== null) this.out.gain.value = v;
    if (this.audioEl !== null) this.audioEl.volume = Math.min(1, v * 1.4);
  }

  /** off → pirate → each stream → off */
  cycle() {
    if (this.mode === 'off') this.setMode('pirate');
    else if (this.mode === 'pirate') {
      if (RADIO_STREAMS.length > 0) {
        this.streamIndex = 0;
        this.setMode('stream');
      } else this.setMode('off');
    } else if (this.streamIndex < RADIO_STREAMS.length - 1) {
      this.streamIndex++;
      this.setMode('stream');
    } else this.setMode('off');
  }

  nextTrack() {
    if (this.mode !== 'pirate') {
      this.setMode('pirate');
      return;
    }
    this.songIndex = (this.songIndex + 1) % SONGS.length;
    this.bar = 0;
    this.step = 0;
    this.scratch(this.nextTime);
    this.onNowPlaying?.(this.label);
  }

  setMode(m: RadioMode) {
    this.stopPirate();
    this.stopStream();
    this.mode = m;
    if (m === 'pirate') this.startPirate();
    if (m === 'stream') this.startStream();
    this.onNowPlaying?.(this.label);
  }

  // ── Live streams ──────────────────────────────────────────────────────

  private startStream() {
    const st = RADIO_STREAMS[this.streamIndex];
    if (st === undefined) return;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = st.url;
    el.volume = Math.min(1, this.volume * 1.4);
    void el.play().catch(() => {
      // Autoplay blocked or stream down — fall back to the pirate station
      this.setMode('pirate');
    });
    this.audioEl = el;
  }

  private stopStream() {
    if (this.audioEl !== null) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
  }

  // ── Pirate station (sequencer) ────────────────────────────────────────

  private startPirate() {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.nextTime = ctx.currentTime + 0.12;
    this.step = 0;
    this.bar = 0;
    this.stationId(this.nextTime);
    // Vinyl crackle bed
    if (this.noise !== null && this.music !== null) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5000;
      const g = ctx.createGain();
      g.gain.value = 0.012;
      src.connect(hp).connect(g).connect(this.music);
      src.start();
      this.crackle = src;
    }
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stopPirate() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    try {
      this.crackle?.stop();
    } catch {
      // already stopped
    }
    this.crackle = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (ctx === null || this.mode !== 'pirate') return;
    const s = this.song;
    const sixteenth = 60 / s.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const swing = this.step % 2 === 1 ? s.swing * sixteenth : 0;
      this.playStep(this.nextTime + swing, this.step, this.bar, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
      if (this.step >= STEPS) {
        this.step = 0;
        this.bar++;
        // Every 32 bars, hand over to the next station with a scratch
        if (this.bar >= 32) {
          this.bar = 0;
          this.songIndex = (this.songIndex + 1) % SONGS.length;
          this.scratch(this.nextTime - sixteenth * 2);
          this.onNowPlaying?.(this.label);
        }
      }
    }
  }

  private playStep(t: number, step: number, bar: number, sixteenth: number) {
    const s = this.song;
    const phrase = bar % 8;
    const isFill = phrase === 7 && step >= 8;
    const breakdown = bar % 16 >= 12 && bar % 16 < 14; // drums thin out
    const intro = bar < 2;
    const scale = s.minor ? MINOR : MAJOR;
    const degree = s.progression[Math.floor(bar / 2) % s.progression.length];
    const chordRoot = s.root + scale[degree % 7] + 12 * Math.floor(degree / 7);
    const deg = (n: number) => {
      const oct = Math.floor(n / 7);
      return scale[((n % 7) + 7) % 7] + 12 * oct;
    };

    // Drums
    if (!breakdown || step % 4 === 0) {
      if (s.kick[step] > 0 && !(intro && step > 0)) this.kick(t, s.kick[step]);
    }
    if (!intro) {
      if (isFill) {
        if (step % 2 === 0 || Math.random() < 0.5) this.snare(t, 0.35 + (step - 8) * 0.07);
      } else if (s.snare[step] > 0) this.snare(t, s.snare[step]);
      if (!breakdown && s.hat[step] > 0)
        this.hat(t, s.hat[step] * (step % 4 === 2 ? 1 : 0.7), step === 14);
      // Random ghost notes for groove
      if (!breakdown && Math.random() < 0.06) this.snare(t, 0.18);
    }

    // Bass
    const b = s.bass[step];
    if (b !== null && !intro) {
      const note = chordRoot - 12 + deg(b) - deg(0) + (b >= 7 ? 0 : 0);
      this.bass(
        t,
        midiHz(note),
        sixteenth * (s.bass[(step + 1) % STEPS] === null ? 1.8 : 0.9),
        s.bassWave,
      );
    }

    // Chord stabs
    if (s.stab.includes(step) && bar % 4 !== 3) {
      const third = s.minor ? 3 : 4;
      this.stab(
        t,
        [chordRoot + 12, chordRoot + 12 + third, chordRoot + 19, chordRoot + 22],
        s.stabCutoff,
      );
    }

    // Lead hook on the second half of each 8-bar phrase
    const l = s.lead[step];
    if (l !== null && phrase >= 4 && !breakdown) {
      this.lead(t, midiHz(s.root + 24 + deg(l)), sixteenth * 1.6, s.leadWave);
    }

    // Scratch accents at phrase ends
    if (phrase === 7 && step === 12 && Math.random() < 0.6) this.scratch(t);
  }

  // ── Instruments ───────────────────────────────────────────────────────

  private env(t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private kick(t: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.env(t, 0.9 * v, 0.002, 0.32);
    o.connect(g).connect(this.music!);
    o.start(t);
    o.stop(t + 0.4);
    this.noiseHit(t, 0.25 * v, 3000, 0.012, 'highpass');
  }

  private snare(t: number, v: number) {
    const ctx = this.ctx!;
    this.noiseHit(t, 0.55 * v, 1800, 0.16, 'bandpass', 0.8);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const g = this.env(t, 0.35 * v, 0.001, 0.1);
    o.connect(g).connect(this.music!);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, v: number, open: boolean) {
    this.noiseHit(t, 0.16 * v, 8000, open ? 0.22 : 0.035, 'highpass');
  }

  private noiseHit(
    t: number,
    peak: number,
    freq: number,
    decay: number,
    type: BiquadFilterType,
    q = 1,
  ) {
    const ctx = this.ctx!;
    if (this.noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(t, peak, 0.001, decay);
    src.connect(f).connect(g).connect(this.music!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.05);
  }

  private bass(t: number, hz: number, dur: number, wave: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(hz * 0.985, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.03); // little slide-in
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = this.env(t, 0.42, 0.005, dur);
    o.connect(f).connect(g).connect(this.music!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private stab(t: number, notes: number[], cutoff: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.22);
    const g = this.env(t, 0.13, 0.004, 0.24);
    f.connect(g).connect(this.music!);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + 0.3);
      }
    }
  }

  private lead(t: number, hz: number, dur: number, wave: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = hz;
    // Little vibrato for that organ/lead character
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = ctx.createGain();
    lg.gain.value = hz * 0.006;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = this.env(t, 0.085, 0.01, dur);
    o.connect(f).connect(g).connect(this.music!);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Turntable scratch: noise through a sweeping bandpass, back and forth. */
  private scratch(t: number) {
    const ctx = this.ctx!;
    if (this.noise === null) return;
    for (let k = 0; k < 2; k++) {
      const st = t + k * 0.11;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(k === 0 ? 400 : 2400, st);
      f.frequency.exponentialRampToValueAtTime(k === 0 ? 2400 : 300, st + 0.1);
      const g = this.env(st, 0.3, 0.005, 0.1);
      src.connect(f).connect(g).connect(this.music!);
      src.start(st, Math.random());
      src.stop(st + 0.13);
    }
  }

  /** Little pirate-radio ident: a rising "laser" + optional spoken tag. */
  private stationId(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    const g = this.env(t, 0.08, 0.01, 0.4);
    o.connect(g).connect(this.music!);
    o.start(t);
    o.stop(t + 0.45);
    try {
      const synth = window.speechSynthesis as SpeechSynthesis | undefined;
      if (synth !== undefined) {
        const u = new SpeechSynthesisUtterance('Noun pirate radio!');
        u.rate = 1.15;
        u.pitch = 0.6;
        u.volume = Math.min(1, this.volume * 1.3);
        synth.speak(u);
      }
    } catch {
      // speech unavailable — the laser will do
    }
  }

  dispose() {
    this.stopPirate();
    this.stopStream();
    this.out?.disconnect();
    this.ctx = null;
  }
}

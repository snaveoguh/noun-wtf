// ── NOUN PIRATE RADIO — procedural cloud-rap / ethereal underground ─────
//
// Everything is synthesized live with WebAudio (no samples, no licensing).
// The vibe is Sad Boys / Yung Gud cloud rap: slow half-time trap drums with
// hat rolls, long sliding 808s, washed-out detuned pads, a ghostly formant
// "ahh" choir, glassy bells through a dotted-eighth delay, everything sent
// into a big generated reverb, with tape wobble, rain and vinyl hiss on top.
// Songs evolve over 8-bar phrases (intro → drop → breakdown) and the station
// rotates every 32 bars.
//
// Live internet streams plug in through RADIO_STREAMS.

export interface StreamStation {
  name: string;
  url: string;
}

/** Add live internet-radio streams here (direct mp3/aac/icecast URLs). */
export const RADIO_STREAMS: StreamStation[] = [];

interface Song {
  name: string;
  bpm: number; // trap tempo; drums play half-time
  root: number; // MIDI note of the key (minor)
  /** Chord roots as scale degrees, one per bar. */
  progression: number[];
  kick: string; // 16 steps, x = hit
  clap: string;
  hats: string; // x = hat, r = roll (32nds), t = triplet roll
  /** 808 pattern: scale degree per step (relative to chord root), '-' rest, '~' slide up an octave */
  bass: string;
  bells: (number | null)[]; // scale degrees over 2 bars (32 steps), null = rest
  padCutoff: number;
  rain: number; // 0..1 rain/hiss level
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const deg = (n: number) => MINOR[((n % 7) + 7) % 7] + 12 * Math.floor(n / 7);

const SONGS: Song[] = [
  {
    name: 'sad noggles',
    bpm: 136,
    root: 42, // F#
    progression: [0, 5, 2, 6],
    kick: 'x.........x.....',
    clap: '........x.......',
    hats: 'x.x.x.x.x.r.x.x.',
    bass: '0-------0--~----',
    bells: [
      7,
      null,
      null,
      9,
      null,
      null,
      11,
      null,
      9,
      null,
      null,
      null,
      7,
      null,
      null,
      null,
      4,
      null,
      null,
      6,
      null,
      null,
      7,
      null,
      6,
      null,
      null,
      null,
      4,
      null,
      null,
      null,
    ],
    padCutoff: 1400,
    rain: 0.5,
  },
  {
    name: 'ginseng plaza',
    bpm: 140,
    root: 38, // D
    progression: [0, 0, 5, 3],
    kick: 'x..x......x.....',
    clap: '........x.......',
    hats: 'x.xxx.x.x.t.x.x.',
    bass: '0--0------0~----',
    bells: [
      11,
      null,
      9,
      null,
      7,
      null,
      null,
      null,
      9,
      null,
      7,
      null,
      4,
      null,
      null,
      null,
      7,
      null,
      4,
      null,
      2,
      null,
      null,
      null,
      4,
      null,
      2,
      null,
      0,
      null,
      null,
      null,
    ],
    padCutoff: 1100,
    rain: 0.25,
  },
  {
    name: 'treasury ghosts',
    bpm: 130,
    root: 45, // A
    progression: [0, 3, 5, 4],
    kick: 'x...............',
    clap: '........x.......',
    hats: 'x...x...x...x.r.',
    bass: '0---------------',
    bells: [
      14,
      null,
      null,
      null,
      11,
      null,
      null,
      null,
      9,
      null,
      null,
      null,
      11,
      null,
      null,
      null,
      7,
      null,
      null,
      null,
      9,
      null,
      null,
      null,
      4,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    padCutoff: 900,
    rain: 0.8,
  },
  {
    name: 'drowning in ether',
    bpm: 144,
    root: 40, // E
    progression: [0, 5, 6, 4],
    kick: 'x.....x...x.....',
    clap: '........x.....x.',
    hats: 'x.x.x.xxx.x.t.x.',
    bass: '0-----0---0~--0-',
    bells: [
      7,
      9,
      11,
      null,
      9,
      null,
      7,
      null,
      null,
      null,
      4,
      null,
      7,
      null,
      null,
      null,
      7,
      9,
      11,
      null,
      14,
      null,
      11,
      null,
      null,
      null,
      9,
      null,
      7,
      null,
      null,
      null,
    ],
    padCutoff: 1700,
    rain: 0.35,
  },
];

export type RadioMode = 'off' | 'pirate' | 'stream';

export class PirateRadio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  /** Dry music bus → tape colour → out */
  private music: GainNode | null = null;
  /** Big reverb + dotted delay sends */
  private verb: GainNode | null = null;
  private delay: GainNode | null = null;
  /** Shared slow pitch wobble (cents) for that warped-tape feel */
  private wobble: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds: AudioScheduledSourceNode[] = [];
  private rainGain: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  songIndex = 0;
  mode: RadioMode = 'off';
  volume = 0.6;
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
  attach(ctx: BaseAudioContext, destination: AudioNode, noise: AudioBuffer | null) {
    if (this.ctx !== null) return;
    this.ctx = ctx as AudioContext;
    this.noise = noise ?? this.makeNoise(2);
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);

    // Tape colour: soft saturation + rolled-off top, gentle low shelf lift
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3);
    }
    shaper.curve = curve;
    const tape = ctx.createBiquadFilter();
    tape.type = 'lowpass';
    tape.frequency.value = 7500;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowshelf';
    warm.frequency.value = 180;
    warm.gain.value = 3;
    this.music = ctx.createGain();
    this.music.connect(shaper).connect(warm).connect(tape).connect(this.out);

    // Reverb: generated 4.5 s stereo impulse (dark, diffuse)
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(4.5);
    const verbIn = ctx.createGain();
    verbIn.gain.value = 1;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    const verbDark = ctx.createBiquadFilter();
    verbDark.type = 'lowpass';
    verbDark.frequency.value = 5000;
    verbIn.connect(conv).connect(verbDark).connect(verbOut).connect(this.music);
    this.verb = verbIn;

    // Dotted-eighth feedback delay (tempo set per song), into the reverb too
    const d = ctx.createDelay(2);
    d.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const dTone = ctx.createBiquadFilter();
    dTone.type = 'lowpass';
    dTone.frequency.value = 3200;
    const delayIn = ctx.createGain();
    delayIn.connect(d);
    d.connect(dTone).connect(fb).connect(d);
    dTone.connect(this.music);
    dTone.connect(verbIn);
    this.delay = delayIn;
    (this as unknown as { delayNode: DelayNode }).delayNode = d;

    // Tape wobble LFO (cents) — melodic oscillators connect their detune here
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.33;
    this.wobble = ctx.createGain();
    this.wobble.gain.value = 9;
    lfo.connect(this.wobble);
    lfo.start();
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private makeImpulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Smoothed noise for a darker tail, exponential decay, soft pre-delay
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] =
          lp * Math.pow(1 - t, 2.6) * (i < ctx.sampleRate * 0.02 ? i / (ctx.sampleRate * 0.02) : 1);
      }
    }
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
    this.applySongFx();
    this.riser(this.nextTime);
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

  private applySongFx() {
    const ctx = this.ctx;
    if (ctx === null) return;
    const s = this.song;
    const beat = 60 / s.bpm;
    const d = (this as unknown as { delayNode?: DelayNode }).delayNode;
    if (d !== undefined) d.delayTime.setTargetAtTime(beat * 0.75, ctx.currentTime, 0.05);
    this.rainGain?.gain.setTargetAtTime(0.018 * s.rain, ctx.currentTime, 0.5);
  }

  private startPirate() {
    const ctx = this.ctx;
    if (ctx === null || this.music === null) return;
    this.out?.gain.setTargetAtTime(this.volume, ctx.currentTime + 0.05, 0.05);
    this.nextTime = ctx.currentTime + 0.15;
    this.step = 0;
    this.bar = 0;
    // Rain + vinyl hiss beds
    if (this.noise !== null) {
      const rain = ctx.createBufferSource();
      rain.buffer = this.noise;
      rain.loop = true;
      rain.playbackRate.value = 0.7;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 0.4;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rain.connect(bp).connect(this.rainGain).connect(this.music);
      rain.start();
      const hiss = ctx.createBufferSource();
      hiss.buffer = this.noise;
      hiss.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      const hg = ctx.createGain();
      hg.gain.value = 0.006;
      hiss.connect(hp).connect(hg).connect(this.music);
      hiss.start();
      this.beds = [rain, hiss];
    }
    this.applySongFx();
    this.riser(this.nextTime);
    // Long lookahead: the main thread can stall (3D frames, tab throttling to
    // 1 Hz in the background) — notes already queued on the audio clock play on.
    this.timer = window.setInterval(() => this.schedule(), 120);
  }

  private stopPirate() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    // Notes are queued ~1.5 s ahead on the audio clock — mute so "off" is instant
    if (this.ctx !== null && this.out !== null)
      this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    for (const b of this.beds) {
      try {
        b.stop();
      } catch {
        // already stopped
      }
    }
    this.beds = [];
  }

  private schedule() {
    const ctx = this.ctx;
    if (ctx === null || this.mode !== 'pirate') return;
    const sixteenth = 60 / this.song.bpm / 4;
    // Fell behind (tab was frozen): skip ahead instead of firing a burst
    if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 1.5) {
      this.playStep(this.nextTime, this.step, this.bar, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        if (this.bar >= 32) {
          this.bar = 0;
          this.songIndex = (this.songIndex + 1) % SONGS.length;
          this.applySongFx();
          this.riser(this.nextTime);
          this.onNowPlaying?.(this.label);
        }
      }
    }
  }

  /** One 16th step. Public-ish so offline renders can drive it. */
  playStep(t: number, step: number, bar: number, sixteenth: number) {
    const s = this.song;
    const section = bar % 16;
    const intro = bar < 4; // pads + bells only
    const breakdown = section >= 12 && section < 14; // drums drop out
    const drums = !intro && !breakdown;
    const chordDeg = s.progression[bar % s.progression.length];
    const root = s.root + deg(chordDeg);

    // Pads: one long chord per bar (root, 3rd, 5th, 7th, 9th), very washed
    if (step === 0) {
      this.pad(
        t,
        [
          root + 12,
          root + 12 + deg(chordDeg + 2) - deg(chordDeg),
          root + 19,
          root + 12 + deg(chordDeg + 6) - deg(chordDeg),
          root + 26,
        ],
        sixteenth * 16,
        s.padCutoff,
      );
      if (bar % 2 === 0) this.choir(t, root + 24, sixteenth * 32);
    }

    // Bells (2-bar phrase), quieter in the intro
    const bell = s.bells[(bar % 2) * 16 + step];
    if (bell !== null && bell !== undefined)
      this.bell(t, midiHz(s.root + 24 + deg(bell)), intro ? 0.5 : 0.8);

    if (drums) {
      if (s.kick[step] === 'x') this.kick(t);
      if (s.clap[step] === 'x') this.clap(t);
      const h = s.hats[step];
      if (h === 'x') this.hat(t, step % 4 === 0 ? 0.9 : 0.6);
      else if (h === 'r')
        for (let k = 0; k < 4; k++) this.hat(t + (k * sixteenth) / 2, 0.45 + k * 0.1);
      else if (h === 't') for (let k = 0; k < 3; k++) this.hat(t + (k * sixteenth * 2) / 3, 0.5);
      // Every 4th bar end: a hat roll pickup
      if (bar % 4 === 3 && step >= 12) this.hat(t + sixteenth / 2, 0.4);
    }

    // 808: plays from the drop, also through breakdowns (no drums = big space)
    if (!intro) {
      const b = s.bass[step];
      if (b !== '-' && b !== undefined) {
        const slide = b === '~';
        const n = slide ? 0 : Number(b);
        // Sustain until the next note
        let len = 1;
        while (len < 16 && s.bass[(step + len) % 16] === '-') len++;
        this.eightOhEight(
          t,
          midiHz(root - 12 + deg(chordDeg + n) - deg(chordDeg)),
          sixteenth * len,
          slide,
        );
      }
    }
  }

  // ── Instruments ───────────────────────────────────────────────────────

  private env(t: number, peak: number, attack: number, hold: number, release: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  private send(node: AudioNode, dry: number, verb: number, delay = 0) {
    const ctx = this.ctx!;
    const d = ctx.createGain();
    d.gain.value = dry;
    node.connect(d).connect(this.music!);
    if (verb > 0) {
      const v = ctx.createGain();
      v.gain.value = verb;
      node.connect(v).connect(this.verb!);
    }
    if (delay > 0) {
      const dl = ctx.createGain();
      dl.gain.value = delay;
      node.connect(dl).connect(this.delay!);
    }
  }

  private wobbleOsc(o: OscillatorNode) {
    if (this.wobble !== null) this.wobble.connect(o.detune);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    const g = this.env(t, 0.7, 0.002, 0.02, 0.18);
    o.connect(g);
    this.send(g, 1, 0.05);
    o.start(t);
    o.stop(t + 0.3);
  }

  private clap(t: number) {
    const ctx = this.ctx!;
    if (this.noise === null) return;
    // Three quick bursts = clap, drenched in reverb
    for (let k = 0; k < 3; k++) {
      const st = t + k * 0.012;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500;
      f.Q.value = 0.9;
      const g = this.env(st, k === 2 ? 0.5 : 0.3, 0.001, 0, k === 2 ? 0.22 : 0.03);
      src.connect(f).connect(g);
      this.send(g, 0.8, 0.9);
      src.start(st, Math.random());
      src.stop(st + 0.3);
    }
  }

  private hat(t: number, v: number) {
    const ctx = this.ctx!;
    if (this.noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 9000;
    const g = this.env(t, 0.13 * v, 0.001, 0, 0.03);
    src.connect(f).connect(g);
    this.send(g, 1, 0.12);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.06);
  }

  /** Long sub 808 with a pitch drop at the head, optional octave slide. */
  private eightOhEight(t: number, hz: number, dur: number, slide: boolean) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz * 2, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
    if (slide) o.frequency.exponentialRampToValueAtTime(hz * 2, t + Math.min(dur, 0.35));
    // A touch of 2nd harmonic so it reads on laptop speakers
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(hz * 2, t);
    if (slide) o2.frequency.exponentialRampToValueAtTime(hz * 4, t + Math.min(dur, 0.35));
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const sat = ctx.createWaveShaper();
    const c = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i / 511) * 2 - 1;
      c[i] = Math.tanh(x * 2.2);
    }
    sat.curve = c;
    const g = this.env(t, 0.75, 0.004, Math.max(0, dur - 0.25), 0.45);
    o.connect(sat);
    o2.connect(g2).connect(sat);
    sat.connect(g);
    this.send(g, 1, 0);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.6);
    o2.stop(t + dur + 0.6);
  }

  /** Washed detuned-saw pad, slow attack, heavy reverb. */
  private pad(t: number, notes: number[], dur: number, cutoff: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur);
    f.Q.value = 0.5;
    const g = this.env(t, 0.05, dur * 0.35, dur * 0.4, dur * 0.6);
    f.connect(g);
    this.send(g, 0.55, 0.9);
    for (const n of notes) {
      for (const det of [-11, 0, 12]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(n);
        o.detune.value = det;
        this.wobbleOsc(o);
        o.connect(f);
        o.start(t);
        o.stop(t + dur * 1.4);
      }
    }
  }

  /** Ghostly formant "ahh": saw through two vowel bandpasses, very wet. */
  private choir(t: number, note: number, dur: number) {
    const ctx = this.ctx!;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    for (const [freq, q, amp] of [
      [750, 9, 1],
      [1150, 11, 0.7],
      [2600, 14, 0.25],
    ] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const a = ctx.createGain();
      a.gain.value = amp;
      for (const det of [-14, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(note);
        o.detune.value = det;
        this.wobbleOsc(o);
        o.connect(bp);
        o.start(t);
        o.stop(t + dur * 1.3);
      }
      bp.connect(a).connect(mix);
    }
    const g = this.env(t, 0.09, dur * 0.4, dur * 0.2, dur * 0.5);
    mix.connect(g);
    this.send(g, 0.3, 1);
  }

  /** Glassy bell: sine + inharmonic partial, into delay + reverb. */
  private bell(t: number, hz: number, v: number) {
    const ctx = this.ctx!;
    const g = this.env(t, 0.07 * v, 0.003, 0, 1.4);
    for (const [mult, amp] of [
      [1, 1],
      [2.76, 0.25],
      [5.4, 0.08],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz * mult;
      this.wobbleOsc(o);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + 1.6);
    }
    this.send(g, 0.7, 0.7, 0.55);
  }

  /** Kept for offline renders: the song-change transition. */
  scratch(t: number) {
    this.riser(t);
  }

  /** Reverse-swell riser into a new song. */
  private riser(t: number) {
    const ctx = this.ctx!;
    if (this.noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.75);
    src.connect(f).connect(g);
    this.send(g, 0.5, 1);
    src.start(t, Math.random());
    src.stop(t + 1.8);
  }

  dispose() {
    this.stopPirate();
    this.stopStream();
    this.out?.disconnect();
    this.ctx = null;
  }
}

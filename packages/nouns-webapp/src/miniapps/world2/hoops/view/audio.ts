// ── Hoops audio: procedural WebAudio (no samples), like SkateAudio ──────
//
// One-shots: ball bounce, sneaker squeak, net swish, rim clank, backboard
// thud, buzzer, crowd reactions (ooh / cheer / roar) over a low crowd bed.
// Shares the game's AudioContext + master bus when given one.

export interface AudioBus {
  ctx: AudioContext;
  out: AudioNode;
}

export class HoopsAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private bed: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private own = false;
  private lastSqueak = 0;
  volume = 0.9;
  /** 0..1 playback slow-down (slow-mo pitches everything down). */
  slow = 1;

  constructor(private bus?: AudioBus | null) {}

  /** Lazily wire up (call from a gesture if we own the context). */
  start() {
    if (this.ctx !== null) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    let ctx: AudioContext;
    let dest: AudioNode;
    if (this.bus) {
      ctx = this.bus.ctx;
      dest = this.bus.out;
    } else {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (AC === undefined) return false;
      ctx = new AC();
      this.own = true;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 3;
      comp.connect(ctx.destination);
      dest = comp;
    }
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(dest);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Crowd bed: band-limited murmur
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    src.connect(bp).connect(gain).connect(this.out);
    src.start();
    this.bed = { src, gain };
    return true;
  }

  private ready(): AudioContext | null {
    if (this.ctx === null && !this.start()) return null;
    return this.ctx;
  }

  private noiseBurst(
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    freqEnd?: number,
    rate = 1,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * this.slow;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq * this.slow, t);
    if (freqEnd !== undefined)
      f.frequency.exponentialRampToValueAtTime(freqEnd * this.slow, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    attack = 0.004,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * this.slow, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * this.slow), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Ball on hardwood / asphalt. */
  bounce(strength = 0.6) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const s = Math.min(1, Math.max(0.15, strength));
    this.tone(t, 'sine', 150, 55, 0.16, 0.5 * s);
    this.noiseBurst(t, 0.05, 'bandpass', 900, 1.2, 0.25 * s);
  }

  /** Sneaker squeak (rate-limited). */
  squeak(intensity = 1) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    if (t - this.lastSqueak < 0.18) return;
    this.lastSqueak = t;
    const f = 1900 + Math.random() * 1400;
    const dur = 0.07 + Math.random() * 0.08;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * this.slow, t);
    o.frequency.linearRampToValueAtTime((f + (Math.random() - 0.4) * 900) * this.slow, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * this.slow;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * intensity, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Net swish: a downward-sweeping airy hiss. */
  swish(fire = false) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.42, 'bandpass', 5200, 1.4, 0.45, 1400);
    this.noiseBurst(t + 0.03, 0.3, 'highpass', 6000, 0.7, 0.18, 2500);
    if (fire) {
      // Whoomph of the flames
      this.noiseBurst(t, 0.9, 'lowpass', 900, 0.8, 0.5, 200, 0.6);
      this.tone(t, 'sine', 90, 40, 0.6, 0.35, 0.03);
    }
  }

  /** Rim clank: inharmonic ringing partials. */
  rim(strength = 0.6) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const s = Math.min(1, Math.max(0.2, strength));
    for (const [f, d, g] of [
      [523, 0.55, 0.16],
      [1187, 0.4, 0.1],
      [1795, 0.3, 0.07],
      [2690, 0.2, 0.05],
    ])
      this.tone(
        t,
        'triangle',
        f * (0.98 + Math.random() * 0.04),
        f * 0.985,
        d * (0.6 + s * 0.6),
        g * s,
      );
    this.noiseBurst(t, 0.06, 'highpass', 2500, 0.9, 0.35 * s);
  }

  /** Backboard: a dull boom + rattle. */
  board(strength = 0.6) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const s = Math.min(1, Math.max(0.2, strength));
    this.tone(t, 'sine', 120, 70, 0.3, 0.55 * s);
    this.noiseBurst(t, 0.22, 'lowpass', 700, 0.9, 0.4 * s, 200);
    this.noiseBurst(t + 0.02, 0.18, 'bandpass', 2200, 3, 0.08 * s);
  }

  /** Game buzzer. */
  buzzer(dur = 1.1) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    for (const f of [196, 207.6, 392]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
      g.gain.setValueAtTime(0.11, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.out!);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /**
   * Crowd reaction: 'ooh' (a miss / block), 'cheer' (a bucket), 'roar'
   * (dunk / fire / game winner). Shaped noise through vowel formants.
   */
  crowd(kind: 'ooh' | 'cheer' | 'roar', amount = 1) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const dur = kind === 'roar' ? 3.2 : kind === 'cheer' ? 2.0 : 1.3;
    const peak = (kind === 'roar' ? 0.55 : kind === 'cheer' ? 0.38 : 0.3) * amount;
    const formants =
      kind === 'ooh'
        ? [
            [320, 6],
            [800, 7],
          ]
        : [
            [700, 3],
            [1200, 4],
            [2600, 5],
          ];
    for (const [f, q] of formants) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.8 * this.slow;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f * this.slow, t);
      if (kind === 'ooh') bp.frequency.linearRampToValueAtTime(f * 0.8 * this.slow, t + dur);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak / formants.length, t + dur * 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(this.out!);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
    }
    if (kind !== 'ooh') {
      // Claps: a scatter of short bright bursts
      const n = kind === 'roar' ? 26 : 14;
      for (let i = 0; i < n; i++)
        this.noiseBurst(
          t + 0.1 + Math.random() * dur * 0.7,
          0.03,
          'bandpass',
          1600 + Math.random() * 900,
          1.5,
          0.05 * amount,
        );
    }
  }

  /** Crowd bed level (0..1): louder in tense moments. */
  setHype(h: number) {
    if (this.bed === null || this.ctx === null) return;
    this.bed.gain.gain.setTargetAtTime(0.03 + h * 0.07, this.ctx.currentTime, 0.4);
  }

  dispose() {
    try {
      this.bed?.src.stop();
    } catch {
      /* already stopped */
    }
    this.out?.disconnect();
    if (this.own) void this.ctx?.close();
    this.ctx = null;
  }
}

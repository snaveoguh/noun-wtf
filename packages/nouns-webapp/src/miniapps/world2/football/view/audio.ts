// ── Noun Football audio: procedural WebAudio, no samples ────────────────
//
// A crowd bed (two band-limited murmurs) that swells with danger (the ball
// near a box), a roar on goals, "ooh"s on chances, chants now and then
// (formant-filtered voices on a terrace rhythm), the referee's whistle
// (short / long / full time), kick thuds by power, the net swish, a post
// clang and bounces. Plays into the game's AudioContext + master bus (so
// the game's mute covers it); nothing runs until the first sound.

export class FootballAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private bed: {
    a: GainNode;
    b: GainNode;
    f: BiquadFilterNode;
    srcs: AudioScheduledSourceNode[];
  } | null = null;
  private chantAt = 18 + Math.random() * 20;
  private time = 0;
  private lastKick = 0;
  private lastBounce = 0;
  /** 0..1 playback slow-down (replays pitch the crowd down a touch). */
  slow = 1;
  volume = 0.85;
  enabled = true;

  constructor(
    private getCtx: () => AudioContext | null,
    private getOut: () => AudioNode | null,
  ) {}

  private ready(): AudioContext | null {
    if (!this.enabled) return null;
    if (this.ctx !== null) return this.ctx.state === 'closed' ? null : this.ctx;
    const ctx = this.getCtx();
    const dest = this.getOut();
    if (ctx === null || dest === null) return null;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(dest);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startBed(ctx);
    return ctx;
  }

  /** Begin the crowd bed (call from a gesture or the first event). */
  start() {
    return this.ready() !== null;
  }

  private startBed(ctx: AudioContext) {
    const mk = (rate: number, freq: number, q: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(bp).connect(g);
      src.start(0, Math.random() * 1.5);
      return { src, bp, g };
    };
    const a = mk(0.45, 480, 0.55, 0.05);
    const b = mk(0.8, 1100, 0.9, 0.02);
    // A slow lowpass on the whole bed: it opens as the crowd gets going
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    a.g.connect(f);
    b.g.connect(f);
    f.connect(this.out!);
    this.bed = { a: a.g, b: b.g, f, srcs: [a.src, b.src] };
  }

  private burst(
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    freqEnd?: number,
    attack = 0.01,
    rate = 1,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * this.slow;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
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

  /**
   * Per frame: the bed follows `danger` (0..1, the ball near a box) and
   * `excite` (0..1, after a goal); chants come round now and then.
   */
  update(dt: number, danger: number, excite: number) {
    if (this.ctx === null || this.bed === null) return;
    this.time += dt;
    const t = this.ctx.currentTime;
    const lvl = 0.045 + 0.05 * danger + 0.12 * excite;
    this.bed.a.gain.setTargetAtTime(lvl, t, 0.4);
    this.bed.b.gain.setTargetAtTime(0.015 + 0.04 * danger + 0.08 * excite, t, 0.4);
    this.bed.f.frequency.setTargetAtTime(1200 + 1600 * Math.max(danger, excite), t, 0.6);
    if (this.time > this.chantAt) {
      this.chantAt = this.time + 25 + Math.random() * 30;
      this.chant();
    }
  }

  /** A terrace chant: "oh-oh-oh, oh-oh" on a few detuned voices through vowel formants. */
  chant() {
    const ctx = this.ready();
    if (ctx === null) return;
    const t0 = ctx.currentTime + 0.05;
    const notes = [0, 0, 0, 3, 2, 0, -2, 0];
    const beat = 0.42;
    const root = 196;
    for (let v = 0; v < 4; v++) {
      const det = 1 + (v - 1.5) * 0.012;
      notes.forEach((n, i) => {
        const t = t0 + i * beat + Math.random() * 0.02;
        const f = root * Math.pow(2, n / 12) * det * (v === 3 ? 0.5 : 1);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.frequency.value = 560;
        f1.Q.value = 5;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass';
        f2.frequency.value = 900;
        f2.Q.value = 6;
        const g = ctx.createGain();
        const len = i === notes.length - 1 ? beat * 1.8 : beat * 0.85;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(f1).connect(g);
        o.connect(f2).connect(g);
        g.connect(this.out!);
        o.start(t);
        o.stop(t + len + 0.05);
      });
    }
    // Claps on the beat
    for (let i = 0; i < notes.length; i += 2)
      this.burst(t0 + i * beat, 0.08, 'bandpass', 1600, 1.5, 0.05);
  }

  /** Referee's whistle (a pea whistle: a trilled ~3 kHz tone). */
  whistle(kind: 'short' | 'long' | 'end') {
    const ctx = this.ready();
    if (ctx === null) return;
    const t0 = ctx.currentTime;
    const blasts = kind === 'short' ? [0.22] : kind === 'long' ? [0.85] : [0.35, 0.35, 1.1];
    let t = t0;
    for (const d of blasts) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2950;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 38;
      const depth = ctx.createGain();
      depth.gain.value = 140;
      lfo.connect(depth).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.setValueAtTime(0.16, t + d - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.out!);
      o.start(t);
      lfo.start(t);
      o.stop(t + d + 0.05);
      lfo.stop(t + d + 0.05);
      this.burst(t, d, 'highpass', 3500, 0.7, 0.03);
      t += d + 0.14;
    }
  }

  /** Boot on ball: a thud (low sine sweep) + a leather slap, louder with power. */
  kick(power: number) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    if (t - this.lastKick < 0.05) return;
    this.lastKick = t;
    const p = Math.min(1, Math.max(0.1, power));
    this.tone(t, 'sine', 110 + 60 * p, 42, 0.14 + 0.1 * p, 0.25 + 0.45 * p);
    this.burst(t, 0.05 + 0.04 * p, 'bandpass', 1300 + 900 * p, 1.1, 0.12 + 0.3 * p);
  }

  header(power: number) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const p = Math.min(1, Math.max(0.1, power));
    this.tone(t, 'sine', 180, 80, 0.12, 0.2 + 0.25 * p);
    this.burst(t, 0.06, 'bandpass', 900, 1, 0.15 + 0.15 * p);
  }

  bounce(strength: number) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    if (t - this.lastBounce < 0.06) return;
    this.lastBounce = t;
    const s = Math.min(1, Math.max(0.1, strength));
    this.tone(t, 'sine', 130, 60, 0.12, 0.18 * s);
    this.burst(t, 0.04, 'lowpass', 700, 0.8, 0.08 * s);
  }

  /** The ball in the net: an airy swish + rope rattle. */
  net(strength: number) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const s = Math.min(1, Math.max(0.2, strength));
    this.burst(t, 0.45, 'bandpass', 3800, 1.2, 0.3 * s, 1200);
    this.burst(t + 0.02, 0.25, 'highpass', 5000, 0.7, 0.12 * s, 2200);
  }

  /** Woodwork: inharmonic ringing partials (a bar rings lower than a post). */
  clang(part: 'post' | 'bar', strength: number) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    const s = Math.min(1, Math.max(0.2, strength));
    const k = part === 'bar' ? 0.82 : 1;
    for (const [f, d, g] of [
      [610, 1.1, 0.14],
      [1530, 0.8, 0.09],
      [2370, 0.55, 0.06],
      [3410, 0.35, 0.04],
    ])
      this.tone(t, 'triangle', f * k, f * k * 0.99, d * (0.5 + s * 0.6), g * s);
    this.burst(t, 0.05, 'bandpass', 2500, 2, 0.2 * s);
    this.ooh(0.8);
  }

  /** The crowd's "ooh" (a chance, a save, the woodwork). */
  ooh(k = 1) {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    this.burst(t, 1.6, 'bandpass', 420, 1.6, 0.22 * k, 300, 0.25);
    this.burst(t + 0.05, 1.3, 'bandpass', 700, 2.2, 0.12 * k, 480, 0.3);
  }

  /** GOAL: a swelling roar that rings on. */
  roar() {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    this.burst(t, 5.5, 'bandpass', 600, 0.5, 0.55, 900, 0.35, 0.8);
    this.burst(t + 0.1, 5, 'bandpass', 1500, 0.8, 0.28, 1100, 0.4);
    this.burst(t, 0.6, 'lowpass', 260, 0.6, 0.35, 120, 0.05, 0.6);
  }

  /** A groan (a miss, the other side scoring away). */
  groan() {
    const ctx = this.ready();
    if (ctx === null) return;
    const t = ctx.currentTime;
    this.burst(t, 1.8, 'bandpass', 380, 1.4, 0.18, 220, 0.2);
  }

  dispose() {
    if (this.bed !== null) {
      for (const s of this.bed.srcs) {
        try {
          s.stop();
        } catch {
          // already stopped
        }
      }
      this.bed.f.disconnect();
    }
    this.bed = null;
    this.out?.disconnect();
    this.out = null;
    this.ctx = null;
  }
}

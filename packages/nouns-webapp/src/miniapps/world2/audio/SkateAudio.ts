// ── Procedural skate audio (WebAudio, no samples) ───────────────────────
//
// Rolling: filtered noise whose pitch/gain track speed + surface.
// Grinds: resonant metallic scrape. One-shots: pop, land, push, bail.

export class SkateAudio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private roll: {
    src: AudioBufferSourceNode;
    bp: BiquadFilterNode;
    lp: BiquadFilterNode;
    gain: GainNode;
    rumble: GainNode;
  } | null = null;
  private hum: {
    osc: OscillatorNode;
    osc2: OscillatorNode;
    lp: BiquadFilterNode;
    gain: GainNode;
  } | null = null;
  private grind: { src: AudioBufferSourceNode; gain: GainNode; bp: BiquadFilterNode } | null = null;
  volume = 0.8;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (AC === undefined) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // 2s noise buffer (pink-ish)
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }

    // Rolling loop
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 400;
      bp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const rumble = ctx.createGain();
      rumble.gain.value = 0;
      src.connect(bp).connect(gain).connect(this.master);
      src.connect(lp).connect(rumble).connect(this.master);
      src.start();
      this.roll = { src, bp, lp, gain, rumble };
    }
    // Hoverboard hum: detuned saws through a lowpass, pitch tracks speed
    {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 55.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      lp.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(lp);
      osc2.connect(lp);
      lp.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.hum = { osc, osc2, lp, gain };
    }
    // Grind loop
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 1.3;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 5;
      const ring = ctx.createBiquadFilter();
      ring.type = 'peaking';
      ring.frequency.value = 3700;
      ring.Q.value = 18;
      ring.gain.value = 14;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(bp).connect(ring).connect(gain).connect(this.master);
      src.start();
      this.grind = { src, gain, bp };
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Continuous state each frame. */
  update(
    speed: number,
    rolling: boolean,
    grinding: boolean,
    railType: string | null,
    surfaceRough: number,
    hover = false,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.roll || !this.grind) return;
    const t = ctx.currentTime;
    const sp = Math.min(1, speed / 14);
    const wheels = rolling && !hover;
    const rollGain = wheels
      ? Math.min(0.55, sp * 0.7 + (speed > 0.3 ? 0.04 : 0)) * (0.7 + surfaceRough * 0.5)
      : 0;
    this.roll.gain.gain.setTargetAtTime(rollGain, t, 0.05);
    this.roll.rumble.gain.setTargetAtTime(wheels ? sp * 0.9 : 0, t, 0.05);
    if (this.hum !== null) {
      this.hum.gain.gain.setTargetAtTime(hover ? 0.05 + sp * 0.08 : 0, t, 0.08);
      const f = 48 + sp * 70;
      this.hum.osc.frequency.setTargetAtTime(f, t, 0.1);
      this.hum.osc2.frequency.setTargetAtTime(f * 1.012, t, 0.1);
      this.hum.lp.frequency.setTargetAtTime(260 + sp * 1400, t, 0.1);
    }
    this.roll.bp.frequency.setTargetAtTime(220 + sp * 900 + surfaceRough * 300, t, 0.08);
    this.roll.src.playbackRate.setTargetAtTime(0.6 + sp * 0.8, t, 0.08);
    const gg = grinding ? 0.35 + sp * 0.3 : 0;
    this.grind.gain.gain.setTargetAtTime(gg, t, grinding ? 0.02 : 0.06);
    this.grind.bp.frequency.setTargetAtTime(
      railType === 'ledge' || railType === 'curb' ? 1300 : 2600 + sp * 800,
      t,
      0.05,
    );
  }

  private burst(opts: {
    dur: number;
    freq: number;
    q?: number;
    gain: number;
    type?: BiquadFilterType;
    rate?: number;
    delay?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.dur + 0.02);
  }

  private thump(freq: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  pop(strength: number) {
    // Tail snap: sharp wood clack + low knock
    this.burst({ dur: 0.06, freq: 1800, q: 2.5, gain: 0.9 * strength, rate: 1.4 });
    this.burst({ dur: 0.12, freq: 650, q: 1.5, gain: 0.6 * strength });
    this.thump(150, 0.12, 0.6 * strength);
  }

  land(impact: number) {
    const k = Math.min(1, impact / 8);
    this.thump(95, 0.22, 0.5 + k * 0.6);
    this.burst({ dur: 0.1, freq: 900, q: 1.2, gain: 0.5 + k * 0.5 });
    this.burst({ dur: 0.05, freq: 2600, q: 3, gain: 0.35 * k, delay: 0.03 });
  }

  flip() {
    this.burst({ dur: 0.08, freq: 3200, q: 1.5, gain: 0.25, type: 'highpass' });
  }

  push() {
    this.burst({ dur: 0.28, freq: 700, q: 0.6, gain: 0.22, rate: 0.7 });
  }

  grindStart(railType: string) {
    this.burst({
      dur: 0.08,
      freq: railType === 'rail' || railType === 'coping' ? 3800 : 1400,
      q: 6,
      gain: 0.7,
    });
    this.thump(120, 0.1, 0.4);
  }

  bail(impact: number) {
    const k = Math.min(1, impact / 10);
    this.thump(80, 0.35, 0.8);
    this.burst({ dur: 0.35, freq: 500, q: 0.8, gain: 0.6 + k * 0.4 });
    // Board clattering away
    for (let i = 0; i < 4; i++)
      this.burst({
        dur: 0.07,
        freq: 1500 + i * 300,
        q: 2,
        gain: 0.35 / (i + 1),
        delay: 0.12 + i * 0.13,
      });
  }

  footstep() {
    this.burst({ dur: 0.07, freq: 500, q: 0.9, gain: 0.12, rate: 0.8 });
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

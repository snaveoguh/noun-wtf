// ── Procedural paintball audio (WebAudio, no samples) ───────────────────
//
// Same recipe as world2's SkateAudio: one noise buffer + oscillators,
// shaped per one-shot. Paint pops (fire), wet splats, hit ticks, the
// kill "ding-splat", footsteps, reload clacks, grenade bounces + blasts,
// zone capture jingles. Positional sounds get distance gain + stereo pan.

import type { WeaponId } from '../sim/weapons';

export class WarfareAudio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;
  /** Listener pose (set each frame). */
  lx = 0;
  ly = 0;
  lz = 0;
  lyaw = 0;

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
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Gain + pan node chain for a world position (or centred when null). */
  private out(pos: [number, number, number] | null, gain: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    let k = gain;
    let pan = 0;
    if (pos !== null) {
      const dx = pos[0] - this.lx;
      const dy = pos[1] - this.ly;
      const dz = pos[2] - this.lz;
      const d = Math.hypot(dx, dy, dz);
      k *= 1 / (1 + d * 0.09);
      if (k < 0.01) return null;
      // Right vector of the listener
      const rx = Math.cos(this.lyaw);
      const rz = -Math.sin(this.lyaw);
      pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / (d || 1)) * 0.8));
    }
    g.gain.value = k;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  private noiseBurst(
    out: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    freqEnd?: number,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined)
      f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(
    out: AudioNode,
    t: number,
    dur: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    gain: number,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  fire(w: WeaponId, pos: [number, number, number] | null) {
    const out = this.out(pos, pos === null ? 0.55 : 0.9);
    if (!out) return;
    const t = this.ctx!.currentTime;
    switch (w) {
      case 'splatter':
        this.tone(out, t, 0.07, 'square', 520, 140, 0.25);
        this.noiseBurst(out, t, 0.06, 'bandpass', 2200, 1.2, 0.6);
        break;
      case 'hopper':
        this.tone(out, t, 0.05, 'square', 420 + Math.random() * 60, 120, 0.18);
        this.noiseBurst(out, t, 0.05, 'bandpass', 1800, 1.4, 0.5);
        break;
      case 'shotgun':
        this.tone(out, t, 0.16, 'sawtooth', 160, 45, 0.45);
        this.noiseBurst(out, t, 0.18, 'lowpass', 2600, 0.7, 0.9, 400);
        break;
      case 'longsplat':
        this.tone(out, t, 0.22, 'square', 900, 70, 0.35);
        this.noiseBurst(out, t, 0.12, 'highpass', 2500, 0.8, 0.7);
        break;
      case 'launcher':
        this.tone(out, t, 0.25, 'sine', 140, 50, 0.7);
        this.noiseBurst(out, t, 0.2, 'lowpass', 900, 1, 0.6, 200);
        break;
    }
  }

  splat(pos: [number, number, number], big = false) {
    const out = this.out(pos, big ? 0.9 : 0.35);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(out, t, big ? 0.22 : 0.08, 'lowpass', big ? 1800 : 3200, 2, 0.8, 300);
    this.tone(out, t, 0.06, 'sine', big ? 260 : 380, 90, 0.25);
  }

  /** Paint hitting a player you shot: crisp tick. */
  hitMarker(head: boolean) {
    const out = this.out(null, 0.5);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, t, 0.05, 'triangle', head ? 2100 : 1500, head ? 1900 : 1300, 0.5);
  }

  /** You splatted someone. */
  killConfirm() {
    const out = this.out(null, 0.6);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, t, 0.12, 'triangle', 880, 860, 0.5);
    this.tone(out, t + 0.08, 0.2, 'triangle', 1320, 1300, 0.45);
    this.noiseBurst(out, t, 0.25, 'lowpass', 2400, 1.5, 0.6, 200);
  }

  /** You got hit. */
  hurt() {
    const out = this.out(null, 0.6);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(out, t, 0.14, 'lowpass', 1400, 3, 0.9, 200);
    this.tone(out, t, 0.1, 'sine', 180, 80, 0.5);
  }

  step(pos: [number, number, number] | null, sprint: boolean) {
    const out = this.out(pos, pos === null ? 0.18 : 0.3);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(out, t, 0.05, 'lowpass', sprint ? 900 : 650, 1.5, 0.7, 150);
  }

  land() {
    const out = this.out(null, 0.4);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(out, t, 0.12, 'lowpass', 500, 1, 0.9, 80);
  }

  reload(pos: [number, number, number] | null) {
    const out = this.out(pos, 0.4);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.tone(out, t, 0.03, 'square', 1800, 1700, 0.2);
    this.tone(out, t + 0.12, 0.03, 'square', 1300, 1200, 0.2);
    this.noiseBurst(out, t + 0.05, 0.08, 'bandpass', 3000, 3, 0.4);
  }

  swap() {
    const out = this.out(null, 0.3);
    if (!out) return;
    this.tone(out, this.ctx!.currentTime, 0.05, 'square', 700, 900, 0.15);
  }

  bounce(pos: [number, number, number]) {
    const out = this.out(pos, 0.4);
    if (!out) return;
    this.tone(out, this.ctx!.currentTime, 0.06, 'triangle', 600, 400, 0.4);
  }

  blast(pos: [number, number, number]) {
    const out = this.out(pos, 1.2);
    if (!out) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(out, t, 0.6, 'lowpass', 1600, 0.8, 1, 60);
    this.tone(out, t, 0.4, 'sine', 120, 35, 0.9);
    this.noiseBurst(out, t + 0.05, 0.3, 'bandpass', 2600, 2, 0.4, 600);
  }

  zone(good: boolean) {
    const out = this.out(null, 0.45);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const notes = good ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(out, t + i * 0.09, 0.18, 'triangle', f, f, 0.4));
  }

  callout(tier: number) {
    const out = this.out(null, 0.4);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const base = 440 * Math.pow(1.122, tier * 2);
    [1, 1.26, 1.5].forEach((m, i) =>
      this.tone(out, t + i * 0.06, 0.16, 'square', base * m, base * m, 0.18),
    );
  }

  countdown(go: boolean) {
    const out = this.out(null, 0.4);
    if (!out) return;
    this.tone(
      out,
      this.ctx!.currentTime,
      go ? 0.35 : 0.12,
      'square',
      go ? 880 : 440,
      go ? 880 : 440,
      0.25,
    );
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

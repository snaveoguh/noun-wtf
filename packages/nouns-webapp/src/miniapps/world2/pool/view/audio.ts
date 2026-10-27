// ── Pool sounds: procedural WebAudio, no samples ────────────────────────
//
// Cue strike (a leather tock), ball clacks (a bright, short click whose
// level and pitch follow the impulse), cushion thuds (soft and low) and
// pocket drops (a hollow knock, a rattle in the drop). Shares the game's
// AudioContext and master bus; at most a few voices per frame.

export class PoolAudio {
  private noise: AudioBuffer | null = null;
  private out: GainNode | null = null;
  private voices = 0;

  constructor(
    private ctx: () => AudioContext | null,
    private dest: () => AudioNode | null,
  ) {}

  private ready(): AudioContext | null {
    const ctx = this.ctx();
    if (ctx === null || ctx.state !== 'running') return null;
    if (this.out === null || this.out.context !== ctx) {
      this.out = ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(this.dest() ?? ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }

  /** Call once a frame: resets the voice budget. */
  frame() {
    this.voices = 0;
  }

  private budget(): boolean {
    return this.voices++ < 6;
  }

  private tone(
    ctx: AudioContext,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    when = 0,
  ) {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(ctx: AudioContext, freq: number, q: number, dur: number, gain: number, when = 0) {
    if (this.noise === null) return;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out!);
    s.start(t, Math.random() * 0.3);
    s.stop(t + dur + 0.02);
  }

  /** The tip hits the cue ball (v m/s). */
  cue(v: number) {
    const ctx = this.ready();
    if (ctx === null || !this.budget()) return;
    const k = Math.min(1, 0.25 + v / 8);
    this.tone(ctx, 900, 380, 0.05, 0.22 * k, 'triangle');
    this.hiss(ctx, 2400, 1.2, 0.035, 0.35 * k);
    if (v > 6) this.tone(ctx, 140, 60, 0.12, 0.2 * k);
  }

  /** Two balls (impulse j, m/s). */
  clack(j: number) {
    if (j < 0.02) return;
    const ctx = this.ready();
    if (ctx === null || !this.budget()) return;
    const k = Math.min(1, j / 2.2);
    const f = 3000 + Math.random() * 900 + k * 600;
    this.tone(ctx, f, f * 0.92, 0.028 + k * 0.02, 0.55 * Math.sqrt(k), 'sine');
    this.hiss(ctx, 5200, 2, 0.012 + k * 0.01, 0.4 * k);
  }

  /** Off a cushion. */
  thud(j: number) {
    if (j < 0.05) return;
    const ctx = this.ready();
    if (ctx === null || !this.budget()) return;
    const k = Math.min(1, j / 3);
    this.tone(ctx, 150 + k * 40, 70, 0.09, 0.4 * Math.sqrt(k));
    this.hiss(ctx, 500, 0.8, 0.05, 0.18 * k);
  }

  /** Into a pocket (v m/s at the drop). */
  drop(v: number) {
    const ctx = this.ready();
    if (ctx === null || !this.budget()) return;
    const k = Math.min(1, 0.35 + v / 3);
    this.tone(ctx, 220, 90, 0.16, 0.35 * k);
    for (let i = 0; i < 3; i++)
      this.tone(ctx, 1500 - i * 200, 1300 - i * 200, 0.02, 0.12 * k, 'sine', 0.05 + i * 0.045);
    this.tone(ctx, 120, 60, 0.22, 0.25 * k, 'sine', 0.18);
  }

  dispose() {
    this.out?.disconnect();
    this.out = null;
  }
}

// ── 3D Grand Exchange: floor sound (optional, off until asked) ──────────
//
// All synthesised, no files: a crowd murmur (filtered noise, wobbling)
// that swells with trading volume, a roar on big trades and the opening
// bell. Browsers keep audio locked until a gesture, so it starts muted and
// the 🔈 button turns it on.

export class FloorAudio {
  private ctx: AudioContext | null = null;
  private murmur: GainNode | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private level = 0;
  on = false;

  private ensure(): AudioContext | null {
    if (this.ctx !== null) return this.ctx;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC === undefined) return null;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // Two seconds of brown-ish noise, looped
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.noise = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.7;
    // A slow wobble so it sounds like voices, not a fan
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(bp.frequency);
    lfo.start();
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0.2;
    src.connect(bp).connect(this.murmur).connect(this.master);
    src.start();
    return ctx;
  }

  setOn(on: boolean) {
    this.on = on;
    const ctx = on ? this.ensure() : this.ctx;
    if (ctx === null || this.master === null) return;
    if (on) void ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.2);
    if (on) this.bell();
  }

  /** Activity 0..1 (fills per minute, normalised by the view). */
  setLevel(k: number) {
    this.level = Math.min(1, Math.max(0, k));
    if (this.ctx === null || this.murmur === null || !this.on) return;
    this.murmur.gain.setTargetAtTime(0.12 + this.level * 0.45, this.ctx.currentTime, 0.8);
  }

  /** A crowd roar (a big trade). */
  roar(size = 1) {
    const ctx = this.ctx;
    if (ctx === null || !this.on || this.noise === null || this.master === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * Math.min(2, size), t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 2.4);
  }

  /** The exchange bell: a few inharmonic partials, struck. */
  bell() {
    const ctx = this.ctx;
    if (ctx === null || !this.on || this.master === null) return;
    const t = ctx.currentTime;
    for (const [f, a, d] of [
      [523, 0.25, 2.5],
      [1046, 0.12, 1.8],
      [1318, 0.08, 1.4],
      [1760, 0.05, 1],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

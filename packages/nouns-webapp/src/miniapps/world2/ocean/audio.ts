// ── The sea's sound: surf and gulls (WebAudio, no samples) ───────────────
//
// SeaSound.update(near, swell, rush) once a frame:
//   near   0..1 how close you are to the water (0 fades it all out and
//          frees the nodes);
//   swell  0..1 the breaking surf's roar (rises as a wave breaks near you);
//   rush   0..1 board / water rush (riding, wiping out).
// Two looped noise beds through filters (the low roar, the hiss of the
// rush) plus a gull now and then: two quick falling chirps from an
// oscillator. Nothing runs when you're far away.

import type { SkateAudio } from '../audio/SkateAudio';

interface Bed {
  src: AudioBufferSourceNode;
  f: BiquadFilterNode;
  g: GainNode;
}

export class SeaSound {
  private roar: Bed | null = null;
  private hiss: Bed | null = null;
  private gullIn = 4;

  constructor(private audio: SkateAudio) {}

  private bed(type: BiquadFilterType, freq: number, q: number): Bed | null {
    const a = this.audio;
    const ctx = a.ctx;
    if (ctx === null || a.master === null || a.noise === null) return null;
    const src = ctx.createBufferSource();
    src.buffer = a.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(a.master);
    src.start();
    return { src, f, g };
  }

  private drop(b: Bed | null) {
    if (b === null) return;
    try {
      b.src.stop();
    } catch {
      /* stopped */
    }
    b.src.disconnect();
  }

  update(dt: number, near: number, swell: number, rush: number) {
    const a = this.audio;
    const ctx = a.ctx;
    if (ctx === null || a.master === null) return;
    if (near <= 0.001 && this.roar === null) return;
    this.roar ??= this.bed('lowpass', 520, 0.6);
    this.hiss ??= this.bed('bandpass', 2400, 0.5);
    const t = ctx.currentTime;
    if (this.roar !== null) {
      this.roar.g.gain.setTargetAtTime(near * (0.12 + 0.3 * swell), t, 0.35);
      this.roar.f.frequency.setTargetAtTime(380 + 600 * swell, t, 0.4);
    }
    if (this.hiss !== null) this.hiss.g.gain.setTargetAtTime(near * (0.025 + 0.12 * rush + 0.05 * swell), t, 0.15);
    // gulls
    this.gullIn -= dt;
    if (this.gullIn <= 0) {
      this.gullIn = 5 + Math.random() * 9;
      if (near > 0.3) this.gull(near * 0.5);
    }
    if (near <= 0.001 && (this.roar?.g.gain.value ?? 0) < 0.002) {
      this.drop(this.roar);
      this.drop(this.hiss);
      this.roar = null;
      this.hiss = null;
    }
  }

  /** A gull: two or three quick falling cries. */
  private gull(level: number) {
    const a = this.audio;
    const ctx = a.ctx;
    if (ctx === null || a.master === null) return;
    const n = 2 + Math.floor(Math.random() * 2);
    const pan = ctx.createStereoPanner?.();
    const out = ctx.createGain();
    out.gain.value = level * 0.18;
    if (pan !== undefined) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      out.connect(pan).connect(a.master);
    } else out.connect(a.master);
    const base = 1400 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * (0.2 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * 0.62, t0 + 0.17);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.19);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 0.22);
    }
    setTimeout(() => out.disconnect(), 1200);
  }

  dispose() {
    this.drop(this.roar);
    this.drop(this.hiss);
    this.roar = null;
    this.hiss = null;
  }
}

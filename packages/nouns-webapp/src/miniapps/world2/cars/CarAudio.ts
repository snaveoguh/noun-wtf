// ── Car sounds: the van's engine synth at each car's pitch, real car horns ──
//
// Engine, tyre screech and thuds come from van/VanAudio.ts (pitched per car
// with `pitch`). The horn is a car's instead of the van's chime: a two-tone
// beep, a deep blast, an old bulb "toot", the lowrider's little tune, or an
// air horn. `pssh` is the hydraulics / stomp release (filtered noise).
// Everything is synthesized; nothing is sampled.

import type { CarSpec } from './specs';

import { VanAudio } from '../van/VanAudio';

/** Horn voices: [frequencies (Hz), seconds, wave]. Notes play one after another. */
const HORNS: Record<CarSpec['horn'], { notes: number[][]; len: number; wave: OscillatorType }> = {
  beep: { notes: [[415, 523]], len: 0.32, wave: 'square' },
  deep: { notes: [[220, 277]], len: 0.5, wave: 'sawtooth' },
  toot: { notes: [[660], [620]], len: 0.16, wave: 'triangle' },
  // an original six-note phrase (no existing tune)
  tune: { notes: [[523], [659], [784], [659], [880], [784]], len: 0.14, wave: 'square' },
  air: { notes: [[185, 233, 277]], len: 0.8, wave: 'sawtooth' },
};

export class CarAudio extends VanAudio {
  private hornEnd = 0;
  private noiseBuf: AudioBuffer | null = null;
  private voice: CarSpec['horn'] = 'beep';

  setCar(spec: CarSpec) {
    this.pitch = spec.engine;
    this.voice = spec.horn;
  }

  override start(ctx: AudioContext | null, out: AudioNode | null, noise: AudioBuffer | null) {
    this.noiseBuf = noise;
    super.start(ctx, out, noise);
  }

  override horn() {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const now = ctx.currentTime;
    if (now < this.hornEnd) return;
    const v = HORNS[this.voice];
    const bus = ctx.createGain();
    bus.gain.value = 0.16;
    bus.connect(out);
    let t = now + 0.01;
    for (const chord of v.notes) {
      for (const f of chord) {
        const o = ctx.createOscillator();
        o.type = v.wave;
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
        g.gain.setValueAtTime(0.5, t + v.len * 0.85);
        g.gain.exponentialRampToValueAtTime(0.0001, t + v.len);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + v.len + 0.02);
      }
      t += v.len;
    }
    this.hornEnd = t;
    window.setTimeout(() => bus.disconnect(), (t - now + 0.5) * 1000);
  }

  override get hornPlaying(): boolean {
    return this.ctx !== null && this.ctx.currentTime < this.hornEnd;
  }

  /** Hydraulics / thruster pop: a short filtered hiss, `k` 0..1. */
  pssh(k = 1) {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null || this.noiseBuf === null) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.45);
  }
}

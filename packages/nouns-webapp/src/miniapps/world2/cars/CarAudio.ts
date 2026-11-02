// ── Car sounds: the van's engine synth at each car's pitch, real car horns ──
//
// Engine, tyre screech and thuds come from van/VanAudio.ts (pitched per car
// with `pitch`). The horn is a car's instead of the van's chime: a two-tone
// beep, a deep blast, an old bulb "toot", the lowrider's little tune, or an
// air horn. `pssh` is the hydraulics / stomp release (filtered noise).
// Everything is synthesized; nothing is sampled.
//
// Electric cars (`voice: 'electric'`, the GOLF BUGGY) don't use the van's
// combustion synth: its nodes run into a muted bus, and the motor is a
// high whine that rises with road speed (a triangle plus a slightly
// detuned partial through a bandpass, a faint gear hum under it), with
// the cart's reverse beeper while backing up.

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

/** Electric whine: Hz at a standstill and at the car's top speed (× `engine`). */
const WHINE_LO = 220;
const WHINE_HI = 1250;
/** Reverse beeper: a beep this long, every `BEEP_EVERY` seconds. */
const BEEP_LEN = 0.32;
const BEEP_EVERY = 0.9;

/** Whine pitch (Hz) for a speed as a share of top speed (0..~1.3), pure. */
export function whineHz(speedFrac: number, pitch = 1): number {
  const k = Math.max(0, Math.min(1.4, speedFrac));
  return (WHINE_LO + (WHINE_HI - WHINE_LO) * Math.pow(k, 0.85)) * pitch;
}

interface Whine {
  a: OscillatorNode;
  b: OscillatorNode;
  hum: OscillatorNode;
  bp: BiquadFilterNode;
  gain: GainNode;
  humGain: GainNode;
  mute: GainNode;
}

export class CarAudio extends VanAudio {
  private hornEnd = 0;
  private noiseBuf: AudioBuffer | null = null;
  private voice: CarSpec['horn'] = 'beep';
  private electric = false;
  private topMs = 30;
  private whine: Whine | null = null;
  private nextBeep = 0;
  /** Road speed (m/s, signed: − = reversing), set by the driver each frame before update(). */
  speed = 0;

  setCar(spec: CarSpec) {
    this.pitch = spec.engine;
    this.voice = spec.horn;
    this.electric = spec.voice === 'electric';
    this.topMs = Math.max(1, spec.topKmh / 3.6);
  }

  override start(ctx: AudioContext | null, out: AudioNode | null, noise: AudioBuffer | null) {
    this.noiseBuf = noise;
    if (!this.electric || ctx === null || out === null || this.whine !== null) {
      super.start(ctx, out, noise);
      return;
    }
    // The van's synth into a muted bus (its skid / horn / thud bookkeeping
    // stays), the motor's own voice to the real output
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(out);
    super.start(ctx, mute, noise);
    this.out = out;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.05, t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = whineHz(0, this.pitch) * 1.5;
    bp.Q.value = 1.4;
    const a = ctx.createOscillator();
    a.type = 'triangle';
    a.frequency.value = whineHz(0, this.pitch);
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = whineHz(0, this.pitch) * 2.013;
    const bg = ctx.createGain();
    bg.gain.value = 0.35;
    a.connect(bp);
    b.connect(bg).connect(bp);
    bp.connect(gain).connect(out);
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 55;
    const hlp = ctx.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = 180;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.015;
    hum.connect(hlp).connect(humGain).connect(out);
    a.start();
    b.start();
    hum.start();
    this.whine = { a, b, hum, bp, gain, humGain, mute };
  }

  override update(
    rpm: number,
    gear: number,
    throttle: number,
    slip: number,
    boost: boolean,
    air: boolean,
  ) {
    super.update(rpm, gear, throttle, slip, boost, air);
    const w = this.whine;
    const ctx = this.ctx;
    if (w === null || ctx === null) return;
    const t = ctx.currentTime;
    const frac = Math.abs(this.speed) / this.topMs;
    const f = whineHz(frac, this.pitch) * (boost ? 1.08 : 1);
    w.a.frequency.setTargetAtTime(f, t, 0.08);
    w.b.frequency.setTargetAtTime(f * 2.013, t, 0.08);
    w.bp.frequency.setTargetAtTime(f * 1.5, t, 0.1);
    // louder under load, a soft coast whine off the pedal, quiet at a standstill
    const load = Math.max(throttle, gear < 0 ? 0.6 : 0);
    w.gain.gain.setTargetAtTime(
      Math.min(0.13, 0.012 + Math.min(1, frac * 3) * 0.035 + load * 0.06 + (boost ? 0.02 : 0)),
      t,
      0.08,
    );
    w.humGain.gain.setTargetAtTime(0.01 + load * 0.02, t, 0.1);
    // Reversing: beep… beep…
    if (gear < 0 && this.speed < -0.2) {
      if (t >= this.nextBeep) {
        this.beep(t);
        this.nextBeep = t + BEEP_EVERY;
      }
    } else this.nextBeep = 0;
  }

  private beep(t: number) {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1040;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.setValueAtTime(0.05, t + BEEP_LEN - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + BEEP_LEN);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + BEEP_LEN + 0.02);
  }

  override stop() {
    const w = this.whine;
    const ctx = this.ctx;
    this.whine = null;
    super.stop();
    if (w === null || ctx === null) return;
    const t = ctx.currentTime;
    w.gain.gain.setTargetAtTime(0, t, 0.1);
    w.humGain.gain.setTargetAtTime(0, t, 0.1);
    w.a.stop(t + 0.8);
    w.b.stop(t + 0.8);
    w.hum.stop(t + 0.8);
    window.setTimeout(() => {
      w.gain.disconnect();
      w.humGain.disconnect();
      w.mute.disconnect();
    }, 1000);
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

// ── Van audio: engine, tyre screech, and the chime horn (all synthesized) ──
//
// Everything goes into the skate audio's master gain, which feeds the game
// mixer's sfx bus (settings/mixer.ts): the SFX slider and master govern it.
// Nodes exist only while driving; per-frame updates are AudioParam ramps.
//
// The horn plays a short music-box chime in the spirit of an ice cream van.
// It's an original little phrase (no existing tune), on a glockenspiel-ish
// voice: a sine with a bright inharmonic partial and a fast decay.

/** Original chime phrase: [semitones above C5, beats]. */
const CHIME: [number, number][] = [
  [7, 1], // G5
  [12, 1], // C6
  [11, 0.5], // B5
  [9, 0.5], // A5
  [7, 1], // G5
  [4, 1], // E5
  [5, 0.5], // F5
  [7, 0.5], // G5
  [9, 1], // A5
  [7, 2], // G5
];
const BEAT = 0.2;
const C5 = 523.25;

export class VanAudio {
  protected ctx: AudioContext | null = null;
  protected out: AudioNode | null = null;
  /** Engine pitch multiplier (cars/ voice their engines off this synth). */
  pitch = 1;
  private engine: {
    a: OscillatorNode;
    b: OscillatorNode;
    lp: BiquadFilterNode;
    gain: GainNode;
  } | null = null;
  private skid: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null = null;
  private hornUntil = 0;

  /** Start the engine (needs the unlocked context and the sfx master). */
  start(ctx: AudioContext | null, out: AudioNode | null, noise: AudioBuffer | null) {
    if (ctx === null || out === null || this.engine !== null) return;
    this.ctx = ctx;
    this.out = out;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.16, t, 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 2.5;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = 38;
    const b = ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = 19;
    const bg = ctx.createGain();
    bg.gain.value = 0.55;
    a.connect(lp);
    b.connect(bg).connect(lp);
    lp.connect(gain).connect(out);
    a.start();
    b.start();
    this.engine = { a, b, lp, gain };
    if (noise !== null) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 3;
      const sg = ctx.createGain();
      sg.gain.value = 0;
      src.connect(bp).connect(sg).connect(out);
      src.start();
      this.skid = { src, bp, gain: sg };
    }
  }

  /**
   * Per frame while driving. `rpm` 0..1 within the gear, `gear` (−1 = R),
   * `throttle` 0..1, `slip` 0..1 tyre slide, `air` true while airborne.
   */
  update(rpm: number, gear: number, throttle: number, slip: number, boost: boolean, air: boolean) {
    const ctx = this.ctx;
    const e = this.engine;
    if (ctx === null || e === null) return;
    const t = ctx.currentTime;
    // Lower gears rev higher-pitched; each gear's band ends a bit higher
    const g = Math.max(1, gear);
    const base = 30 + g * 4;
    const f = (base + rpm * (54 + g * 6) + (air ? 14 * throttle : 0)) * this.pitch;
    e.a.frequency.setTargetAtTime(f, t, 0.05);
    e.b.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.lp.frequency.setTargetAtTime(260 + throttle * 900 + (boost ? 600 : 0), t, 0.08);
    e.gain.gain.setTargetAtTime(0.09 + throttle * 0.1 + (boost ? 0.04 : 0), t, 0.1);
    if (this.skid !== null) {
      const s = Math.min(1, slip);
      this.skid.gain.gain.setTargetAtTime(s > 0.08 ? s * 0.22 : 0, t, 0.06);
      this.skid.bp.frequency.setTargetAtTime(1200 + s * 900, t, 0.1);
    }
  }

  /** A one-off thud (wall hit / hard landing), 0..1. */
  thud(k: number) {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null || k <= 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.12 + k * 0.4), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** The chime horn (ignored while it's still playing). */
  horn() {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return;
    const now = ctx.currentTime;
    if (now < this.hornUntil) return;
    let t = now + 0.02;
    const bus = ctx.createGain();
    bus.gain.value = 0.32;
    bus.connect(out);
    for (const [semi, beats] of CHIME) {
      const f = C5 * Math.pow(2, semi / 12);
      const len = beats * BEAT;
      for (const [mult, amp, decay] of [
        [1, 1, 0.9],
        [2.76, 0.28, 0.25], // the bright, bell-like partial
        [5.4, 0.08, 0.12],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.2, len * 2.4) * decay);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + len * 2.6 + 0.05);
      }
      t += len;
    }
    this.hornUntil = t;
    window.setTimeout(() => bus.disconnect(), (t - now + 1.5) * 1000);
  }

  get hornPlaying(): boolean {
    return this.ctx !== null && this.ctx.currentTime < this.hornUntil;
  }

  /** Engine off: fade out, then release the nodes. */
  stop() {
    const ctx = this.ctx;
    const e = this.engine;
    const s = this.skid;
    this.engine = null;
    this.skid = null;
    if (ctx === null) return;
    const t = ctx.currentTime;
    if (e !== null) {
      e.gain.gain.setTargetAtTime(0, t, 0.12);
      e.a.stop(t + 0.8);
      e.b.stop(t + 0.8);
      window.setTimeout(() => e.gain.disconnect(), 1000);
    }
    if (s !== null) {
      s.gain.gain.setTargetAtTime(0, t, 0.05);
      s.src.stop(t + 0.5);
      window.setTimeout(() => s.gain.disconnect(), 800);
    }
  }
}

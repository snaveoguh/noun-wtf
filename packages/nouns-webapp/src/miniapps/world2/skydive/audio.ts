// ── Freefall wind: filtered noise rising with speed (WebAudio, no samples) ──

import type { SkateAudio } from '../audio/SkateAudio';

export class SkyWind {
  private node: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null = null;

  constructor(private audio: SkateAudio) {}

  /** `level` 0..1 (0 fades it out), `speed` m/s (pitch). */
  update(level: number, speed: number) {
    const a = this.audio;
    const ctx = a.ctx;
    if (ctx === null || a.master === null || a.noise === null) return;
    if (this.node === null) {
      if (level <= 0.001) return;
      const src = ctx.createBufferSource();
      src.buffer = a.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(bp).connect(gain).connect(a.master);
      src.start();
      this.node = { src, bp, gain };
    }
    const t = ctx.currentTime;
    const n = this.node;
    n.gain.gain.setTargetAtTime(level * 0.55, t, 0.12);
    n.bp.frequency.setTargetAtTime(260 + speed * 22, t, 0.2);
    if (level <= 0.001 && n.gain.gain.value < 0.002) {
      n.src.stop();
      n.src.disconnect();
      this.node = null;
    }
  }

  dispose() {
    if (this.node === null) return;
    try {
      this.node.src.stop();
    } catch {
      /* already stopped */
    }
    this.node.src.disconnect();
    this.node = null;
  }
}

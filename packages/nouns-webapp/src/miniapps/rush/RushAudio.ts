// ── Noun Rush sound: a synth engine hum, blips, and a dance-floor beat ──

import type { Ride } from './course';

export class RushAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engOsc: OscillatorNode | null = null;
  private engGain: GainNode | null = null;
  private danceGain: GainNode | null = null;
  private beatTimer = 0;
  private nextBeat = 0;
  private beatN = 0;
  private muted = false;

  unlock() {
    if (this.ctx !== null) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(lp).connect(this.engGain).connect(this.master);
    this.engOsc.start();

    this.danceGain = ctx.createGain();
    this.danceGain.gain.value = 0;
    this.danceGain.connect(this.master);
    this.nextBeat = ctx.currentTime;
    this.beatTimer = window.setInterval(() => this.scheduleBeats(), 50);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  setEngine(level: number, ride: Ride) {
    if (!this.ctx || !this.engOsc || !this.engGain) return;
    const motor =
      ride === 'car' ||
      ride === 'moto' ||
      ride === 'tractor' ||
      ride === 'heli' ||
      ride === 'plane';
    const base =
      ride === 'tractor'
        ? 38
        : ride === 'moto'
          ? 70
          : ride === 'heli'
            ? 22
            : ride === 'plane'
              ? 55
              : 50;
    const t = this.ctx.currentTime;
    this.engOsc.frequency.setTargetAtTime(base * (0.8 + level * 0.9), t, 0.08);
    this.engGain.gain.setTargetAtTime(motor ? 0.06 + level * 0.05 : 0, t, 0.1);
  }

  setDance(on: number) {
    if (!this.ctx || !this.danceGain) return;
    this.danceGain.gain.setTargetAtTime(on * 0.8, this.ctx.currentTime, 0.3);
  }

  private scheduleBeats() {
    const ctx = this.ctx;
    if (!ctx || !this.danceGain) return;
    const step = 60 / 124 / 2;
    while (this.nextBeat < ctx.currentTime + 0.15) {
      const t = this.nextBeat;
      const n = this.beatN++;
      if (n % 2 === 0) this.kick(t);
      else this.hat(t);
      if (n % 8 === 4) this.clap(t);
      if (n % 4 === 2) this.bass(t, [55, 55, 65.4, 49][Math.floor(n / 8) % 4]!);
      this.nextBeat += step;
    }
  }

  private env(t: number, dur: number, peak: number, dest: AudioNode) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(dest);
    return g;
  }

  private kick(t: number) {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    o.connect(this.env(t, 0.25, 0.9, this.danceGain!));
    o.start(t);
    o.stop(t + 0.3);
  }

  private noise(t: number, dur: number, peak: number, hp: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    src.connect(f).connect(this.env(t, dur, peak, dest));
    src.start(t);
  }

  private hat(t: number) {
    this.noise(t, 0.05, 0.15, 7000, this.danceGain!);
  }

  private clap(t: number) {
    this.noise(t, 0.15, 0.4, 1500, this.danceGain!);
  }

  private bass(t: number, f: number) {
    const o = this.ctx!.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    o.connect(lp).connect(this.env(t, 0.22, 0.25, this.danceGain!));
    o.start(t);
    o.stop(t + 0.25);
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    peak = 0.2,
    slideTo?: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(this.env(t, dur, peak, this.master));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  beep(go: boolean) {
    this.tone(go ? 880 : 440, go ? 0.5 : 0.18, 'square', 0.18);
  }
  blip() {
    this.tone(990, 0.09, 'square', 0.12);
    this.tone(1480, 0.1, 'square', 0.1, undefined, 0.06);
  }
  fizz() {
    if (!this.ctx || !this.master) return;
    this.noise(this.ctx.currentTime, 0.5, 0.25, 3000, this.master);
    this.tone(400, 0.4, 'sawtooth', 0.12, 1200);
  }
  ring() {
    this.tone(660, 0.12, 'triangle', 0.25);
    this.tone(990, 0.2, 'triangle', 0.25, undefined, 0.08);
  }
  punch() {
    if (!this.ctx || !this.master) return;
    this.noise(this.ctx.currentTime, 0.12, 0.5, 200, this.master);
    this.tone(160, 0.15, 'sine', 0.5, 60);
  }
  crash() {
    if (!this.ctx || !this.master) return;
    this.noise(this.ctx.currentTime, 0.35, 0.45, 300, this.master);
  }
  fanfare(win: boolean) {
    const notes = win ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach((f, i) => this.tone(f, 0.25, 'square', 0.15, undefined, i * 0.14));
  }

  dispose() {
    window.clearInterval(this.beatTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

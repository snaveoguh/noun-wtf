// ── Character voices at runtime: babble synth + recorded-line hook ────────
//
// One short-lived node graph per line, all of it scheduled up front from the
// plan (voiceParams.syllablePlan), then left to stop itself:
//
//   osc ×unison ─┬─ bandpass F1 ─┐
//                └─ bandpass F2 ─┼─ env ─┬────────────────────┐
//   noise ─ highpass ─ breath ───┘       └─ shimmer (Oracle) ─┴─ out (the "npc" bus)
//
// The env gain carries every syllable's blip; the formant filters step to each
// syllable's vowel. The Oracle's shimmer is an octave-and-a-fifth partial into
// a short feedback echo: a crystal-ball ring without a reverb impulse.
//
// Recorded lines: `files` maps a line id to an audio URL. If a line has one,
// it plays the file instead of babbling (and the typewriter stretches to the
// file's length, see `speak`). Nothing ships with files yet.

import { syllablePlan, VOWELS, type Plan, type VoiceParams } from './voiceParams';

export interface VoiceLine {
  text: string;
  voice: VoiceParams;
  /** Stable id (e.g. "oracle.greeting"): a recorded file replaces the babble. */
  lineId?: string;
  /** Extra gain for this line (distance falloff etc.). */
  gain?: number;
}

export interface VoiceHandle {
  /** The timing plan (text reveal and syllables). */
  plan: Plan;
  /** AudioContext time the line started at (null when silent / no audio yet). */
  startedAt: number | null;
  /** Reveal clock scale: 1 for babble; file length / plan length for a recording. */
  stretch: number;
  stop(): void;
}

/** Dev / browser checks: what the voice box has played. */
export interface VoiceLog {
  lines: number;
  syllables: number;
  files: number;
  last: string;
}

export class VoiceBox {
  /** lineId → audio URL. A line with a file plays it instead of babbling. */
  readonly files = new Map<string, string>();
  readonly log: VoiceLog = { lines: 0, syllables: 0, files: 0, last: '' };
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private live = new Set<VoiceHandle>();

  constructor(
    private ctx: () => AudioContext | null,
    private out: () => AudioNode | null,
    private noise: () => AudioBuffer | null = () => null,
  ) {}

  /** Say a line. Always returns a handle (silent when audio isn't unlocked yet). */
  speak(line: VoiceLine): VoiceHandle {
    const plan = syllablePlan(line.text, line.voice);
    const ctx = this.ctx();
    const out = this.out();
    const h: VoiceHandle = { plan, startedAt: null, stretch: 1, stop: () => undefined };
    if (ctx === null || out === null || ctx.state === 'closed') return h;
    const url = line.lineId !== undefined ? this.files.get(line.lineId) : undefined;
    if (url !== undefined) return this.playFile(ctx, out, url, h, line);
    return this.babble(ctx, out, plan, line, h);
  }

  /** Hush everyone (a scene skipped, the panel closed). */
  stopAll() {
    for (const h of [...this.live]) h.stop();
  }

  private babble(
    ctx: AudioContext,
    out: AudioNode,
    plan: Plan,
    line: VoiceLine,
    h: VoiceHandle,
  ): VoiceHandle {
    const v = line.voice;
    const t0 = ctx.currentTime + 0.03;
    const end = t0 + plan.total + 0.1;
    const level = Math.max(0, Math.min(1.5, v.gain * (line.gain ?? 1)));
    const env = ctx.createGain();
    env.gain.value = 0;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 7;
    const f2g = ctx.createGain();
    f2g.gain.value = 0.6;
    f1.connect(env);
    f2.connect(f2g).connect(env);
    // A dry path keeps the pitch audible through narrow formants
    const dry = ctx.createGain();
    dry.gain.value = 0.22;
    dry.connect(env);
    const nodes: AudioNode[] = [env, f1, f2, f2g, dry];
    const srcs: AudioScheduledSourceNode[] = [];
    const oscs: OscillatorNode[] = [];
    const n = Math.max(1, Math.min(3, Math.round(v.unison)));
    for (let u = 0; u < n; u++) {
      const o = ctx.createOscillator();
      o.type = v.wave;
      const cents = n === 1 ? 0 : (u / (n - 1) - 0.5) * v.detune;
      o.detune.value = cents;
      o.connect(f1);
      o.connect(f2);
      o.connect(dry);
      srcs.push(o);
      oscs.push(o);
    }
    // Breath: the shared noise buffer, high-passed, under the same envelope
    const nb = this.noise();
    if (nb !== null && v.breath > 0) {
      const ns = ctx.createBufferSource();
      ns.buffer = nb;
      ns.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const ng = ctx.createGain();
      ng.gain.value = v.breath * 0.5;
      ns.connect(hp).connect(ng).connect(env);
      nodes.push(hp, ng);
      srcs.push(ns);
    }
    const master = ctx.createGain();
    master.gain.value = level;
    env.connect(master);
    master.connect(out);
    nodes.push(master);
    // Shimmer: a high partial into a short feedback echo (the Oracle's crystal ball)
    if (v.shimmer > 0) {
      const so = ctx.createOscillator();
      so.type = 'sine';
      const sg = ctx.createGain();
      sg.gain.value = 0;
      const dl = ctx.createDelay(0.5);
      dl.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.5;
      const wet = ctx.createGain();
      wet.gain.value = 0.35 * v.shimmer;
      so.connect(sg);
      sg.connect(dl);
      dl.connect(fb).connect(dl);
      dl.connect(wet).connect(master);
      env.connect(dl); // the voice itself echoes a little too
      for (const s of plan.syllables) {
        const a = t0 + s.t;
        so.frequency.setValueAtTime(s.f0 * 3, a);
        sg.gain.setValueAtTime(0, a);
        sg.gain.linearRampToValueAtTime(0.12 * v.shimmer * s.amp, a + 0.015);
        sg.gain.linearRampToValueAtTime(0, a + s.dur + 0.05);
      }
      nodes.push(sg, dl, fb, wet);
      srcs.push(so);
    }
    // The blips
    const fs = v.formant;
    for (const s of plan.syllables) {
      const a = t0 + s.t;
      const [F1, F2] = VOWELS[s.vowel] ?? VOWELS[0]!;
      for (const o of oscs) {
        o.frequency.setValueAtTime(s.f0, a);
        o.frequency.linearRampToValueAtTime(s.f1, a + s.dur);
      }
      f1.frequency.setValueAtTime(F1 * fs, a);
      f2.frequency.setValueAtTime(F2 * fs, a);
      env.gain.setValueAtTime(0, a);
      env.gain.linearRampToValueAtTime(s.amp, a + 0.012);
      env.gain.setValueAtTime(s.amp, a + s.dur * 0.6);
      env.gain.linearRampToValueAtTime(0, a + s.dur);
    }
    const tail = v.shimmer > 0 ? 0.9 : 0.05;
    for (const s of srcs) {
      s.start(t0);
      s.stop(end + tail);
    }
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      this.live.delete(h);
      for (const nd of nodes) nd.disconnect();
      for (const s of srcs) s.disconnect();
    };
    srcs[0]!.onended = cleanup;
    h.startedAt = t0;
    h.stop = () => {
      if (done) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.02);
      for (const s of srcs) {
        try {
          s.stop(now + 0.1);
        } catch {
          // already stopped
        }
      }
      setTimeout(cleanup, 250);
    };
    this.live.add(h);
    this.log.lines++;
    this.log.syllables += plan.syllables.length;
    this.log.last = line.text.slice(0, 60);
    return h;
  }

  private playFile(
    ctx: AudioContext,
    out: AudioNode,
    url: string,
    h: VoiceHandle,
    line: VoiceLine,
  ): VoiceHandle {
    let p = this.buffers.get(url);
    if (p === undefined) {
      p = fetch(url)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(b => ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    let stopped = false;
    let src: AudioBufferSourceNode | null = null;
    h.startedAt = ctx.currentTime;
    h.stop = () => {
      stopped = true;
      this.live.delete(h);
      try {
        src?.stop();
      } catch {
        // not started
      }
    };
    this.live.add(h);
    void p.then(buf => {
      if (stopped) return;
      if (buf === null) {
        // The file's missing: babble after all
        this.live.delete(h);
        const b = this.babble(ctx, out, h.plan, { ...line, lineId: undefined }, h);
        h.stop = b.stop;
        return;
      }
      const g = ctx.createGain();
      g.gain.value = line.gain ?? 1;
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g).connect(out);
      src.onended = () => {
        g.disconnect();
        this.live.delete(h);
      };
      h.startedAt = ctx.currentTime;
      h.stretch = h.plan.total > 0 ? buf.duration / h.plan.total : 1;
      src.start();
      this.log.files++;
      this.log.last = line.text.slice(0, 60);
    });
    return h;
  }
}

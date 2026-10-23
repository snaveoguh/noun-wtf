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
//
// Real voices: when `realVoice()` hands back a TtsEngine (the player has them
// on), a line is spoken by the neural voice for that character instead
// (ttsVoice.ts: speaker + pitch + pace from their seed). The whole line is
// synthesized up front, then the typewriter is stretched to the audio's
// length so letters land roughly with the words. While the model loads, or if
// a line takes too long or fails, the babble plays as before.

import type { TtsEngine } from './TtsEngine';

import { pitchFactor, ttsVoiceOf, type TtsVoice } from './ttsVoice';
import { deriveVoice, syllablePlan, VOWELS, type Plan, type VoiceParams } from './voiceParams';

/** Any voice, just to time a recording's (unused) typewriter plan. */
const DUMMY_PLAN_VOICE: VoiceParams = deriveVoice([0, 0, 0, 0, 0]);

/** How long a line waits for its synthesis before babbling instead (ms). */
const TTS_WAIT_MS = 2200;

export interface VoiceLine {
  text: string;
  voice: VoiceParams;
  /** Stable id (e.g. "oracle.greeting"): a recorded file replaces the babble. */
  lineId?: string;
  /** Extra gain for this line (distance falloff etc.). */
  gain?: number;
  /** Real voice override (default: derived from `voice`). */
  tts?: TtsVoice;
  /** Speak with this (ready) engine instead: a player's own trained voice model. */
  engine?: TtsEngine;
  /** Stereo position -1..1 (a remote rider to the left / right). */
  pan?: number;
}

/** A recording's playback trim + level (Voice Booth clips). */
export interface ClipPlay {
  t0: number;
  t1: number;
  gain: number;
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
  /** Player recordings played (Voice Booth clips). */
  clips: number;
  lines: number;
  syllables: number;
  files: number;
  /** Lines spoken with a real voice, and the last one's audio length (s). */
  tts: number;
  ttsDur: number;
  last: string;
}

export class VoiceBox {
  /** lineId → audio URL. A line with a file plays it instead of babbling. */
  readonly files = new Map<string, string>();
  readonly log: VoiceLog = {
    clips: 0,
    lines: 0,
    syllables: 0,
    files: 0,
    tts: 0,
    ttsDur: 0,
    last: '',
  };
  /** Real voices: the engine when the player has them on (null: babble). */
  realVoice: (() => TtsEngine | null) | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private live = new Set<VoiceHandle>();
  /** Real voices: when each speaker finishes their current line (ctx time), so nobody talks over themselves. */
  private until = new Map<number, number>();

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
    const eng = line.engine?.ready === true ? line.engine : (this.realVoice?.() ?? null);
    if (eng !== null) {
      if (eng.ready) return this.playTts(ctx, out, eng, h, line);
      eng.load(); // first time: start the download, babble meanwhile
    }
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

  private playTts(
    ctx: AudioContext,
    out: AudioNode,
    eng: TtsEngine,
    h: VoiceHandle,
    line: VoiceLine,
  ): VoiceHandle {
    const tv = line.tts ?? ttsVoiceOf(line.voice);
    let stopped = false;
    let settled = false;
    this.live.add(h);
    h.stop = () => {
      stopped = true;
      this.live.delete(h);
    };
    const fallback = () => {
      settled = true;
      this.live.delete(h);
      if (!stopped) this.babble(ctx, out, h.plan, line, h);
    };
    const cached = eng.peek(line.text, tv);
    if (cached !== null) {
      this.playBuffer(ctx, out, cached, tv, h, line);
      return h;
    }
    // Hold the typewriter until the voice starts
    h.startedAt = Infinity;
    const timer = setTimeout(() => {
      if (!settled) fallback();
    }, TTS_WAIT_MS);
    void eng.synth(ctx, line.text, tv, 'now').then(buf => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stopped) return;
      if (buf === null) return fallback();
      this.playBuffer(ctx, out, buf, tv, h, line);
    });
    return h;
  }

  /** Play a synthesized line: pitch-shifted, plus the Twins' unison and the Oracle's echo. */
  private playBuffer(
    ctx: AudioContext,
    out: AudioNode,
    buf: AudioBuffer,
    tv: TtsVoice,
    h: VoiceHandle,
    line: VoiceLine,
  ) {
    const dur = buf.duration / pitchFactor(tv.pitch);
    const t0 = Math.max(ctx.currentTime + 0.02, this.until.get(tv.speaker) ?? 0);
    const end = t0 + dur + 0.15;
    this.until.set(tv.speaker, end);
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1.5, 0.95 * (line.gain ?? 1)));
    const nodes: AudioNode[] = [master];
    master.connect(this.panned(ctx, out, line.pan, nodes));
    const srcs: AudioBufferSourceNode[] = [];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.detune.value = tv.pitch;
    src.connect(master);
    srcs.push(src);
    if (tv.unison > 0) {
      const g2 = ctx.createGain();
      g2.gain.value = 0.55;
      const s2 = ctx.createBufferSource();
      s2.buffer = buf;
      s2.detune.value = tv.pitch + tv.unison;
      // (detune resamples, so the higher twin runs a touch ahead: two people, not a chorus)
      s2.connect(g2).connect(master);
      nodes.push(g2);
      srcs.push(s2);
    }
    let tail = 0.05;
    if (tv.echo > 0) {
      const dl = ctx.createDelay(0.5);
      dl.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.45;
      const wet = ctx.createGain();
      wet.gain.value = 0.35 * tv.echo;
      master.connect(dl);
      dl.connect(fb).connect(dl);
      dl.connect(wet).connect(out);
      nodes.push(dl, fb, wet);
      tail = 0.9;
    }
    for (const s of srcs) s.start(t0);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      this.live.delete(h);
      for (const n of nodes) n.disconnect();
      for (const s of srcs) s.disconnect();
    };
    src.onended = () => setTimeout(cleanup, tail * 1000);
    h.startedAt = t0;
    h.stretch = h.plan.total > 0 ? Math.max(0.25, Math.min(4, dur / h.plan.total)) : 1;
    h.stop = () => {
      if (done) return;
      const now = ctx.currentTime;
      if (this.until.get(tv.speaker) === end) this.until.set(tv.speaker, now);
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.02);
      for (const s of srcs) {
        try {
          s.stop(now + 0.1);
        } catch {
          // not started
        }
      }
      setTimeout(cleanup, 250);
    };
    this.live.add(h);
    this.log.tts++;
    this.log.ttsDur = Math.round(dur * 100) / 100;
    this.log.last = line.text.slice(0, 60);
  }

  /** `out`, or a stereo panner in front of it (added to `nodes` for cleanup). */
  private panned(ctx: AudioContext, out: AudioNode, pan: number | undefined, nodes: AudioNode[]) {
    if (pan === undefined || pan === 0 || typeof ctx.createStereoPanner !== 'function') return out;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    nodes.push(p);
    return p;
  }

  /**
   * Play a player's own recording (Voice Booth): just the trimmed speech, at
   * its normalised level, optionally panned. Returns null when audio isn't
   * unlocked yet.
   */
  playClip(
    buf: AudioBuffer,
    clip: ClipPlay,
    opts: { text?: string; gain?: number; pan?: number } = {},
  ): VoiceHandle | null {
    const ctx = this.ctx();
    const out = this.out();
    if (ctx === null || out === null || ctx.state === 'closed') return null;
    const t0 = Math.max(0, Math.min(buf.duration, clip.t0));
    const len = Math.max(0.05, Math.min(buf.duration, clip.t1) - t0);
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(8, clip.gain)) * Math.max(0, Math.min(1.5, opts.gain ?? 1));
    const nodes: AudioNode[] = [g];
    g.connect(this.panned(ctx, out, opts.pan, nodes));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    const start = ctx.currentTime + 0.02;
    // Tiny fades so a trim never clicks
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(g.gain.value, start + 0.01);
    g.gain.setValueAtTime(g.gain.value, start + len - 0.02);
    g.gain.linearRampToValueAtTime(0, start + len);
    src.start(start, t0, len);
    const plan = syllablePlan(opts.text ?? '', { ...DUMMY_PLAN_VOICE });
    const h: VoiceHandle = { plan, startedAt: start, stretch: 1, stop: () => undefined };
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      this.live.delete(h);
      src.disconnect();
      for (const n of nodes) n.disconnect();
    };
    src.onended = cleanup;
    h.stop = () => {
      try {
        src.stop();
      } catch {
        // not started
      }
      cleanup();
    };
    this.live.add(h);
    this.log.clips++;
    this.log.last = (opts.text ?? '').slice(0, 60);
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

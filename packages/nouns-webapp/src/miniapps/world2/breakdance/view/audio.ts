// ── Noun Breaks audio: the break beat on the sim's clock, scratches, crowd ──
//
// Drum samples are rendered once (drums.ts) and scheduled 120 ms ahead
// with start(when): every 16th is placed from one anchor ("the audio time
// beat 0 sounds"), so downbeats are sample-accurate to the view's beat
// clock, which is phase-locked to the sim's. The anchor only moves when the
// clock drifts more than 25 ms (a re-sync), otherwise it creeps.
//
// Shares the game's AudioContext + a bus when given one (like HoopsAudio).
//
// A real song (BattleConfig.track, see ../tracks.ts) replaces the drum
// machine once its file is decoded: one AudioBufferSourceNode started with
// start(when, offset) so the song's first downbeat sits on the battle's
// first beat, from the same anchor the drums use (so the same latency
// compensation). It's only restarted on a re-sync (the anchor moving more
// than 30 ms); a song shorter than the battle loops on whole bars.

import * as THREE from 'three';

import { songLoop, songPos, wrapPos } from '../tracks';

import {
  breakStep,
  renderBass,
  renderHat,
  renderKick,
  renderScratch,
  renderSnare,
  renderStab,
  renderVox,
  stepTime,
} from './drums';

export interface AudioBus {
  ctx: AudioContext;
  out: AudioNode;
}

export type MusicMode = 'off' | 'full' | 'muffled';

interface Kit {
  kick: AudioBuffer;
  snare: AudioBuffer;
  hat: AudioBuffer;
  open: AudioBuffer;
  bass: AudioBuffer;
  stab: AudioBuffer;
  scratches: AudioBuffer[];
}

export class BreakAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private music: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private kit: Kit | null = null;
  private bed: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private own = false;
  private anchor: number | null = null;
  private bpm = 100;
  private next = 0;
  /** Audio time of the last step scheduled. */
  private lastWhen = -Infinity;
  private mode: MusicMode = 'off';
  /** Kick hits scheduled (audio time), so the view can pump the speakers when they sound. */
  readonly kicks: number[] = [];
  volume = 0.85;
  /** The song, once decoded (null: the drum machine plays). */
  private song: {
    buf: AudioBuffer;
    offset: number;
    loop: { start: number; end: number } | null;
  } | null = null;
  private songWant: { bytes: ArrayBuffer | null; offset: number; bpm: number } | null = null;
  private songState: 'none' | 'loading' | 'decoding' | 'ready' | 'failed' = 'none';
  private songSrc: { src: AudioBufferSourceNode; anchor: number; spb: number } | null = null;
  private songBeat = -Infinity;

  constructor(private bus: () => AudioBus | null) {}

  get running() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Audio clock (s), or null before audio starts. */
  get now(): number | null {
    return this.ctx?.currentTime ?? null;
  }

  /** Wire up lazily (call from a gesture when the view owns its context). */
  start(): boolean {
    if (this.ctx !== null) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    const b = this.bus();
    let ctx: AudioContext;
    let dest: AudioNode;
    if (b !== null) {
      ctx = b.ctx;
      dest = b.out;
    } else {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (AC === undefined) return false;
      ctx = new AC();
      this.own = true;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 3;
      comp.connect(ctx.destination);
      dest = comp;
    }
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(dest);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = this.mode === 'muffled' ? 700 : 18000;
    this.music = ctx.createGain();
    this.music.gain.value = this.mode === 'off' ? 0 : this.mode === 'muffled' ? 0.55 : 0.9;
    this.music.connect(this.tone).connect(this.out);
    const sr = ctx.sampleRate;
    const buf = (a: Float32Array) => {
      const x = ctx.createBuffer(1, a.length, sr);
      x.getChannelData(0).set(a);
      return x;
    };
    const vox = renderVox(sr);
    this.kit = {
      kick: buf(renderKick(sr)),
      snare: buf(renderSnare(sr)),
      hat: buf(renderHat(sr, false)),
      open: buf(renderHat(sr, true)),
      bass: buf(renderBass(sr)),
      stab: buf(renderStab(sr)),
      scratches: [1, 2, 3].map(s => buf(renderScratch(sr, vox, 0.9 + s * 0.2, s))),
    };
    const len = sr * 2;
    this.noise = ctx.createBuffer(1, len, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Crowd bed: a murmur that swells with the hype
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.03;
    src.connect(bp).connect(gain).connect(this.out);
    src.start();
    this.bed = { src, gain };
    return true;
  }

  /**
   * Play a song instead of the drums: its file's bytes (when they arrive),
   * its first downbeat (s into the file) and tempo. Until it's decoded, or
   * if it never is, the drum machine keeps the beat.
   */
  playTrack(bytes: Promise<ArrayBuffer | null>, offset: number, bpm: number) {
    const want = { bytes: null as ArrayBuffer | null, offset, bpm };
    this.songState = 'loading';
    this.songWant = want;
    void bytes.then(b => {
      if (this.songWant !== want) return;
      if (b === null) {
        this.songState = 'failed';
        console.warn('[breaks] track file missing: the generated beat plays');
        return;
      }
      want.bytes = b;
    });
  }

  /** 'ready' once the song plays; 'failed' = the drums stand in. */
  get trackState() {
    return this.songState;
  }

  private decodeSong(ctx: AudioContext) {
    const w = this.songWant;
    if (w === null || w.bytes === null || this.songState !== 'loading') return;
    this.songState = 'decoding';
    ctx.decodeAudioData(w.bytes.slice(0)).then(
      buf => {
        if (this.songWant !== w) return;
        this.song = { buf, offset: w.offset, loop: songLoop(buf.duration, w.offset, w.bpm) };
        this.songState = 'ready';
      },
      () => {
        this.songState = 'failed';
        console.warn("[breaks] couldn't decode the track: the generated beat plays");
      },
    );
  }

  /** Keep the song's source on the anchor (audio time of beat 0), restarting it on a re-sync. */
  private updateSong(ctx: AudioContext, now: number, a: number, spb: number) {
    const song = this.song!;
    const cur = this.songSrc;
    if (cur === null || Math.abs(a - cur.anchor) > 0.03 || cur.spb !== spb) {
      if (cur !== null) {
        try {
          cur.src.stop(now + 0.01);
        } catch {
          /* never started */
        }
      }
      this.songSrc = null;
      const t0 = now + 0.03;
      // Battle time t sounds at audio time a + t - INTRO_BEATS * spb (beat 0 at a)
      let pos = songPos(t0 - a + 4 * spb, song.offset);
      let when = t0;
      if (pos < 0) {
        when = t0 - pos;
        pos = 0;
      }
      pos = wrapPos(pos, song.loop);
      const src = ctx.createBufferSource();
      if (pos < song.buf.duration - 0.05) {
        src.buffer = song.buf;
        if (song.loop !== null) {
          src.loop = true;
          src.loopStart = song.loop.start;
          src.loopEnd = song.loop.end;
        }
        src.connect(this.music!);
        src.start(when, pos);
      }
      this.songSrc = { src, anchor: a, spb };
    }
    // The speakers pump on the beat
    let b = Math.max(this.songBeat, Math.ceil((now - a) / spb));
    while (a + b * spb <= now + 0.12) {
      if (a + b * spb >= now - 0.01) this.kicks.push(a + b * spb);
      b++;
    }
    this.songBeat = b;
    while (this.kicks.length > 0 && this.kicks[0] < now - 0.5) this.kicks.shift();
  }

  private ready(): AudioContext | null {
    if (this.ctx === null && !this.start()) return null;
    return this.ctx;
  }

  setMusic(mode: MusicMode) {
    if (mode === this.mode || this.ctx === null || this.music === null || this.tone === null) {
      this.mode = mode;
      return;
    }
    this.mode = mode;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(mode === 'off' ? 0 : mode === 'muffled' ? 0.55 : 0.9, t, 0.12);
    this.tone.frequency.setTargetAtTime(mode === 'muffled' ? 700 : 18000, t, 0.15);
  }

  /**
   * Schedule the beat. `beat` = the view's beat clock right now, `bpm` the
   * battle's tempo. Call every frame.
   */
  update(beat: number, bpm: number) {
    const ctx = this.ctx;
    if (ctx === null || this.kit === null || this.music === null || ctx.state !== 'running') return;
    if (!Number.isFinite(beat) || !(bpm > 0)) return;
    const now = ctx.currentTime;
    const spb = 60 / bpm;
    const step = spb / 4;
    // What we see now should be what we hear: sound leaves the speakers after the output latency
    const lat =
      (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0;
    const a = now - beat * spb - (Number.isFinite(lat) ? Math.min(lat, 0.2) : 0);
    if (this.songState === 'loading') this.decodeSong(ctx);
    if (this.song !== null) {
      this.updateSong(ctx, now, a, spb);
      return;
    }
    if (this.anchor === null || Math.abs(a - this.anchor) > 0.025 || bpm !== this.bpm) {
      this.anchor = a;
      this.bpm = bpm;
      this.next = Math.ceil((now - a) / step);
      // Steps already queued in the lookahead keep their slot: never play one twice
      let g = 0;
      while (stepTime(a, 0, this.next, spb) <= this.lastWhen + 0.01 && g++ < 64) this.next++;
    } else this.anchor += (a - this.anchor) * 0.02;
    // Steps from `next` up to the lookahead
    let guard = 0;
    while (guard++ < 64) {
      const when = stepTime(this.anchor, 0, this.next, spb);
      if (when > now + 0.12) break;
      if (when >= now - 0.01) {
        this.playStep(this.next, Math.max(when, now));
        this.lastWhen = when;
      }
      this.next++;
    }
    while (this.kicks.length > 0 && this.kicks[0] < now - 0.5) this.kicks.shift();
  }

  private playStep(step16: number, when: number) {
    if (this.mode === 'off') return;
    const kit = this.kit!;
    const bar = Math.floor(step16 / 16);
    const s = breakStep(bar, step16 - bar * 16);
    const hit = (b: AudioBuffer, v: number, rate = 1) => {
      if (v <= 0) return;
      const src = this.ctx!.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = rate;
      const g = this.ctx!.createGain();
      g.gain.value = v;
      src.connect(g).connect(this.music!);
      src.start(when);
    };
    hit(kit.kick, s.kick);
    hit(kit.snare, s.snare * 0.8);
    hit(kit.hat, s.hat * 0.45);
    hit(kit.open, s.open * 0.4);
    if (s.bass !== null) hit(kit.bass, 0.75, 2 ** (s.bass / 12));
    if (s.stab !== null) hit(kit.stab, 0.32, 2 ** (s.stab / 12));
    if (s.kick > 0) this.kicks.push(when);
  }

  /** Did a kick sound since `since` (audio time)? (speaker pump) */
  kickedSince(since: number): boolean {
    const now = this.ctx?.currentTime ?? 0;
    return this.kicks.some(k => k > since && k <= now);
  }

  /** The DJ cuts between turns. */
  scratch() {
    const ctx = this.ready();
    if (ctx === null || this.kit === null) return;
    const b = this.kit.scratches[Math.floor(Math.random() * this.kit.scratches.length)];
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    src.connect(g).connect(this.out!);
    src.start(ctx.currentTime + 0.01);
  }

  private noiseBurst(
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    freqEnd?: number,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private beep(t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Crowd: 'ooh' (a big move), 'cheer' (a freeze on the beat), 'roar' (the winner), 'groan' (a crash). */
  crowd(kind: 'ooh' | 'cheer' | 'roar' | 'groan', amount = 1) {
    const ctx = this.ready();
    if (ctx === null || this.noise === null) return;
    const t = ctx.currentTime;
    const dur = kind === 'roar' ? 3.4 : kind === 'cheer' ? 2.0 : 1.4;
    const peak = (kind === 'roar' ? 0.55 : kind === 'cheer' ? 0.4 : 0.32) * amount;
    const formants =
      kind === 'ooh' || kind === 'groan'
        ? [
            [kind === 'groan' ? 260 : 330, 6],
            [kind === 'groan' ? 600 : 820, 7],
          ]
        : [
            [700, 3],
            [1200, 4],
            [2600, 5],
          ];
    for (const [f, q] of formants) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.8;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f, t);
      if (kind === 'ooh') bp.frequency.linearRampToValueAtTime(f * 1.25, t + dur * 0.4);
      if (kind === 'ooh' || kind === 'groan')
        bp.frequency.linearRampToValueAtTime(f * 0.75, t + dur);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak / formants.length, t + dur * 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(this.out!);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
    }
    if (kind === 'cheer' || kind === 'roar') {
      const n = kind === 'roar' ? 28 : 14;
      for (let i = 0; i < n; i++)
        this.noiseBurst(
          t + 0.1 + Math.random() * dur * 0.7,
          0.03,
          'bandpass',
          1600 + Math.random() * 900,
          1.5,
          0.05 * amount,
        );
    }
  }

  /** A judge slaps a card up (`i` = which judge, for a rising pitch). */
  card(i: number) {
    const ctx = this.ready();
    if (ctx === null || this.noise === null) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.09, 'lowpass', 2400, 0.8, 0.5, 600);
    this.beep(t, 'sine', 140, 70, 0.15, 0.35);
    const f = [1046.5, 1318.5, 1568][i % 3];
    this.beep(t + 0.04, 'triangle', f, f, 0.35, 0.16);
  }

  /** The air horn: bwaaa-bwa-bwaaaa. */
  horn() {
    const ctx = this.ready();
    if (ctx === null) return;
    const t0 = ctx.currentTime;
    const blasts: [number, number][] = [
      [0, 0.28],
      [0.34, 0.12],
      [0.5, 0.6],
    ];
    for (const [at, dur] of blasts) {
      const t = t0 + at;
      for (const f of [415, 440, 466]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.94, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
        g.gain.setValueAtTime(0.07, t + dur - 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp).connect(g).connect(this.out!);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  /** Freeze hit on the beat: a crash cymbal + a sub drop. */
  freeze() {
    const ctx = this.ready();
    if (ctx === null || this.noise === null) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 1.3, 'highpass', 5000, 0.7, 0.28, 3000);
    this.beep(t, 'sine', 90, 38, 0.6, 0.45);
  }

  /** A small tick for the local player's hits (perfect rings brighter). */
  tick(grade: 'perfect' | 'great' | 'ok' | 'miss') {
    const ctx = this.ready();
    if (ctx === null || this.noise === null) return;
    const t = ctx.currentTime;
    if (grade === 'miss') {
      this.beep(t, 'square', 180, 90, 0.12, 0.06);
      return;
    }
    const f = grade === 'perfect' ? 2093 : grade === 'great' ? 1568 : 1175;
    this.beep(t, 'triangle', f, f, 0.08, grade === 'perfect' ? 0.12 : 0.08);
  }

  /** Crowd bed level (0..1). */
  setHype(h: number) {
    if (this.bed === null || this.ctx === null) return;
    this.bed.gain.gain.setTargetAtTime(
      0.025 + THREE.MathUtils.clamp(h, 0, 1) * 0.07,
      this.ctx.currentTime,
      0.4,
    );
  }

  dispose() {
    try {
      this.bed?.src.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.songSrc?.src.stop();
    } catch {
      /* never started */
    }
    this.songSrc = null;
    this.song = null;
    this.songWant = null;
    this.songState = 'none';
    this.music?.disconnect();
    this.out?.disconnect();
    if (this.own) void this.ctx?.close();
    this.ctx = null;
    this.kit = null;
  }
}

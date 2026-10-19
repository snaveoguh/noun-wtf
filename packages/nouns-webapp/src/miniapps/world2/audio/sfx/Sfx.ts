// ── Sampled + synthesized one-shots, loops and ambience (the sfx bus) ─────
//
// The samples are small CC0 mp3s under public/world2/sfx/ (CREDITS.md there
// lists every file's source and licence). They're fetched lazily: the first
// play() of a sound starts its download and plays it as soon as it's decoded
// (or drops it, if that took too long to still make sense). mp3 because
// every browser's decodeAudioData takes it (older iOS Safari can't decode Ogg).
//
// Everything here goes into the mixer's sfx bus, except `music` cues, which
// go to the music (radio) bus.

export const SFX_FILES = {
  'ui-click': 'ui-click.mp3',
  'ui-confirm': 'ui-confirm.mp3',
  'ui-cancel': 'ui-cancel.mp3',
  'mission-accept': 'mission-accept.mp3',
  'mission-complete': 'mission-complete.mp3',
  'cut-hit': 'cut-hit.mp3',
  'cut-boom': 'cut-boom.mp3',
  'door-creak': 'door-creak.mp3',
  'ud-accent': 'ud-accent.mp3',
  'crystal-hum': 'crystal-hum.mp3',
  'crystal-chime': 'crystal-chime.mp3',
  coins: 'coins.mp3',
  chips: 'chips.mp3',
  tumbleweed: 'tumbleweed.mp3',
  'wind-1': 'wind-1.mp3',
  'wind-2': 'wind-2.mp3',
  'wave-1': 'wave-1.mp3',
  'wave-2': 'wave-2.mp3',
  'gull-1': 'gull-1.mp3',
  'gull-2': 'gull-2.mp3',
  'gull-3': 'gull-3.mp3',
} as const;

export type SampleId = keyof typeof SFX_FILES;
/** Synthesized, no file. */
export type SynthId = 'whoosh' | 'beep' | 'go' | 'sparkle';
export type SfxId = SampleId | SynthId;
export type Bed = 'cowboy' | 'beach';

export const SFX_BASE = '/world2/sfx/';

const SYNTH: readonly string[] = ['whoosh', 'beep', 'go', 'sparkle'];
export const isSample = (id: string): id is SampleId => id in SFX_FILES;
export const isSfxId = (id: string): id is SfxId => isSample(id) || SYNTH.includes(id);

export interface PlayOpts {
  gain?: number;
  rate?: number;
  /** Seconds from now. */
  delay?: number;
  /** -1..1 */
  pan?: number;
}

/** What one ambience bed plays, and how often (s between one-shots). */
export const BEDS: Record<
  Bed,
  { id: SampleId[]; every: [number, number]; gain: [number, number] }[]
> = {
  // Dry Gulch: wind gusts that overlap into a bed, the odd tumbleweed skitter
  cowboy: [
    { id: ['wind-1', 'wind-2'], every: [4.2, 6], gain: [0.35, 0.55] },
    { id: ['tumbleweed'], every: [7, 16], gain: [0.2, 0.35] },
  ],
  // Puerto Noun: waves on the beach, gulls overhead
  beach: [
    { id: ['wave-1', 'wave-2'], every: [2.6, 5], gain: [0.35, 0.6] },
    { id: ['gull-1', 'gull-2', 'gull-3'], every: [6, 15], gain: [0.15, 0.3] },
  ],
};

/** Next gap before a bed layer fires again (u in 0..1). */
export function nextGap(every: readonly [number, number], u: number): number {
  return every[0] + (every[1] - every[0]) * Math.min(1, Math.max(0, u));
}

/** Dev / browser checks: what the bank has played. */
export interface SfxLog {
  plays: Partial<Record<SfxId, number>>;
  loaded: number;
  failed: number;
}

export class Sfx {
  readonly log: SfxLog = { plays: {}, loaded: 0, failed: 0 };
  private buffers = new Map<SampleId, AudioBuffer>();
  private loading = new Map<SampleId, Promise<AudioBuffer | null>>();
  private loops = new Map<SampleId, { src: AudioBufferSourceNode; gain: GainNode; want: number }>();
  private bed: { name: Bed; timers: number[] } | null = null;
  private udT = 0;

  constructor(
    private ctx: () => AudioContext | null,
    private out: () => AudioNode | null,
    private noise: () => AudioBuffer | null = () => null,
    private musicOut: () => AudioNode | null = () => null,
  ) {}

  /** Start fetching sounds ahead of need. */
  preload(ids: readonly SampleId[]) {
    for (const id of ids) void this.load(id);
  }

  private load(id: SampleId): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id);
    if (have !== undefined) return Promise.resolve(have);
    let p = this.loading.get(id);
    if (p !== undefined) return p;
    const ctx = this.ctx();
    if (ctx === null) return Promise.resolve(null);
    p = fetch(SFX_BASE + SFX_FILES[id])
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(
        b =>
          new Promise<AudioBuffer>((res, rej) => {
            // The callback form: older Safari's decodeAudioData has no promise
            const out = ctx.decodeAudioData(b, res, rej) as unknown;
            if (out instanceof Promise) out.then(res, rej);
          }),
      )
      .then(buf => {
        this.buffers.set(id, buf);
        this.log.loaded++;
        return buf;
      })
      .catch(() => {
        this.log.failed++;
        this.loading.delete(id);
        return null;
      });
    this.loading.set(id, p);
    return p;
  }

  /** Play a sound (a sample, or one of the synthesized ones). */
  play(id: SfxId, o: PlayOpts = {}) {
    const ctx = this.ctx();
    const out = this.out();
    if (ctx === null || out === null) return;
    this.log.plays[id] = (this.log.plays[id] ?? 0) + 1;
    if (!isSample(id)) {
      this.synth(ctx, out, id, o);
      return;
    }
    const buf = this.buffers.get(id);
    if (buf !== undefined) {
      this.start(ctx, out, buf, o);
      return;
    }
    const asked = performance.now();
    void this.load(id).then(b => {
      // Late by more than a moment: the moment's gone
      if (b !== null && performance.now() - asked < 700) this.start(ctx, out, b, o);
    });
  }

  private start(ctx: AudioContext, out: AudioNode, buf: AudioBuffer, o: PlayOpts) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let last: AudioNode = src.connect(g);
    if (o.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      last = last.connect(p);
    }
    last.connect(out);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start(ctx.currentTime + (o.delay ?? 0));
  }

  /** Synthesized one-shots (no file): whooshes, countdown beeps, sparkles. */
  private synth(ctx: AudioContext, out: AudioNode, id: SynthId, o: PlayOpts) {
    const t = ctx.currentTime + (o.delay ?? 0);
    const level = o.gain ?? 1;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    const done: AudioScheduledSourceNode[] = [];
    if (id === 'whoosh') {
      const nb = this.noise();
      if (nb === null) return;
      const len = 0.55 / (o.rate ?? 1);
      const src = ctx.createBufferSource();
      src.buffer = nb;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + len * 0.6);
      bp.frequency.exponentialRampToValueAtTime(700, t + len);
      src.connect(bp).connect(g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.9 * level, t + len * 0.55);
      g.gain.linearRampToValueAtTime(0, t + len);
      src.start(t, Math.random() * 1.2);
      src.stop(t + len + 0.05);
      done.push(src);
    } else {
      // Tonal: a beep (countdown), the GO chord, a sparkle (glints)
      const notes =
        id === 'beep' ? [880] : id === 'go' ? [880, 1108.7, 1318.5] : [1568, 2093, 2637, 3136];
      const len = id === 'beep' ? 0.16 : id === 'go' ? 0.5 : 0.7;
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = id === 'sparkle' ? 'sine' : 'square';
        osc.frequency.value = f * (o.rate ?? 1);
        const og = ctx.createGain();
        const at = t + (id === 'sparkle' ? i * 0.07 : 0);
        og.gain.setValueAtTime(0, at);
        og.gain.linearRampToValueAtTime(id === 'sparkle' ? 0.25 : 0.12, at + 0.01);
        og.gain.exponentialRampToValueAtTime(0.001, at + len);
        osc.connect(og).connect(g);
        osc.start(at);
        osc.stop(at + len + 0.05);
        done.push(osc);
      });
      g.gain.setValueAtTime(level, t);
    }
    const last = done.at(-1);
    if (last !== undefined) last.onended = () => g.disconnect();
  }

  /**
   * A looped sample at a level (0 stops it, after a fade). Call as often as
   * you like: only changes do anything.
   */
  loop(id: SampleId, level: number) {
    const ctx = this.ctx();
    const out = this.out();
    if (ctx === null || out === null) return;
    const cur = this.loops.get(id);
    if (cur !== undefined) {
      if (Math.abs(cur.want - level) < 0.01) return;
      cur.want = level;
      cur.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.25);
      if (level <= 0) {
        const src = cur.src;
        this.loops.delete(id);
        src.stop(ctx.currentTime + 1.2);
        src.onended = () => {
          src.disconnect();
          cur.gain.disconnect();
        };
      }
      return;
    }
    if (level <= 0) return;
    const buf = this.buffers.get(id);
    if (buf === undefined) {
      void this.load(id);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(level, ctx.currentTime, 0.25);
    src.connect(gain).connect(out);
    src.start();
    this.loops.set(id, { src, gain, want: level });
  }

  /** Town ambience: 'cowboy' / 'beach', or null to fade it out. */
  setBed(name: Bed | null) {
    if (this.bed?.name === name) return;
    this.bed = name === null ? null : { name, timers: BEDS[name].map(() => 0.3) };
    if (name !== null) this.preload(BEDS[name].flatMap(l => l.id));
  }

  /** Per frame: ambience timing, the Upside Down's occasional accent. */
  update(dt: number, opts: { upsideDown: boolean }) {
    const bed = this.bed;
    if (bed !== null) {
      const layers = BEDS[bed.name];
      layers.forEach((l, i) => {
        bed.timers[i]! -= dt;
        if (bed.timers[i]! > 0) return;
        bed.timers[i] = nextGap(l.every, Math.random());
        const id = l.id[Math.floor(Math.random() * l.id.length)]!;
        this.play(id, {
          gain: nextGap(l.gain, Math.random()),
          rate: 0.92 + Math.random() * 0.16,
          pan: Math.random() * 1.2 - 0.6,
        });
      });
    }
    if (opts.upsideDown) {
      this.udT -= dt;
      if (this.udT <= 0) {
        if (this.udT > -1) this.play('ud-accent', { gain: 0.35, rate: 0.7 + Math.random() * 0.25 });
        this.udT = 22 + Math.random() * 25;
      }
    } else this.udT = 12;
  }

  /**
   * A short music cue for a cinematic, on the music bus: a slow pad chord
   * that swells and fades. Returns a stop.
   */
  music(cue: 'oracle' | 'one' | 'door' | 'keys', dur = 6): () => void {
    const ctx = this.ctx();
    const out = this.musicOut() ?? this.out();
    if (ctx === null || out === null) return () => undefined;
    const CHORDS: Record<string, number[]> = {
      oracle: [110, 130.81, 164.81, 220], // A minor
      keys: [98, 146.83, 196, 233.08], // G minor-ish, open
      door: [55, 58.27, 82.41], // a dark cluster
      one: [130.81, 164.81, 196, 261.63, 329.63], // C major, wide
    };
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.13, t + Math.min(2, dur * 0.3));
    g.gain.setValueAtTime(0.13, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cue === 'one' ? 2400 : 900;
    lp.connect(g).connect(out);
    const oscs = (CHORDS[cue] ?? CHORDS.oracle!).flatMap(f =>
      [-6, 6].map(c => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = c;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
        return o;
      }),
    );
    oscs[0]!.onended = () => {
      lp.disconnect();
      g.disconnect();
    };
    return () => {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(0, now, 0.2);
      for (const o of oscs) {
        try {
          o.stop(now + 1);
        } catch {
          // already stopped
        }
      }
    };
  }

  dispose() {
    for (const id of [...this.loops.keys()]) this.loop(id, 0);
    this.bed = null;
  }
}

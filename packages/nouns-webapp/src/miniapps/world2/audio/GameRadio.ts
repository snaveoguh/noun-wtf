// ── Noun World's radio switch ────────────────────────────────────────────
//
// Off, COMMUNITY RADIO (the shared station in the ice cream van,
// radio/NounFm.ts), NOUN BEATS (the rider's own hip-hop station: real tracks
// from the NOUN FM playlist on YouTube, NounBeats.ts, per player and never
// synced) or a live internet stream. When YouTube can't play here
// (?offline=1, the app refusing embeds, three tracks in a row erroring)
// NOUN BEATS falls back to the generated boom-bap on the audio thread
// (radioWorklet.ts), labelled "NOUN BEATS (offline)". The beats never fill
// in for COMMUNITY RADIO. While this radio is on, the site-wide NOUN FM player
// (components/NounFm) holds (Game.ts claims the floor via lib/nounFmBus).
//
// Live internet streams plug in through RADIO_STREAMS.

import type { NounBeats } from './NounBeats';

import workletUrl from './radioWorklet.ts?worker&url';

export interface StreamStation {
  name: string;
  url: string;
}

/** Add live internet-radio streams here (direct mp3/aac/icecast URLs). */
export const RADIO_STREAMS: StreamStation[] = [];

export type RadioMode = 'off' | 'fm' | 'beats' | 'stream';

/** NOUN FM (radio/NounFm.ts), the shared station in the ice cream van. */
export interface FmStation {
  setTuned(on: boolean): void;
  next(): void;
  readonly label: string;
}

/** Load the worklet module into a context (once per context). */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
function loadBeatsWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (p === undefined) {
    p = ctx.audioWorklet.addModule(workletUrl);
    loaded.set(ctx, p);
  }
  return p;
}

export class GameRadio {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private songName = 'tuning in';
  mode: RadioMode = 'off';
  volume = 0.6;
  /** Mixer gain for the stream <audio> element (it bypasses the WebAudio graph). */
  extGain = 1;
  streamIndex = 0;
  private audioEl: HTMLAudioElement | null = null;
  /** Called with a "now playing" label whenever the track/station changes. */
  onNowPlaying?: (label: string) => void;
  /** NOUN FM, first stop in the cycle when set. */
  fm: FmStation | null = null;
  /** NOUN BEATS' real tracks (YouTube); without it, or offline, the worklet plays. */
  private beats: NounBeats | null = null;
  private ducked = false;

  /** NOUN BEATS is on the generated worklet beats rather than real tracks. */
  get beatsOffline(): boolean {
    return this.beats === null || this.beats.source === 'offline';
  }

  setBeats(b: NounBeats) {
    this.beats = b;
    b.onChange = () => {
      if (this.mode === 'beats' && !this.beatsOffline) this.onNowPlaying?.(this.label);
    };
    b.onOffline = () => {
      if (this.mode !== 'beats') return;
      this.post('play');
      this.onNowPlaying?.(this.label);
    };
    this.applyBeatsVolume();
  }

  get label(): string {
    if (this.mode === 'fm') return this.fm?.label ?? 'COMMUNITY RADIO';
    if (this.mode === 'beats')
      return this.beatsOffline
        ? `NOUN BEATS (offline): ${this.songName}`
        : `NOUN BEATS: ${this.beats!.label}`;
    if (this.mode === 'stream') return RADIO_STREAMS[this.streamIndex]?.name ?? 'stream';
    return 'radio off';
  }

  /** Attach to the game's AudioContext + radio bus (the beats play into it). */
  attach(ctx: BaseAudioContext, destination: AudioNode) {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);
    loadBeatsWorklet(ctx)
      .then(() => {
        if (this.ctx === null || this.out === null) return;
        const node = new AudioWorkletNode(ctx, 'noun-radio', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.port.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; name?: string };
          if (m.type === 'song' && m.name !== undefined) {
            this.songName = m.name;
            if (this.mode === 'beats' && this.beatsOffline) this.onNowPlaying?.(this.label);
          }
        };
        node.connect(this.out);
        this.node = node;
        // the mode may have been picked while the module loaded
        if (this.mode === 'beats' && this.beatsOffline) this.post('play');
      })
      .catch((err: unknown) => {
        console.warn('[radio] beats worklet failed to load', err);
      });
  }

  private post(type: 'play' | 'stop' | 'next') {
    if (this.ctx !== null && this.ctx.state === 'suspended' && 'resume' in this.ctx)
      void (this.ctx as AudioContext).resume().catch(() => undefined);
    this.node?.port.postMessage({ type, seed: (Math.random() * 2 ** 32) >>> 0 });
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out !== null) this.out.gain.value = v;
    if (this.audioEl !== null) this.audioEl.volume = Math.min(1, v * 1.4 * this.extGain);
    this.applyBeatsVolume();
  }

  /** Under the rider's own spots (intro, town themes) the radio ducks; YouTube too. */
  setDucked(on: boolean) {
    this.ducked = on;
    this.applyBeatsVolume();
  }

  /** YouTube sits outside the WebAudio graph: radio volume × mixer gain by hand. */
  private applyBeatsVolume() {
    this.beats?.setVolume(this.volume * this.extGain * 1.3 * (this.ducked ? 0.12 : 1));
  }

  /** off → NOUN FM → NOUN BEATS → each stream → off */
  cycle() {
    if (this.mode === 'off' && this.fm !== null) this.setMode('fm');
    else if (this.mode === 'off' || this.mode === 'fm') this.setMode('beats');
    else if (this.mode === 'beats') {
      if (RADIO_STREAMS.length > 0) {
        this.streamIndex = 0;
        this.setMode('stream');
      } else this.setMode('off');
    } else if (this.streamIndex < RADIO_STREAMS.length - 1) {
      this.streamIndex++;
      this.setMode('stream');
    } else this.setMode('off');
  }

  /** Next track on NOUN FM, a fresh beat, the next stream, or (radio off) tune in. */
  nextTrack() {
    if (this.mode === 'fm') this.fm?.next();
    else if (this.mode === 'beats') {
      if (this.beatsOffline) this.post('next');
      else this.beats!.next();
    } else if (this.mode === 'stream') this.cycle();
    else if (this.fm !== null) this.setMode('fm');
  }

  setMode(m: RadioMode) {
    if (m !== 'beats') {
      this.post('stop');
      this.beats?.stop();
    }
    this.stopStream();
    if (this.mode === 'fm' && m !== 'fm') this.fm?.setTuned(false);
    this.mode = m;
    if (m === 'fm') this.fm?.setTuned(true);
    if (m === 'beats') {
      this.beats?.start();
      this.post(this.beatsOffline ? 'play' : 'stop');
    }
    if (m === 'stream') this.startStream();
    this.onNowPlaying?.(this.label);
  }

  // ── Live streams ──────────────────────────────────────────────────────

  private startStream() {
    const st = RADIO_STREAMS[this.streamIndex];
    if (st === undefined) return;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = st.url;
    el.volume = Math.min(1, this.volume * 1.4 * this.extGain);
    void el.play().catch(() => {
      // autoplay blocked or stream down
      this.setMode('off');
    });
    this.audioEl = el;
  }

  private stopStream() {
    if (this.audioEl !== null) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
  }

  dispose() {
    this.post('stop');
    this.beats?.stop();
    this.stopStream();
    this.node?.disconnect();
    this.out?.disconnect();
    this.node = null;
    this.ctx = null;
  }
}

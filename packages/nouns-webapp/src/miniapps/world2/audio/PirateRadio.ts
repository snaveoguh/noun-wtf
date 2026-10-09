// ── NOUN PIRATE RADIO ───────────────────────────────────────────────────
//
// Endless generative cloud-rap station. The music itself (sequencer, synths,
// reverb, mix) lives in `radioWorklet.ts` and runs on the audio thread, so
// it keeps playing through main-thread stalls (shader compiles, level
// loads, GC) that used to make it cut out. This class just loads the
// worklet and forwards play/stop/next.
//
// Live internet streams plug in through RADIO_STREAMS.

import workletUrl from './radioWorklet.ts?worker&url';

export interface StreamStation {
  name: string;
  url: string;
}

/** Add live internet-radio streams here (direct mp3/aac/icecast URLs). */
export const RADIO_STREAMS: StreamStation[] = [];

export type RadioMode = 'off' | 'pirate' | 'stream';

/** Load the worklet module into a context (once per context). */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
export function loadRadioWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (p === undefined) {
    p = ctx.audioWorklet.addModule(workletUrl);
    loaded.set(ctx, p);
  }
  return p;
}

export class PirateRadio {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private songName = 'tuning in';
  mode: RadioMode = 'off';
  volume = 0.6;
  streamIndex = 0;
  private audioEl: HTMLAudioElement | null = null;
  /** Called with a "now playing" label whenever the track/station changes. */
  onNowPlaying?: (label: string) => void;

  get label(): string {
    if (this.mode === 'pirate') return `pirate radio: ${this.songName}`;
    if (this.mode === 'stream') return RADIO_STREAMS[this.streamIndex]?.name ?? 'stream';
    return 'radio off';
  }

  /** Attach to an existing AudioContext + destination (the game mix). */
  attach(ctx: BaseAudioContext, destination: AudioNode, _noise?: AudioBuffer | null) {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);
    loadRadioWorklet(ctx)
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
            if (this.mode === 'pirate') this.onNowPlaying?.(this.label);
          }
        };
        node.connect(this.out);
        this.node = node;
        // Mode may have been chosen while the module was loading
        if (this.mode === 'pirate') this.post('play');
      })
      .catch((err: unknown) => {
        console.warn('[radio] worklet failed to load', err);
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
    if (this.audioEl !== null) this.audioEl.volume = Math.min(1, v * 1.4);
  }

  /** off → pirate → each stream → off */
  cycle() {
    if (this.mode === 'off') this.setMode('pirate');
    else if (this.mode === 'pirate') {
      if (RADIO_STREAMS.length > 0) {
        this.streamIndex = 0;
        this.setMode('stream');
      } else this.setMode('off');
    } else if (this.streamIndex < RADIO_STREAMS.length - 1) {
      this.streamIndex++;
      this.setMode('stream');
    } else this.setMode('off');
  }

  /** Skip to a freshly generated song. */
  nextTrack() {
    if (this.mode !== 'pirate') {
      this.setMode('pirate');
      return;
    }
    this.post('next');
  }

  setMode(m: RadioMode) {
    if (m !== 'pirate') this.post('stop');
    this.stopStream();
    this.mode = m;
    if (m === 'pirate') this.post('play');
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
    el.volume = Math.min(1, this.volume * 1.4);
    void el.play().catch(() => {
      // Autoplay blocked or stream down: fall back to the pirate station
      this.setMode('pirate');
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
    this.stopStream();
    this.node?.disconnect();
    this.out?.disconnect();
    this.node = null;
    this.ctx = null;
  }
}

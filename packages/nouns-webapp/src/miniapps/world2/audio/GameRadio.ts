// ── Noun World's radio switch ────────────────────────────────────────────
//
// Off, NOUN FM (the shared station in the ice cream van, radio/NounFm.ts)
// or a live internet stream. There is no generated "pirate" station any
// more: NOUN FM is real music and our jingles only. While this radio is on,
// the site-wide NOUN FM player (components/NounFm) holds (Game.ts claims
// the floor through lib/nounFmBus).
//
// Live internet streams plug in through RADIO_STREAMS.

export interface StreamStation {
  name: string;
  url: string;
}

/** Add live internet-radio streams here (direct mp3/aac/icecast URLs). */
export const RADIO_STREAMS: StreamStation[] = [];

export type RadioMode = 'off' | 'fm' | 'stream';

/** NOUN FM (radio/NounFm.ts), the shared station in the ice cream van. */
export interface FmStation {
  setTuned(on: boolean): void;
  next(): void;
  readonly label: string;
}

export class GameRadio {
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

  get label(): string {
    if (this.mode === 'fm') return this.fm?.label ?? 'NOUN FM';
    if (this.mode === 'stream') return RADIO_STREAMS[this.streamIndex]?.name ?? 'stream';
    return 'radio off';
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.audioEl !== null) this.audioEl.volume = Math.min(1, v * 1.4 * this.extGain);
  }

  /** off → NOUN FM → each stream → off */
  cycle() {
    if (this.mode === 'off' && this.fm !== null) this.setMode('fm');
    else if (this.mode === 'off' || this.mode === 'fm') {
      if (RADIO_STREAMS.length > 0) {
        this.streamIndex = 0;
        this.setMode('stream');
      } else this.setMode('off');
    } else if (this.streamIndex < RADIO_STREAMS.length - 1) {
      this.streamIndex++;
      this.setMode('stream');
    } else this.setMode('off');
  }

  /** Next track on NOUN FM, the next stream, or (radio off) tune in. */
  nextTrack() {
    if (this.mode === 'fm') this.fm?.next();
    else if (this.mode === 'stream') this.cycle();
    else if (this.fm !== null) this.setMode('fm');
  }

  setMode(m: RadioMode) {
    this.stopStream();
    if (this.mode === 'fm' && m !== 'fm') this.fm?.setTuned(false);
    this.mode = m;
    if (m === 'fm') this.fm?.setTuned(true);
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
    this.stopStream();
  }
}

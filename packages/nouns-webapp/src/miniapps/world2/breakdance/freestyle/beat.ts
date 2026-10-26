// ── Freestyle: the beat ─────────────────────────────────────────────────
//
// Pure. Which tempo the dancer moves to, and a beat clock on
// performance.now() milliseconds (key presses are stamped on the same clock).
//
// The beat follows the music when its tempo is knowable: NOUN BEATS on its
// generated boom-bap (radioWorklet.ts announces each song's bpm, and the song
// starts ~50 ms after that message, so the downbeat is known too). Real
// tracks (NOUN BEATS on YouTube, COMMUNITY RADIO, a stream) carry no tempo,
// so the dancer keeps the default 95 bpm under them. The quiet break loop
// (BreakAudio's drum machine) only plays when nothing else is: never on top
// of the radio or the van's speakers.

import type { RadioMode } from '../../audio/GameRadio';

export const DEFAULT_BPM = 95;

export interface BeatInputs {
  radioMode: RadioMode;
  /** NOUN BEATS is on the generated worklet beats. */
  beatsOffline: boolean;
  /** The worklet's current song: its bpm and when (ms) its first beat played. */
  song: { bpm: number; at: number } | null;
  /** COMMUNITY RADIO audible from the van nearby. */
  vanLive: boolean;
}

export interface BeatChoice {
  bpm: number;
  /** ms (performance.now) of one of its beats, when known. */
  anchor: number | null;
  from: 'radio' | 'default';
  /** Other music is playing (so no break loop on top). */
  music: boolean;
}

export function pickBeat(o: BeatInputs): BeatChoice {
  const music = o.radioMode !== 'off' || o.vanLive;
  if (
    o.radioMode === 'beats' &&
    o.beatsOffline &&
    o.song !== null &&
    Number.isFinite(o.song.bpm) &&
    o.song.bpm >= 60 &&
    o.song.bpm <= 200
  )
    return { bpm: o.song.bpm, anchor: o.song.at, from: 'radio', music };
  return { bpm: DEFAULT_BPM, anchor: null, from: 'default', music };
}

/** Beat clock: beat(ms) = (ms − t0) · bpm / 60 000. */
export class FreeClock {
  bpm: number;
  t0: number;

  constructor(bpm = DEFAULT_BPM, t0 = 0) {
    this.bpm = bpm;
    this.t0 = t0;
  }

  get spb() {
    return 60 / this.bpm;
  }

  beat(ms: number): number {
    return ((ms - this.t0) * this.bpm) / 60000;
  }

  /** The ms beat `b` lands on. */
  timeOf(b: number): number {
    return this.t0 + (b * 60000) / this.bpm;
  }

  /**
   * Change tempo at `now` without the beat count jumping (much): with an
   * `anchor` (ms of a beat of the new music), the grid locks onto it, taking
   * whichever of its beats is nearest the count we're at.
   */
  retime(bpm: number, now: number, anchor: number | null) {
    const b = this.beat(now);
    const msPer = 60000 / bpm;
    if (anchor === null) {
      this.bpm = bpm;
      this.t0 = now - b * msPer;
      return;
    }
    const k = Math.round(b - (now - anchor) / msPer);
    this.bpm = bpm;
    this.t0 = anchor - k * msPer;
  }

  /** Same tempo and phase as (bpm, anchor) already (within `tolMs`)? */
  matches(bpm: number, anchor: number | null, tolMs = 15): boolean {
    if (Math.abs(bpm - this.bpm) > 0.01) return false;
    if (anchor === null) return true;
    const msPer = 60000 / bpm;
    const off = (((anchor - this.t0) % msPer) + msPer) % msPer;
    return Math.min(off, msPer - off) <= tolMs;
  }
}

// A hero slide's sound bed (rows.ts `bed`): the Noun Hoops slide gets a
// court under it (dribbles, sneaker squeaks, swishes, a crowd murmur, all
// synthesised in sound.ts) plus a looping groove, public/home/hoops-track.mp3.
//
// The track is an original procedural funk / hip-hop loop (no samples): 8 bars
// at 98 BPM in E dorian, swung 16ths, rendered offline with numpy with its
// tail folded back onto the start so it repeats without a gap (~19.6 s).
//
// Only with sound on. It fades in while its slide shows and out on a slide
// change, mute, a hidden tab, or the hero going off screen; and it never
// plays over the brand slide's voice-over (voiceOver.ts).

export interface BedState {
  /** The visitor turned sound on. */
  sound: boolean;
  /** The slide showing has a bed. */
  slideHasBed: boolean;
  /** The hero is on screen, the tab visible and the home active. */
  live: boolean;
  /** The voice-over is talking (or still fading out). */
  voOn: boolean;
}

/** Should the bed be playing right now? Anything else means fade it out. */
export function shouldPlayBed(s: BedState): boolean {
  return s.sound && s.slideHasBed && s.live && !s.voOn;
}

/** Bed levels into the master bus: the groove, and the court under it. */
export const BED_TRACK_LEVEL = 0.32;
export const BED_AMBIENCE_LEVEL = 0.55;
/** Fade in / out, seconds. */
export const BED_FADE_IN = 1.4;
export const BED_FADE_OUT = 0.6;

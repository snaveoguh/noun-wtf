// The NOUN WTF brand slide's voice-over: a dark-trailer intro read over the
// sizzle reel, once per page view, only with sound on.
//
// Rendered offline (not in the browser) with Piper TTS, LibriTTS-R medium
// model, speaker VO_SPEAKER (a deep male read; LibriTTS-R is CC BY 4.0) at
// length_scale 1.0, then slowed like tape (asetrate x0.94: slower and ~1.4
// semitones deeper with no pitch-shift artifacts), low-shelf lift and a
// small room, over a procedurally generated 86 BPM boom-bap bed (Rhodes
// Fm9/Dbmaj7, swung hats, vinyl) that ducks under the voice. ~17 s. "DAO"
// is fed to the model as "Dow" so it's said that way. The script:
//
//   In the year the DAO was captured... the whales took the treasury.
//   The rest of us went underground.
//   No reserve. No gatekeepers.
//   Free games. Free art. A free DAO. And eyes on the old one.
//   Just Nouns.
//   Welcome to Noun.

// The file is public/home/vo-intro.mp3, set as the sizzle slide's `vo` (rows.ts).

/** LibriTTS-R speaker the file was rendered with (for the credit). */
export const VO_SPEAKER = 499; // LibriTTS-R speaker "2427" in the model's speaker_id_map
/** Length of public/home/vo-intro.mp3, s. While it plays the slide's clip is
 * restarted and slowed to last exactly as long, so voice and picture end
 * together instead of the clip looping back to scenes already seen. */
export const VO_SECONDS = 16.8;

/** Slowest the clip may play to last as long as the voice-over. */
const MIN_RATE = 0.75;

/** Playback rate that stretches a clip of `clipSeconds` over the voice-over (never faster, at most 25% slower). */
export function syncRate(clipSeconds: number): number {
  if (!Number.isFinite(clipSeconds) || clipSeconds <= 0) return 1;
  return Math.min(1, Math.max(MIN_RATE, clipSeconds / VO_SECONDS));
}

/**
 * Can a clip of `clipSeconds` be slowed to last the whole voice-over? A
 * shorter one keeps looping at normal speed instead of playing out and
 * sitting on its last frame for the rest of a longer read.
 */
export function stretches(clipSeconds: number): boolean {
  return Number.isFinite(clipSeconds) && clipSeconds >= VO_SECONDS * MIN_RATE;
}

export const VO_CREDIT =
  'Voice-over: Piper TTS, LibriTTS-R voice (CC BY 4.0, Koizumi et al. / Zen et al.)';

export interface VoState {
  /** The visitor turned sound on. */
  sound: boolean;
  /** The slide showing has a voice-over. */
  slideHasVo: boolean;
  /** The hero is on screen, the tab visible and the home active. */
  live: boolean;
  /** It already started once this page view. */
  played: boolean;
}

/** Start the voice-over now? (Once per page view, sound on, on its slide, visible.) */
export function shouldStartVo(s: VoState): boolean {
  return s.sound && s.slideHasVo && s.live && !s.played;
}

/** Stop a playing voice-over? (Muted, slide changed, or the hero went away.) */
export function shouldStopVo(s: Omit<VoState, 'played'>): boolean {
  return !s.sound || !s.slideHasVo || !s.live;
}

/** The video's own soundtrack level while the voice-over talks over it. */
export const DUCKED = 0.2;

// The NOUN WTF brand slide's voice-over: a dark-trailer intro read over the
// sizzle reel, once per page view, only with sound on. Voice and spooky bed
// come mixed in one file (owner-supplied 2026-10-25), cut straight after the
// last word, "...Welcome to Noun.", with the outro left off. The script opens
// "In the year the DAO was captured... the whales took the treasury."

// The file is public/home/vo-intro.mp3, set as the sizzle slide's `vo` (rows.ts).

/** Length of public/home/vo-intro.mp3, s. While it plays the slide's clip is
 * restarted and slowed to last exactly as long when it can stretch that far
 * (`stretches`), so voice and picture end together; otherwise it loops. */
export const VO_SECONDS = 26.26;

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

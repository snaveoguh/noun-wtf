// The NOUN WTF brand slide's voice-over: a dark-trailer intro read over the
// sizzle reel, once per page view, only with sound on.
//
// Rendered offline (not in the browser) with Piper TTS, LibriTTS-R medium
// model, speaker VO_SPEAKER (a deep male read; LibriTTS-R is CC BY 4.0), a
// touch slower than natural (length_scale 1.1), then darkened with ffmpeg:
// a low-shelf lift, a small room and a slight pitch drop. The script:
//
//   In the year the DAO was captured... the whales took the treasury.
//   The rest of us went underground.
//   No reserve. No gatekeepers.
//   Free games. Free art. A free DAO. And eyes on the old one.
//   Just Nouns.
//   Welcome to noun dot W T F.

// The file is public/home/vo-intro.mp3, set as the sizzle slide's `vo` (rows.ts).

/** LibriTTS-R speaker the file was rendered with (for the credit). */
export const VO_SPEAKER = 499; // LibriTTS-R speaker "2427" in the model's speaker_id_map
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

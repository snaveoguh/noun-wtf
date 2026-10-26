// ── Real voices: which Piper speaker a character gets, and how they talk ──
//
// Pure (no WebAudio, no worker). The neural voice is Piper's LibriTTS-R
// "medium" model (MIT code, CC-BY-4.0 data): one 78 MB ONNX file holding 904
// different speakers. Every character's voice already comes from their Noun
// seed (voiceParams.deriveVoice); this maps that to a speaker id plus a pitch
// and pace, so the same Noun always sounds the same and two Nouns almost
// never share a voice (904 speakers × pitch × pace).
//
// Pitch is shifted at playback (the buffer's detune), which also speeds the
// clip up by the same factor, so synthesis is slowed by that factor first
// (Piper's length_scale): the pitch moves, the pace stays what we asked for.

import { hashSeed, type VoiceParams } from './voiceParams';

/** The model: Piper en_US LibriTTS-R medium, pinned to a revision of rhasspy/piper-voices. */
export const PIPER_REV = '5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';
const PIPER_BASE = `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_REV}/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx`;
export const PIPER_MODEL_URL = PIPER_BASE;
export const PIPER_CONFIG_URL = `${PIPER_BASE}.json`;
/** Size of the model download (bytes), for the settings panel before it's fetched. */
export const PIPER_MODEL_BYTES = 78_580_914;
/** Speakers in the model (ids 0..903). */
export const SPEAKERS = 904;

export interface TtsVoice {
  /** Piper speaker id. */
  speaker: number;
  /** Playback pitch shift (cents). */
  pitch: number;
  /** Speaking pace (1 = the speaker's own; above is faster). */
  rate: number;
  /** Piper noise_scale (expressiveness) and noise_w (rhythm wobble). */
  noise: number;
  noiseW: number;
  /** Twins: a second voice in unison, this many cents above. 0 = none. */
  unison: number;
  /** The Oracle's crystal echo (0..1). */
  echo: number;
  /** Silence between sentences, as heard (s). */
  gap: number;
}

/** Between an NPC's sentences: about native Piper's sentence_silence. */
export const NPC_GAP = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A character's real voice from their babble voice (which comes from their
 * seed). Deterministic: the same params always give the same voice.
 */
export function ttsVoiceOf(v: VoiceParams): TtsVoice {
  const h = hashSeed([
    Math.round(v.base * 10),
    Math.round(v.speed * 100),
    Math.round(v.formant * 1000),
    Math.round(v.breath * 1000),
    v.wave.length + Math.round(v.range * 100),
  ]);
  // Higher babble pitch → a higher real voice (a few semitones at most: the
  // speaker already carries most of the character, big shifts sound processed)
  const pitch = clamp(Math.log2(v.base / 185) * 400, -300, 220);
  // 12..23 chars/s babble → 0.86..1.14 pace
  const rate = clamp(0.86 + ((v.speed - 12) / 11) * 0.28, 0.8, 1.2);
  return {
    speaker: h % SPEAKERS,
    pitch: Math.round(pitch),
    rate: Math.round(rate * 1000) / 1000,
    noise: Math.round(clamp(0.5 + v.breath * 0.9, 0.5, 0.8) * 1000) / 1000,
    noiseW: Math.round((0.6 + ((h >>> 12) % 300) / 1000) * 1000) / 1000,
    unison: v.unison > 1 ? Math.max(60, v.detune * 6) : 0,
    echo: clamp(v.shimmer, 0, 1),
    gap: NPC_GAP,
  };
}

/**
 * The player's own voice: one hand-picked LibriTTS-R speaker, not a seed
 * lottery. Seed-picked speakers were half women, and the seed's babble pitch
 * pushed many up to +220 cents, which (pitched by resampling) is what made the
 * rider sound robotic. RIDER_SPEAKER was picked by rendering all 904 speakers
 * and pitch-tracking the callout bank: a male read with a clean, unbroken pitch
 * contour and a lively range (median F0 ~91 Hz calm, ~101 Hz shouting). No
 * pitch shift (a deeper speaker beats resampling down: that's slow and muddy),
 * Piper's own expressive noise defaults (lower
 * noise_scale / noise_w is what sounds flat and robotic), natural pace, and a
 * real beat between a callout's sentences ("Who's the goat? ... Me.").
 */
export const RIDER_SPEAKER = 479; // LibriTTS-R speaker "8875"
export const RIDER_VOICE: TtsVoice = {
  speaker: RIDER_SPEAKER,
  pitch: 0,
  rate: 1,
  noise: 0.667,
  noiseW: 0.8,
  unison: 0,
  echo: 0,
  gap: 0.6,
};

/**
 * A player's own trained model (Voice Booth): single speaker (id ignored by
 * single-speaker models), their natural pitch, the rider's callout pace and
 * the rider's pause between sentences (same rules as RIDER_VOICE).
 */
export const MODEL_VOICE: TtsVoice = {
  ...RIDER_VOICE,
  speaker: 0,
  rate: 1.04,
};

/**
 * The house voice: the site owner's own trained Piper model (single speaker,
 * 22.05 kHz, en-us), hosted with the site. Every rider speaks with it, yours
 * and everyone else's, unless they recorded their lines or loaded their own
 * model in the Voice Booth; the LibriTTS-R speaker above is the fallback if
 * it can't load. Bump HOUSE_REV when the files are replaced (the TTS worker
 * caches by URL).
 */
const HOUSE_REV = 1;
export const HOUSE_MODEL_URL = `/world2/voices/house.onnx?v=${HOUSE_REV}`;
export const HOUSE_CONFIG_URL = `/world2/voices/house.onnx.json?v=${HOUSE_REV}`;
export const HOUSE_MODEL_BYTES = 63_516_051;
export const HOUSE_VOICE: TtsVoice = MODEL_VOICE;

/** The same voice, revved up (the rider shouting a callout). */
export function hyped(t: TtsVoice, k = 1.06): TtsVoice {
  return { ...t, rate: Math.round(clamp(t.rate * k, 0.8, 1.35) * 1000) / 1000 };
}

/** Playback rate the pitch shift implies. */
export const pitchFactor = (cents: number) => 2 ** (cents / 1200);

/** The gap to put in the synthesized clip so it's `t.gap` once pitch playback speeds it up. */
export const sentenceGap = (t: TtsVoice) => t.gap * pitchFactor(t.pitch);

/** Piper's inference scales for a voice: [noise_scale, length_scale, noise_w]. */
export function modelScales(t: TtsVoice): [number, number, number] {
  // Slow synthesis by the pitch factor: playback speeds it back up
  return [t.noise, pitchFactor(t.pitch) / t.rate, t.noiseW];
}

/** Cache key for one synthesized line. */
export function lineKey(text: string, t: TtsVoice): string {
  return `${t.speaker}|${t.pitch}|${t.rate}|${t.noise}|${t.noiseW}|${t.gap}|${text}`;
}

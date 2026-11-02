// ── NOUN TAXI chatter: when to talk, and with which voice (pure) ──────────
//
// gate()       talk, or hold: muted, the radio's on, an event line (a shout
//              from lines.ts) is being said, or nobody's in a cab.
// gapAfter()   the pause between two lines: a breath usually, a longer
//              silence now and then so it never feels like a podcast.
// voicePlan()  which voice the chatter uses. The house voice (the owner's
//              Piper model, 63.5 MB) loads on demand in a cab:
//                shared   real voices are on anyway (desktop): borrow the
//                         game's house engine, which stays loaded;
//                private  real voices are off (touch / auto): load our own
//                         copy for the ride and free it after (release());
//                none     voices off in settings, data saver, a slow link,
//                         a weak phone, or the house failed: the Noun's own
//                         babble / seed voice (VoiceBox decides).

import type { DeviceNet, VoiceModeLike } from '../../audio/voice/voicePrefs';

export type ChatGate = 'off' | 'talk' | 'muted' | 'radio' | 'event';

export interface GateIn {
  active: boolean;
  muted: boolean;
  radioOn: boolean;
  /** Seconds until the current event line is over (≤ 0: none). */
  eventLeft: number;
}

export function gate(s: GateIn): ChatGate {
  if (!s.active) return 'off';
  if (s.muted) return 'muted';
  if (s.radioOn) return 'radio';
  if (s.eventLeft > 0) return 'event';
  return 'talk';
}

/** The first line waits this long after someone gets in (their greeting goes first). */
export const FIRST_LINE_S = 2.2;
/** After the radio goes off / unmute / an event line: a beat, then talk again. */
export const RESUME_S = 1.1;
/** Longest wait for a line's synthesis before it's spoken anyway (VoiceBox babbles if it must). */
export const SYNTH_WAIT_S = 7;
/** Keep a private house engine this long after the last cab (hopping fares doesn't reload it). */
export const RELEASE_AFTER_S = 30;

/** Pause after a line of `dur` seconds (`r` in 0..1, the caller's random). */
export function gapAfter(dur: number, n: number, r: number): number {
  // every 6th-ish line, a proper silence (2.5..5 s); otherwise a breath
  if (n % 6 === 5) return 2.5 + r * 2.5;
  return 0.5 + Math.min(1.2, dur * 0.08) + r * 0.9;
}

/** Rough spoken length of a line (s), for babble and event lines we don't time. */
export function spokenSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const stops = (text.match(/[!.?]/g) ?? []).length;
  return 0.4 + words * 0.34 + stops * 0.3;
}

export type VoiceLoad = 'shared' | 'private' | 'none';

export interface VoicePlanIn {
  mode: VoiceModeLike;
  device: DeviceNet;
  /** render/deviceTier isWeakDevice. */
  weak: boolean;
  /** The game's real voices are on (settings + device): it keeps a house engine loaded. */
  realOn: boolean;
  /** The house model failed to load this session. */
  houseFailed: boolean;
}

export function voicePlan(i: VoicePlanIn): VoiceLoad {
  if (i.mode === 'off' || i.houseFailed) return 'none';
  if (i.realOn) return 'shared';
  if (i.mode === 'on') return 'private';
  // auto on a phone / tablet: a cab is worth a download, but not on a
  // metered link, a slow one or a phone that can't spare the memory
  if (i.weak || i.device.saveData) return 'none';
  if (i.device.effectiveType !== undefined && i.device.effectiveType !== '4g') return 'none';
  if (i.device.memory !== undefined && i.device.memory < 3) return 'none';
  return 'private';
}

/** What the HUD says about the voice. */
export type VoiceStatus = 'house' | 'loading' | 'fallback';

export function voiceStatus(load: VoiceLoad, houseReady: boolean): VoiceStatus {
  if (load === 'none') return 'fallback';
  return houseReady ? 'house' : 'loading';
}

// ── Mute (remembered) ──

export const MUTE_KEY = 'noun-taxi-chatter-muted';

export function readMuted(get: (k: string) => string | null): boolean {
  try {
    return get(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(set: (k: string, v: string) => void, muted: boolean) {
  try {
    set(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // private mode: this session only
  }
}

// ── The voice a speaker gets from the house model ──

/** Cents + pace from a seed: the cabbie a bit lower and slower, passengers all over. */
export function houseTuning(
  seed: readonly number[],
  role: 'cabbie' | 'passenger',
): { pitch: number; rate: number } {
  let h = 2166136261;
  for (const v of seed) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  const a = (h % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  return role === 'cabbie'
    ? { pitch: Math.round(-60 + a * 220), rate: Math.round((0.95 + b * 0.08) * 1000) / 1000 }
    : { pitch: Math.round(120 + a * 330), rate: Math.round((0.98 + b * 0.12) * 1000) / 1000 };
}

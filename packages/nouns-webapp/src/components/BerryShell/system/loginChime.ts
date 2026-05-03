/**
 * BerryOS login chime — three-note ascending ding using WebAudio.
 *
 * No audio assets, no dependencies. Just an `OscillatorNode` per note with a
 * shared `GainNode` envelope (attack 8ms / decay 220ms — short, percussive).
 *
 * Browsers gate audio behind a user gesture. The first call always succeeds
 * because the boot sequence is a synchronous-ish flow that follows the page
 * load. If the AudioContext is created in `suspended` state we attempt one
 * `resume()`; failure is swallowed so the chime is "best-effort".
 *
 * Respects a "reduce sound effects" preference stored under
 * `berry.reduceSound` (boolean string "true"/"false") — if that's truthy
 * the chime is a no-op. Default is OFF (sound is ON), per spec.
 */

declare global {
  interface Window {
    /** WebKit-prefixed legacy AudioContext used as a fallback. */
    webkitAudioContext?: typeof AudioContext;
  }
}

const REDUCE_KEY = 'berry.reduceSound';

function reduceSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(REDUCE_KEY) === 'true';
  } catch {
    return false;
  }
}

let cachedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (cachedCtx) return cachedCtx;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    cachedCtx = new Ctor();
    return cachedCtx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  startOffset: number;
  duration: number;
}

// A neat I-V-I-ish triad: C5 → G5 → C6. Brisk, two-thirds of a second total.
const NOTES: Note[] = [
  { freq: 523.25, startOffset: 0, duration: 0.22 },
  { freq: 783.99, startOffset: 0.18, duration: 0.22 },
  { freq: 1046.5, startOffset: 0.36, duration: 0.36 },
];

function scheduleNote(ctx: AudioContext, note: Note, masterGain: GainNode, startAt: number): void {
  const osc = ctx.createOscillator();
  // Triangle = mellow, just enough warmth without sounding cheesy.
  osc.type = 'triangle';
  osc.frequency.value = note.freq;

  const gain = ctx.createGain();
  // ADSR envelope — fast attack, smooth release into silence.
  const t0 = startAt + note.startOffset;
  const peak = 0.16;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.linearRampToValueAtTime(peak * 0.6, t0 + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.duration);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(t0);
  osc.stop(t0 + note.duration + 0.05);
}

/**
 * Play the three-note login chime. Idempotent within ~1 second — repeated
 * calls inside that window are coalesced so the bus firing both
 * `system:bootComplete` and `system:unlocked` back-to-back doesn't double-up.
 */
let lastPlayedAt = 0;

export function playLoginChime(): void {
  if (reduceSoundEnabled()) return;
  if (typeof performance === 'undefined') return;

  const now = performance.now();
  if (now - lastPlayedAt < 1000) return;
  lastPlayedAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume if the browser left it suspended.
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const startAt = ctx.currentTime + 0.02;
  NOTES.forEach(n => scheduleNote(ctx, n, master, startAt));
}

/**
 * Convenience for the settings UI later — not used directly by the boot flow.
 */
export function setReduceSound(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REDUCE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function isReduceSoundEnabled(): boolean {
  return reduceSoundEnabled();
}

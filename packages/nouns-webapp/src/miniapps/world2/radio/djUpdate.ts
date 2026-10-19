// ── NOUN FM's DJ update (client) ─────────────────────────────────────────
//
// Twice a day a Netlify scheduled function (netlify/functions/
// fm-dj-update.ts) reads the last 24 h of Nouns activity straight from
// chain and writes a ~10 s on-air update in the DJ's voice. GET
// /.netlify/functions/fm-dj returns the latest:
//   { script, alert, audioUrl?, at }
// `audioUrl` is a server-rendered mp3 when a TTS key is configured;
// otherwise the browser speaks the script (speechSynthesis), or, with no
// speech at all, the talkbox says the call sign under the subtitles.

import { speakable } from './djScript';

export const DJ_URL = '/.netlify/functions/fm-dj';

export interface DjUpdate {
  /** The ~10 s update (25–35 words). */
  script: string;
  /** One urgent line for WORLDWIDE ALERT breaks. */
  alert: string;
  /** Server-rendered voice (same-origin mp3), if any. */
  audioUrl: string | null;
  /** When it was generated (ms). */
  at: number;
}

export function parseDjUpdate(v: unknown): DjUpdate | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.script !== 'string' || d.script.trim() === '') return null;
  const audio = typeof d.audioUrl === 'string' && d.audioUrl.startsWith('/') ? d.audioUrl : null;
  return {
    script: d.script.slice(0, 400),
    alert: typeof d.alert === 'string' ? d.alert.slice(0, 200) : '',
    audioUrl: audio !== null ? audio.slice(0, 300) : null,
    at: Number(d.at) || 0,
  };
}

let cache: { at: number; p: Promise<DjUpdate | null> } | null = null;

/** The latest update (cached for `maxAgeMs`; null when the endpoint is down). */
export function getDjUpdate(maxAgeMs = 10 * 60_000): Promise<DjUpdate | null> {
  const now = Date.now();
  if (cache !== null && now - cache.at < maxAgeMs) return cache.p;
  const p = fetch(DJ_URL, { headers: { accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null))
    .then(parseDjUpdate)
    .catch(() => null);
  cache = { at: now, p };
  return p;
}

/** Best voice for a radio DJ: English, a known "male"/deeper voice first. */
export function pickDjVoice(voices: { name: string; lang: string }[]): number {
  const en = voices.map((v, i) => ({ v, i })).filter(x => /^en[_-]/i.test(x.v.lang));
  // a human-sounding woman: the neural / enhanced voices first, then the
  // best stock female voice each platform ships
  const female =
    /aria|jenny|sonia|libby|natasha|ava|samantha|serena|kate|moira|tessa|karen|victoria|allison|susan|zira|female/i;
  const natural = /natural|neural|premium|enhanced|online/i;
  const prefs: ((name: string) => boolean)[] = [
    n => natural.test(n) && female.test(n),
    n => /google uk english female/i.test(n),
    n => /google us english/i.test(n),
    n => female.test(n) && !/\bmale\b/i.test(n),
  ];
  for (const ok of prefs) {
    const hit = en.find(x => ok(x.v.name));
    if (hit !== undefined) return hit.i;
  }
  return en[0]?.i ?? -1;
}

/** Can this browser speak at all? */
export function canSpeak(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.speechSynthesis !== undefined &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

/**
 * Speak `text` in the DJ's voice; resolves when it's done (or after a
 * timeout, browsers sometimes never fire `end`). False when there's no speech.
 */
export function speakDj(
  text: string,
  opts: { volume: number; urgent?: boolean; signal?: { cancelled: boolean } },
): Promise<boolean> {
  if (!canSpeak()) return Promise.resolve(false);
  const ss = window.speechSynthesis;
  return new Promise(resolve => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(ok);
    };
    const words = text.split(/\s+/).length;
    const timer = setTimeout(() => finish(true), (words / 2.4) * 1000 + 4000);
    const poll = setInterval(() => {
      if (opts.signal?.cancelled === true) {
        ss.cancel();
        finish(true);
      }
    }, 100);
    try {
      const u = new SpeechSynthesisUtterance(speakable(text));
      const voices = ss.getVoices();
      const i = pickDjVoice(voices);
      if (i >= 0) u.voice = voices[i]!;
      u.lang = u.voice?.lang ?? 'en-US';
      // natural pitch (bending it is what makes browser voices sound robotic);
      // urgent: a touch quicker
      u.rate = opts.urgent === true ? 1.08 : 1;
      u.pitch = 1;
      u.volume = Math.max(0, Math.min(1, opts.volume));
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      ss.cancel();
      ss.speak(u);
    } catch {
      finish(false);
    }
  });
}

// ── NOUN TAXI chatter: the optional LLM line source (pure) ────────────────
//
// Off by default, on two sides:
//   server  netlify/functions/taxi-chatter.ts answers only when TAXI_LLM=1,
//           ANTHROPIC_API_KEY and TAXI_LLM_MODEL are set (the key never
//           leaves the server); otherwise 404 { off: true };
//   client  asks only with `?chatllm=1` or localStorage noun-taxi-llm = 1
//           (llmWanted), and stops for the session on a 404.
// Whatever comes back goes through cleanLines (length, no links, no
// repeats); the grammar generator is the fallback for every line it can't
// supply. Tests never make a network call.

import type { Persona, Role } from './bank';
import type { Tod } from './generator';

import { LINE_MAX, LINE_MIN } from './generator';
import { lineKey } from './grammar';

export const LLM_BATCH = 6;
export const LLM_PATH = '/.netlify/functions/taxi-chatter';
export const LLM_FLAG_KEY = 'noun-taxi-llm';

export interface LlmAsk {
  role: Role;
  persona: Persona;
  name: string;
  dest: string | null;
  tod: Tod;
  /** Places they might mention (spoken names, at most 16). */
  places: string[];
  /** Their last few lines, so the batch follows on. */
  recent: string[];
}

export const LLM_SYSTEM = `You write in-character dialogue for a taxi ride in Noun World, a cartoon city game where everyone is a Noun: a blocky character wearing square "noggles" glasses, with an everyday object for a head. Tone: deadpan, warm, a bit unhinged, never mean. Keep it clean (no swearing, no sex, no politics, no real people or brands).
You get the speaker as JSON. Reply with JSON only: {"lines":["...", ...]} with ${LLM_BATCH} lines, each one to three short spoken sentences (under 200 characters), one continuous monologue that follows on from "recent". The speaker is a cabbie talking to their passenger, or a passenger talking to the driver. Mention the places given now and then, the time of day, small stories about invented friends and family (always "they" for them). Plain text, no emoji, no stage directions, no quotation marks around lines.`;

export function llmPrompt(a: LlmAsk): string {
  return JSON.stringify({
    speaker: { role: a.role, persona: a.persona, name: a.name },
    goingTo: a.dest,
    timeOfDay: a.tod,
    places: a.places.slice(0, 16),
    recent: a.recent.slice(-6),
  });
}

/** Parse the model's reply (JSON, maybe fenced) into raw lines. */
export function parseLlmLines(reply: string): string[] {
  const m = /{[\S\s]*}/.exec(reply);
  if (m === null) return [];
  try {
    const v = JSON.parse(m[0]) as { lines?: unknown };
    return Array.isArray(v.lines) ? v.lines.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Keep lines fit to say: trimmed, bounded, no links / markup, none said before. */
export function cleanLines(lines: readonly string[], said: (text: string) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const t = raw
      .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length < LINE_MIN || t.length > LINE_MAX) continue;
    if (/https?:|www\.|[<>{}[\]*_#`]|\p{Extended_Pictographic}/u.test(t)) continue;
    const k = lineKey(t);
    if (k === '' || seen.has(k) || said(t)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Validate a request body on the server (anything off → null). */
export function parseAsk(body: unknown): LlmAsk | null {
  const b = body as Partial<LlmAsk> | null;
  if (b === null || typeof b !== 'object') return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const role = b.role === 'cabbie' ? 'cabbie' : b.role === 'passenger' ? 'passenger' : null;
  if (role === null) return null;
  const tods: Tod[] = ['afternoon', 'golden', 'blue', 'night'];
  const personas: Persona[] = ['chatty', 'nervous', 'hype', 'philosopher', 'grump', 'schemer'];
  return {
    role,
    persona: personas.includes(b.persona as Persona) ? (b.persona as Persona) : 'chatty',
    name: str(b.name, 32) || 'Noun',
    dest: typeof b.dest === 'string' ? b.dest.slice(0, 48) : null,
    tod: tods.includes(b.tod as Tod) ? (b.tod as Tod) : 'afternoon',
    places: Array.isArray(b.places) ? b.places.slice(0, 16).map(p => str(p, 40)) : [],
    recent: Array.isArray(b.recent) ? b.recent.slice(-6).map(p => str(p, 240)) : [],
  };
}

/** Client flag: `?chatllm=1`, or localStorage noun-taxi-llm = 1. */
export function llmWanted(search: string, stored: string | null): boolean {
  return /[&?]chatllm=1\b/.test(search) || stored === '1';
}

// ── Respect ↔ netlify/functions/world-respect ─────────────────────────────
//
// The server keeps the authoritative score per rider (the private browser id
// world-stats and world-trade use). The client sends what happened, never a
// score: batches of { id, at, e } (event nonce, when, the RespectEvent). The
// function re-scores each one with the same rules (respect/rules.ts) and its
// own rate limits, and answers with its book; the client adopts that score
// (plus whatever it has queued since). See the function for what it trusts.

import type { RespectEvent, RespectTier } from '../interiors/contract';

export const RESPECT_URL = '/.netlify/functions/world-respect';
/** Most events per POST (the function refuses more). */
export const BATCH_MAX = 20;

export interface PendingEvent {
  /** Client nonce: a retried batch isn't counted twice. */
  id: string;
  /** When it happened (client clock, ms). */
  at: number;
  e: RespectEvent;
  /** What the client scored it (for reconciling with the server). */
  d: number;
}

export interface ServerBook {
  score: number;
  tier: RespectTier;
  at: number;
  /** False when the server has never seen this rider. */
  known: boolean;
}

export interface RespectSyncPort {
  load(): Promise<ServerBook | null>;
  /**
   * Send a batch. `book` is the server's answer; null with `retry` when it
   * didn't get through (kept and resent), null without when the server read
   * it and refused it (dropped).
   */
  post(batch: PendingEvent[]): Promise<{ book: ServerBook | null; retry: boolean }>;
}

function parseServer(v: unknown): ServerBook | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.ok !== true || typeof o.score !== 'number' || typeof o.tier !== 'string') return null;
  return {
    score: o.score,
    tier: o.tier as RespectTier,
    at: typeof o.at === 'number' ? o.at : Date.now(),
    known: o.known !== false,
  };
}

/** The real thing, over fetch. Any failure (offline, vite dev with no functions) → null. */
export function httpSync(rider: string, url = RESPECT_URL): RespectSyncPort {
  return {
    async load() {
      try {
        const r = await fetch(`${url}?rider=${encodeURIComponent(rider)}`);
        if (!r.ok) return null;
        return parseServer(await r.json());
      } catch {
        return null;
      }
    },
    async post(batch) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rider, events: batch.map(({ id, at, e }) => ({ id, at, e })) }),
        });
        // 4xx: the server read it and said no; don't resend it forever
        if (r.status >= 400 && r.status < 500 && r.status !== 429)
          return { book: null, retry: false };
        if (!r.ok) return { book: null, retry: true };
        const book = parseServer(await r.json());
        return { book, retry: book === null };
      } catch {
        return { book: null, retry: true };
      }
    },
  };
}

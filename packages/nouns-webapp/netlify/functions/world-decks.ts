import { createHash } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';
import { verifyMessage } from 'viem';

import {
  DECK_SLOTS,
  MAX_DESIGN_BYTES,
  deckMessage,
  validateDesign,
  type DeckSlot,
} from '../../src/miniapps/world2/character/deckSchema';

// Noun World custom decks (the Noun Jersey board shop), saved to a wallet.
//
// GET  ?address=0x…            → { address, slots: (DeckSlot | null)[3] }
// GET  ?addresses=0x…,0x…      → { decks: { [address]: (DeckSlot | null)[3] } }
//                                 (≤ 50, addresses with nothing saved left out)
// POST { address, slot, design, message, signature }
//      design    the design as a JSON string (what was hashed)
//      message   "Noun World deck · <address> · <sha256(design)> · <ms timestamp>"
//      signature personal_sign of message by address
//                → { ok: true, slot, at }
//
// One blob per lowercase address holding three slots. A signature is only
// good for 10 minutes and only once: each save must be newer than the last.

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

interface DeckDoc {
  address: string;
  slots: (DeckSlot | null)[];
  /** Timestamp of the newest signed save (replay guard). */
  lastTs: number;
}

const MAX_BATCH = 50;
const MAX_AGE_MS = 10 * 60_000;
const MAX_SKEW_MS = 2 * 60_000;
const ADDR_RE = /^0x[\da-f]{40}$/;
const MSG_RE = /^Noun World deck · (0x[\da-f]{40}) · ([\da-f]{64}) · (\d{13})$/;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown): HandlerResponse => ({
  statusCode: status,
  headers,
  body: JSON.stringify(body),
});

const deckKey = (address: string) => `deck/${address}`;

const emptySlots = (): (DeckSlot | null)[] => Array.from({ length: DECK_SLOTS }, () => null);

// node:crypto rather than WebCrypto: the global isn't there on every Lambda Node
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-world-decks');

  if (method === 'GET') {
    const q = event.queryStringParameters ?? {};
    if (q.addresses !== undefined) {
      const want = [
        ...new Set(
          q.addresses
            .split(',')
            .map(a => a.trim().toLowerCase())
            .filter(a => ADDR_RE.test(a)),
        ),
      ];
      if (want.length > MAX_BATCH) return json(400, { error: `At most ${MAX_BATCH} addresses` });
      const decks: Record<string, (DeckSlot | null)[]> = {};
      await Promise.all(
        want.map(async a => {
          const doc = (await store.get(deckKey(a), { type: 'json' })) as DeckDoc | null;
          if (doc !== null) decks[a] = doc.slots;
        }),
      );
      return json(200, { decks });
    }
    const address = (q.address ?? '').trim().toLowerCase();
    if (!ADDR_RE.test(address)) return json(400, { error: 'Bad address' });
    const doc = (await store.get(deckKey(address), { type: 'json' })) as DeckDoc | null;
    return json(200, { address, slots: doc?.slots ?? emptySlots() });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  if ((event.body ?? '').length > MAX_DESIGN_BYTES * 2 + 2000)
    return json(413, { error: 'Too big' });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const address = String(input.address ?? '').toLowerCase();
  const slot = input.slot;
  const designJson = input.design;
  const message = String(input.message ?? '');
  const signature = String(input.signature ?? '');
  if (!ADDR_RE.test(address)) return json(400, { error: 'Bad address' });
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= DECK_SLOTS)
    return json(400, { error: 'Bad slot' });
  if (typeof designJson !== 'string' || designJson.length > MAX_DESIGN_BYTES)
    return json(400, { error: 'Bad design' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(designJson);
  } catch {
    return json(400, { error: 'Bad design' });
  }
  const valid = validateDesign(parsed);
  if (!valid.ok) return json(400, { error: `Bad design: ${valid.error}` });

  // The signed message binds this address, this exact design and a time
  const m = MSG_RE.exec(message);
  if (m === null || m[1] !== address) return json(400, { error: 'Bad message' });
  if (m[2] !== sha256Hex(designJson)) return json(400, { error: 'Design hash mismatch' });
  const ts = Number(m[3]);
  const now = Date.now();
  if (now - ts > MAX_AGE_MS) return json(401, { error: 'Signature expired' });
  if (ts - now > MAX_SKEW_MS) return json(401, { error: 'Timestamp in the future' });
  if (message !== deckMessage(address, m[2], ts)) return json(400, { error: 'Bad message' });
  let ok = false;
  try {
    ok = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    ok = false;
  }
  if (!ok) return json(401, { error: 'Bad signature' });

  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.getWithMetadata(deckKey(address), { type: 'json' });
    const prev = (cur?.data as DeckDoc | null) ?? null;
    if (prev !== null && ts <= prev.lastTs) return json(409, { error: 'Signature already used' });
    const slots = prev?.slots.slice(0, DECK_SLOTS) ?? emptySlots();
    while (slots.length < DECK_SLOTS) slots.push(null);
    slots[slot] = { d: valid.design, at: ts };
    const doc: DeckDoc = { address, slots, lastTs: ts };
    const res =
      typeof cur?.etag === 'string'
        ? await store.setJSON(deckKey(address), doc, { onlyIfMatch: cur.etag })
        : await store.setJSON(deckKey(address), doc, { onlyIfNew: true });
    if (res.modified) return json(200, { ok: true, slot, at: ts });
  }
  return json(409, { error: 'Busy, try again' });
}

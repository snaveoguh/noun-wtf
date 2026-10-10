import { connectLambda, getStore } from '@netlify/blobs';

// Noun World's fastest-of-all-time board. It used to ride the PartyKit
// room's leaderboard, but the deployed party server drops it whenever the
// room goes idle, so records vanished. Blobs keep it for good.
//
// GET  → { entries: [{ name, kmh, downM, at }] } fastest first, one per rider
// POST { rider, name, kmh, downM } → the updated board (only a personal best
//      moves it). `rider` is a random per-browser id, so the many riders
//      who keep the default name don't share one row; it's never sent back.

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  rawUrl?: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

interface Entry {
  rider: string;
  name: string;
  kmh: number;
  downM: number;
  at: number;
}

const STORE_NAME = 'noun-world-fastest';
const KEY = 'board';
const MAX_ENTRIES = 500;
const MIN_KMH = 40;
// The mountain has no speed cap, but nothing real gets near this
const MAX_KMH = 2000;

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

function sorted(entries: Entry[]) {
  return entries.sort((a, b) => b.kmh - a.kmh).slice(0, MAX_ENTRIES);
}

/** What readers see: no rider ids. */
const pub = (entries: Entry[]) => entries.map(({ name, kmh, downM, at }) => ({ name, kmh, downM, at }));

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore(STORE_NAME);

  if (method === 'GET') {
    const board = ((await store.get(KEY, { type: 'json' })) as Entry[] | null) ?? [];
    return json(200, { entries: pub(sorted(board)) });
  }

  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  let input: { rider?: unknown; name?: unknown; kmh?: unknown; downM?: unknown };
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const name = String(input.name ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 42);
  const kmh = Math.round(Number(input.kmh) * 10) / 10;
  const downM = Math.max(0, Math.round(Number(input.downM) || 0));
  const rider = String(input.rider ?? '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 64);
  if (!name || !rider) return json(400, { error: 'Missing name or rider' });
  if (!Number.isFinite(kmh) || kmh < MIN_KMH || kmh > MAX_KMH) {
    return json(400, { error: 'Speed out of range' });
  }

  // Read-modify-write guarded by the blob's etag, so two riders posting at
  // once can't overwrite each other's record
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getWithMetadata(KEY, { type: 'json' });
    const board = ((current?.data as Entry[] | null) ?? []).slice();
    const mine = board.findIndex(e => e.rider === rider);
    if (mine >= 0 && board[mine]!.kmh >= kmh) return json(200, { entries: pub(sorted(board)) });
    const entry: Entry = { rider, name, kmh, downM, at: Date.now() };
    if (mine >= 0) board[mine] = entry;
    else board.push(entry);
    const next = sorted(board);
    const res = current?.etag
      ? await store.setJSON(KEY, next, { onlyIfMatch: current.etag })
      : await store.setJSON(KEY, next, { onlyIfNew: true });
    if (res.modified) return json(200, { entries: pub(next) });
  }
  return json(409, { error: 'Busy, try again' });
}

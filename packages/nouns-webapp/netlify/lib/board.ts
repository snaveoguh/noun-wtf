import { connectLambda, getStore } from '@netlify/blobs';

// Shared all-time leaderboard for Noun World (speed, best combo, ...),
// stored in Netlify Blobs. One row per rider: `rider` is a random
// per-browser id so the many riders on the default name don't share a row,
// and it's never sent back to readers.
//
// GET  → { entries } best first
// POST { rider, name, ...fields } → the updated board (only a personal best
//      moves it)

export interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  rawUrl?: string;
}

export interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

export interface BoardSpec<F extends Record<string, unknown>> {
  store: string;
  /** Validate the posted fields; a string is the 400 error message. */
  parse: (input: Record<string, unknown>) => F | string;
  /** The number the board ranks by, higher is better. */
  score: (fields: F) => number;
  max?: number;
}

type Row<F> = F & { rider: string; name: string; at: number };

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

const KEY = 'board';

export async function boardHandler<F extends Record<string, unknown>>(
  event: HandlerEvent,
  spec: BoardSpec<F>,
): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore(spec.store);
  const max = spec.max ?? 500;
  const sorted = (rows: Row<F>[]) =>
    rows.sort((a, b) => spec.score(b) - spec.score(a)).slice(0, max);
  const pub = (rows: Row<F>[]) => rows.map(({ rider: _rider, ...rest }) => rest);

  if (method === 'GET') {
    const board = ((await store.get(KEY, { type: 'json' })) as Row<F>[] | null) ?? [];
    return json(200, { entries: pub(sorted(board)) });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const name = String(input.name ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 42);
  const rider = String(input.rider ?? '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 64);
  if (!name || !rider) return json(400, { error: 'Missing name or rider' });
  const fields = spec.parse(input);
  if (typeof fields === 'string') return json(400, { error: fields });

  // Read-modify-write guarded by the blob's etag, so two riders posting at
  // once can't overwrite each other's record
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getWithMetadata(KEY, { type: 'json' });
    const board = ((current?.data as Row<F>[] | null) ?? []).slice();
    const mine = board.findIndex(e => e.rider === rider);
    if (mine >= 0 && spec.score(board[mine]!) >= spec.score(fields)) {
      return json(200, { entries: pub(sorted(board)) });
    }
    const row = { ...fields, rider, name, at: Date.now() } as Row<F>;
    if (mine >= 0) board[mine] = row;
    else board.push(row);
    const next = sorted(board);
    const res = current?.etag
      ? await store.setJSON(KEY, next, { onlyIfMatch: current.etag })
      : await store.setJSON(KEY, next, { onlyIfNew: true });
    if (res.modified) return json(200, { entries: pub(next) });
  }
  return json(409, { error: 'Busy, try again' });
}

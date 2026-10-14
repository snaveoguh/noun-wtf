// ── Noun World record appeals ──
//
// A rider whose record was refused can appeal it: the claim, the ride trace
// that set it and the server's reason are kept for an admin to replay and
// approve (the record is written to the rider's row) or reject (with a note
// the rider sees). Stored in the world-stats blob store:
//
//   appeals              AppealMeta[] (open + the last closed ones, no traces)
//   appeal-trace/<id>    the ride trace (base64, the same `d` as a run proof)
//
// Bounded: one open appeal per rider per record (a new one replaces it),
// a cap on the trace size, on open appeals in total, and on closed history.
//
// Admin actions need WORLD_ADMIN_TOKEN (a Netlify env var) in the
// `X-World-Admin` header. With no token set, admin is off.

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export type AppealKey = 'kmh' | 'airM' | 'airS';
export const APPEAL_KEYS: readonly AppealKey[] = ['kmh', 'airM', 'airS'];
export type AppealStatus = 'pending' | 'approved' | 'rejected';

export interface AppealMeta {
  id: string;
  rider: string;
  name: string;
  key: AppealKey;
  value: number;
  /** Why the server refused the record (re-checked when the appeal was filed). */
  reason: string;
  at: number;
  status: AppealStatus;
  decidedAt?: number;
  /** The admin's note (a rejection's reason, shown to the rider). */
  note?: string;
  /** Trace size, chars. */
  chars: number;
}

/** Trace cap: a trimmed proof (the client sends ≤ 20k samples ≈ 640k chars). */
export const MAX_APPEAL_CHARS = 700_000;
/** Open appeals in total (new ones are refused until some are decided). */
export const MAX_OPEN_APPEALS = 100;
/** Closed appeals kept (their traces go with them). */
export const MAX_CLOSED_APPEALS = 200;

const MAX_VALUE: Record<AppealKey, number> = { kmh: 20_000, airM: 500, airS: 120 };

/** The subset of a Netlify Blobs store this module uses. */
export interface AppealStore {
  get(key: string, opts?: { type: 'json' | 'text' }): Promise<unknown>;
  getWithMetadata(
    key: string,
    opts: { type: 'json' },
  ): Promise<{ data: unknown; etag?: string } | null>;
  set(key: string, value: string): Promise<unknown>;
  setJSON(
    key: string,
    value: unknown,
    opts?: { onlyIfMatch?: string; onlyIfNew?: boolean },
  ): Promise<{ modified: boolean }>;
  delete(key: string): Promise<unknown>;
}

const traceKey = (id: string) => `appeal-trace/${id}`;

/** Check an appeal's fields; null + why if they don't hold up. */
export function validateAppeal(
  input: Record<string, unknown>,
):
  | { ok: true; key: AppealKey; value: number; d: string; clientReason: string }
  | { ok: false; error: string } {
  const key = input.key as AppealKey;
  if (!APPEAL_KEYS.includes(key)) return { ok: false, error: 'Bad record' };
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_VALUE[key])
    return { ok: false, error: 'Bad value' };
  const d = input.d;
  if (typeof d !== 'string' || d.length === 0)
    return { ok: false, error: 'An appeal needs its ride trace' };
  if (d.length > MAX_APPEAL_CHARS)
    return {
      ok: false,
      error: `Trace too big (${Math.round(d.length / 1000)}k chars, max ${MAX_APPEAL_CHARS / 1000}k)`,
    };
  const clientReason = String(input.reason ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 200);
  return { ok: true, key, value: Math.round(value * 100) / 100, d, clientReason };
}

async function readAll(store: AppealStore) {
  const cur = await store.getWithMetadata('appeals', { type: 'json' });
  const list = Array.isArray(cur?.data) ? (cur!.data as AppealMeta[]) : [];
  return { list: list.slice(), etag: cur?.etag };
}

async function writeAll(store: AppealStore, list: AppealMeta[], etag: string | undefined) {
  const res = etag
    ? await store.setJSON('appeals', list, { onlyIfMatch: etag })
    : await store.setJSON('appeals', list, { onlyIfNew: true });
  return res.modified;
}

/** Closed appeals beyond the cap go, oldest first, with their traces. */
function prune(list: AppealMeta[]): { keep: AppealMeta[]; gone: AppealMeta[] } {
  const closed = list
    .filter(a => a.status !== 'pending')
    .sort((a, b) => (b.decidedAt ?? b.at) - (a.decidedAt ?? a.at));
  const gone = closed.slice(MAX_CLOSED_APPEALS);
  const goneIds = new Set(gone.map(a => a.id));
  return { keep: list.filter(a => !goneIds.has(a.id)), gone };
}

/** File (or replace) a rider's open appeal for one record. */
export async function fileAppeal(
  store: AppealStore,
  a: { rider: string; name: string; key: AppealKey; value: number; reason: string; d: string },
  now = Date.now(),
): Promise<{ ok: true; appeal: AppealMeta } | { ok: false; status: number; error: string }> {
  const freshId = randomUUID();
  for (let attempt = 0; attempt < 6; attempt++) {
    const { list, etag } = await readAll(store);
    const open = list.filter(x => x.status === 'pending');
    const mine = open.find(x => x.rider === a.rider && x.key === a.key);
    if (mine === undefined && open.length >= MAX_OPEN_APPEALS)
      return { ok: false, status: 429, error: 'Too many appeals waiting, try again later' };
    const appeal: AppealMeta = {
      id: mine?.id ?? freshId,
      rider: a.rider,
      name: a.name,
      key: a.key,
      value: a.value,
      reason: a.reason,
      at: now,
      status: 'pending',
      chars: a.d.length,
    };
    const next = mine !== undefined ? list.map(x => (x === mine ? appeal : x)) : [...list, appeal];
    // Trace first: an index entry never points at a missing trace
    await store.set(traceKey(appeal.id), a.d);
    if (!(await writeAll(store, next, etag))) continue;
    return { ok: true, appeal };
  }
  return { ok: false, status: 409, error: 'Busy, try again' };
}

/** A rider's own appeals (newest first, no traces). */
export async function riderAppeals(store: AppealStore, rider: string): Promise<AppealMeta[]> {
  const { list } = await readAll(store);
  return list
    .filter(a => a.rider === rider)
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);
}

export async function listAppeals(store: AppealStore): Promise<AppealMeta[]> {
  const { list } = await readAll(store);
  // Open first (oldest waiting longest), then the latest decisions
  return list.sort(
    (a, b) =>
      Number(b.status === 'pending') - Number(a.status === 'pending') ||
      (a.status === 'pending' ? a.at - b.at : (b.decidedAt ?? 0) - (a.decidedAt ?? 0)),
  );
}

export async function appealTrace(store: AppealStore, id: string): Promise<string | null> {
  if (!/^[\da-f-]{36}$/.test(id)) return null;
  const d = await store.get(traceKey(id), { type: 'text' });
  return typeof d === 'string' ? d : null;
}

/**
 * Approve (the record goes on the rider's row through `apply`) or reject
 * (closed, with a note the rider sees).
 */
export async function decideAppeal(
  store: AppealStore,
  id: string,
  approve: boolean,
  note: string,
  apply: (a: AppealMeta) => Promise<boolean>,
  now = Date.now(),
): Promise<{ ok: true; appeal: AppealMeta } | { ok: false; status: number; error: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { list, etag } = await readAll(store);
    const a = list.find(x => x.id === id);
    if (a === undefined) return { ok: false, status: 404, error: 'No such appeal' };
    if (a.status !== 'pending') return { ok: false, status: 409, error: `Already ${a.status}` };
    if (approve && !(await apply(a))) return { ok: false, status: 409, error: 'Busy, try again' };
    const done: AppealMeta = {
      ...a,
      status: approve ? 'approved' : 'rejected',
      decidedAt: now,
      ...(note ? { note } : {}),
    };
    const { keep, gone } = prune(list.map(x => (x === a ? done : x)));
    if (!(await writeAll(store, keep, etag))) continue;
    for (const g of gone) await store.delete(traceKey(g.id)).catch(() => undefined);
    return { ok: true, appeal: done };
  }
  return { ok: false, status: 409, error: 'Busy, try again' };
}

/**
 * Is this request the admin? Constant-time against WORLD_ADMIN_TOKEN (at
 * least 16 characters; shorter or unset turns admin off).
 */
export function adminCheck(
  headers: Record<string, string | undefined> | undefined,
  token: string | undefined = process.env.WORLD_ADMIN_TOKEN,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!token || token.length < 16)
    return { ok: false, status: 503, error: 'Admin is off (set WORLD_ADMIN_TOKEN)' };
  const h = headers ?? {};
  const got = h['x-world-admin'] ?? h['X-World-Admin'] ?? '';
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!got || !timingSafeEqual(hash(got), hash(token)))
    return { ok: false, status: 401, error: 'Wrong admin token' };
  return { ok: true };
}

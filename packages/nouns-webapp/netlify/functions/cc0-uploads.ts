import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

import {
  checkFileBytes,
  concatBytes,
  MAX_PARTS,
  PART_BYTES,
  stripJpegMetadata,
  stripPngMetadata,
  validateUploadMeta,
  type Cc0Upload,
  type UploadMeta,
} from '../../src/pages/Cc0Library/uploadRules';
import { adminCheck } from '../lib/appeals';

// CC0 Library community uploads (the /cc0 page's SUBMIT A CC0 ASSET form).
// Anyone can upload a file they release under CC0; nothing is listed or
// served until an admin approves it. The files themselves are served by
// `cc0-file` (a streaming function, so 10 MB files fit).
//
// Files are sent in parts (≤ 3 MB raw each, base64 in JSON) because a
// Netlify function request is capped at 6 MB:
//
// GET                                    → { uploads: Cc0Upload[] }  approved + not hidden,
//                                           newest first
// POST { action: 'begin', title, creator, link?, tags, consent: true, name, bytes }
//                                        → { ok, id, token, parts, partBytes }  rate limited
//                                           per IP hash; consent must be literally true
// POST { action: 'part', id, token, n, data (base64) }  → { ok }
// POST { action: 'finish', id, token }   → { ok, id }  bytes checked (size, magic numbers,
//                                           SVG / glTF rules), JPEG / PNG metadata stripped,
//                                           then queued as pending
// POST { action: 'report', id, reason? } → { ok }  rate limited per IP hash
// POST { action: 'admin-pending' }       → { pending: Record[], reported: { upload, reports }[] }
// POST { action: 'admin-decide', id, approve?: boolean, hidden?: boolean }
//                                        → { ok }  approve publishes, approve:false deletes the
//                                           upload and its file, hidden hides / unhides an
//                                           approved one (hidden files are never served)
//      admin actions need X-World-Admin: WORLD_ADMIN_TOKEN (same check as world-stats);
//      admins can also fetch a pending file from cc0-file with that header.
//
// Storage (Netlify Blobs, store `cc0-uploads`):
//   u/<id>               the record (status uploading | pending | approved)
//   p/<id>/<n>           upload parts (base64) until `finish`
//   f/<id>               the file bytes
//   approved             Cc0Upload[]: the public list, rewritten on every admin decision
//   r/<id>/<rid>         a report { reason, ip (hash), at }
//   rl/<who>/<hour>/<n>  rate-limit slots

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

export type UploadStatus = 'uploading' | 'pending' | 'approved';

export interface UploadRecord extends UploadMeta {
  id: string;
  at: number;
  status: UploadStatus;
  hidden?: boolean;
  /** sha256 of the upload token (the token itself is only ever in the uploader's tab) */
  tokenHash: string;
  parts: number;
  /** Hashed submitter IP (for spotting floods), never the IP itself */
  ip: string | null;
  /** Metadata segments were removed from a JPEG / PNG */
  stripped?: boolean;
}

interface Report {
  reason: string;
  ip: string | null;
  at: number;
}

type Store = ReturnType<typeof getStore>;

export const CC0_STORE = 'cc0-uploads';
/** One base64 part plus the JSON around it. */
export const UP_MAX_BODY = Math.ceil((PART_BYTES * 4) / 3) + 4_000;
export const UP_PER_IP_HOUR = 6;
export const UP_REPORTS_PER_IP_HOUR = 10;
/** Pending + in-flight cap: past this new uploads wait until someone reviews */
export const UP_MAX_PENDING = 100;
export const UP_MAX_APPROVED = 2_000;
/** An upload has to finish within this long of `begin`. */
export const UP_FINISH_MS = 30 * 60_000;
const HOUR = 3600_000;
const ID_RE = /^[\da-f]{16}$/;
const TOKEN_RE = /^[\da-f]{32}$/;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-World-Admin',
};
const json = (status: number, body: unknown, cache = 'no-store'): HandlerResponse => ({
  statusCode: status,
  headers: { ...headers, 'Cache-Control': cache },
  body: JSON.stringify(body),
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function ipTag(h: Record<string, string> | undefined): string | null {
  const x = h ?? {};
  const ip =
    x['x-nf-client-connection-ip'] ?? x['client-ip'] ?? x['x-forwarded-for']?.split(',')[0] ?? '';
  return ip.trim() === '' ? null : sha(`cc0:${ip.trim()}`).slice(0, 16);
}

/** One slot blob per action (onlyIfNew is checked at the origin, unlike a counter). */
async function rateOk(store: Store, who: string, max: number, now: number): Promise<boolean> {
  const w = Math.floor(now / HOUR).toString(36);
  try {
    for (let n = 0; n < max; n++) {
      const r = await store.setJSON(`rl/${who}/${w}/${n}`, { at: now }, { onlyIfNew: true });
      if (r.modified) return true;
    }
    return false;
  } catch {
    return true;
  }
}

const isB64 = (s: string) => /^[\d+/A-Za-z]*={0,2}$/.test(s) && s.length % 4 === 0;

function tokenOk(rec: UploadRecord, token: unknown): boolean {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  const a = Buffer.from(sha(`cc0-token:${token}`));
  const b = Buffer.from(rec.tokenHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the public list shows of a record. */
export function publicUpload(r: UploadRecord): Cc0Upload {
  return {
    id: r.id,
    at: r.at,
    title: r.title,
    creator: r.creator,
    ...(r.link !== undefined ? { link: r.link } : {}),
    tags: r.tags,
    name: r.name,
    ext: r.ext,
    mime: r.mime,
    kind: r.kind,
    bytes: r.bytes,
  };
}

const getRecord = async (store: Store, id: string) =>
  (await store.get(`u/${id}`, { type: 'json' })) as UploadRecord | null;

async function deleteParts(store: Store, id: string) {
  const parts = await store.list({ prefix: `p/${id}/` });
  for (const b of parts.blobs) await store.delete(b.key);
}

async function deleteUpload(store: Store, id: string) {
  await deleteParts(store, id);
  await store.delete(`f/${id}`);
  await store.delete(`u/${id}`);
  const reports = await store.list({ prefix: `r/${id}/` });
  for (const b of reports.blobs) await store.delete(b.key);
}

async function readApproved(store: Store): Promise<Cc0Upload[]> {
  const v = (await store.get('approved', { type: 'json' })) as unknown;
  return Array.isArray(v) ? (v as Cc0Upload[]) : [];
}

/** Rewrite the public list with this record in (approved + visible) or out. */
async function syncApproved(store: Store, rec: UploadRecord | null, id: string) {
  const list = (await readApproved(store)).filter(u => u.id !== id);
  if (rec !== null && rec.status === 'approved' && rec.hidden !== true)
    list.push(publicUpload(rec));
  list.sort((a, b) => b.at - a.at);
  await store.setJSON('approved', list.slice(0, UP_MAX_APPROVED));
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore(CC0_STORE);
  const now = Date.now();

  if (method === 'GET') {
    return json(
      200,
      { uploads: await readApproved(store) },
      'public, max-age=60, stale-while-revalidate=300',
    );
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  const body = event.body ?? '';
  if (body.length > UP_MAX_BODY) return json(413, { error: 'that request is too big' });
  let input: Record<string, unknown>;
  try {
    const v = JSON.parse(body) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return json(400, { error: 'Bad JSON' });
    input = v as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const action = input.action;
  const ip = ipTag(event.headers);
  const id = typeof input.id === 'string' ? input.id : '';

  // ── Admin ──────────────────────────────────────────────────────────
  if (action === 'admin-pending' || action === 'admin-decide') {
    const auth = adminCheck(event.headers);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    if (action === 'admin-pending') {
      const keys = (await store.list({ prefix: 'u/' })).blobs.map(b => b.key);
      const recs = (
        await Promise.all(keys.map(k => store.get(k, { type: 'json' }) as Promise<unknown>))
      ).filter((r): r is UploadRecord => typeof r === 'object' && r !== null);
      // Sweep uploads that never finished
      for (const r of recs)
        if (r.status === 'uploading' && now - r.at > UP_FINISH_MS) await deleteUpload(store, r.id);
      const pending = recs.filter(r => r.status === 'pending').sort((a, b) => a.at - b.at);
      const byId = new Map<string, string[]>();
      for (const b of (await store.list({ prefix: 'r/' })).blobs) {
        const rid = b.key.split('/')[1] ?? '';
        byId.set(rid, [...(byId.get(rid) ?? []), b.key]);
      }
      const reported = (
        await Promise.all(
          [...byId].slice(0, 200).map(async ([rid, rkeys]) => ({
            upload: recs.find(r => r.id === rid) ?? null,
            reports: (
              await Promise.all(rkeys.slice(0, 50).map(k => store.get(k, { type: 'json' })))
            ).filter(Boolean) as Report[],
          })),
        )
      )
        .filter(x => x.upload !== null)
        .sort((a, b) => b.reports.length - a.reports.length);
      const strip = (r: UploadRecord): Omit<UploadRecord, 'tokenHash'> => {
        const rest: Partial<UploadRecord> = { ...r };
        delete rest.tokenHash;
        return rest as Omit<UploadRecord, 'tokenHash'>;
      };
      return json(200, {
        pending: pending.map(strip),
        reported: reported.map(x => ({ ...x, upload: strip(x.upload!) })),
      });
    }
    if (!ID_RE.test(id)) return json(400, { error: 'Bad id' });
    const rec = await getRecord(store, id);
    if (rec === null) return json(404, { error: 'No such upload' });
    if (rec.status === 'uploading') return json(409, { error: 'That upload never finished' });
    if (input.approve === false) {
      await deleteUpload(store, id);
      await syncApproved(store, null, id);
      return json(200, { ok: true, deleted: true });
    }
    if (input.approve === true) rec.status = 'approved';
    if (typeof input.hidden === 'boolean') {
      if (input.hidden) rec.hidden = true;
      else delete rec.hidden;
    }
    if (input.approve !== true && typeof input.hidden !== 'boolean')
      return json(400, { error: 'Say approve or hidden' });
    await store.setJSON(`u/${id}`, rec);
    // A decision clears the reports it answered
    for (const b of (await store.list({ prefix: `r/${id}/` })).blobs) await store.delete(b.key);
    await syncApproved(store, rec, id);
    return json(200, { ok: true, status: rec.status, hidden: rec.hidden === true });
  }

  // ── Report (anyone, approved uploads only) ─────────────────────────
  if (action === 'report') {
    if (!ID_RE.test(id)) return json(400, { error: 'Bad id' });
    const rec = await getRecord(store, id);
    if (rec === null || rec.status !== 'approved') return json(404, { error: 'No such upload' });
    if (!(await rateOk(store, `rep-${ip ?? 'anon'}`, UP_REPORTS_PER_IP_HOUR, now)))
      return json(429, { error: 'too many reports, try again in an hour' });
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
    const doc: Report = { reason, ip, at: now };
    await store.setJSON(`r/${id}/${randomBytes(8).toString('hex')}`, doc);
    return json(200, { ok: true });
  }

  // ── Upload: begin → part × n → finish ──────────────────────────────
  if (action === 'begin') {
    const v = validateUploadMeta(input);
    if (!v.ok) return json(400, { error: v.error });
    if (!(await rateOk(store, `up-${ip ?? 'anon'}`, UP_PER_IP_HOUR, now)))
      return json(429, { error: 'you have sent a few already, try again in an hour' });
    const queued = (await store.list({ prefix: 'u/' })).blobs.length;
    const approved = (await readApproved(store)).length;
    if (queued - approved >= UP_MAX_PENDING)
      return json(503, { error: 'the review queue is full right now, try again tomorrow' });
    const newId = randomBytes(8).toString('hex');
    const token = randomBytes(16).toString('hex');
    const parts = Math.ceil(v.value.bytes / PART_BYTES);
    const rec: UploadRecord = {
      ...v.value,
      id: newId,
      at: now,
      status: 'uploading',
      tokenHash: sha(`cc0-token:${token}`),
      parts,
      ip,
    };
    await store.setJSON(`u/${newId}`, rec);
    return json(200, { ok: true, id: newId, token, parts, partBytes: PART_BYTES });
  }

  if (action !== 'part' && action !== 'finish') return json(400, { error: 'Bad action' });
  if (!ID_RE.test(id)) return json(400, { error: 'Bad id' });
  const rec = await getRecord(store, id);
  if (rec === null || !tokenOk(rec, input.token)) return json(404, { error: 'No such upload' });
  if (rec.status !== 'uploading') return json(409, { error: 'That upload is already in' });
  if (now - rec.at > UP_FINISH_MS) {
    await deleteUpload(store, id);
    return json(410, { error: 'that upload took too long, start again' });
  }

  if (action === 'part') {
    const n = input.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= rec.parts || n >= MAX_PARTS)
      return json(400, { error: 'Bad part' });
    const data = typeof input.data === 'string' ? input.data : '';
    if (data === '' || !isB64(data)) return json(400, { error: 'Bad file data' });
    const raw =
      Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    const want = n === rec.parts - 1 ? rec.bytes - PART_BYTES * n : PART_BYTES;
    if (raw !== want) return json(400, { error: 'that part is the wrong size' });
    await store.set(`p/${id}/${n}`, data);
    return json(200, { ok: true });
  }

  // finish
  const chunks: Uint8Array[] = [];
  for (let n = 0; n < rec.parts; n++) {
    const d = (await store.get(`p/${id}/${n}`, { type: 'text' })) as string | null;
    if (d === null) return json(400, { error: `part ${n + 1} of ${rec.parts} is missing` });
    chunks.push(new Uint8Array(Buffer.from(d, 'base64')));
  }
  let bytes = concatBytes(chunks);
  if (bytes.length !== rec.bytes) return json(400, { error: 'the file arrived the wrong size' });
  const check = checkFileBytes(bytes, rec.ext);
  if (!check.ok) {
    await deleteUpload(store, id);
    return json(400, { error: check.error });
  }
  const before = bytes.length;
  if (rec.ext === 'jpg') bytes = stripJpegMetadata(bytes);
  if (rec.ext === 'png') bytes = stripPngMetadata(bytes);
  await store.set(
    `f/${id}`,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  await deleteParts(store, id);
  const done: UploadRecord = {
    ...rec,
    status: 'pending',
    bytes: bytes.length,
    ...(bytes.length !== before ? { stripped: true } : {}),
  };
  await store.setJSON(`u/${id}`, done);
  return json(200, { ok: true, id });
}

import { createHash, randomBytes } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

import {
  validateSubmission,
  type CommunityEntry,
  type Submission,
} from '../../src/components/NounOS/home/community';
import { adminCheck } from '../lib/appeals';

// Community submissions for the homescreen's Community row. Anyone can
// suggest a game / page / tool; nothing shows until an admin approves it.
//
// GET                                   → { entries: CommunityEntry[] }  approved only,
//                                          newest first
// POST { name, url, blurb, kind }        → { ok, id }  stored as pending. https links
//                                          only, lengths capped (see community.ts),
//                                          a few per IP-hash per hour
// POST { action: 'admin-pending' }       → { pending: Pending[] }
// POST { action: 'admin-decide', id, approve: boolean }
//                                        → { ok }  approve publishes, reject deletes
//      both admin actions need X-World-Admin: WORLD_ADMIN_TOKEN
//      (same check as world-stats).
//
// Storage (Netlify Blobs, store `community-submissions`):
//   p/<id>               pending submission
//   a/<id>               approved entry
//   rl/<ip>/<hour>/<n>   rate-limit slots

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

interface Pending extends Submission {
  id: string;
  at: number;
  /** Hashed submitter IP (for spotting floods), never the IP itself */
  ip: string | null;
}

type Store = ReturnType<typeof getStore>;

export const SUB_MAX_BODY = 2_000;
export const SUB_PER_IP_HOUR = 3;
/** Pending queue cap: past this new submissions wait until someone reviews */
export const SUB_MAX_PENDING = 200;
export const SUB_MAX_APPROVED = 120;
const HOUR = 3600_000;
const ID_RE = /^[\da-f]{16}$/;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-World-Admin',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown): HandlerResponse => ({
  statusCode: status,
  headers,
  body: JSON.stringify(body),
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function ipTag(h: Record<string, string> | undefined): string | null {
  const x = h ?? {};
  const ip =
    x['x-nf-client-connection-ip'] ?? x['client-ip'] ?? x['x-forwarded-for']?.split(',')[0] ?? '';
  return ip.trim() === '' ? null : sha(`community:${ip.trim()}`).slice(0, 16);
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

async function readAll<T>(store: Store, prefix: string, max: number): Promise<T[]> {
  const list = await store.list({ prefix });
  const keys = list.blobs.map(b => b.key).slice(0, max);
  const got = await Promise.all(keys.map(k => store.get(k, { type: 'json' }) as Promise<unknown>));
  return got.filter((v): v is T => typeof v === 'object' && v !== null);
}

function toEntry(v: unknown): CommunityEntry | null {
  const c = validateSubmission(v);
  const r = v as { id?: unknown; at?: unknown };
  if (!c.ok || typeof r.id !== 'string' || !ID_RE.test(r.id) || typeof r.at !== 'number')
    return null;
  return { ...c.value, id: r.id, at: r.at };
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('community-submissions');
  const now = Date.now();

  if (method === 'GET') {
    const raw = await readAll<unknown>(store, 'a/', SUB_MAX_APPROVED);
    const entries = raw
      .map(toEntry)
      .filter((e): e is CommunityEntry => e !== null)
      .sort((a, b) => b.at - a.at);
    return json(200, { entries });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  const body = event.body ?? '';
  if (body.length > SUB_MAX_BODY) return json(413, { error: 'that is too long' });
  let input: Record<string, unknown>;
  try {
    const v = JSON.parse(body) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return json(400, { error: 'Bad JSON' });
    input = v as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Bad JSON' });
  }

  if (input.action === 'admin-pending' || input.action === 'admin-decide') {
    const auth = adminCheck(event.headers);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    if (input.action === 'admin-pending') {
      const pending = (await readAll<Pending>(store, 'p/', SUB_MAX_PENDING)).sort(
        (a, b) => a.at - b.at,
      );
      return json(200, { pending });
    }
    const id = typeof input.id === 'string' ? input.id : '';
    if (!ID_RE.test(id)) return json(400, { error: 'Bad id' });
    const doc = (await store.get(`p/${id}`, { type: 'json' })) as Pending | null;
    if (doc === null) return json(404, { error: 'No such submission' });
    if (input.approve === true) {
      const entry = toEntry(doc);
      if (entry === null) return json(400, { error: 'That submission no longer passes the rules' });
      await store.setJSON(`a/${id}`, entry);
    }
    await store.delete(`p/${id}`);
    return json(200, { ok: true, approved: input.approve === true });
  }

  if (input.action !== undefined) return json(400, { error: 'Bad action' });

  const v = validateSubmission(input);
  if (!v.ok) return json(400, { error: v.error });
  const ip = ipTag(event.headers);
  if (!(await rateOk(store, ip ?? 'anon', SUB_PER_IP_HOUR, now)))
    return json(429, { error: 'you have sent a few already, try again in an hour' });
  const queued = await store.list({ prefix: 'p/' });
  if (queued.blobs.length >= SUB_MAX_PENDING)
    return json(503, { error: 'the review queue is full right now, try again tomorrow' });
  const id = randomBytes(8).toString('hex');
  const doc: Pending = { ...v.value, id, at: now, ip };
  await store.setJSON(`p/${id}`, doc);
  return json(200, { ok: true, id });
}

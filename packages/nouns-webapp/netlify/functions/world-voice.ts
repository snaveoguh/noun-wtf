import { createHash, randomBytes } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

import {
  CHAT_ID_RE,
  CHAT_TTL_MS,
  CLIP_MAX_BYTES,
  MAX_CLIPS,
  parseClipKey,
  playableClips,
  TAG_RE,
  validateClip,
  validateChatClip,
  validateClipBytes,
  type ClipMeta,
} from '../../src/miniapps/world2/audio/voice/booth/clips';
import { adminCheck } from '../lib/appeals';

// Noun World Voice Booth: players' own recordings of their rider's callout
// lines, so other players hear them in multiplayer. Live recordings only
// (the booth has no file upload), short, small, and moderated.
//
// Identity: the game's private per-browser rider id (net/Stats.ts riderId,
// the same key world-stats and Noun Trade use). It's a secret, so it's never
// shared: clips live under a public *tag* = sha256('voice:' + rider)[0..24],
// which is what the multiplayer pose blob carries (`vo`).
//
// GET  ?tag=<tag>                     → { tag, clips: { key: ClipMeta } }  visible clips only;
//                                       a hidden player answers an empty manifest
// GET  ?tag=<tag>&key=<key>&v=<ver>   → the audio bytes (base64 body), cached for a year
//                                       (the version is in the URL). Hidden → 404.
// POST { action: 'upload', rider, key, mime, t0, t1, gain, dur, data (base64) }
//                                     → { ok, tag, clip }  ≤ 64 KB, webm / mp4 / ogg (bytes
//                                       checked), ≤ 4 s, ≤ 40 clips per player, rate limited
//                                       per IP hash and per player
// POST { action: 'delete', rider, key? }  → { ok }  one clip, or all of them (no key)
// POST { action: 'mine', rider }      → { tag, clips }  own manifest (hidden flags included)
// POST { action: 'report', tag, key?, reason? } → { ok }  rate limited per IP hash
// POST { action: 'admin-reports' }    → { reported: [{ tag, reports, manifest }] }
// POST { action: 'admin-hide', tag, key?, hidden } → { ok }  a clip, or the whole player
// POST { action: 'admin-delete', tag, key? }       → { ok }  removes clips (+ their reports)
//
// Chat lines in a player's trained voice (ephemeral, see booth/clips.ts):
// POST { action: 'chat-upload', rider, mime, dur, text, data } → { ok, tag, id, exp }
//      ≤ 8 s, ≤ 64 KB, at most 1 per 5 s and 60 per hour per player; served for
//      10 minutes, then gone. The text is kept with the clip for moderators.
// GET  ?tag=<tag>&chat=<id>           → the audio (404 once expired or hidden)
// POST { action: 'report', tag, chat: id } reports one; admin-delete { tag, chat } removes it.
//      admin actions need X-World-Admin: WORLD_ADMIN_TOKEN (same check as world-stats).
//
// Storage (Netlify Blobs, store `world-voice`):
//   m/<tag>              manifest { tag, clips: { key: ClipMeta }, hidden?, at }
//   c/<tag>/<key>        { mime, data (base64) }
//   e/<tag>/<id>         ephemeral chat clip { mime, data, text, dur, at }
//   r/<tag>/<id>         a report { key, reason, ip (hash), at }
//   rl/<who>/<hour>/<n>  rate-limit slots

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  rawUrl?: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
  isBase64Encoded?: boolean;
}

interface Manifest {
  tag: string;
  clips: Record<string, ClipMeta>;
  hidden?: boolean;
  at: number;
}

interface Report {
  key: string | null;
  /** A reported chat clip (its id, and what it said). */
  chat?: string;
  text?: string;
  reason: string;
  ip: string | null;
  at: number;
}

interface ChatClip {
  mime: string;
  data: string;
  text: string;
  dur: number;
  at: number;
  hidden?: boolean;
}

type Store = ReturnType<typeof getStore>;

/** base64 of a 64 KB clip + the JSON around it. */
export const VOICE_MAX_BODY = Math.ceil((CLIP_MAX_BYTES * 4) / 3) + 2_000;
/** Uploads per IP hash per hour (a full re-record of every line, with retakes). */
export const VOICE_UPLOADS_PER_IP_HOUR = 90;
/** Uploads per player per hour. */
export const VOICE_UPLOADS_PER_TAG_HOUR = 60;
export const VOICE_REPORTS_PER_IP_HOUR = 10;
/** Chat clips per player per hour (and never more than one per 5 s). */
export const VOICE_CHAT_PER_HOUR = 60;
const CHAT_GAP_MS = 5_000;
const HOUR = 3600_000;
const RIDER_RE = /^[\w-]{8,64}$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-World-Admin',
};
const json = (status: number, body: unknown, cache = 'no-store'): HandlerResponse => ({
  statusCode: status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache },
  body: JSON.stringify(body),
});

/** Hashed client IP (rate limits, spotting floods), never the IP itself. */
export function ipTag(h: Record<string, string> | undefined): string | null {
  const x = h ?? {};
  const ip =
    x['x-nf-client-connection-ip'] ?? x['client-ip'] ?? x['x-forwarded-for']?.split(',')[0] ?? '';
  return ip.trim() === ''
    ? null
    : createHash('sha256').update(`voice-ip:${ip.trim()}`).digest('hex').slice(0, 16);
}

/** A rider's public voice tag (never reveals the rider id). */
export function voiceTag(rider: string): string {
  return createHash('sha256').update(`voice:${rider}`).digest('hex').slice(0, 24);
}

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

async function manifestOf(store: Store, tag: string): Promise<Manifest> {
  const m = (await store.get(`m/${tag}`, { type: 'json' })) as Manifest | null;
  return m !== null && typeof m === 'object' && m.clips !== undefined
    ? m
    : { tag, clips: {}, at: 0 };
}

/** What everyone else may see of a manifest. */
function publicManifest(m: Manifest) {
  return { tag: m.tag, clips: m.hidden === true ? {} : playableClips(m) };
}

const isB64 = (s: string) => /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0;

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('world-voice');
  const now = Date.now();

  if (method === 'GET') {
    const q = event.queryStringParameters ?? {};
    const tag = q.tag ?? '';
    if (!TAG_RE.test(tag)) return json(400, { error: 'Bad tag' });
    const m = await manifestOf(store, tag);
    if (q.chat !== undefined) {
      const id = q.chat;
      if (!CHAT_ID_RE.test(id)) return json(400, { error: 'Bad chat id' });
      const e = (await store.get(`e/${tag}/${id}`, { type: 'json' })) as ChatClip | null;
      if (e === null || m.hidden === true || e.hidden === true || now - e.at > CHAT_TTL_MS)
        return json(404, { error: 'No such clip' });
      return {
        statusCode: 200,
        headers: {
          ...cors,
          'Content-Type': e.mime,
          'Cache-Control': 'public, max-age=600',
          'X-Content-Type-Options': 'nosniff',
        },
        body: e.data,
        isBase64Encoded: true,
      };
    }
    if (q.key === undefined)
      return json(200, publicManifest(m), 'public, max-age=60, stale-while-revalidate=300');
    const key = q.key;
    if (parseClipKey(key) === null) return json(400, { error: 'Bad key' });
    const meta = publicManifest(m).clips[key];
    if (meta === undefined) return json(404, { error: 'No such clip' });
    const clip = (await store.get(`c/${tag}/${key}`, { type: 'json' })) as {
      mime: string;
      data: string;
    } | null;
    if (clip === null) return json(404, { error: 'No such clip' });
    // Only the version in the manifest is served, so a versioned URL never changes
    const fresh = q.v === String(meta.v);
    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': meta.mime,
        'Cache-Control': fresh ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
      body: clip.data,
      isBase64Encoded: true,
    };
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  const body = event.body ?? '';
  if (body.length > VOICE_MAX_BODY) return json(413, { error: 'clip too big (64 KB max)' });
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

  // ── Admin ──────────────────────────────────────────────────────────
  if (action === 'admin-reports' || action === 'admin-hide' || action === 'admin-delete') {
    const auth = adminCheck(event.headers);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    if (action === 'admin-reports') {
      const list = await store.list({ prefix: 'r/' });
      const byTag = new Map<string, string[]>();
      for (const b of list.blobs) {
        const tag = b.key.split('/')[1] ?? '';
        if (!TAG_RE.test(tag)) continue;
        byTag.set(tag, [...(byTag.get(tag) ?? []), b.key]);
      }
      const reported = await Promise.all(
        [...byTag].slice(0, 200).map(async ([tag, keys]) => ({
          tag,
          reports: (
            await Promise.all(keys.slice(0, 50).map(k => store.get(k, { type: 'json' })))
          ).filter(Boolean) as Report[],
          manifest: await manifestOf(store, tag),
        })),
      );
      reported.sort((a, b) => b.reports.length - a.reports.length);
      return json(200, { reported });
    }
    const tag = typeof input.tag === 'string' ? input.tag : '';
    if (!TAG_RE.test(tag)) return json(400, { error: 'Bad tag' });
    const key = input.key === undefined ? null : input.key;
    if (key !== null && parseClipKey(key) === null) return json(400, { error: 'Bad key' });
    const m = await manifestOf(store, tag);
    if (action === 'admin-hide') {
      const hidden = input.hidden !== false;
      if (key === null) m.hidden = hidden;
      else {
        const c = m.clips[key as string];
        if (c === undefined) return json(404, { error: 'No such clip' });
        c.hidden = hidden;
      }
      await store.setJSON(`m/${tag}`, m);
      return json(200, { ok: true });
    }
    // admin-delete
    if (typeof input.chat === 'string') {
      if (!CHAT_ID_RE.test(input.chat)) return json(400, { error: 'Bad chat id' });
      await store.delete(`e/${tag}/${input.chat}`);
      return json(200, { ok: true });
    }
    const keys = key === null ? Object.keys(m.clips) : [key as string];
    for (const k of keys) {
      await store.delete(`c/${tag}/${k}`);
      delete m.clips[k];
    }
    if (key === null) m.hidden = true; // a wiped player stays wiped until a moderator unhides
    await store.setJSON(`m/${tag}`, m);
    const reports = await store.list({ prefix: `r/${tag}/` });
    for (const r of reports.blobs) await store.delete(r.key);
    return json(200, { ok: true });
  }

  // ── Report (anyone, by public tag) ─────────────────────────────────
  if (action === 'report') {
    const tag = typeof input.tag === 'string' ? input.tag : '';
    if (!TAG_RE.test(tag)) return json(400, { error: 'Bad tag' });
    const key = input.key === undefined || input.key === null ? null : input.key;
    if (key !== null && parseClipKey(key) === null) return json(400, { error: 'Bad key' });
    const chat = typeof input.chat === 'string' ? input.chat : null;
    if (chat !== null && !CHAT_ID_RE.test(chat)) return json(400, { error: 'Bad chat id' });
    const reason = typeof input.reason === 'string' ? input.reason.slice(0, 200) : '';
    if (!(await rateOk(store, `rep-${ip ?? 'anon'}`, VOICE_REPORTS_PER_IP_HOUR, now)))
      return json(429, { error: 'too many reports, try again in an hour' });
    const id = randomBytes(8).toString('hex');
    const doc: Report = { key: key as string | null, reason, ip, at: now };
    if (chat !== null) {
      // Keep what was said: the clip itself expires before anyone reviews it
      const e = (await store.get(`e/${tag}/${chat}`, { type: 'json' })) as ChatClip | null;
      doc.chat = chat;
      if (e !== null) doc.text = e.text;
    }
    await store.setJSON(`r/${tag}/${id}`, doc);
    return json(200, { ok: true });
  }

  // ── The player's own clips (by private rider id) ───────────────────
  const rider = typeof input.rider === 'string' ? input.rider : '';
  if (!RIDER_RE.test(rider)) return json(400, { error: 'Bad rider' });
  const tag = voiceTag(rider);

  if (action === 'mine') {
    const m = await manifestOf(store, tag);
    return json(200, { tag, clips: m.clips, hidden: m.hidden === true });
  }

  if (action === 'delete') {
    const m = await manifestOf(store, tag);
    const key = input.key === undefined ? null : input.key;
    if (key !== null && parseClipKey(key) === null) return json(400, { error: 'Bad key' });
    const keys = key === null ? Object.keys(m.clips) : [key as string];
    for (const k of keys) {
      await store.delete(`c/${tag}/${k}`);
      delete m.clips[k];
    }
    m.at = now;
    await store.setJSON(`m/${tag}`, m);
    return json(200, { ok: true, tag });
  }

  if (action === 'chat-upload') {
    const c = validateChatClip(input);
    if (!c.ok) return json(400, { error: c.error });
    const data = typeof input.data === 'string' ? input.data : '';
    if (!isB64(data)) return json(400, { error: 'Bad audio data' });
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    const b = validateClipBytes(bytes, c.value.mime);
    if (!b.ok) return json(400, { error: b.error });
    const m = await manifestOf(store, tag);
    if (m.hidden === true) return json(403, { error: 'voice sharing is off for this player' });
    const slot = await store.setJSON(
      `rl/chat5-${tag}/${Math.floor(now / CHAT_GAP_MS).toString(36)}`,
      { at: now },
      { onlyIfNew: true },
    );
    if (!slot.modified) return json(429, { error: 'one voice line every 5 s' });
    if (!(await rateOk(store, `chat-${tag}`, VOICE_CHAT_PER_HOUR, now)))
      return json(429, { error: 'too many voice lines, try again in an hour' });
    // Sweep this player's expired clips
    const old = await store.list({ prefix: `e/${tag}/` });
    for (const o of old.blobs) {
      const e = (await store.get(o.key, { type: 'json' })) as ChatClip | null;
      if (e === null || now - e.at > CHAT_TTL_MS) await store.delete(o.key);
    }
    const id = randomBytes(8).toString('hex');
    const doc: ChatClip = {
      mime: c.value.mime,
      data,
      text: c.value.text,
      dur: c.value.dur,
      at: now,
    };
    await store.setJSON(`e/${tag}/${id}`, doc);
    return json(200, { ok: true, tag, id, exp: now + CHAT_TTL_MS });
  }

  if (action !== 'upload') return json(400, { error: 'Bad action' });

  const v = validateClip(input);
  if (!v.ok) return json(400, { error: v.error });
  const data = typeof input.data === 'string' ? input.data : '';
  if (!isB64(data)) return json(400, { error: 'Bad audio data' });
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  const b = validateClipBytes(bytes, v.value.mime);
  if (!b.ok) return json(400, { error: b.error });

  const m = await manifestOf(store, tag);
  if (m.hidden === true) return json(403, { error: 'voice sharing is off for this player' });
  const { key, ...shape } = v.value;
  if (m.clips[key] === undefined && Object.keys(m.clips).length >= MAX_CLIPS)
    return json(400, { error: `${MAX_CLIPS} clips at most` });
  if (!(await rateOk(store, `ip-${ip ?? 'anon'}`, VOICE_UPLOADS_PER_IP_HOUR, now)))
    return json(429, { error: 'too many uploads, try again in an hour' });
  if (!(await rateOk(store, `tag-${tag}`, VOICE_UPLOADS_PER_TAG_HOUR, now)))
    return json(429, { error: 'too many uploads, try again in an hour' });

  await store.setJSON(`c/${tag}/${key}`, { mime: shape.mime, data });
  // Re-recording a line a moderator hid keeps it hidden
  const clip: ClipMeta = {
    ...shape,
    bytes: bytes.length,
    v: now,
    ...(m.clips[key]?.hidden === true ? { hidden: true } : {}),
  };
  m.clips[key] = clip;
  m.at = now;
  await store.setJSON(`m/${tag}`, m);
  return json(200, { ok: true, tag, clip });
}

// ── Voice Booth ↔ the world-voice Netlify function ───────────────────────
//
// Uploads only ever happen after the player ticked the consent box (the
// booth's share section) or turned on "Let other players hear my voice".
// Everything here is a no-op while `voiceNet.enabled` is false (offline
// sessions, `?offline=1`, tests).

import { playableClips, TAG_RE, type ClipMeta } from './clips';

export const VOICE_URL = '/.netlify/functions/world-voice';
const TAG_KEY = 'noun-world-voice-tag';

export const voiceNet = {
  /** Talk to the server at all (Game turns it off for offline sessions). */
  enabled: !(typeof location !== 'undefined' && /[&?]offline=1/.test(location.search)),
};

/** This player's public voice tag, once the server has told us (null: never shared). */
export function myTag(): string | null {
  try {
    const t = localStorage.getItem(TAG_KEY);
    return t !== null && TAG_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

function saveTag(t: unknown) {
  if (typeof t !== 'string' || !TAG_RE.test(t)) return;
  try {
    localStorage.setItem(TAG_KEY, t);
  } catch {
    // private mode: re-learned on the next upload
  }
}

/** A Blob → base64 (no data: prefix). */
export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  if (!voiceNet.enabled) throw new Error('offline');
  const r = await fetch(VOICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `voice server ${r.status}`);
  return j;
}

export interface ClipUpload {
  key: string;
  blob: Blob;
  mime: string;
  t0: number;
  t1: number;
  gain: number;
  dur: number;
}

export async function uploadClip(rider: string, c: ClipUpload): Promise<ClipMeta> {
  const r = await post<{ tag: string; clip: ClipMeta }>({
    action: 'upload',
    rider,
    key: c.key,
    mime: c.mime,
    t0: c.t0,
    t1: c.t1,
    gain: c.gain,
    dur: c.dur,
    data: await blobToBase64(c.blob),
  });
  saveTag(r.tag);
  return r.clip;
}

/** Remove one shared clip, or all of them (no key). */
export async function deleteShared(rider: string, key?: string): Promise<void> {
  const r = await post<{ tag: string }>({ action: 'delete', rider, ...(key ? { key } : {}) });
  saveTag(r.tag);
}

export async function uploadChat(
  rider: string,
  blob: Blob,
  mime: string,
  dur: number,
  text: string,
): Promise<{ tag: string; id: string }> {
  const r = await post<{ tag: string; id: string }>({
    action: 'chat-upload',
    rider,
    mime,
    dur,
    text,
    data: await blobToBase64(blob),
  });
  saveTag(r.tag);
  return r;
}

export async function report(
  tag: string,
  what: { key?: string; chat?: string; reason?: string } = {},
): Promise<void> {
  await post({ action: 'report', tag, ...what });
}

export const clipUrl = (tag: string, key: string, v: number) =>
  `${VOICE_URL}?tag=${tag}&key=${encodeURIComponent(key)}&v=${v}`;
export const chatUrl = (tag: string, id: string) => `${VOICE_URL}?tag=${tag}&chat=${id}`;

const manifests = new Map<string, { at: number; p: Promise<Record<string, ClipMeta>> }>();
const MANIFEST_TTL = 60_000;

/** Another player's visible clips (cached for a minute; {} on any failure). */
export function manifestOf(tag: string): Promise<Record<string, ClipMeta>> {
  if (!voiceNet.enabled || !TAG_RE.test(tag)) return Promise.resolve({});
  const hit = manifests.get(tag);
  const now = Date.now();
  if (hit !== undefined && now - hit.at < MANIFEST_TTL) return hit.p;
  const p = fetch(`${VOICE_URL}?tag=${tag}`)
    .then(r => (r.ok ? r.json() : {}))
    .then(playableClips)
    .catch(() => ({}));
  manifests.set(tag, { at: now, p });
  return p;
}

import { getStore } from '@netlify/blobs';

import { adminCheck } from '../lib/appeals';

import { CC0_STORE, type UploadRecord } from './cc0-uploads';

// Serves CC0 Library uploads: GET ?id=<id>[&dl=1]. Only approved, visible
// uploads (an admin with X-World-Admin can preview pending ones). A modern
// (streaming) function because a 10 MB file is over the 6 MB buffered
// response cap of the classic handler in cc0-uploads.
//
// Files never change under an id, so browsers cache them for a year; the
// CDN copy only lives 10 minutes so hiding an upload takes effect quickly.
// Range requests are honoured (Safari won't play audio without them).

const ID_RE = /^[\da-f]{16}$/;
const CHUNK = 256 * 1024;

const base = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  // An SVG opened directly is a document: no scripts, no outside loads
  'Content-Security-Policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
};

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { ...base, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });

function streamOf(b: Uint8Array): ReadableStream<Uint8Array> {
  let o = 0;
  return new ReadableStream({
    pull(c) {
      if (o >= b.length) {
        c.close();
        return;
      }
      c.enqueue(b.subarray(o, o + CHUNK));
      o += CHUNK;
    },
  });
}

/** `bytes=a-b` → [start, end] inclusive, or null if absent / unsatisfiable. */
export function parseRange(h: string | null, size: number): [number, number] | null | 'bad' {
  if (h === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (m === null || (m[1] === '' && m[2] === '')) return 'bad';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'bad' : [start, end];
}

export default async function cc0File(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: base });
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405, headers: base });
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) return notFound();

  const store = getStore(CC0_STORE);
  const rec = (await store.get(`u/${id}`, { type: 'json' })) as UploadRecord | null;
  if (rec === null || rec.status === 'uploading') return notFound();
  const h: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    h[k.toLowerCase()] = v;
  });
  const admin = rec.status !== 'approved' || rec.hidden === true;
  if (admin && !adminCheck(h).ok) return notFound();

  const buf = (await store.get(`f/${id}`, { type: 'arrayBuffer' })) as ArrayBuffer | null;
  if (buf === null) return notFound();
  const bytes = new Uint8Array(buf);
  const disp = url.searchParams.get('dl') === '1' ? 'attachment' : 'inline';
  const headers: Record<string, string> = {
    ...base,
    'Content-Type': rec.mime,
    'Content-Disposition': `${disp}; filename="${rec.name.replace(/"/g, '')}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': admin ? 'no-store' : 'public, max-age=31536000, immutable',
    ...(admin ? {} : { 'Netlify-CDN-Cache-Control': 'public, max-age=600' }),
  };
  const range = parseRange(req.headers.get('range'), bytes.length);
  if (range === 'bad')
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${bytes.length}` },
    });
  const [s, e] = range ?? [0, bytes.length - 1];
  const part = bytes.subarray(s, e + 1);
  headers['Content-Length'] = String(part.length);
  if (range !== null) headers['Content-Range'] = `bytes ${s}-${e}/${bytes.length}`;
  return new Response(req.method === 'HEAD' ? null : streamOf(part), {
    status: range !== null ? 206 : 200,
    headers,
  });
}

import { getStore } from '@netlify/blobs';

import { handleDjGet, viemReader, type DjStore } from '../lib/fmDj';

// GET /.netlify/functions/fm-dj        → { script, alert, at, audioUrl }
// GET /.netlify/functions/fm-dj?audio= → the rendered voice (audio/mpeg)
// The scheduled fm-dj-update.ts writes it every 12 h; if it's missing or
// stale this regenerates it on the spot. Logic: netlify/lib/fmDj.ts.

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });
  return handleDjGet(new URL(req.url), {
    reader: viemReader(),
    store: getStore('fm-dj') as unknown as DjStore,
    env: process.env,
    now: () => Date.now(),
  });
};

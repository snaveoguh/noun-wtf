import { getStore } from '@netlify/blobs';

import { runDjUpdate, viemReader, type DjStore } from '../lib/fmDj';

// NOUN FM's DJ update, written every 12 hours: the last 24 h of Nouns
// activity read from chain → a ~10 s script in the DJ's voice (and an mp3 if
// a TTS key is set) → Netlify Blobs store "fm-dj" (`latest`). The game reads
// it through fm-dj.ts. Logic and env vars: netlify/lib/fmDj.ts.

export default async (): Promise<Response> => {
  const doc = await runDjUpdate({
    reader: viemReader(),
    store: getStore('fm-dj') as unknown as DjStore,
    env: process.env,
    now: () => Date.now(),
  });
  console.log(
    '[fm-dj] update',
    JSON.stringify({ at: doc.at, script: doc.script, audio: doc.audio }),
  );
  return new Response('ok');
};

export const config = { schedule: '0 */12 * * *' };

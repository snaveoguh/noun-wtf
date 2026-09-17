#!/usr/bin/env node
// Ask SFKB (Sans Frontière Knowledge Base) to redraw a picture in the noun.wtf
// hand-drawn style through its GPT-6 Astra image endpoint, then pull the
// results into public/memes.
//
//   SFKB_TOKEN=... node scripts/marker-memes/sfkb-redraw.mjs <source-image-or-url> [tag]
//
// Env: SFKB_URL (default https://sans-frontiere-brain.netlify.app), SFKB_TOKEN
// (the Brain token from SFKB Settings), VARIANTS (default 2), PIP3 (how many
// live pip3 GIFs to send as extra references, default 4).

import fs from 'node:fs';
import path from 'node:path';

const [, , sourceArg, tagArg] = process.argv;
if (!sourceArg) { console.error('usage: sfkb-redraw.mjs <source-image-or-url> [tag]'); process.exit(1); }
const TOKEN = process.env.SFKB_TOKEN;
if (!TOKEN) { console.error('SFKB_TOKEN is not set (SFKB → Settings → Brain token)'); process.exit(1); }
const BASE = (process.env.SFKB_URL || 'https://sans-frontiere-brain.netlify.app').replace(/\/$/, '');
const VARIANTS = Number(process.env.VARIANTS || 2);
const PIP3 = Number(process.env.PIP3 ?? 4);
const tag = (tagArg || path.basename(sourceArg).replace(/\.[^.]+$/, '') || 'redraw').replace(/[^\w-]+/g, '-').slice(0, 40);
const outDir = 'public/memes';

const mime = f => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })[path.extname(f).toLowerCase()] || 'application/octet-stream';
const source = /^https?:\/\//.test(sourceArg) ? sourceArg : `data:${mime(sourceArg)};base64,${fs.readFileSync(sourceArg).toString('base64')}`;
const headers = { 'content-type': 'application/json', 'x-brain-token': TOKEN };

const list = async () => {
  const r = await fetch(`${BASE}/api/image-redraw?tag=${encodeURIComponent(tag)}&limit=20`, { headers });
  if (!r.ok) throw new Error(`list ${r.status}: ${await r.text()}`);
  return (await r.json()).files;
};

const before = new Set((await list()).map(f => f.id));
const kick = await fetch(`${BASE}/api/image-redraw-background`, {
  method: 'POST', headers,
  body: JSON.stringify({ source, tag, n: VARIANTS, pip3: PIP3 }),
});
if (kick.status !== 202 && !kick.ok) { console.error(`kick ${kick.status}: ${await kick.text()}`); process.exit(1); }
console.log(`SFKB accepted the job (tag "${tag}", ${VARIANTS} variant(s)); waiting for Astra …`);

fs.mkdirSync(outDir, { recursive: true });
const started = Date.now();
while (Date.now() - started < 12 * 60_000) {
  await new Promise(r => setTimeout(r, 15_000));
  const fresh = (await list()).filter(f => !before.has(f.id) && f.url);
  if (fresh.length >= VARIANTS) {
    for (const f of fresh) {
      const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
      const file = path.join(outDir, `${tag}-astra-${f.name}`);
      fs.writeFileSync(file, buf);
      console.log(file);
    }
    process.exit(0);
  }
  process.stdout.write('.');
}
console.error('\ntimed out after 12 min; check the Files tab in SFKB');
process.exit(1);

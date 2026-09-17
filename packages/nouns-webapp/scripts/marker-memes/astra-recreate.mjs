#!/usr/bin/env node
// Ask GPT-6 Astra (OpenAI Responses API + image_generation tool) to redraw a
// meme in the noun.wtf hand-drawn style, using the repo's own sketches as
// style references.
//
//   OPENAI_API_KEY=sk-... node scripts/marker-memes/astra-recreate.mjs <source-image> [out-dir]
//
// Env knobs:
//   ASTRA_MODEL   orchestrating model      (default: gpt-6-astra)
//   IMAGE_MODEL   image_generation model   (default: gpt-image-2)
//   VARIANTS      how many images to ask for (default: 2)
//
// Run from packages/nouns-webapp. Written blind — the sandbox this was authored
// in could not reach api.openai.com or the docs, so field names follow the
// documented Responses API image_generation shape and were not executed.

import fs from 'node:fs';
import path from 'node:path';

const [, , sourceArg, outArg] = process.argv;
if (!sourceArg) { console.error('usage: astra-recreate.mjs <source-image> [out-dir]'); process.exit(1); }
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set'); process.exit(1); }

const ASTRA_MODEL = process.env.ASTRA_MODEL || 'gpt-6-astra';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
const VARIANTS = Number(process.env.VARIANTS || 2);
const outDir = outArg || 'public/memes';

const REFERENCES = [
  'public/sketches/1822.gif',
  'public/sketches/1823.gif',
  'public/sketches/1824.gif',
  'public/untitled2026.gif',
];

const mime = f => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })[path.extname(f).toLowerCase()] || 'application/octet-stream';
const dataUrl = f => `data:${mime(f)};base64,${fs.readFileSync(f).toString('base64')}`;
const imageInput = f => ({ type: 'input_image', image_url: dataUrl(f), detail: 'high' });

const STYLE_PROMPT = `
You are redrawing a meme for noun.wtf. Match the attached hand-drawn reference
sketches as closely as possible. That style is:

- Thick, uneven black marker lines on a plain white background. No colour, no
  grey, no shading, no gradients, no texture, no pixel art.
- Crude and fast, like a kid or a bored adult finger-painting: wobbly lines,
  corners that overshoot, shapes that don't quite close, lumpy proportions,
  the two sides not symmetrical.
- Big simple shapes with a lot of empty white. Solid black only for small
  things (spots, pupils, a tee shirt), never for large fills.
- Hand-lettered all-caps captions in the same marker if any text is needed.

Redraw the attached SOURCE image in that style. Keep the scene and the joke,
drop the polish:

- Two black-and-white dairy cows facing the viewer, each wearing Nouns
  "noggles" (two square glasses joined by a bridge, black pupil on the right
  half of each lens).
- Between them a Noun character: square head with noggles, a hi-vis safety
  vest with reflective stripes, sitting on a milking stool, sweating,
  grimacing with a mouthful of teeth.
- The Noun is milking both cows at once, and each cow's udder is an Ethereum
  diamond logo with drops of milk coming out.
- Barn interior behind them, a hay bale, a pitchfork, a barn door open to a
  field with a small barn, and a little TV with noggles on it.
- Make it a bit grotesque: saggy udders, drool, flies, a stray eyeball.

Landscape, roughly 16:9. Output only the drawing, no border, no signature.
`.trim();

const body = {
  model: ASTRA_MODEL,
  tools: [{ type: 'image_generation', model: IMAGE_MODEL, size: '1536x1024', quality: 'high', output_format: 'png', input_fidelity: 'high' }],
  tool_choice: { type: 'image_generation' },
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'STYLE REFERENCES (hand-drawn noun.wtf sketches; copy this look):' },
        ...REFERENCES.filter(fs.existsSync).map(imageInput),
        { type: 'input_text', text: 'SOURCE IMAGE (the meme to redraw):' },
        imageInput(sourceArg),
        { type: 'input_text', text: STYLE_PROMPT },
      ],
    },
  ],
};

fs.mkdirSync(outDir, { recursive: true });
for (let i = 1; i <= VARIANTS; i++) {
  process.stdout.write(`variant ${i}/${VARIANTS} … `);
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error(`\nHTTP ${res.status}: ${await res.text()}`); process.exit(1); }
  const json = await res.json();
  const calls = (json.output || []).filter(o => o.type === 'image_generation_call' && o.result);
  if (calls.length === 0) { console.error('\nno image in response:', JSON.stringify(json).slice(0, 2000)); process.exit(1); }
  calls.forEach((c, k) => {
    const file = path.join(outDir, `milking-the-treasury-astra-${i}${calls.length > 1 ? `-${k + 1}` : ''}.png`);
    fs.writeFileSync(file, Buffer.from(c.result, 'base64'));
    console.log(file, c.revised_prompt ? `\n  revised: ${c.revised_prompt.slice(0, 200)}` : '');
  });
}

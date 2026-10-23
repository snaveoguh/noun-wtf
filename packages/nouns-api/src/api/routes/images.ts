import type { Hono } from 'hono';

import { eq } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import sharp from 'sharp';

import {
  type ArtDao,
  composeNoun,
  decodeRle,
  getOnchainArt,
  type OnchainArt,
} from '../../agent/onchainArt.js';

// ─── Image → ASCII Art Conversion ─────────────────────────────────────────

const ASCII_CHARS = ' .:-=+*#%@█';
const asciiImageCache = new Map<string, { data: unknown; fetchedAt: number }>();
const ASCII_CACHE_TTL = 3600_000; // 1 hour

interface AsciiPixel {
  ch: string; // ASCII character
  r: number; // original red
  g: number; // original green
  b: number; // original blue
}

async function imageToAscii(
  url: string,
  cols = 80,
): Promise<{ pixels: AsciiPixel[]; width: number; height: number } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());

    // Get original dimensions
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;

    // ASCII chars are ~2x tall as wide, so halve the row count
    const aspectRatio = meta.height / meta.width;
    const rows = Math.round(cols * aspectRatio * 0.45);

    // Resize and extract raw pixels
    const { data: raw, info } = await sharp(buffer)
      .resize(cols, rows, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels: AsciiPixel[] = [];
    const numChars = ASCII_CHARS.length;

    for (let i = 0; i < info.width * info.height; i++) {
      const r = raw[i * 3];
      const g = raw[i * 3 + 1];
      const b = raw[i * 3 + 2];
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const charIdx = Math.min(numChars - 1, Math.floor(luminance * numChars));
      pixels.push({ ch: ASCII_CHARS[charIdx], r, g, b });
    }

    return { pixels, width: info.width, height: info.height };
  } catch (err) {
    console.error('[AsciiImage] Conversion error:', err);
    return null;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Trait Preview — server-rendered previews for propose_trait ────────────
//
// GET /api/trait-preview?dao=nounv2&category=head&rle=0x…&mode=grid|gif|solo&n=12
//   solo → the trait alone on the cool background, 512×512 nearest PNG
//   grid → n sample nouns wearing the trait, PNG grid
//   gif  → animated GIF cycling n sample nouns wearing the trait
// Art comes from chain (getOnchainArt); responses are LRU-cached in memory.

type TraitOverrideKey = 'overrideBody' | 'overrideAccessory' | 'overrideHead' | 'overrideGlasses';
const TRAIT_PREVIEW_CATEGORIES: Record<
  string,
  { imagesKey: keyof OnchainArt['images']; overrideKey: TraitOverrideKey }
> = {
  head: { imagesKey: 'heads', overrideKey: 'overrideHead' },
  body: { imagesKey: 'bodies', overrideKey: 'overrideBody' },
  accessory: { imagesKey: 'accessories', overrideKey: 'overrideAccessory' },
  glasses: { imagesKey: 'glasses', overrideKey: 'overrideGlasses' },
};

const traitPreviewCache = new Map<string, { body: Buffer; contentType: string }>();
const TRAIT_PREVIEW_CACHE_MAX = 50;

/** deterministic PRNG for reproducible sample seeds */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function registerImageRoutes(app: Hono) {
  app.get('/api/ascii-image', async c => {
    const url = c.req.query('url');
    const cols = Math.min(120, Math.max(20, parseInt(c.req.query('cols') || '80', 10)));

    if (!url) return c.json({ error: 'url param required' }, 400);

    // Validate URL (only allow http/https, no local addresses)
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return c.json({ error: 'only http/https URLs' }, 400);
      }
    } catch {
      return c.json({ error: 'invalid URL' }, 400);
    }

    const cacheKey = `${url}:${cols}`;
    const cached = asciiImageCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ASCII_CACHE_TTL) {
      return c.json(cached.data);
    }

    const result = await imageToAscii(url, cols);
    if (!result) return c.json({ error: 'failed to convert image' }, 500);

    asciiImageCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
    return c.json(result);
  });

  // ─── OG Image — ASCII art as PNG ──────────────────────────────────────────

  app.get('/api/og/proposal/:id', async c => {
    const proposalId = c.req.param('id');
    if (!proposalId) return c.json({ error: 'id required' }, 400);

    try {
      // Get proposal from DB
      const proposals = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, BigInt(proposalId)))
        .limit(1);
      if (proposals.length === 0) return c.json({ error: 'not found' }, 404);

      const proposal = proposals[0];
      const descText = (proposal.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 80);

      // Extract first image URL
      const imgMatch = descText.match(
        /!\[.*?]\((https?:\/\/[^)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/,
      );
      const imgUrl = imgMatch?.[1] || imgMatch?.[2];

      // Convert image to ASCII if available
      const asciiLines: string[] = [];
      if (imgUrl) {
        const ascii = await imageToAscii(imgUrl, 70);
        if (ascii) {
          for (let y = 0; y < ascii.height; y++) {
            let line = '';
            for (let x = 0; x < ascii.width; x++) {
              line += ascii.pixels[y * ascii.width + x].ch;
            }
            asciiLines.push(line);
          }
        }
      }

      // Render OG image as SVG → PNG
      const W = 1200;
      const H = 630;
      // const CHAR_W = 8.4; // reserved for future OG image layout
      const LINE_H = 12;
      const PAD = 40;

      // Build SVG
      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#000000"/>
      <text x="${PAD}" y="${PAD + 20}" fill="#00ff41" font-family="monospace" font-size="18" font-weight="bold">NOUN.WTF</text>
      <text x="${PAD}" y="${PAD + 48}" fill="#facc15" font-family="monospace" font-size="16">PROP ${proposalId}: ${escapeXml(title)}</text>`;

      if (asciiLines.length > 0) {
        const startY = PAD + 72;
        const maxLines = Math.min(asciiLines.length, Math.floor((H - startY - PAD) / LINE_H));
        for (let i = 0; i < maxLines; i++) {
          svgContent += `<text x="${PAD}" y="${startY + i * LINE_H}" fill="#888888" font-family="monospace" font-size="10">${escapeXml(asciiLines[i])}</text>`;
        }
      } else {
        svgContent += `<text x="${PAD}" y="${PAD + 80}" fill="#444" font-family="monospace" font-size="14">⌐◨-◨</text>`;
      }

      svgContent += `<text x="${W - PAD}" y="${H - PAD}" fill="#333" font-family="monospace" font-size="12" text-anchor="end">noun.wtf</text>`;
      svgContent += '</svg>';

      const png = await sharp(Buffer.from(svgContent)).png().toBuffer();

      return new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (err) {
      console.error('[OG] Error:', err);
      return c.json({ error: 'failed to generate OG image' }, 500);
    }
  });

  app.get('/api/trait-preview', async c => {
    const dao: ArtDao = c.req.query('dao') === 'nouns' ? 'nouns' : 'nounv2';
    const category = c.req.query('category') ?? '';
    const rle = (c.req.query('rle') ?? '').toLowerCase();
    const mode = c.req.query('mode') ?? 'grid';
    const n = Math.min(Math.max(parseInt(c.req.query('n') || '12', 10) || 12, 1), 48);
    const seedParam = c.req.query('seed');

    const cat = TRAIT_PREVIEW_CATEGORIES[category];
    if (!cat) return c.json({ error: 'category must be head|body|accessory|glasses' }, 400);
    if (!['grid', 'gif', 'solo'].includes(mode)) {
      return c.json({ error: 'mode must be grid|gif|solo' }, 400);
    }
    if (!/^0x[\da-f]{10,4096}$/.test(rle) || rle.length % 2 !== 0) {
      return c.json({ error: 'rle must be 0x-prefixed hex (a Nouns RLE image)' }, 400);
    }

    const cacheKey = `${dao}|${category}|${mode}|${n}|${seedParam ?? ''}|${rle}`;
    const cached = traitPreviewCache.get(cacheKey);
    if (cached) {
      // refresh recency for the LRU
      traitPreviewCache.delete(cacheKey);
      traitPreviewCache.set(cacheKey, cached);
      return new Response(new Uint8Array(cached.body), {
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    }

    try {
      const art = await getOnchainArt(dao);
      const rleBare = rle.slice(2);
      decodeRle(rleBare); // validates bounds/runs before any rendering

      const upscale = (raw: Buffer, size: number) =>
        sharp(raw, { raw: { width: 32, height: 32, channels: 3 } })
          .resize(size, size, { kernel: 'nearest' })
          .png()
          .toBuffer();

      // deterministic when ?seed= is provided, random otherwise
      const rng = seedParam != null ? mulberry32(parseInt(seedParam, 10) || 0) : Math.random;
      const sampleSeed = () => ({
        background: Math.floor(rng() * Math.max(art.bgcolors.length, 1)),
        body: Math.floor(rng() * Math.max(art.images.bodies.length, 1)),
        accessory: Math.floor(rng() * Math.max(art.images.accessories.length, 1)),
        head: Math.floor(rng() * Math.max(art.images.heads.length, 1)),
        glasses: Math.floor(rng() * Math.max(art.images.glasses.length, 1)),
      });
      const composeSample = () =>
        composeNoun({ art, seed: sampleSeed(), [cat.overrideKey]: rleBare });

      let body: Buffer;
      let contentType: string;
      if (mode === 'solo') {
        // the trait alone on the cool background (bg 0)
        const raw = composeNoun({
          art,
          seed: { background: 0, body: -1, accessory: -1, head: -1, glasses: -1 },
          [cat.overrideKey]: rleBare,
        });
        body = await upscale(raw, 512);
        contentType = 'image/png';
      } else if (mode === 'grid') {
        const cell = 160;
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const cells = await Promise.all(
          Array.from({ length: n }, async (_, i) => ({
            input: await upscale(composeSample(), cell),
            left: (i % cols) * cell,
            top: Math.floor(i / cols) * cell,
          })),
        );
        body = await sharp({
          create: {
            width: cols * cell,
            height: rows * cell,
            channels: 3,
            background: { r: 13, g: 13, b: 13 },
          },
        })
          .composite(cells)
          .png()
          .toBuffer();
        contentType = 'image/png';
      } else {
        // gif — one frame per sample noun; sharp joins the frames as pages
        const frames: Buffer[] = [];
        for (let i = 0; i < n; i++) frames.push(await upscale(composeSample(), 320));
        body = await sharp(frames, { join: { animated: true } })
          .gif({ delay: 600, loop: 0 })
          .toBuffer();
        contentType = 'image/gif';
      }

      traitPreviewCache.set(cacheKey, { body, contentType });
      while (traitPreviewCache.size > TRAIT_PREVIEW_CACHE_MAX) {
        const oldest = traitPreviewCache.keys().next().value;
        if (oldest === undefined) break;
        traitPreviewCache.delete(oldest);
      }

      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    } catch (err) {
      return c.json(
        { error: `trait preview failed: ${err instanceof Error ? err.message : String(err)}` },
        400,
      );
    }
  });
}

import type { Hono } from 'hono';

// ============================================================
// Sketch — detect @pip's daily sketch from Farcaster
// ============================================================

const PIP_FID = 191593; // @pip on Farcaster (hugo)
const SKETCH_CACHE_TTL = 5 * 60_000; // 5 minutes
let sketchCache: { data: unknown; fetchedAt: number } | null = null;

export function registerSketchRoutes(app: Hono) {
  app.get('/api/sketch/latest', async c => {
    const neynarKey = process.env.NEYNAR_API_KEY;
    if (!neynarKey) {
      return c.json({ error: 'Sketch API not configured (missing Neynar key)' }, 503);
    }

    // Return cached if fresh
    if (sketchCache && Date.now() - sketchCache.fetchedAt < SKETCH_CACHE_TTL) {
      return c.json(sketchCache.data);
    }

    try {
      // Fetch @pip's recent casts in /nouns channel
      const url = `https://api.neynar.com/v2/farcaster/feed/?feed_type=filter&filter_type=fids&fids=${PIP_FID}&channel_id=nouns&limit=10`;
      const res = await fetch(url, {
        headers: {
          'x-api-key': neynarKey,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        console.error('Neynar sketch API error:', res.status);
        return c.json({ nounId: 0 });
      }

      const data = await res.json();
      const casts = data?.casts ?? [];

      // Find the most recent cast with an image embed and a noun number
      const nounIdRegex = /\b(\d{3,4})\b/;
      for (const cast of casts) {
        // Check if cast is within last 48 hours
        const castAge = Date.now() - new Date(cast.timestamp).getTime();
        if (castAge > 48 * 60 * 60 * 1000) continue;

        // Extract noun number from text
        const numMatch = cast.text?.match(nounIdRegex);
        if (!numMatch) continue;

        // Find image embed
        const embeds = cast.embeds ?? [];
        let gifUrl: string | null = null;
        for (const embed of embeds) {
          if (embed.metadata?.image || embed.metadata?.content_type?.startsWith('image/')) {
            gifUrl = embed.url;
            break;
          }
        }
        if (!gifUrl) continue;

        const result = {
          nounId: parseInt(numMatch[1], 10),
          gifUrl,
          artist: 'pip',
          mintPrice: '0.01',
          mintEnabled: Boolean(process.env.SKETCH_MINT_CONTRACT),
          mintContract: process.env.SKETCH_MINT_CONTRACT || null,
          castHash: cast.hash,
          castTimestamp: cast.timestamp,
        };

        sketchCache = { data: result, fetchedAt: Date.now() };
        return c.json(result);
      }

      // No sketch found
      const empty = { nounId: 0 };
      sketchCache = { data: empty, fetchedAt: Date.now() };
      return c.json(empty);
    } catch (err) {
      console.error('Sketch fetch error:', err);
      return c.json({ nounId: 0 });
    }
  });
}

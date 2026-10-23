import type { Hono } from 'hono';

// ============================================================
// Feed — Neynar Farcaster proxy for /nouns and /noc channels
// ============================================================

const ALLOWED_CHANNELS = ['nouns', 'noc', 'lil'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const feedCaches = new Map<string, { data: any; fetchedAt: number }>();
const FEED_CACHE_TTL = 60 * 60_000; // 1 hour

export function registerFeedRoutes(app: Hono) {
  app.get('/api/feed/:channel', async c => {
    const channel = c.req.param('channel');

    if (!ALLOWED_CHANNELS.includes(channel)) {
      return c.json(
        { error: `Unknown channel: ${channel}. Allowed: ${ALLOWED_CHANNELS.join(', ')}` },
        400,
      );
    }

    const neynarKey = process.env.NEYNAR_API_KEY;
    if (!neynarKey) {
      return c.json({ error: 'Feed not configured (missing Neynar key)' }, 503);
    }

    // Return cached if fresh
    const cached = feedCaches.get(channel);
    if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL) {
      return c.json(cached.data);
    }

    try {
      const url = `https://api.neynar.com/v2/farcaster/feed/?feed_type=filter&filter_type=channel_id&channel_id=${channel}&limit=25`;
      const res = await fetch(url, {
        headers: {
          'x-api-key': neynarKey,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Neynar API error (/${channel}):`, res.status, errText);
        return c.json({ error: `Neynar API error: ${res.status}` }, 502);
      }

      const data = await res.json();
      feedCaches.set(channel, { data, fetchedAt: Date.now() });
      return c.json(data);
    } catch (err) {
      console.error(`Feed fetch error (/${channel}):`, err);
      return c.json({ error: 'Failed to fetch feed' }, 500);
    }
  });
}

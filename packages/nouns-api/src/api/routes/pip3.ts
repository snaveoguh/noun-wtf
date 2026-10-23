import type { Hono } from 'hono';

// ============================================================
// Pip3 — Giphy channel proxy (Giphy v4 channels feed sends no CORS)
// ============================================================

const PIP3_CACHE_TTL_MS = 60_000;
const pip3Cache = new Map<string, { at: number; body: unknown }>();

export function registerPip3Routes(app: Hono) {
  app.get('/api/pip3-gifs', async c => {
    const channelId = c.req.query('channel') || '19207767';
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
    const key = `${channelId}:${offset}:${limit}`;
    const now = Date.now();
    const cached = pip3Cache.get(key);
    if (cached && now - cached.at < PIP3_CACHE_TTL_MS) return c.json(cached.body);
    try {
      const res = await fetch(
        `https://giphy.com/api/v4/channels/${channelId}/feed?offset=${offset}&limit=${limit}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) throw new Error(`giphy ${res.status}`);
      const body = await res.json();
      pip3Cache.set(key, { at: now, body });
      return c.json(body);
    } catch (err) {
      if (cached) return c.json(cached.body, 200, { 'x-cache': 'stale' });
      return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
    }
  });
}

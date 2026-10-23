import type { Hono } from 'hono';

export function registerFarcasterRoutes(app: Hono) {
  // ============================================================
  // Farcaster Write — proxy write ops so NEYNAR_API_KEY stays server-side
  // Clients send their signer_uuid (obtained via SIWN on the frontend).
  // ============================================================

  app.post('/api/farcaster/cast', async c => {
    const neynarKey = process.env.NEYNAR_API_KEY;
    if (!neynarKey) return c.json({ error: 'Not configured' }, 503);

    const { signer_uuid, text, channel_id, parent } = await c.req.json<{
      signer_uuid: string;
      text: string;
      channel_id?: string;
      parent?: string;
    }>();

    if (!signer_uuid || !text?.trim()) {
      return c.json({ error: 'Missing signer_uuid or text' }, 400);
    }

    try {
      const body: Record<string, string> = { signer_uuid, text: text.trim() };
      if (channel_id) body.channel_id = channel_id;
      if (parent) body.parent = parent;

      const res = await fetch('https://api.neynar.com/v2/farcaster/cast', {
        method: 'POST',
        headers: {
          'x-api-key': neynarKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Farcaster cast] Neynar error:', res.status, data);
        return c.json({ error: data }, res.status as 400);
      }
      return c.json(data);
    } catch (err) {
      console.error('[Farcaster cast] Error:', err);
      return c.json({ error: 'Failed to publish cast' }, 500);
    }
  });

  app.post('/api/farcaster/reaction', async c => {
    const neynarKey = process.env.NEYNAR_API_KEY;
    if (!neynarKey) return c.json({ error: 'Not configured' }, 503);

    const { signer_uuid, reaction_type, target } = await c.req.json<{
      signer_uuid: string;
      reaction_type: 'like' | 'recast';
      target: string;
    }>();

    if (!signer_uuid || !reaction_type || !target) {
      return c.json({ error: 'Missing signer_uuid, reaction_type, or target' }, 400);
    }

    try {
      const res = await fetch('https://api.neynar.com/v2/farcaster/reaction', {
        method: 'POST',
        headers: {
          'x-api-key': neynarKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signer_uuid, reaction_type, target }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Farcaster reaction] Neynar error:', res.status, data);
        return c.json({ error: data }, res.status as 400);
      }
      return c.json(data);
    } catch (err) {
      console.error('[Farcaster reaction] Error:', err);
      return c.json({ error: 'Failed to submit reaction' }, 500);
    }
  });

  app.delete('/api/farcaster/reaction', async c => {
    const neynarKey = process.env.NEYNAR_API_KEY;
    if (!neynarKey) return c.json({ error: 'Not configured' }, 503);

    const { signer_uuid, reaction_type, target } = await c.req.json<{
      signer_uuid: string;
      reaction_type: 'like' | 'recast';
      target: string;
    }>();

    if (!signer_uuid || !reaction_type || !target) {
      return c.json({ error: 'Missing signer_uuid, reaction_type, or target' }, 400);
    }

    try {
      const res = await fetch('https://api.neynar.com/v2/farcaster/reaction', {
        method: 'DELETE',
        headers: {
          'x-api-key': neynarKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signer_uuid, reaction_type, target }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Farcaster unreaction] Neynar error:', res.status, data);
        return c.json({ error: data }, res.status as 400);
      }
      return c.json(data);
    } catch (err) {
      console.error('[Farcaster unreaction] Error:', err);
      return c.json({ error: 'Failed to remove reaction' }, 500);
    }
  });
}

import type { Hono } from 'hono';

import { inArray } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

export function registerNounsRoutes(app: Hono) {
  // ─── Noun Seeds (compact, for twin matching) ────────────────────────────

  app.get('/api/nouns/seeds', async c => {
    try {
      const nouns = await db
        .select({
          id: schema.noun.id,
          background: schema.noun.background,
          body: schema.noun.body,
          accessory: schema.noun.accessory,
          head: schema.noun.head,
          glasses: schema.noun.glasses,
        })
        .from(schema.noun)
        .orderBy(schema.noun.id);

      // Set long cache — seeds of minted nouns never change
      c.header('Cache-Control', 'public, max-age=300');
      return c.json(nouns.map(n => ({ ...n, id: Number(n.id) })));
    } catch (err) {
      console.error('[NounSeeds] Error:', err);
      return c.json([], 500);
    }
  });

  // ─── Noun Holders ────────────────────────────────────────────────────────

  app.get('/api/noun-holders', async c => {
    const addressesParam = c.req.query('addresses') || '';
    const addresses = addressesParam
      .split(',')
      .filter(a => /^0x[\dA-Fa-f]{40}$/.test(a))
      .slice(0, 50);

    if (addresses.length === 0) return c.json({ holders: {} });

    try {
      const nouns = await db
        .select()
        .from(schema.noun)
        .where(
          inArray(
            schema.noun.owner,
            addresses.map(a => a.toLowerCase()),
          ),
        );

      const holders: Record<
        string,
        Array<{
          nounId: number;
          seed: {
            head: number;
            body: number;
            accessory: number;
            glasses: number;
            background: number;
          };
        }>
      > = {};

      for (const n of nouns) {
        const key = (n.owner || '').toLowerCase();
        if (!holders[key]) holders[key] = [];
        holders[key].push({
          nounId: Number(n.id),
          seed: {
            head: n.head,
            body: n.body,
            accessory: n.accessory,
            glasses: n.glasses,
            background: n.background,
          },
        });
      }

      return c.json({ holders });
    } catch (err) {
      console.error('[NounHolders] Error:', err);
      return c.json({ holders: {} }, 500);
    }
  });
}

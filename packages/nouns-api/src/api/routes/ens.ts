import type { Hono } from 'hono';

import { ENS_CACHE_TTL, ensCache, ensClient } from '../lib/ens.js';

export function registerEnsRoutes(app: Hono) {
  app.get('/api/ens', async c => {
    const addressesParam = c.req.query('addresses') || '';
    const addresses = addressesParam
      .split(',')
      .filter(a => /^0x[\dA-Fa-f]{40}$/.test(a))
      .slice(0, 50);

    if (addresses.length === 0) return c.json({ names: {} });

    const now = Date.now();
    const names: Record<string, string | null> = {};
    const toResolve: string[] = [];

    for (const addr of addresses) {
      const key = addr.toLowerCase();
      const cached = ensCache.get(key);
      if (cached && now - cached.resolvedAt < ENS_CACHE_TTL) {
        names[key] = cached.name;
      } else {
        toResolve.push(addr);
      }
    }

    // Resolve uncached (max 10 concurrent to avoid RPC hammering)
    const chunks = [];
    for (let i = 0; i < toResolve.length; i += 10) {
      chunks.push(toResolve.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async addr => {
          const key = addr.toLowerCase();
          try {
            const name = await ensClient.getEnsName({ address: addr as `0x${string}` });
            ensCache.set(key, { name: name || null, resolvedAt: now });
            names[key] = name || null;
          } catch {
            ensCache.set(key, { name: null, resolvedAt: now });
            names[key] = null;
          }
        }),
      );
    }

    return c.json({ names });
  });
}

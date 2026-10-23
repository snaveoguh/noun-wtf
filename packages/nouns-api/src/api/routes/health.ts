import type { Hono } from 'hono';

import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { getCurrentBlock } from '../lib/chain.js';
import { checkDashboardKey } from '../lib/dashboardAuth.js';
import { getBufferSize, getMetrics, getRecentErrors } from '../metrics.js';

export function registerHealthRoutes(app: Hono) {
  // Health check
  app.get('/api/health', async c => {
    // Every `railway up` starts a FRESH Ponder schema, so all data endpoints
    // return empty for ~10-15 min while the backfill replays. Report that here
    // so the webapp can show a "reindexing" state instead of a blank site.
    let indexing = false;
    let proposalCount: number | null = null;
    try {
      const rows = await db.select({ id: schema.proposal.id }).from(schema.proposal).limit(1000);
      proposalCount = rows.length;
      // A healthy index has ~1000 proposals. A near-empty one mid-deploy is the tell.
      indexing = proposalCount < 100;
    } catch {
      indexing = true;
    }
    return c.json({
      status: indexing ? 'reindexing' : 'ok',
      indexing,
      proposalCount,
      timestamp: Date.now(),
    });
  });

  app.get('/api/stats', async c => {
    if (!checkDashboardKey(c)) return c.json({ error: 'Unauthorized' }, 401);
    const window = parseInt(c.req.query('window') || '60', 10);
    return c.json(getMetrics(window));
  });

  app.get('/api/stats/errors', async c => {
    if (!checkDashboardKey(c)) return c.json({ error: 'Unauthorized' }, 401);
    return c.json(getRecentErrors(50));
  });

  app.get('/api/stats/health', async c => {
    let latestBlock: string = 'unknown';
    try {
      latestBlock = (await getCurrentBlock()).toString();
    } catch {}

    let dbStatus: { ok: boolean; error?: string } = { ok: false };
    try {
      await db.select().from(schema.noun).limit(1);
      dbStatus = { ok: true };
    } catch (e: unknown) {
      dbStatus = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    const mem = process.memoryUsage();
    return c.json({
      api: {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
      },
      indexer: { latestBlock },
      database: dbStatus,
      metricsBufferSize: getBufferSize(),
      timestamp: Date.now(),
    });
  });
}

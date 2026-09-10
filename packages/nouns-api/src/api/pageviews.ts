/**
 * Site pageview beacon — replaces Plausible (the noun.wtf site is locked
 * there for lack of a subscription, so every Stats API call errors).
 *
 * Storage: raw pg Pool on DATABASE_URL in a plain table (same pattern as
 * dreams.ts / agent/reservations.ts) so rows survive Ponder's per-deploy
 * schemas.
 *
 * Privacy model mirrors Plausible: no cookies, no raw IP. A visitor is
 * sha256(daily salt + ip + user-agent). The salt is random, generated once
 * per UTC day and persisted in Postgres so a restart mid-day does not
 * inflate visitor counts; salts older than two days are deleted, at which
 * point old visitor hashes are permanently unlinkable.
 *
 * Routes:
 *   POST /api/pv                       beacon  { p: path, r: referrer, w: width }
 *   GET  /api/stats/traffic?period=…   dashboard stats, key-gated like /api/stats
 */

import type { Context, Hono } from 'hono';

import { createHash, randomBytes } from 'node:crypto';

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

/** Origins allowed to post pageviews. Anything else is dropped silently. */
const ALLOWED_HOSTS = new Set([
  'noun.wtf',
  'www.noun.wtf',
  'dev-noun-wtf.netlify.app',
  'localhost',
  '127.0.0.1',
]);

const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python|java\/|go-http|axios|node-fetch|undici|preview|facebookexternalhit|whatsapp|telegram|discord|twitterbot|embedly|quora|vkshare|bingpreview|phantom|selenium|puppeteer|playwright/i;

/** Per-visitor rate limit: this many beacons per window. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAP_MAX = 20_000;

const STATS_TTL_MS = 5 * 60_000;
const RETENTION_DAYS = 400;
const MAX_PATH_LEN = 200;

let pool: pg.Pool | null = null;
if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  console.log('[Pageviews] Postgres pool created for site_pageviews');
}

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS site_pageviews (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    path TEXT NOT NULL,
    referrer_host TEXT,
    screen TEXT NOT NULL,
    visitor_hash TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_site_pageviews_ts ON site_pageviews(ts);
  CREATE TABLE IF NOT EXISTS site_pageview_salts (
    day DATE PRIMARY KEY,
    salt TEXT NOT NULL
  );
`;

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!pool) return Promise.reject(new Error('no DATABASE_URL'));
  const p = initPromise ?? pool.query(INIT_SQL).then(() => undefined);
  initPromise = p;
  return p;
}

// ---------------------------------------------------------------------------
// Visitor hashing
// ---------------------------------------------------------------------------

let saltCache: { day: string; salt: string } | null = null;

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function getDailySalt(): Promise<string> {
  const day = utcDay();
  if (saltCache?.day === day) return saltCache.salt;
  if (!pool) throw new Error('no DATABASE_URL');

  const fresh = randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO site_pageview_salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING',
    [day, fresh],
  );
  const { rows } = await pool.query<{ salt: string }>(
    'SELECT salt FROM site_pageview_salts WHERE day = $1',
    [day],
  );
  const salt = rows[0]?.salt ?? fresh;
  saltCache = { day, salt };

  // Forget salts older than two days so historic hashes can never be re-derived.
  pool
    .query("DELETE FROM site_pageview_salts WHERE day < (CURRENT_DATE - INTERVAL '2 days')")
    .catch(() => undefined);
  return salt;
}

function clientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip')?.trim() ||
    'unknown'
  );
}

function visitorHash(salt: string, ip: string, ua: string): string {
  return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per visitor hash)
// ---------------------------------------------------------------------------

const rateMap = new Map<string, { count: number; resetAt: number }>();

function rateLimited(hash: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(hash);
  if (!entry || entry.resetAt <= now) {
    if (rateMap.size >= RATE_MAP_MAX) {
      for (const [k, v] of rateMap) if (v.resetAt <= now) rateMap.delete(k);
      if (rateMap.size >= RATE_MAP_MAX) rateMap.clear();
    }
    rateMap.set(hash, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// Beacon payload parsing
// ---------------------------------------------------------------------------

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Path only — query strings and fragments are dropped before storage. */
function cleanPath(p: unknown): string | null {
  if (typeof p !== 'string' || !p.startsWith('/')) return null;
  const bare = p.split(/[#?]/)[0] ?? '/';
  const trimmed = bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
  return (trimmed || '/').slice(0, MAX_PATH_LEN);
}

function referrerHost(r: unknown): string | null {
  if (typeof r !== 'string' || r.length === 0 || r.length > 2048) return null;
  const host = hostOf(r);
  if (!host || ALLOWED_HOSTS.has(host)) return null;
  return host.replace(/^www\./, '').slice(0, 100);
}

function screenBucket(w: unknown): string {
  const n = typeof w === 'number' ? w : Number(w);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  if (n < 768) return 'mobile';
  if (n < 1024) return 'tablet';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

type Bucket = '5min' | 'hour' | 'day';

interface PeriodSpec {
  since: Date;
  bucket: Bucket;
}

const PERIODS: Record<string, { ms: number; bucket: Bucket }> = {
  '1h': { ms: 3_600_000, bucket: '5min' },
  day: { ms: 86_400_000, bucket: 'hour' },
  '24h': { ms: 86_400_000, bucket: 'hour' },
  '7d': { ms: 7 * 86_400_000, bucket: 'day' },
  '30d': { ms: 30 * 86_400_000, bucket: 'day' },
  '6mo': { ms: 182 * 86_400_000, bucket: 'day' },
  '12mo': { ms: 365 * 86_400_000, bucket: 'day' },
};

function parsePeriod(period: string): PeriodSpec | null {
  const spec = PERIODS[period];
  if (!spec) return null;
  return { since: new Date(Date.now() - spec.ms), bucket: spec.bucket };
}

const BUCKET_MS: Record<Bucket, number> = { '5min': 300_000, hour: 3_600_000, day: 86_400_000 };

function bucketExpr(bucket: Bucket): string {
  if (bucket === '5min') return 'to_timestamp(floor(extract(epoch FROM ts) / 300) * 300)';
  return `date_trunc('${bucket}', ts)`;
}

function bucketLabel(d: Date, bucket: Bucket): string {
  if (bucket === 'day') return d.toISOString().slice(0, 10);
  return d.toISOString().slice(11, 16);
}

export interface TrafficStats {
  aggregate: { results: Record<string, { value: number }> };
  timeseries: { results: { date: string; visitors: number; pageviews: number }[] };
  topPages: { results: { page: string; visitors: number; pageviews: number }[] };
  topReferrers: { results: { source: string; visitors: number }[] };
  devices: { results: { device: string; visitors: number }[] };
  period: string;
  since: string;
}

const statsCache = new Map<string, { data: TrafficStats; fetchedAt: number }>();

export async function getTrafficStats(period: string): Promise<TrafficStats | null> {
  const spec = parsePeriod(period);
  if (!spec) return null;

  const cached = statsCache.get(period);
  if (cached && Date.now() - cached.fetchedAt < STATS_TTL_MS) return cached.data;

  await ensureInit();
  if (!pool) throw new Error('no DATABASE_URL');
  const since = spec.since;

  const [agg, bounce, series, pages, refs, devices] = await Promise.all([
    pool.query<{ pageviews: string; visitors: string }>(
      `SELECT count(*)::text AS pageviews, count(DISTINCT visitor_hash)::text AS visitors
       FROM site_pageviews WHERE ts >= $1`,
      [since],
    ),
    pool.query<{ bounce_rate: string | null }>(
      `SELECT round(100.0 * count(*) FILTER (WHERE n = 1) / nullif(count(*), 0))::text AS bounce_rate
       FROM (SELECT visitor_hash, count(*) AS n FROM site_pageviews WHERE ts >= $1 GROUP BY visitor_hash) s`,
      [since],
    ),
    pool.query<{ bucket: Date; visitors: string; pageviews: string }>(
      `SELECT ${bucketExpr(spec.bucket)} AS bucket,
              count(DISTINCT visitor_hash)::text AS visitors, count(*)::text AS pageviews
       FROM site_pageviews WHERE ts >= $1 GROUP BY 1 ORDER BY 1`,
      [since],
    ),
    pool.query<{ page: string; visitors: string; pageviews: string }>(
      `SELECT path AS page, count(DISTINCT visitor_hash)::text AS visitors, count(*)::text AS pageviews
       FROM site_pageviews WHERE ts >= $1 GROUP BY path ORDER BY 2 DESC, 3 DESC LIMIT 10`,
      [since],
    ),
    pool.query<{ source: string; visitors: string }>(
      `SELECT coalesce(referrer_host, 'Direct / None') AS source, count(DISTINCT visitor_hash)::text AS visitors
       FROM site_pageviews WHERE ts >= $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [since],
    ),
    pool.query<{ device: string; visitors: string }>(
      `SELECT screen AS device, count(DISTINCT visitor_hash)::text AS visitors
       FROM site_pageviews WHERE ts >= $1 GROUP BY screen ORDER BY 2 DESC`,
      [since],
    ),
  ]);

  // Fill empty buckets so the chart is continuous.
  const step = BUCKET_MS[spec.bucket];
  const byBucket = new Map<number, { visitors: number; pageviews: number }>();
  for (const r of series.rows) {
    byBucket.set(new Date(r.bucket).getTime(), {
      visitors: Number(r.visitors),
      pageviews: Number(r.pageviews),
    });
  }
  const start = Math.floor(since.getTime() / step) * step;
  const end = Date.now();
  const timeseries: TrafficStats['timeseries']['results'] = [];
  for (let t = start; t <= end; t += step) {
    const hit = byBucket.get(t);
    timeseries.push({
      date: bucketLabel(new Date(t), spec.bucket),
      visitors: hit?.visitors ?? 0,
      pageviews: hit?.pageviews ?? 0,
    });
  }

  const visitors = Number(agg.rows[0]?.visitors ?? 0);
  const pageviews = Number(agg.rows[0]?.pageviews ?? 0);
  const data: TrafficStats = {
    aggregate: {
      results: {
        visitors: { value: visitors },
        pageviews: { value: pageviews },
        bounce_rate: { value: Number(bounce.rows[0]?.bounce_rate ?? 0) },
        views_per_visit: {
          value: visitors > 0 ? Math.round((pageviews / visitors) * 10) / 10 : 0,
        },
      },
    },
    timeseries: { results: timeseries },
    topPages: {
      results: pages.rows.map((r: { page: string; visitors: string; pageviews: string }) => ({
        page: r.page,
        visitors: Number(r.visitors),
        pageviews: Number(r.pageviews),
      })),
    },
    topReferrers: {
      results: refs.rows.map((r: { source: string; visitors: string }) => ({
        source: r.source,
        visitors: Number(r.visitors),
      })),
    },
    devices: {
      results: devices.rows.map((r: { device: string; visitors: string }) => ({
        device: r.device,
        visitors: Number(r.visitors),
      })),
    },
    period,
    since: since.toISOString(),
  };
  statsCache.set(period, { data, fetchedAt: Date.now() });
  return data;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

let lastPrune = 0;
function pruneOldRows(): void {
  if (!pool || Date.now() - lastPrune < 86_400_000) return;
  lastPrune = Date.now();
  pool
    .query(`DELETE FROM site_pageviews WHERE ts < now() - ($1 || ' days')::interval`, [
      String(RETENTION_DAYS),
    ])
    .catch((err: unknown) => console.error('[Pageviews] prune failed:', err));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerPageviewRoutes(app: Hono, isDashboardAuthorized: (c: Context) => boolean) {
  // Beacon. Always answers 204 — the client never needs to know why a view
  // was dropped, and sendBeacon ignores the response anyway.
  app.post('/api/pv', async c => {
    if (!pool) return c.body(null, 204);

    const ua = c.req.header('user-agent') ?? '';
    if (!ua || BOT_UA.test(ua)) return c.body(null, 204);

    const originHost = hostOf(c.req.header('origin')) ?? hostOf(c.req.header('referer'));
    if (!originHost || !ALLOWED_HOSTS.has(originHost)) return c.body(null, 204);

    let body: { p?: unknown; r?: unknown; w?: unknown } = {};
    try {
      const raw = await c.req.text();
      if (raw.length > 4096) return c.body(null, 204);
      body = JSON.parse(raw) as typeof body;
    } catch {
      return c.body(null, 204);
    }

    const path = cleanPath(body.p);
    if (!path) return c.body(null, 204);

    try {
      await ensureInit();
      const salt = await getDailySalt();
      const hash = visitorHash(salt, clientIp(c), ua);
      if (rateLimited(hash)) return c.body(null, 204);

      await pool.query(
        'INSERT INTO site_pageviews (path, referrer_host, screen, visitor_hash) VALUES ($1, $2, $3, $4)',
        [path, referrerHost(body.r), screenBucket(body.w), hash],
      );
      pruneOldRows();
    } catch (err) {
      console.error('[Pageviews] insert failed:', err);
    }
    return c.body(null, 204);
  });

  // Dashboard stats — same key gate as /api/stats, cached 5 min per period.
  app.get('/api/stats/traffic', async c => {
    if (!isDashboardAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);
    if (!pool) return c.json({ error: 'Traffic storage not configured' }, 503);

    const period = c.req.query('period') || '30d';
    try {
      const data = await getTrafficStats(period);
      if (!data) {
        return c.json(
          { error: `Unknown period; use one of ${Object.keys(PERIODS).join(', ')}` },
          400,
        );
      }
      return c.json(data);
    } catch (err) {
      console.error('[Pageviews] stats failed:', err);
      return c.json({ error: 'Failed to load traffic stats' }, 500);
    }
  });
}

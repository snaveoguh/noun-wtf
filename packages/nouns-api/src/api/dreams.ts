/**
 * Dream Nouns API — replaces the Laravel backend that lived on the
 * probe.wtf DigitalOcean droplet (api.probe.wtf/api/dream-nouns).
 *
 * Storage: raw pg Pool on DATABASE_URL in a plain table (same pattern as
 * agent/reservations.ts) so records survive Ponder's per-deploy schemas.
 *
 * Images: dreams migrated from probe.wtf reference files bundled into the
 * webapp at noun.wtf/probe-dreams/<path>; dreams created after the
 * migration store the uploaded PNG as bytea and are served from
 * GET /api/dream-nouns/:id/image.
 *
 * The response shape mirrors Laravel's paginator ({ data, links, meta })
 * so the webapp's useProbeDreams hook works unchanged.
 */

import type { Hono } from 'hono';

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const PUBLIC_API_BASE =
  process.env.PUBLIC_API_BASE ?? 'https://spirited-flexibility-production-3c30.up.railway.app';
const MIGRATED_IMAGE_BASE = 'https://noun.wtf/probe-dreams/';

let pool: pg.Pool | null = null;
if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  console.log('[Dreams] Postgres pool created for dream_nouns');
}

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS dream_nouns (
    id INTEGER PRIMARY KEY,
    dreamer TEXT NOT NULL,
    accessory_seed_id INTEGER,
    background_seed_id INTEGER NOT NULL DEFAULT 0,
    body_seed_id INTEGER,
    glasses_seed_id INTEGER,
    head_seed_id INTEGER,
    custom_trait_layer TEXT,
    custom_trait_image TEXT,
    custom_trait_data BYTEA,
    custom_trait_mime TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE SEQUENCE IF NOT EXISTS dream_nouns_id_seq;
  CREATE INDEX IF NOT EXISTS idx_dream_nouns_dreamer ON dream_nouns(dreamer);
`;

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!pool) return Promise.reject(new Error('no DATABASE_URL'));
  const p = initPromise ?? pool.query(INIT_SQL).then(() => undefined);
  initPromise = p;
  return p;
}

interface DreamRow {
  id: number;
  dreamer: string;
  accessory_seed_id: number | null;
  background_seed_id: number;
  body_seed_id: number | null;
  glasses_seed_id: number | null;
  head_seed_id: number | null;
  custom_trait_layer: string | null;
  custom_trait_image: string | null;
  has_image_data: boolean;
  created_at: string;
  updated_at: string;
}

/** Laravel-compatible serialization of one dream row. */
function serializeDream(row: DreamRow) {
  let imageUrl: string | null = null;
  if (row.has_image_data) {
    imageUrl = `${PUBLIC_API_BASE}/api/dream-nouns/${row.id}/image`;
  } else if (row.custom_trait_image) {
    imageUrl = `${MIGRATED_IMAGE_BASE}${row.custom_trait_image}`;
  }
  return {
    id: row.id,
    dreamer: row.dreamer,
    accessory_seed_id: row.accessory_seed_id,
    background_seed_id: row.background_seed_id,
    body_seed_id: row.body_seed_id,
    glasses_seed_id: row.glasses_seed_id,
    head_seed_id: row.head_seed_id,
    custom_trait_image: row.custom_trait_image,
    custom_trait_layer: row.custom_trait_layer,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    custom_trait_image_url: imageUrl,
  };
}

const SELECT_COLS = `id, dreamer, accessory_seed_id, background_seed_id, body_seed_id,
  glasses_seed_id, head_seed_id, custom_trait_layer, custom_trait_image,
  (custom_trait_data IS NOT NULL) AS has_image_data, created_at, updated_at`;

const VALID_LAYERS = new Set(['head', 'body', 'accessory', 'glasses']);
const VALID_MIMES = new Set(['image/png', 'image/gif', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function parseSeed(v: unknown): number | null {
  if (v == null || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : null;
}

/**
 * Load a dream's custom trait image — the same source GET
 * /api/dream-nouns/:id/image serves from. Post-migration dreams store the
 * upload as bytea; migrated probe.wtf dreams only have a reference file that
 * lives under noun.wtf/probe-dreams/, which we fetch on demand.
 *
 * Also used by the agent's propose_trait tool (dream_id input).
 */
export async function getDreamTraitImage(
  id: number,
): Promise<{ data: Buffer; mime: string; layer: string | null } | null> {
  if (!pool) throw new Error('dream storage unavailable');
  await ensureInit();
  const res = await pool.query(
    'SELECT custom_trait_data, custom_trait_mime, custom_trait_image, custom_trait_layer FROM dream_nouns WHERE id = $1',
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.custom_trait_data) {
    return {
      data: Buffer.from(row.custom_trait_data),
      mime: row.custom_trait_mime ?? 'image/png',
      layer: row.custom_trait_layer ?? null,
    };
  }
  if (row.custom_trait_image) {
    const r = await fetch(`${MIGRATED_IMAGE_BASE}${row.custom_trait_image}`);
    if (!r.ok) return null;
    return {
      data: Buffer.from(await r.arrayBuffer()),
      mime: r.headers.get('content-type') ?? 'image/png',
      layer: row.custom_trait_layer ?? null,
    };
  }
  return null;
}

export function registerDreamRoutes(app: Hono) {
  // ── List (Laravel paginator shape) ───────────────────────────────────
  app.get('/api/dream-nouns', async c => {
    if (!pool) return c.json({ error: 'storage unavailable' }, 503);
    await ensureInit();

    const perPage = Math.min(Math.max(Number(c.req.query('per_page')) || 25, 1), 200);
    const page = Math.max(Number(c.req.query('page')) || 1, 1);
    const offset = (page - 1) * perPage;

    const [countRes, rowsRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM dream_nouns'),
      pool.query(
        `SELECT ${SELECT_COLS} FROM dream_nouns ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [perPage, offset],
      ),
    ]);
    const total: number = countRes.rows[0].n;
    const lastPage = Math.max(Math.ceil(total / perPage), 1);
    const path = `${PUBLIC_API_BASE}/api/dream-nouns`;
    const pageUrl = (p: number) => `${path}?per_page=${perPage}&page=${p}`;

    return c.json({
      data: rowsRes.rows.map(serializeDream),
      links: {
        first: pageUrl(1),
        last: pageUrl(lastPage),
        prev: page > 1 ? pageUrl(page - 1) : null,
        next: page < lastPage ? pageUrl(page + 1) : null,
      },
      meta: {
        current_page: page,
        from: total === 0 ? null : offset + 1,
        last_page: lastPage,
        per_page: perPage,
        to: total === 0 ? null : Math.min(offset + perPage, total),
        total,
        path,
      },
    });
  });

  // ── Serve an uploaded custom-trait image ─────────────────────────────
  app.get('/api/dream-nouns/:id/image', async c => {
    if (!pool) return c.json({ error: 'storage unavailable' }, 503);
    await ensureInit();
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad id' }, 400);
    const res = await pool.query(
      'SELECT custom_trait_data, custom_trait_mime FROM dream_nouns WHERE id = $1',
      [id],
    );
    const row = res.rows[0];
    if (!row?.custom_trait_data) return c.json({ error: 'not found' }, 404);
    return c.body(new Uint8Array(row.custom_trait_data), 200, {
      'Content-Type': row.custom_trait_mime ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  // ── Create (multipart form, matches what probeSync.ts sends) ─────────
  app.post('/api/dream-nouns', async c => {
    if (!pool) return c.json({ error: 'storage unavailable' }, 503);
    await ensureInit();

    const body = await c.req.parseBody();
    const dreamer = String(body.dreamer ?? '');
    if (!/^0x[a-fA-F0-9]{40}$/.test(dreamer)) return c.json({ error: 'invalid dreamer' }, 422);

    const background = parseSeed(body.background_seed_id) ?? 0;
    const seeds = {
      accessory: parseSeed(body.accessory_seed_id),
      body: parseSeed(body.body_seed_id),
      glasses: parseSeed(body.glasses_seed_id),
      head: parseSeed(body.head_seed_id),
    };

    let layer: string | null = null;
    let imageData: Buffer | null = null;
    let imageMime: string | null = null;
    let imagePath: string | null = null;

    const file = body.custom_trait_image;
    if (file instanceof File) {
      layer = String(body.custom_trait_layer ?? '');
      if (!VALID_LAYERS.has(layer)) return c.json({ error: 'invalid custom_trait_layer' }, 422);
      if (!VALID_MIMES.has(file.type)) return c.json({ error: 'unsupported image type' }, 422);
      if (file.size > MAX_IMAGE_BYTES) return c.json({ error: 'image too large' }, 422);
      imageData = Buffer.from(await file.arrayBuffer());
      imageMime = file.type;
      const safeName = (file.name || 'upload.png').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      imagePath = `uploads/${layer}/${safeName}`;
    }

    const res = await pool.query(
      `INSERT INTO dream_nouns
         (id, dreamer, accessory_seed_id, background_seed_id, body_seed_id,
          glasses_seed_id, head_seed_id, custom_trait_layer, custom_trait_image,
          custom_trait_data, custom_trait_mime)
       VALUES (nextval('dream_nouns_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SELECT_COLS}`,
      [
        dreamer,
        seeds.accessory,
        background,
        seeds.body,
        seeds.glasses,
        seeds.head,
        layer,
        imagePath,
        imageData,
        imageMime,
      ],
    );
    console.log(`[Dreams] created dream ${res.rows[0].id} by ${dreamer}`);
    return c.json({ data: serializeDream(res.rows[0]) }, 201);
  });

  // ── One-time import of the probe.wtf dump (only into an empty table) ─
  app.post('/api/dream-nouns/import', async c => {
    if (!pool) return c.json({ error: 'storage unavailable' }, 503);
    await ensureInit();

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM dream_nouns');
    if (count.rows[0].n > 0) {
      return c.json({ error: 'table not empty — import refused' }, 409);
    }

    const dump = (await c.req.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(dump) || dump.length === 0) return c.json({ error: 'empty dump' }, 422);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const d of dump) {
        await client.query(
          `INSERT INTO dream_nouns
             (id, dreamer, accessory_seed_id, background_seed_id, body_seed_id,
              glasses_seed_id, head_seed_id, custom_trait_layer, custom_trait_image,
              created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            d.id,
            d.dreamer,
            d.accessory_seed_id,
            d.background_seed_id ?? 0,
            d.body_seed_id,
            d.glasses_seed_id,
            d.head_seed_id,
            d.custom_trait_layer,
            d.custom_trait_image,
            d.created_at,
            d.updated_at ?? d.created_at,
          ],
        );
      }
      await client.query(
        `SELECT setval('dream_nouns_id_seq', (SELECT MAX(id) FROM dream_nouns))`,
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    console.log(`[Dreams] imported ${dump.length} dreams from probe.wtf dump`);
    return c.json({ imported: dump.length });
  });
}

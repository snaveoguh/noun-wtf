#!/usr/bin/env node
// One-shot: rebuild the delegate_noun rows in nouns-prod from on-chain truth.
//
// The current V1 indexer never populated delegate_noun (handler bug — fix
// lives on claude/v1-delegate-noun-fix but can't deploy without a multi-hour
// resync). This script bypasses Ponder and writes directly to the prod
// Postgres schema:
//
//   1. Read every noun row → (nounId, owner)
//   2. Multicall V1 token.delegates(owner) for each unique owner
//   3. Wipe delegate_noun, then bulk-insert (delegate, nounId) rows
//
// Run with `railway run` so DATABASE_URL + RPC URL come from prod env:
//   railway link -p spirited-flexibility -s spirited-flexibility
//   railway run --service spirited-flexibility -- \
//     node packages/nouns-api/scripts/backfill-v1-delegate-noun.mjs
//
// Or locally with explicit env:
//   DATABASE_URL=... PONDER_RPC_URL_1=... node ...

import pg from 'pg';
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';

const NOUNS_TOKEN = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03';
const RPC_URL = (process.env.PONDER_RPC_URL_1 ?? '').split(',').filter(Boolean)[0];
const DRY_RUN = process.argv.includes('--dry-run');
// Each Ponder deploy creates a fresh schema named after $RAILWAY_DEPLOYMENT_ID.
// Auto-detect the most-recently-touched one so we always backfill the schema
// the live API is currently reading from.
let SCHEMA = process.env.PONDER_SCHEMA;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Run via `railway run` or export it.');
  process.exit(1);
}
if (!RPC_URL) {
  console.error('PONDER_RPC_URL_1 not set.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const rpc = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });

const TOKEN_ABI = parseAbi([
  'function delegates(address account) view returns (address)',
]);

async function main() {
  await client.connect();
  if (!SCHEMA) {
    // Pick the most recently CREATED user schema that owns a `nouns` table.
    // Each Ponder deploy uses --schema $RAILWAY_DEPLOYMENT_ID, so the newest
    // schema is the one the live API is currently reading from.
    const r = await client.query(`
      SELECT n.nspname AS schema
      FROM pg_namespace n
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = 'nouns'
      WHERE n.nspname NOT LIKE 'pg_%'
        AND n.nspname NOT IN ('information_schema', 'public', 'ponder_sync')
      ORDER BY n.oid DESC
      LIMIT 1
    `);
    if (r.rows.length === 0) throw new Error('no schema with a nouns table found');
    SCHEMA = r.rows[0].schema;
  }
  console.log(`Connected to Postgres. Schema: ${SCHEMA}`);

  const { rows: nouns } = await client.query(
    `SELECT id, owner FROM "${SCHEMA}".nouns ORDER BY id`,
  );
  console.log(`Found ${nouns.length} noun rows.`);

  const uniqueOwners = [...new Set(nouns.map(n => n.owner.toLowerCase()))];
  console.log(`Unique owners: ${uniqueOwners.length}. Resolving delegates via multicall...`);

  // Batch the multicall — viem chunks internally but we cap explicitly so a
  // bad batch doesn't kill the whole job. mcCallAddress is the standard
  // multicall3 deployed on mainnet.
  const ownerToDelegate = new Map();
  const BATCH = 100;
  for (let i = 0; i < uniqueOwners.length; i += BATCH) {
    const slice = uniqueOwners.slice(i, i + BATCH);
    const calls = slice.map(addr => ({
      address: NOUNS_TOKEN,
      abi: TOKEN_ABI,
      functionName: 'delegates',
      args: [addr],
    }));
    const results = await rpc.multicall({ contracts: calls, allowFailure: true });
    results.forEach((r, j) => {
      const owner = slice[j];
      if (r.status === 'success') {
        const delegate = r.result.toLowerCase();
        // ERC721Checkpointable returns 0x0 when never delegated → defaults to self
        ownerToDelegate.set(
          owner,
          delegate === '0x0000000000000000000000000000000000000000' ? owner : delegate,
        );
      } else {
        console.warn(`  delegates(${owner}) failed:`, r.error?.shortMessage ?? r.error);
        ownerToDelegate.set(owner, owner); // safe fallback: self-delegation
      }
    });
    process.stdout.write(`\r  resolved ${Math.min(i + BATCH, uniqueOwners.length)} / ${uniqueOwners.length}`);
  }
  console.log();

  const rows = nouns.map(n => ({
    delegate_id: ownerToDelegate.get(n.owner.toLowerCase()),
    noun_id: n.id, // bigint, pg pass-through
  }));
  console.log(`Built ${rows.length} delegate_noun rows.`);

  if (DRY_RUN) {
    console.log('DRY RUN — not writing. Sample 5 rows:');
    console.table(rows.slice(0, 5));
    return;
  }

  await client.query('BEGIN');
  // Skip Ponder's live_query() trigger — it references live_query_tables which
  // is created lazily on first subscription, so plain INSERT/TRUNCATE outside
  // Ponder's normal write path crashes.
  await client.query("SET LOCAL session_replication_role = 'replica'");
  await client.query(`TRUNCATE TABLE "${SCHEMA}".delegate_noun`);
  // Bulk insert via multi-row VALUES — much faster than per-row inserts.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice
      .map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`)
      .join(', ');
    const params = slice.flatMap(r => [r.delegate_id, r.noun_id]);
    await client.query(
      `INSERT INTO "${SCHEMA}".delegate_noun (delegate_id, noun_id) VALUES ${values}`,
      params,
    );
    process.stdout.write(`\r  inserted ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`);
  }
  console.log();
  await client.query('COMMIT');

  const { rows: verify } = await client.query(
    `SELECT COUNT(*)::int AS n FROM "${SCHEMA}".delegate_noun`,
  );
  console.log(`Done. delegate_noun row count: ${verify[0].n}`);
}

main()
  .catch(async err => {
    console.error('Backfill failed:', err);
    await client.query('ROLLBACK').catch(() => {});
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });

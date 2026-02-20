// Cleanup old Ponder schemas to free disk space
// Ponder creates a new schema for each deployment ID
import pg from 'pg';

const client = new pg.Client(process.env.DATABASE_URL);

async function cleanup() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Get database size
    const sizeRes = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    console.log('Database size:', sizeRes.rows[0].size);

    // List all schemas
    const schemas = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'public', 'pg_toast')
      ORDER BY schema_name
    `);
    console.log('Non-system schemas:', schemas.rows.map(r => r.schema_name));

    // Drop ALL non-system schemas (Ponder will recreate its own)
    for (const row of schemas.rows) {
      console.log(`Dropping schema: ${row.schema_name}`);
      await client.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
    }

    // Also clean up public tables (Ponder stores some data there)
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT IN ('pg_stat_statements')
    `);
    for (const row of tables.rows) {
      console.log(`Dropping public table: ${row.tablename}`);
      await client.query(`DROP TABLE IF EXISTS public."${row.tablename}" CASCADE`);
    }

    // VACUUM to reclaim disk space
    await client.query('VACUUM FULL');
    console.log('VACUUM FULL complete');

    // Check size after cleanup
    const newSize = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    console.log('Database size after cleanup:', newSize.rows[0].size);

  } catch (err) {
    console.error('Cleanup error:', err.message);
  } finally {
    await client.end();
  }
}

cleanup();

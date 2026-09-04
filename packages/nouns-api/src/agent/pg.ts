// ─── Shared Postgres pool ────────────────────────────────────────────────────
//
// One lazily-created `pg.Pool` for the agent-side tables that are NOT managed
// by Ponder (autopilot delegations + votes today). `memory.ts` / `peopleDb.ts`
// / `reservations.ts` still own their own pools — migrating them is out of
// scope; new tables should use this one.
//
// Returns `null` when `DATABASE_URL` is unset so callers can fall back to an
// in-memory store (the self-test + local dev run without Postgres).

// No @types/pg in this workspace (memory.ts / peopleDb.ts carry the same
// implicit-any import). The surface we use is small enough to type by hand.
// @ts-expect-error no declaration file for 'pg'
import pg from 'pg';

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface Pool {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
  on(event: 'error', listener: (err: Error) => void): void;
  end(): Promise<void>;
}

let pool: Pool | null | undefined;

export function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    pool = null;
    return pool;
  }
  const created: Pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool = created;
  created.on('error', (err: Error) => {
    console.error('[pg] idle client error:', err instanceof Error ? err.message : err);
  });
  return pool;
}

export function hasPostgres(): boolean {
  return getPool() !== null;
}

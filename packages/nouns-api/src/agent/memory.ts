// ─── Agent NounIRL — Persistent Memory ───────────────────────────────────────
//
// Cross-session memory for both NounIRL and homepage chat. Stores:
// 1. Per-wallet facts (name, preferences, past interactions)
// 2. Global agent memory (learned facts, cultural context)
//
// Uses Railway Postgres (same pool as reservations). Falls back to JSON file.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  key: string;       // e.g. "wallet:0x123:name" or "global:fact:42"
  scope: string;     // "wallet:<addr>" or "global"
  content: string;   // the remembered fact/preference
  createdAt: number; // unix timestamp (seconds)
  updatedAt: number;
}

// ─── Postgres Pool (shared with reservations) ────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
let pool: pg.Pool | null = null;

if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const MEMORY_FILE = '/tmp/nounirl-memory.json';

// ─── SQL Schema ──────────────────────────────────────────────────────────

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_scope ON agent_memory(scope);
`;

let dbInitialized = false;

async function ensureDb(): Promise<void> {
  if (dbInitialized || !pool) return;
  try {
    await pool.query(INIT_SQL);
    dbInitialized = true;
    console.log('[Memory] Postgres table initialized');
  } catch (err) {
    console.error('[Memory] Postgres init failed:', err);
  }
}

// ─── File Fallback ───────────────────────────────────────────────────────

function loadFileMemory(): Map<string, MemoryEntry> {
  try {
    if (existsSync(MEMORY_FILE)) {
      const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch { /* fresh start */ }
  return new Map();
}

function saveFileMemory(mem: Map<string, MemoryEntry>): void {
  try {
    writeFileSync(MEMORY_FILE, JSON.stringify(Object.fromEntries(mem), null, 2));
  } catch { /* non-fatal */ }
}

const fileMemory = loadFileMemory();

// ─── Memory Store ────────────────────────────────────────────────────────

export async function remember(scope: string, key: string, content: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fullKey = `${scope}:${key}`;
  const entry: MemoryEntry = { key: fullKey, scope, content, createdAt: now, updatedAt: now };

  if (pool) {
    await ensureDb();
    try {
      await pool.query(
        `INSERT INTO agent_memory (key, scope, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET content = $3, updated_at = $5`,
        [fullKey, scope, content, now, now],
      );
      return;
    } catch (err) {
      console.error('[Memory] Postgres write failed, falling back to file:', err);
    }
  }

  // File fallback
  fileMemory.set(fullKey, entry);
  saveFileMemory(fileMemory);
}

export async function recall(scope: string, key?: string): Promise<MemoryEntry[]> {
  if (pool) {
    await ensureDb();
    try {
      if (key) {
        const fullKey = `${scope}:${key}`;
        const res = await pool.query('SELECT * FROM agent_memory WHERE key = $1', [fullKey]);
        return res.rows.map(rowToEntry);
      }
      const res = await pool.query(
        'SELECT * FROM agent_memory WHERE scope = $1 ORDER BY updated_at DESC LIMIT 50',
        [scope],
      );
      return res.rows.map(rowToEntry);
    } catch (err) {
      console.error('[Memory] Postgres read failed, falling back to file:', err);
    }
  }

  // File fallback
  const entries: MemoryEntry[] = [];
  for (const [, entry] of fileMemory) {
    if (key) {
      if (entry.key === `${scope}:${key}`) entries.push(entry);
    } else if (entry.scope === scope) {
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}

export async function forget(scope: string, key: string): Promise<void> {
  const fullKey = `${scope}:${key}`;

  if (pool) {
    await ensureDb();
    try {
      await pool.query('DELETE FROM agent_memory WHERE key = $1', [fullKey]);
      return;
    } catch { /* fallback */ }
  }

  fileMemory.delete(fullKey);
  saveFileMemory(fileMemory);
}

export async function recallAll(): Promise<MemoryEntry[]> {
  if (pool) {
    await ensureDb();
    try {
      const res = await pool.query(
        'SELECT * FROM agent_memory ORDER BY updated_at DESC LIMIT 100',
      );
      return res.rows.map(rowToEntry);
    } catch { /* fallback */ }
  }

  return Array.from(fileMemory.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);
}

export async function countByScope(scope: string): Promise<number> {
  if (pool) {
    await ensureDb();
    try {
      const res = await pool.query(
        'SELECT COUNT(*) as count FROM agent_memory WHERE scope = $1',
        [scope],
      );
      return parseInt(res.rows[0]?.count || '0', 10);
    } catch { /* fallback */ }
  }

  let count = 0;
  for (const [, entry] of fileMemory) {
    if (entry.scope === scope) count++;
  }
  return count;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(row: any): MemoryEntry {
  return {
    key: row.key,
    scope: row.scope,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Build a memory context string to inject into the system prompt.
 * Returns relevant memories for a wallet + global memories.
 */
export async function buildMemoryContext(wallet?: string): Promise<string> {
  const parts: string[] = [];

  // Learned knowledge (from URL ingestion)
  const knowledgeMem = await recall('knowledge');
  if (knowledgeMem.length > 0) {
    parts.push('LEARNED KNOWLEDGE (from ingested sources):');
    for (const m of knowledgeMem.slice(0, 40)) {
      parts.push(`• ${m.content}`);
    }
  }

  // Global memories (agent-remembered facts)
  const globalMem = await recall('global');
  if (globalMem.length > 0) {
    parts.push('\nREMEMBERED FACTS:');
    for (const m of globalMem.slice(0, 20)) {
      const k = m.key.replace('global:', '');
      parts.push(`- ${k}: ${m.content}`);
    }
  }

  // Wallet-specific memories
  if (wallet) {
    const walletScope = `wallet:${wallet.toLowerCase()}`;
    const walletMem = await recall(walletScope);
    if (walletMem.length > 0) {
      parts.push(`\nREMEMBERED ABOUT THIS USER (${wallet.slice(0, 6)}...${wallet.slice(-4)}):`);
      for (const m of walletMem.slice(0, 15)) {
        const k = m.key.replace(`${walletScope}:`, '');
        parts.push(`- ${k}: ${m.content}`);
      }
    }
  }

  return parts.length > 0 ? '\n\n' + parts.join('\n') : '';
}

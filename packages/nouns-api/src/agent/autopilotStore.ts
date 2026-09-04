// ─── Autopilot store — delegations + auto-votes ─────────────────────────────
//
// Two tables on the shared agent pool (`pg.ts`), created on first use:
//
//   autopilot_delegations  one row per signed ERC-7710 delegation a voter has
//                          handed the relayer (scoped to one governor).
//   autopilot_votes        one row per relayer decision about (address, dao,
//                          proposal) — including skips and failures, so every
//                          decision is explainable from the row alone.
//
// All timestamps stored + returned are unix MILLISECONDS (`expires_at` too —
// the delegation's TimestampEnforcer seconds are ×1000 on insert).
//
// Without `DATABASE_URL` the store is an in-process Map (self-test / local dev).

import type { AutopilotDao } from './autopilotPrefs.js';

import { randomUUID } from 'node:crypto';

import { getPool } from './pg.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DelegationRow {
  id: string;
  address: string; // lowercase delegator
  dao: AutopilotDao;
  delegationJson: string; // `serializeDelegation` output, verbatim
  delegationHash: string; // 0x… struct hash (== DelegationManager.getDelegationHash)
  redeemer: string; // lowercase relayer address baked into the delegation
  expiresAt: number; // ms
  maxVotes: number | null;
  uses: number;
  createdAt: number; // ms
  revokedAt: number | null; // ms
  onchainDisabledCheckedAt: number | null; // ms
}

export type VoteStatus = 'queued' | 'simulated' | 'sent' | 'confirmed' | 'failed' | 'skipped';

export interface VoteRow {
  id: string;
  address: string;
  dao: AutopilotDao;
  proposalId: number;
  support: number | null; // 0 against / 1 for / 2 abstain / null when skipped without a stance
  reason: string; // the vote reason text OR the skip explanation
  confidence: number | null;
  txHash: string | null;
  status: VoteStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export class DuplicateDelegationError extends Error {
  constructor(public readonly hash: string) {
    super(`delegation ${hash} already stored`);
    this.name = 'DuplicateDelegationError';
  }
}

export const isDelegationActive = (d: DelegationRow, now = Date.now()): boolean =>
  d.revokedAt == null && d.expiresAt > now && (d.maxVotes == null || d.uses < d.maxVotes);

/** Statuses that mean "the relayer is on it / has done it" — never re-decide these. */
export const VOTE_IN_FLIGHT: readonly VoteStatus[] = ['queued', 'simulated', 'sent', 'confirmed'];

// ─── Schema ────────────────────────────────────────────────────────────────

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS autopilot_delegations (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    dao TEXT NOT NULL,
    delegation_json TEXT NOT NULL,
    delegation_hash TEXT NOT NULL UNIQUE,
    redeemer TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    max_votes INT NULL,
    uses INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    revoked_at BIGINT NULL,
    onchain_disabled_checked_at BIGINT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_autopilot_delegations_address ON autopilot_delegations(address);
  CREATE TABLE IF NOT EXISTS autopilot_votes (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    dao TEXT NOT NULL,
    proposal_id BIGINT NOT NULL,
    support INT NULL,
    reason TEXT NOT NULL DEFAULT '',
    confidence REAL NULL,
    tx_hash TEXT NULL,
    status TEXT NOT NULL,
    error TEXT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_autopilot_votes_address ON autopilot_votes(address);
  CREATE INDEX IF NOT EXISTS idx_autopilot_votes_dao_proposal ON autopilot_votes(dao, proposal_id);
`;

let initPromise: Promise<boolean> | null = null;

/** Ensure the tables exist. Resolves false (and logs) when Postgres is unavailable. */
async function ensureDb(): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const running =
    initPromise ??
    pool
      .query(INIT_SQL)
      .then(() => {
        console.log('[Autopilot] Postgres tables ready');
        return true;
      })
      .catch((err: unknown) => {
        console.error('[Autopilot] Postgres init failed:', err);
        initPromise = null;
        return false;
      });
  initPromise = running;
  return running;
}

// ─── In-memory fallback ────────────────────────────────────────────────────

const memDelegations = new Map<string, DelegationRow>();
const memVotes = new Map<string, VoteRow>();

export function storeBackend(): 'postgres' | 'memory' {
  return getPool() ? 'postgres' : 'memory';
}

/** Test hook — wipe the in-memory maps. No-op against Postgres. */
export function clearMemoryStore(): void {
  memDelegations.clear();
  memVotes.clear();
}

// ─── Row mappers ───────────────────────────────────────────────────────────

const n = (x: unknown): number => Number(x);
const nOrNull = (x: unknown): number | null => (x == null ? null : Number(x));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDelegation(r: any): DelegationRow {
  return {
    id: r.id,
    address: r.address,
    dao: r.dao,
    delegationJson: r.delegation_json,
    delegationHash: r.delegation_hash,
    redeemer: r.redeemer,
    expiresAt: n(r.expires_at),
    maxVotes: nOrNull(r.max_votes),
    uses: n(r.uses),
    createdAt: n(r.created_at),
    revokedAt: nOrNull(r.revoked_at),
    onchainDisabledCheckedAt: nOrNull(r.onchain_disabled_checked_at),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToVote(r: any): VoteRow {
  return {
    id: r.id,
    address: r.address,
    dao: r.dao,
    proposalId: n(r.proposal_id),
    support: nOrNull(r.support),
    reason: r.reason ?? '',
    confidence: nOrNull(r.confidence),
    txHash: r.tx_hash ?? null,
    status: r.status,
    error: r.error ?? null,
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
  };
}

// ─── Delegations ───────────────────────────────────────────────────────────

export type NewDelegation = Omit<
  DelegationRow,
  'id' | 'uses' | 'createdAt' | 'revokedAt' | 'onchainDisabledCheckedAt'
>;

export async function insertDelegation(input: NewDelegation): Promise<DelegationRow> {
  const row: DelegationRow = {
    ...input,
    address: input.address.toLowerCase(),
    redeemer: input.redeemer.toLowerCase(),
    delegationHash: input.delegationHash.toLowerCase(),
    id: randomUUID(),
    uses: 0,
    createdAt: Date.now(),
    revokedAt: null,
    onchainDisabledCheckedAt: null,
  };
  if (await ensureDb()) {
    try {
      await getPool()!.query(
        `INSERT INTO autopilot_delegations
           (id, address, dao, delegation_json, delegation_hash, redeemer, expires_at, max_votes, uses, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9)`,
        [
          row.id,
          row.address,
          row.dao,
          row.delegationJson,
          row.delegationHash,
          row.redeemer,
          row.expiresAt,
          row.maxVotes,
          row.createdAt,
        ],
      );
      return row;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new DuplicateDelegationError(row.delegationHash);
      }
      throw err;
    }
  }
  for (const d of memDelegations.values()) {
    if (d.delegationHash === row.delegationHash)
      throw new DuplicateDelegationError(row.delegationHash);
  }
  memDelegations.set(row.id, row);
  return row;
}

export async function listDelegations(address: string): Promise<DelegationRow[]> {
  const a = address.toLowerCase();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      'SELECT * FROM autopilot_delegations WHERE address = $1 ORDER BY created_at DESC LIMIT 100',
      [a],
    );
    return res.rows.map(rowToDelegation);
  }
  return [...memDelegations.values()]
    .filter(d => d.address === a)
    .sort((x, y) => y.createdAt - x.createdAt);
}

export async function getDelegation(address: string, id: string): Promise<DelegationRow | null> {
  const a = address.toLowerCase();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      'SELECT * FROM autopilot_delegations WHERE id = $1 AND address = $2',
      [id, a],
    );
    return res.rows[0] ? rowToDelegation(res.rows[0]) : null;
  }
  const d = memDelegations.get(id);
  return d && d.address === a ? d : null;
}

/** Active (not revoked, not expired, not exhausted) delegations — optionally for one address. */
export async function listActiveDelegations(address?: string): Promise<DelegationRow[]> {
  const now = Date.now();
  if (await ensureDb()) {
    const res = address
      ? await getPool()!.query(
          `SELECT * FROM autopilot_delegations
           WHERE address = $1 AND revoked_at IS NULL AND expires_at > $2
             AND (max_votes IS NULL OR uses < max_votes)
           ORDER BY created_at DESC`,
          [address.toLowerCase(), now],
        )
      : await getPool()!.query(
          `SELECT * FROM autopilot_delegations
           WHERE revoked_at IS NULL AND expires_at > $1
             AND (max_votes IS NULL OR uses < max_votes)
           ORDER BY created_at DESC`,
          [now],
        );
    return res.rows.map(rowToDelegation);
  }
  return [...memDelegations.values()]
    .filter(d => isDelegationActive(d, now) && (!address || d.address === address.toLowerCase()))
    .sort((x, y) => y.createdAt - x.createdAt);
}

/** Distinct lowercase addresses that hold ≥ 1 active delegation. */
export async function listAutoWallets(): Promise<string[]> {
  const rows = await listActiveDelegations();
  return [...new Set(rows.map(r => r.address))];
}

export async function revokeDelegation(address: string, id: string): Promise<boolean> {
  const a = address.toLowerCase();
  const now = Date.now();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      'UPDATE autopilot_delegations SET revoked_at = $3 WHERE id = $1 AND address = $2 AND revoked_at IS NULL',
      [id, a, now],
    );
    return (res.rowCount ?? 0) > 0;
  }
  const d = memDelegations.get(id);
  if (!d || d.address !== a || d.revokedAt != null) return false;
  d.revokedAt = now;
  return true;
}

export async function bumpDelegationUses(id: string): Promise<void> {
  if (await ensureDb()) {
    await getPool()!.query('UPDATE autopilot_delegations SET uses = uses + 1 WHERE id = $1', [id]);
    return;
  }
  const d = memDelegations.get(id);
  if (d) d.uses++;
}

export async function markDelegationChecked(id: string, at = Date.now()): Promise<void> {
  if (await ensureDb()) {
    await getPool()!.query(
      'UPDATE autopilot_delegations SET onchain_disabled_checked_at = $2 WHERE id = $1',
      [id, at],
    );
    return;
  }
  const d = memDelegations.get(id);
  if (d) d.onchainDisabledCheckedAt = at;
}

// ─── Votes ─────────────────────────────────────────────────────────────────

export type NewVote = Omit<VoteRow, 'id' | 'createdAt' | 'updatedAt'>;

export async function insertVote(input: NewVote): Promise<VoteRow> {
  const now = Date.now();
  const row: VoteRow = {
    ...input,
    address: input.address.toLowerCase(),
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  if (await ensureDb()) {
    await getPool()!.query(
      `INSERT INTO autopilot_votes
         (id, address, dao, proposal_id, support, reason, confidence, tx_hash, status, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.id,
        row.address,
        row.dao,
        row.proposalId,
        row.support,
        row.reason,
        row.confidence,
        row.txHash,
        row.status,
        row.error,
        row.createdAt,
        row.updatedAt,
      ],
    );
    return row;
  }
  memVotes.set(row.id, row);
  return row;
}

export async function updateVote(
  id: string,
  patch: Partial<
    Pick<VoteRow, 'support' | 'reason' | 'confidence' | 'txHash' | 'status' | 'error'>
  >,
): Promise<VoteRow | null> {
  const now = Date.now();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      `UPDATE autopilot_votes SET
         support = COALESCE($2, support),
         reason = COALESCE($3, reason),
         confidence = COALESCE($4, confidence),
         tx_hash = COALESCE($5, tx_hash),
         status = COALESCE($6, status),
         error = CASE WHEN $8 THEN $7 ELSE error END,
         updated_at = $9
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.support ?? null,
        patch.reason ?? null,
        patch.confidence ?? null,
        patch.txHash ?? null,
        patch.status ?? null,
        patch.error ?? null,
        'error' in patch,
        now,
      ],
    );
    return res.rows[0] ? rowToVote(res.rows[0]) : null;
  }
  const v = memVotes.get(id);
  if (!v) return null;
  if (patch.support !== undefined && patch.support !== null) v.support = patch.support;
  if (patch.reason != null) v.reason = patch.reason;
  if (patch.confidence != null) v.confidence = patch.confidence;
  if (patch.txHash != null) v.txHash = patch.txHash;
  if (patch.status != null) v.status = patch.status;
  if ('error' in patch) v.error = patch.error ?? null;
  v.updatedAt = now;
  return v;
}

/** Most recent row for (address, dao, proposalId), or null. */
export async function findVote(
  address: string,
  dao: AutopilotDao,
  proposalId: number,
): Promise<VoteRow | null> {
  const a = address.toLowerCase();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      `SELECT * FROM autopilot_votes WHERE address = $1 AND dao = $2 AND proposal_id = $3
       ORDER BY updated_at DESC LIMIT 1`,
      [a, dao, proposalId],
    );
    return res.rows[0] ? rowToVote(res.rows[0]) : null;
  }
  return (
    [...memVotes.values()]
      .filter(v => v.address === a && v.dao === dao && v.proposalId === proposalId)
      .sort((x, y) => y.updatedAt - x.updatedAt)[0] ?? null
  );
}

export async function listVotes(address: string, limit = 20): Promise<VoteRow[]> {
  const a = address.toLowerCase();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      'SELECT * FROM autopilot_votes WHERE address = $1 ORDER BY updated_at DESC LIMIT $2',
      [a, limit],
    );
    return res.rows.map(rowToVote);
  }
  return [...memVotes.values()]
    .filter(v => v.address === a)
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .slice(0, limit);
}

export async function listRecentVotes(limit = 10): Promise<VoteRow[]> {
  if (await ensureDb()) {
    const res = await getPool()!.query(
      'SELECT * FROM autopilot_votes ORDER BY updated_at DESC LIMIT $1',
      [limit],
    );
    return res.rows.map(rowToVote);
  }
  return [...memVotes.values()].sort((x, y) => y.updatedAt - x.updatedAt).slice(0, limit);
}

/** Rows that are in flight (sent, awaiting receipt) — for the status endpoint. */
export async function countVotesByStatus(status: VoteStatus): Promise<number> {
  if (await ensureDb()) {
    const res = await getPool()!.query(
      'SELECT COUNT(*) AS n FROM autopilot_votes WHERE status = $1',
      [status],
    );
    return Number(res.rows[0]?.n ?? 0);
  }
  return [...memVotes.values()].filter(v => v.status === status).length;
}

/** Last row that actually reached the chain (sent / confirmed) for a wallet. */
export async function lastAutoVote(address: string): Promise<VoteRow | null> {
  const a = address.toLowerCase();
  if (await ensureDb()) {
    const res = await getPool()!.query(
      `SELECT * FROM autopilot_votes WHERE address = $1 AND status IN ('sent','confirmed')
       ORDER BY updated_at DESC LIMIT 1`,
      [a],
    );
    return res.rows[0] ? rowToVote(res.rows[0]) : null;
  }
  return (
    [...memVotes.values()]
      .filter(v => v.address === a && (v.status === 'sent' || v.status === 'confirmed'))
      .sort((x, y) => y.updatedAt - x.updatedAt)[0] ?? null
  );
}

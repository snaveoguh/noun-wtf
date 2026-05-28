// ─── Agent NounIRL — Reservation Store ──────────────────────────────────────
//
// In-memory reservation store with Postgres persistence.
// V2: uses DATABASE_URL (Railway Postgres) so reservations survive deploys.
// Falls back to /tmp/ JSON files if no DATABASE_URL is set.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';
import { bridgePublish } from './bridge.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Reservation {
  id: string;
  wallet: string;             // tipper address (checksummed)
  tipTxHash: string;          // transaction hash of the tip
  tipChainId: number;         // chain ID where tip was sent
  tipAmountEth: number;       // tip amount in ETH
  traits: string[];           // e.g. ["head:shark", "glasses:blue"]
  settleFor?: string;         // optional: settle to a different address
  status: 'pending_verification' | 'active' | 'fulfilled' | 'expired' | 'cancelled';
  createdAt: number;          // unix timestamp (seconds)
  fulfilledAt?: number;       // when settled
  fulfilledNounId?: number;   // which noun was settled
  fulfilledTxHash?: string;   // settlement tx hash
}

export interface Settlement {
  id: string;
  nounId: number;
  txHash: string;
  reservationId: string;
  matchedTraits: Record<string, string>; // category → matched name
  blockNumber: number;
  settledAt: number;          // unix timestamp
  gasUsed?: string;
}

// ─── Postgres Pool ────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
let pool: pg.Pool | null = null;

if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 3,               // small pool — agent doesn't need many connections
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  console.log('[NounIRL] Postgres pool created for reservation persistence');
}

// ─── File Fallback Paths ──────────────────────────────────────────────────

const PERSISTENCE_PATH = process.env.NOUNIRL_DATA_PATH || '/tmp/nounirl-reservations.json';
const SETTLEMENTS_PATH = process.env.NOUNIRL_SETTLEMENTS_PATH || '/tmp/nounirl-settlements.json';

// ─── SQL Schema ───────────────────────────────────────────────────────────

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS nounirl_reservations (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    tip_tx_hash TEXT NOT NULL,
    tip_chain_id INTEGER NOT NULL,
    tip_amount_eth DOUBLE PRECISION NOT NULL,
    traits JSONB NOT NULL DEFAULT '[]',
    settle_for TEXT,
    status TEXT NOT NULL DEFAULT 'pending_verification',
    created_at INTEGER NOT NULL,
    fulfilled_at INTEGER,
    fulfilled_noun_id INTEGER,
    fulfilled_tx_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS nounirl_settlements (
    id TEXT PRIMARY KEY,
    noun_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    reservation_id TEXT NOT NULL,
    matched_traits JSONB NOT NULL DEFAULT '{}',
    block_number INTEGER NOT NULL,
    settled_at INTEGER NOT NULL,
    gas_used TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_reservations_status ON nounirl_reservations(status);
  CREATE INDEX IF NOT EXISTS idx_reservations_wallet ON nounirl_reservations(wallet);
  CREATE INDEX IF NOT EXISTS idx_reservations_tip_tx ON nounirl_reservations(tip_tx_hash);
`;

// ─── Row ↔ Type Conversions ───────────────────────────────────────────────

function rowToReservation(row: any): Reservation {
  return {
    id: row.id,
    wallet: row.wallet,
    tipTxHash: row.tip_tx_hash,
    tipChainId: row.tip_chain_id,
    tipAmountEth: row.tip_amount_eth,
    traits: row.traits,
    settleFor: row.settle_for || undefined,
    status: row.status,
    createdAt: row.created_at,
    fulfilledAt: row.fulfilled_at || undefined,
    fulfilledNounId: row.fulfilled_noun_id || undefined,
    fulfilledTxHash: row.fulfilled_tx_hash || undefined,
  };
}

function rowToSettlement(row: any): Settlement {
  return {
    id: row.id,
    nounId: row.noun_id,
    txHash: row.tx_hash,
    reservationId: row.reservation_id,
    matchedTraits: row.matched_traits,
    blockNumber: row.block_number,
    settledAt: row.settled_at,
    gasUsed: row.gas_used || undefined,
  };
}

// ─── On-Chain Settle Attempt Tracking ──────────────────────────────────────
// Counts every settle tx the bot lands successfully on-chain, regardless of
// whether the resulting noun matches the predicted/reserved traits. This is
// the "did the bot actually settle?" counter, complementing the
// reservation-fulfilment counter (settlements[]).

export interface SettleAttempt {
  txHash: string;
  blockNumber: number;
  nounId: number;
  matched: boolean; // true = traits matched a reservation, false = predicted-vs-actual missed
  reservationId?: string;
  at: number;       // unix seconds
}

const SETTLE_ATTEMPT_RING_SIZE = 10;

// ─── Store ─────────────────────────────────────────────────────────────────

class ReservationStore {
  private reservations: Map<string, Reservation> = new Map();
  private settlements: Settlement[] = [];
  private settleAttempts: SettleAttempt[] = [];
  private totalOnchainSettlements = 0;
  private dirty = false;
  private pgReady = false;

  constructor() {
    // Sync load from file (fast, immediate)
    this.loadFromFile();
    // Async init Postgres (creates tables, loads data)
    if (pool) {
      this.initPostgres().catch((err) => {
        console.error('[NounIRL] Postgres init failed — using file fallback:', err);
      });
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  create(data: Omit<Reservation, 'id' | 'createdAt' | 'status'>): Reservation {
    const reservation: Reservation = {
      ...data,
      id: crypto.randomUUID(),
      status: 'pending_verification',
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.reservations.set(reservation.id, reservation);
    this.dirty = true;
    this.persistReservation(reservation);
    return reservation;
  }

  get(id: string): Reservation | undefined {
    return this.reservations.get(id);
  }

  getByWallet(wallet: string): Reservation[] {
    const lower = wallet.toLowerCase();
    return Array.from(this.reservations.values())
      .filter(r => r.wallet.toLowerCase() === lower);
  }

  getActive(): Reservation[] {
    return Array.from(this.reservations.values())
      .filter(r => r.status === 'active');
  }

  getAll(): Reservation[] {
    return Array.from(this.reservations.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  activate(id: string): void {
    const r = this.reservations.get(id);
    if (r && r.status === 'pending_verification') {
      r.status = 'active';
      this.dirty = true;
      this.updateReservationStatus(r);

      bridgePublish('reservation-activated', {
        reservationId: r.id,
        wallet: r.wallet,
        traits: r.traits,
        tipAmountEth: r.tipAmountEth,
      });
    }
  }

  /**
   * Persist a verified tip amount back to Postgres.
   * Callers used to mutate `r.tipAmountEth` directly after `verifyTip`, but
   * that change never made it to the DB (no UPDATE was issued), so every
   * reservation read back from Postgres showed `tipAmountEth: 0`. This method
   * mutates in-memory AND writes the new value to Postgres.
   */
  setTipAmount(id: string, amountEth: number): void {
    const r = this.reservations.get(id);
    if (!r) return;
    r.tipAmountEth = amountEth;
    this.dirty = true;
    this.persistToFile();
    void this.updateTipAmountInPg(id, amountEth);
  }

  private async updateTipAmountInPg(id: string, amountEth: number): Promise<void> {
    if (!pool || !this.pgReady) return;
    try {
      await pool.query(
        `UPDATE nounirl_reservations SET tip_amount_eth = $1 WHERE id = $2`,
        [amountEth, id],
      );
    } catch (err) {
      console.error('[NounIRL] Failed to update tip_amount_eth in Postgres:', err);
    }
  }

  fulfill(id: string, nounId: number, txHash: string): void {
    const r = this.reservations.get(id);
    if (r && r.status === 'active') {
      r.status = 'fulfilled';
      r.fulfilledAt = Math.floor(Date.now() / 1000);
      r.fulfilledNounId = nounId;
      r.fulfilledTxHash = txHash;
      this.dirty = true;
      this.updateReservationStatus(r);

      bridgePublish('reservation-fulfilled', {
        reservationId: r.id,
        wallet: r.wallet,
        traits: r.traits,
        nounId,
        txHash,
      });
    }
  }

  cancel(id: string): void {
    const r = this.reservations.get(id);
    if (r && (r.status === 'active' || r.status === 'pending_verification')) {
      r.status = 'cancelled';
      this.dirty = true;
      this.updateReservationStatus(r);
    }
  }

  // Check if a tip tx has already been used
  isTxUsed(txHash: string): boolean {
    // Only block reuse if the tx is tied to an active or fulfilled reservation.
    // Cancelled/expired reservations free up the tx hash for rebooking.
    return Array.from(this.reservations.values())
      .some(r => r.tipTxHash.toLowerCase() === txHash.toLowerCase()
        && (r.status === 'active' || r.status === 'pending_verification' || r.status === 'fulfilled'));
  }

  // ── Settlements ───────────────────────────────────────────────────────

  addSettlement(settlement: Omit<Settlement, 'id'>): Settlement {
    const s: Settlement = { ...settlement, id: crypto.randomUUID() };
    this.settlements.push(s);
    this.dirty = true;
    this.persistSettlement(s);
    return s;
  }

  getSettlements(limit = 20): Settlement[] {
    return this.settlements.slice(-limit).reverse();
  }

  /**
   * Record that the bot's settle tx landed on-chain successfully — independent
   * of whether the resulting noun matched a reservation's traits. This is the
   * accurate "how many auctions did the bot actually settle?" counter.
   *
   * `matched=true` lines up with `addSettlement` (reservation fulfilment).
   * `matched=false` means the tx succeeded but the predicted seed missed
   * (e.g. the bot was one block late and the seeder used a different block
   * hash), so the minted noun didn't satisfy the active reservation.
   */
  recordOnchainSettle(attempt: SettleAttempt): void {
    this.totalOnchainSettlements++;
    this.settleAttempts.push(attempt);
    if (this.settleAttempts.length > SETTLE_ATTEMPT_RING_SIZE) {
      this.settleAttempts.shift();
    }
  }

  getRecentSettleAttempts(): SettleAttempt[] {
    return [...this.settleAttempts].reverse();
  }

  /** Flip the most-recently recorded settle attempt's matched flag. Used
   *  after trait verification passes so the ring reflects which settles
   *  actually fulfilled the reservation. */
  markSettleAttemptMatched(txHash: string): void {
    for (let i = this.settleAttempts.length - 1; i >= 0; i--) {
      if (this.settleAttempts[i]?.txHash === txHash) {
        this.settleAttempts[i]!.matched = true;
        return;
      }
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────

  stats() {
    const all = Array.from(this.reservations.values());
    return {
      total: all.length,
      active: all.filter(r => r.status === 'active').length,
      pending: all.filter(r => r.status === 'pending_verification').length,
      fulfilled: all.filter(r => r.status === 'fulfilled').length,
      cancelled: all.filter(r => r.status === 'cancelled').length,
      // Reservations fulfilled (predicted seed matched, on-chain seed matched
      // the reservation traits). Kept for backwards compat.
      totalSettlements: this.settlements.length,
      // Every settle tx the bot landed on-chain, including ones where the
      // resulting noun didn't match the reservation. This is the real
      // "how active is the bot?" number.
      totalOnchainSettlements: this.totalOnchainSettlements,
    };
  }

  // ── Postgres Persistence ────────────────────────────────────────────

  private async initPostgres(): Promise<void> {
    if (!pool) return;

    try {
      await pool.query(INIT_SQL);
      console.log('[NounIRL] Postgres tables initialized');

      // Load reservations from Postgres
      const resResult = await pool.query(
        'SELECT * FROM nounirl_reservations ORDER BY created_at DESC'
      );
      for (const row of resResult.rows) {
        const r = rowToReservation(row);
        // Postgres is source of truth — overwrite in-memory
        this.reservations.set(r.id, r);
      }

      // Load settlements from Postgres
      const setResult = await pool.query(
        'SELECT * FROM nounirl_settlements ORDER BY settled_at ASC'
      );
      this.settlements = setResult.rows.map(rowToSettlement);

      this.pgReady = true;
      const activeCount = Array.from(this.reservations.values()).filter(r => r.status === 'active').length;
      console.log(`[NounIRL] Loaded ${resResult.rows.length} reservations (${activeCount} active) and ${setResult.rows.length} settlements from Postgres`);
    } catch (err) {
      console.error('[NounIRL] Failed to init Postgres tables:', err);
    }
  }

  private async persistReservation(r: Reservation): Promise<void> {
    // Always write file fallback
    this.persistToFile();

    if (!pool || !this.pgReady) return;
    try {
      await pool.query(
        `INSERT INTO nounirl_reservations (id, wallet, tip_tx_hash, tip_chain_id, tip_amount_eth, traits, settle_for, status, created_at, fulfilled_at, fulfilled_noun_id, fulfilled_tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           fulfilled_at = EXCLUDED.fulfilled_at,
           fulfilled_noun_id = EXCLUDED.fulfilled_noun_id,
           fulfilled_tx_hash = EXCLUDED.fulfilled_tx_hash`,
        [r.id, r.wallet, r.tipTxHash, r.tipChainId, r.tipAmountEth, JSON.stringify(r.traits), r.settleFor || null, r.status, r.createdAt, r.fulfilledAt || null, r.fulfilledNounId || null, r.fulfilledTxHash || null]
      );
    } catch (err) {
      console.error('[NounIRL] Failed to persist reservation to Postgres:', err);
    }
  }

  private async updateReservationStatus(r: Reservation): Promise<void> {
    // Always write file fallback
    this.persistToFile();

    if (!pool || !this.pgReady) return;
    try {
      await pool.query(
        `UPDATE nounirl_reservations SET status = $1, fulfilled_at = $2, fulfilled_noun_id = $3, fulfilled_tx_hash = $4 WHERE id = $5`,
        [r.status, r.fulfilledAt || null, r.fulfilledNounId || null, r.fulfilledTxHash || null, r.id]
      );
    } catch (err) {
      console.error('[NounIRL] Failed to update reservation in Postgres:', err);
    }
  }

  private async persistSettlement(s: Settlement): Promise<void> {
    // Always write file fallback
    this.persistToFile();

    if (!pool || !this.pgReady) return;
    try {
      await pool.query(
        `INSERT INTO nounirl_settlements (id, noun_id, tx_hash, reservation_id, matched_traits, block_number, settled_at, gas_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.nounId, s.txHash, s.reservationId, JSON.stringify(s.matchedTraits), s.blockNumber, s.settledAt, s.gasUsed || null]
      );
    } catch (err) {
      console.error('[NounIRL] Failed to persist settlement to Postgres:', err);
    }
  }

  // ── File Fallback Persistence ───────────────────────────────────────

  private loadFromFile(): void {
    try {
      if (existsSync(PERSISTENCE_PATH)) {
        const raw = readFileSync(PERSISTENCE_PATH, 'utf-8');
        const data = JSON.parse(raw) as Reservation[];
        for (const r of data) {
          this.reservations.set(r.id, r);
        }
        console.log(`[NounIRL] Loaded ${data.length} reservations from file fallback`);
      }
    } catch (err) {
      console.error('[NounIRL] Failed to load reservations from file:', err);
    }

    try {
      if (existsSync(SETTLEMENTS_PATH)) {
        const raw = readFileSync(SETTLEMENTS_PATH, 'utf-8');
        this.settlements = JSON.parse(raw) as Settlement[];
        console.log(`[NounIRL] Loaded ${this.settlements.length} settlements from file fallback`);
      }
    } catch (err) {
      console.error('[NounIRL] Failed to load settlements from file:', err);
    }
  }

  private persistToFile(): void {
    if (!this.dirty) return;
    try {
      writeFileSync(
        PERSISTENCE_PATH,
        JSON.stringify(Array.from(this.reservations.values()), null, 2),
      );
      writeFileSync(
        SETTLEMENTS_PATH,
        JSON.stringify(this.settlements, null, 2),
      );
      this.dirty = false;
    } catch (err) {
      console.error('[NounIRL] Failed to persist to file:', err);
    }
  }
}

// Singleton
export const reservationStore = new ReservationStore();

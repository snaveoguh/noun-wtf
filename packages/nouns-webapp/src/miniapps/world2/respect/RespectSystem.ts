// ── RespectSystem: `game.respect` (interiors/contract.ts RespectApi) ─────
//
// Holds the score, scores events with the shared rules (rules.ts), keeps a
// history for the HUD, persists locally, and syncs with the server (sync.ts),
// whose score wins: on each answer the local score becomes the server's plus
// whatever is still queued.
//
//   add(e)        score an event now; returns the delta (0 when limited)
//   on(fn)        every scoring add (delta ≠ 0), with the event
//   subscribe(fn) any change at all (React's useSyncExternalStore)
//   onTier(fn)    tier changes, from adds, drift or the server
//   note(text)    a non-scoring ticker line (an NPC greeting a legend)
//
// Local storage: `noun-world-respect-v1` = { v: 1, book, recent, pending }.
// Reads and writes are try/catch'd: private mode or a corrupt value just
// starts fresh.

import type { RespectApi, RespectEvent, RespectState, RespectTier } from '../interiors/contract';

import {
  apply,
  drift,
  newBook,
  normalizeBook,
  parseEvent,
  progressOf,
  tierFor,
  type RespectBook,
} from './rules';
import { BATCH_MAX, type PendingEvent, type RespectSyncPort, type ServerBook } from './sync';

export const STORAGE_KEY = 'noun-world-respect-v1';
/** History kept (the details panel shows it). */
export const RECENT_MAX = 30;
/** Queued events kept while the server can't be reached. */
export const PENDING_MAX = 200;
/** A ticker line stays this long (ms). */
export const TICKER_MS = 4500;

export interface RespectEntry {
  label: string;
  delta: number;
  at: number;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface RespectSystemOptions {
  /** Default: window.localStorage when there is one. null: don't persist. */
  storage?: StorageLike | null;
  now?: () => number;
  /** null / omitted: local only (offline and dev runs). */
  sync?: RespectSyncPort | null;
  /** Run the drift and flush timers (tests drive tick() / flush() by hand). */
  timers?: boolean;
}

type ChangeFn = (s: RespectState, delta: number, e: RespectEvent) => void;
type TierFn = (to: RespectTier, from: RespectTier) => void;

const DRIFT_EVERY = 30_000;
const FLUSH_EVERY = 6_000;
const FLUSH_MAX_BACKOFF = 120_000;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function parseRecent(v: unknown): RespectEntry[] {
  if (!Array.isArray(v)) return [];
  const out: RespectEntry[] = [];
  for (const r of v.slice(0, RECENT_MAX)) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.label === 'string' && typeof o.delta === 'number' && typeof o.at === 'number')
      out.push({ label: o.label.slice(0, 80), delta: o.delta, at: o.at });
  }
  return out;
}

function parsePending(v: unknown): PendingEvent[] {
  if (!Array.isArray(v)) return [];
  const out: PendingEvent[] = [];
  for (const r of v.slice(-PENDING_MAX)) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const e = parseEvent(o.e);
    if (
      e !== null &&
      typeof o.id === 'string' &&
      typeof o.at === 'number' &&
      typeof o.d === 'number'
    )
      out.push({ id: o.id, at: o.at, e, d: o.d });
  }
  return out;
}

let seq = 0;
const eventId = (now: number) =>
  `${now.toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class RespectSystem implements RespectApi {
  private book: RespectBook;
  private recentList: RespectEntry[] = [];
  private notes: RespectEntry[] = [];
  private pending: PendingEvent[] = [];
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly sync: RespectSyncPort | null;
  private changeFns = new Set<ChangeFn>();
  private subs = new Set<() => void>();
  private tierFns = new Set<TierFn>();
  private snap: RespectState;
  private flushing = false;
  private backoff = FLUSH_EVERY;
  private nextFlush = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  /** The server has answered at least once (its score is in). */
  synced = false;

  constructor(o: RespectSystemOptions = {}) {
    this.storage = o.storage === undefined ? defaultStorage() : o.storage;
    this.now = o.now ?? (() => Date.now());
    this.sync = o.sync ?? null;
    this.book = newBook(this.now());
    this.restore();
    this.book = drift(this.book, this.now());
    this.snap = this.makeState();
    if (o.timers !== false && typeof window !== 'undefined') {
      this.timers.push(setInterval(() => this.tick(), DRIFT_EVERY));
      if (this.sync !== null) {
        this.timers.push(setInterval(() => void this.maybeFlush(), 1000));
        void this.load();
      }
    }
  }

  // ── RespectApi ──

  state(): RespectState {
    return this.snap;
  }

  add(e: RespectEvent): number {
    const now = this.now();
    const before = this.book.tier;
    const r = apply(this.book, e, now);
    this.book = r.book;
    if (r.delta === 0) return 0;
    this.recentList = [{ label: r.label, delta: r.delta, at: now }, ...this.recentList].slice(
      0,
      RECENT_MAX,
    );
    if (this.sync !== null) {
      this.pending.push({ id: eventId(now), at: now, e, d: r.delta });
      if (this.pending.length > PENDING_MAX)
        this.pending.splice(0, this.pending.length - PENDING_MAX);
    }
    this.changed(before);
    for (const fn of this.changeFns) fn(this.snap, r.delta, e);
    return r.delta;
  }

  on(fn: ChangeFn): () => void {
    this.changeFns.add(fn);
    return () => this.changeFns.delete(fn);
  }

  // ── Extras for the HUD and hooks ──

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  onTier(fn: TierFn): () => void {
    this.tierFns.add(fn);
    return () => this.tierFns.delete(fn);
  }

  /** A non-scoring line in the ticker (a greeting). */
  note(label: string) {
    const now = this.now();
    this.notes = [{ label, delta: 0, at: now }, ...this.notes].slice(0, 5);
    this.snap = this.makeState();
    for (const fn of this.subs) fn();
  }

  /** Ticker lines still showing at `now`: changes and notes, newest first. */
  ticker(now = this.now()): RespectEntry[] {
    return [...this.recentList.slice(0, 4), ...this.notes]
      .filter(r => now - r.at < TICKER_MS && now >= r.at)
      .sort((a, b) => b.at - a.at)
      .slice(0, 3);
  }

  /** Apply the idle drift up to now. */
  tick() {
    const before = this.book.tier;
    const prev = this.book.score;
    this.book = drift(this.book, this.now());
    if (this.book.score !== prev || this.book.tier !== before) this.changed(before);
  }

  /** Events waiting for the server. */
  get queued(): number {
    return this.pending.length;
  }

  /** Fetch the server's score (on start). */
  async load() {
    if (this.sync === null) return;
    const b = await this.sync.load();
    if (b !== null) this.adopt(b);
    await this.flush();
  }

  /** Send queued events (one batch). */
  async flush() {
    if (this.sync === null || this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    const batch = this.pending.slice(0, BATCH_MAX);
    try {
      const r = await this.sync.post(batch);
      if (r.book !== null || !r.retry) {
        const sent = new Set(batch.map(p => p.id));
        this.pending = this.pending.filter(p => !sent.has(p.id));
        this.backoff = FLUSH_EVERY;
      } else this.backoff = Math.min(FLUSH_MAX_BACKOFF, this.backoff * 2);
      if (r.book !== null) this.adopt(r.book);
      else this.persist();
    } finally {
      this.flushing = false;
      this.nextFlush = this.now() + this.backoff;
    }
  }

  dispose() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.persist();
  }

  // ── Internals ──

  private async maybeFlush() {
    if (this.pending.length > 0 && this.now() >= this.nextFlush) await this.flush();
  }

  /** The server's book wins; what's still queued goes on top. */
  private adopt(b: ServerBook) {
    if (!Number.isFinite(b.score)) return;
    this.synced = true;
    const before = this.book.tier;
    const extra = this.pending.reduce((s, p) => s + p.d, 0);
    const score = Math.round((b.score + extra) * 100) / 100;
    const held = (['outcast', 'stranger', 'local', 'regular', 'legend'] as const).includes(b.tier)
      ? b.tier
      : undefined;
    this.book = { ...this.book, score, tier: tierFor(score, held) };
    this.changed(before);
  }

  private changed(before: RespectTier) {
    this.snap = this.makeState();
    this.persist();
    for (const fn of this.subs) fn();
    if (this.book.tier !== before) for (const fn of this.tierFns) fn(this.book.tier, before);
  }

  private makeState(): RespectState {
    return {
      score: this.book.score,
      tier: this.book.tier,
      progress: progressOf(this.book.score, this.book.tier),
      recent: this.recentList,
    };
  }

  private restore() {
    if (this.storage === null) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const v = JSON.parse(raw) as Record<string, unknown> | null;
      if (v === null || typeof v !== 'object' || v.v !== 1) return;
      this.book = normalizeBook(v.book, this.now());
      this.recentList = parseRecent(v.recent);
      // (kept even offline: an offline run mustn't drop an online run's queue)
      this.pending = parsePending(v.pending);
    } catch {
      // corrupt or unreadable: start fresh
      this.book = newBook(this.now());
      this.recentList = [];
      this.pending = [];
    }
  }

  private persist() {
    if (this.storage === null) return;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, book: this.book, recent: this.recentList, pending: this.pending }),
      );
    } catch {
      // private mode / full: the score just isn't kept locally
    }
  }
}

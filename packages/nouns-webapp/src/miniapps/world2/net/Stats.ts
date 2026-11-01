// ── Noun World stats: records, lifetime totals, how many people played ──
//
// The world-stats Netlify function keeps one row per rider (a random
// per-browser id, so everyone on the default name isn't one row): records
// that only ever go up (top speed, best combo, best session, highest jump,
// hang time, longest grind, furthest downhill) and lifetime totals (km
// skated, tricks landed, time played), plus site-wide session counts.
//
// StatsTracker watches the rider each frame, keeps this browser's bests in
// localStorage, and posts what changed every ~20 s and when the page hides.
//
// Top speed, jump height and hang time are competition records, so each one
// travels with a proof: the trace of the ride that set it (RunTrace below),
// which the server checks against the game's physics (netlify/lib/runProof).
// A claim and its proof always go in the same post (a proved record is never
// posted on its own), a proof is kept until the server has said what it did
// with the claim, and a long ride's proof is trimmed to fit (trimTrace).
//
// A rider can link an ETH address (linkWallet below: a signed message, no
// gas). The address then owns the row and its name: every browser linked to
// it posts into the same row, and the board shows the address, so prize
// winners can be paid. The server checks the signature (netlify/lib/walletAuth).

import type { Player } from '../skate/Player';
import type { ComboState } from '../skate/Tricks';

import {
  decimate,
  decodeTrace,
  encodeTrace,
  STRIDE,
  TRIM_LEVELS,
  trimTrace,
  type ProvedKey,
} from '../../../../netlify/lib/runProof';

const URL_ = '/.netlify/functions/world-stats';
const RIDER_KEY = 'noun-world-rider-id';
const BEST_KEY = 'noun-world-stats-best';
/** Records raised but not yet posted, with their proofs, kept across a reload. */
const PENDING_KEY = 'noun-world-stats-pending';
// Bests kept before the stats board existed
const OLD_KMH_KEY = 'noun-world-fastest-kmh';
const OLD_COMBO_KEY = 'noun-world-best-combo';
const OLD_COMBO_LABEL_KEY = 'noun-world-best-combo-label';
const LINK_KEY = 'noun-world-wallet-link';

export type BestKey = 'kmh' | 'combo' | 'session' | 'airM' | 'airS' | 'grindM' | 'downM';
export type AddKey = 'km' | 'tricks' | 'playS';
export type StatKey = BestKey | AddKey;
export type { ProvedKey };

/** Records the server only accepts with a run proof. */
const PROVED: readonly ProvedKey[] = ['kmh', 'airM', 'airS'];
const isProved = (k: BestKey): k is ProvedKey => (PROVED as readonly string[]).includes(k);
/** A live trace thins its older part when it reaches this many samples. */
const MAX_SAMPLES = 60_000;
/**
 * Samples per proof sent (≈ 640k chars). Longer rides are trimmed to this
 * (trimTrace: the start, the claimed moment at full rate, thinner between).
 */
export const PROOF_SAMPLES = 20_000;
/** Proof chars in one post: three full proofs, well under Netlify's 6 MB. */
const MAX_BODY_PROOF_CHARS = 2_000_000;
/** Finished rides kept in memory for "replay last run". */
const RECENT_RUNS = 4;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A ride's trace, for proofs and replays. */
export interface RideRun {
  id: string;
  /** When the ride started (ms since epoch). */
  at: number;
  /** [t, x, y, z, speed, state] × n */
  samples: Float32Array;
  /** The record it set or claimed, if any. */
  key?: ProvedKey;
  value?: number;
  status?: 'saved' | 'refused';
  reason?: string;
}

/** A proved record the server answered: saved, or refused (with why). */
export interface RecordEvent {
  kind: 'saved' | 'refused';
  key: ProvedKey;
  value: number;
  reason?: string;
  run: RideRun;
  /** A gain too small to show (471.31 over 471.29): saved, but no card. */
  quiet?: boolean;
}

/**
 * One ride on the board since the last respawn / getting on:
 * [t, x, y, z, speed, state] samples (state 0 ground, 1 air, 2 grind,
 * 3 manual, 4 bail), every 0.4 s on the ground, every frame-ish in the air, and on
 * every change of state or new top speed. It never fills up: at
 * MAX_SAMPLES everything but the last minute is thinned (decimate keeps the
 * start, the fastest sample and both sides of every change of state).
 */
class RunTrace {
  private data = new Float32Array(STRIDE * 1024);
  n = 0;
  maxV = 0;
  private lastT = -Infinity;
  private lastSt = -1;
  private lastV = 0;
  readonly id = newId();
  readonly at = Date.now();

  constructor(readonly t0: number) {}

  sample(clock: number, x: number, y: number, z: number, v: number, st: number) {
    const t = clock - this.t0;
    const gap = t - this.lastT;
    // Also on any sharp change of speed (a bail or crash between two ground
    // samples would otherwise leave distance the endpoint speeds can't cover)
    const jolt = Math.abs(v - this.lastV) > 1 + 0.1 * this.lastV;
    const due =
      st !== this.lastSt ||
      gap >= (st === 1 ? 1 / 30 : 0.4) ||
      ((v > this.maxV || jolt) && gap >= 1 / 30);
    if (!due) return;
    if (this.n >= MAX_SAMPLES) this.compact(t);
    if ((this.n + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data.set([t, x, y, z, v, st], this.n * STRIDE);
    this.n++;
    this.lastT = t;
    this.lastSt = st;
    this.lastV = v;
    if (v > this.maxV) this.maxV = v;
  }

  /** Thin everything older than a minute, coarser until it's under 60 % full. */
  private compact(now: number) {
    const cur = this.samples();
    let next = cur;
    for (const [g, a] of TRIM_LEVELS.slice(1)) {
      next = decimate(cur, g, a, [[now - 60, Infinity]]);
      if (next.length / STRIDE <= MAX_SAMPLES * 0.6) break;
    }
    this.data = new Float32Array(Math.max(next.length * 2, STRIDE * 1024));
    this.data.set(next);
    this.n = next.length / STRIDE;
  }

  /** The samples so far (a view: later samples and compaction never change it). */
  samples(): Float32Array {
    return this.data.subarray(0, this.n * STRIDE);
  }
}

const STATE_CODE: Record<string, number> = { ground: 0, air: 1, grind: 2, manual: 3, bail: 4 };

export interface StatRow {
  name: string;
  value: number;
  label?: string;
  at: number;
  /** Linked rows only: the address that owns the row (pays out prizes). */
  addr?: string;
}

/** This browser's wallet link, as the server last reported it. */
export interface WalletLinkState {
  address: string;
  name: string;
}

export interface WorldStats {
  riders: number;
  sessions: number;
  days: Record<string, number>;
  boards: Partial<Record<StatKey, StatRow[]>>;
  /** Payouts: the top linked rider of each competition board. */
  winners?: Partial<Record<BestKey, { name: string; address: string; value: number }>>;
}

export interface MyBests {
  best: Partial<Record<BestKey, number>>;
  comboLabel: string;
}

/** Display metadata for each board. */
export const STAT_INFO: Record<
  StatKey,
  { tab: string; title: string; fmt: (v: number) => string }
> = {
  kmh: { tab: 'SPEED', title: 'Top speed', fmt: v => `${Math.round(v)} km/h` },
  combo: { tab: 'COMBO', title: 'Best combo', fmt: v => `${Math.round(v).toLocaleString()} pts` },
  session: {
    tab: 'SESSION',
    title: 'Best session',
    fmt: v => `${Math.round(v).toLocaleString()} pts`,
  },
  airM: { tab: 'AIR', title: 'Highest jump', fmt: v => `${v.toFixed(1)} m` },
  airS: { tab: 'HANG', title: 'Longest hang time', fmt: v => `${v.toFixed(2)} s` },
  grindM: { tab: 'GRIND', title: 'Longest grind', fmt: v => `${Math.round(v)} m` },
  downM: { tab: 'DOWNHILL', title: 'Furthest downhill', fmt: v => `${(v / 1000).toFixed(2)} km` },
  km: { tab: 'KM', title: 'Distance skated (all time)', fmt: v => `${v.toFixed(1)} km` },
  tricks: {
    tab: 'TRICKS',
    title: 'Tricks landed (all time)',
    fmt: v => Math.round(v).toLocaleString(),
  },
  playS: {
    tab: 'TIME',
    title: 'Time played (all time)',
    fmt: v => (v >= 3600 ? `${(v / 3600).toFixed(1)} h` : `${Math.round(v / 60)} min`),
  },
};

/**
 * Does a new best beat the old one as shown? (471.31 over 471.29 km/h both
 * read "471 km/h".) Top speed lands on the same physics cap run after run,
 * so every run used to "set a record" again: the card and the rider's "new
 * record, baby", all saying 471. Such gains are still saved, to the
 * hundredth, but quietly: no callout, no card.
 */
export function beatsShown(k: BestKey, v: number, prev: number | undefined): boolean {
  if (!(v > (prev ?? 0))) return false;
  if (prev === undefined || !(prev > 0)) return true;
  return STAT_INFO[k].fmt(v) !== STAT_INFO[k].fmt(prev);
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // private mode etc.
  }
}

/** Random id per browser: one row per rider, whatever their name. */
export function riderId(): string {
  let id = load(RIDER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    save(RIDER_KEY, id);
  }
  return id;
}

function loadBests(): MyBests {
  try {
    const raw = load(BEST_KEY);
    if (raw) return JSON.parse(raw) as MyBests;
  } catch {
    // fall through
  }
  const best: MyBests['best'] = {};
  const kmh = Number(load(OLD_KMH_KEY));
  if (kmh > 0) best.kmh = kmh;
  const combo = Number(load(OLD_COMBO_KEY));
  if (combo > 0) best.combo = combo;
  return { best, comboLabel: load(OLD_COMBO_LABEL_KEY) ?? '' };
}

/**
 * The text a rider signs to link (or rename) their row. The server rebuilds
 * it from the posted fields, so keep it byte-for-byte in step with
 * netlify/lib/walletAuth.ts (which imports it from here).
 */
export function linkMessage(rider: string, address: string, name: string, ts: number): string {
  return `Noun World: link rider ${rider} to ${address} as ${name} · ${new Date(ts).toISOString()}`;
}

/** 0x1234…abcd */
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// The link lives in localStorage and a tiny store the UI subscribes to
// (read on first use: the server imports linkMessage from this module)
let link: WalletLinkState | null | undefined;
function readLink(): WalletLinkState | null {
  if (link !== undefined) return link;
  try {
    const v = JSON.parse(load(LINK_KEY) ?? 'null') as WalletLinkState | null;
    link = v && typeof v.address === 'string' && typeof v.name === 'string' ? v : null;
  } catch {
    link = null;
  }
  return link;
}
const linkListeners = new Set<() => void>();
export const walletLink = {
  get: readLink,
  subscribe(fn: () => void) {
    linkListeners.add(fn);
    return () => void linkListeners.delete(fn);
  },
};
function setLink(next: WalletLinkState | null) {
  const cur = readLink();
  if (next?.address === cur?.address && next?.name === cur?.name) return;
  link = next;
  save(LINK_KEY, JSON.stringify(next));
  for (const fn of linkListeners) fn();
}

/**
 * Link this browser's rider to `address` as `name` (or rename a linked
 * rider): sign the message with the wallet, the server checks it.
 */
export async function linkWallet(
  address: string,
  name: string,
  sign: (message: string) => Promise<string>,
): Promise<{ ok: true; link: WalletLinkState } | { ok: false; error: string }> {
  const rider = riderId();
  const ts = Date.now();
  const clean = name
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 42);
  if (!clean) return { ok: false, error: 'Pick a name first' };
  let sig: string;
  try {
    sig = await sign(linkMessage(rider, address, clean, ts));
  } catch {
    return { ok: false, error: 'Signature cancelled' };
  }
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'link', rider, name: clean, address, ts, sig }),
    });
    const out = (await res.json().catch(() => ({}))) as {
      error?: string;
      linked?: WalletLinkState | null;
    };
    if (!res.ok || !out.linked) return { ok: false, error: out.error ?? `Error ${res.status}` };
    setLink(out.linked);
    return { ok: true, link: out.linked };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export async function fetchStats(): Promise<WorldStats | null> {
  try {
    const res = await fetch(URL_, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as WorldStats;
  } catch {
    return null;
  }
}

/** A raised proved record waiting for the server, with the ride that proves it. */
interface Proof {
  /**
   * The ride. A speed record keeps its live trace (still growing until it's
   * sent); a jump keeps the trace as it was on landing; a proof restored
   * after a reload is the decoded samples.
   */
  src: RunTrace | Float32Array;
  /** Trace-time range kept at full rate when the proof is trimmed (the jump). */
  keep?: [number, number];
  seq: number;
  /** The value before the raise: what's saved locally until the server has it. */
  base: number | undefined;
  runId: string;
  runAt: number;
  /** Answers that neither took nor refused it. */
  tries: number;
  /** Some raise in it beat the old best as shown (else saved quietly: no card). */
  loud: boolean;
}

/** A pending proof as stored across a reload. */
interface PendingEntry {
  k: ProvedKey;
  v: number;
  d: string;
  keep?: [number, number];
  /** The tab (tracker) that stored it: tabs never drop each other's. */
  tab?: string;
}

/** One claim in a post: the record, its proof's seq and the samples sent. */
interface SentClaim {
  k: ProvedKey;
  v: number;
  seq: number;
  samples: Float32Array;
  runId: string;
  runAt: number;
  loud: boolean;
}

interface PostAnswer {
  linked?: WalletLinkState | null;
  rejected?: Partial<Record<BestKey, string>>;
  you?: {
    best?: Partial<Record<BestKey, number>>;
    missions?: Record<string, number>;
    title?: string | null;
  };
}

export class StatsTracker {
  mine: MyBests = loadBests();
  /** A proved record the server answered (saved, or refused: shown, never silent). */
  onRecord?: (e: RecordEvent) => void;
  /** A best just went up on this device (the rider's "new record" callout). */
  onRaise?: (k: BestKey, v: number, prev: number | undefined) => void;
  /** Dev / test only: post even though the game is offline. */
  devLive = false;
  /** Extra fields for every post (missions: see missions/MissionSystem). */
  extras?: () => Record<string, unknown>;
  /** The server's view of this rider after each post (accepted records, missions). */
  onYou?: (you: NonNullable<PostAnswer['you']>) => void;
  /**
   * Nothing counts while set (the Upside Down: low gravity): no records, no
   * ride trace (a fresh one starts when it's cleared), only time played.
   */
  suspended = false;
  /** Something new to post (a raised best or lifetime deltas). */
  private dirty = true;
  private sessionPosted = false;
  /** Only games that actually reached the world count as a session. */
  private started = false;
  private posting = false;
  private flushAcc = 0;
  private add = { km: 0, tricks: 0, playS: 0 };
  // Air / grind in progress
  private airStartY: number | null = null;
  private airStartClock = 0;
  private airMaxY = 0;
  private airT = 0;
  /**
   * This air had a skydive in it (skydive/: drag, a canopy): it doesn't fall
   * at the game's gravity, so no air / hang record comes out of it.
   */
  private airVoid = false;
  private grindM = 0;
  private lastBankedAt = -1;
  // Run proofs
  private clock = 0;
  private trace: RunTrace | null = null;
  private recent: RideRun[] = [];
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastV = 0;
  private lastRespawns = 0;
  /** Raised proved records waiting on the server. */
  private proofs = new Map<ProvedKey, Proof>();
  private proofSeq = 0;
  /** Encoded proofs, so a page hide doesn't trim + encode the same ride twice. */
  private encoded = new WeakMap<
    object,
    { n: number; claims: string; d: string; s: Float32Array }
  >();
  private disposers: (() => void)[] = [];
  /** This tracker's id in the pending store, and the entries it took over. */
  private tab = newId();
  private adopted = new Set<string>();

  constructor(
    private getName: () => string,
    private isOffline: () => boolean,
  ) {
    // Last chance to send totals when the tab closes or backgrounds
    const onHide = () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    };
    this.restorePending();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    this.disposers.push(
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onHide),
    );
  }

  private live() {
    return this.devLive || !this.isOffline();
  }

  /** Does this session post stats? */
  isLive() {
    return this.live();
  }

  /** A record the server now holds (an approved appeal). */
  adopt(k: ProvedKey, v: number) {
    if (this.proofs.has(k) || !(v > (this.mine.best[k] ?? 0))) return;
    this.mine.best[k] = v;
    this.persist(false);
  }

  private readPending(): PendingEntry[] {
    try {
      const v = JSON.parse(load(PENDING_KEY) ?? '[]') as PendingEntry[];
      return Array.isArray(v)
        ? v.filter(p => isProved(p?.k) && typeof p.d === 'string' && p.v > 0)
        : [];
    } catch {
      return [];
    }
  }

  /** Raised records whose proof a previous page load never got to post. */
  private restorePending() {
    for (const p of this.readPending()) {
      this.adopted.add(`${p.tab}:${p.k}`);
      if (!(p.v > (this.mine.best[p.k] ?? 0))) continue;
      const s = decodeTrace(p.d);
      if (s === null) continue;
      const prev = this.proofs.get(p.k);
      this.proofs.set(p.k, {
        src: s,
        keep: p.keep,
        seq: ++this.proofSeq,
        base: prev ? prev.base : this.mine.best[p.k],
        runId: newId(),
        runAt: Date.now(),
        tries: 0,
        // (a raise from the last visit that never got its answer: show it)
        loud: true,
      });
      this.mine.best[p.k] = p.v;
      this.dirty = true;
    }
  }

  /** The proof for some keys of one ride, trimmed to size and encoded. */
  private proofFor(src: RunTrace | Float32Array, keys: ProvedKey[]) {
    const s = src instanceof RunTrace ? src.samples() : src;
    const claims: Partial<Record<ProvedKey, number>> = {};
    const keep: [number, number][] = [];
    for (const k of keys) {
      claims[k] = this.mine.best[k];
      const r = this.proofs.get(k)?.keep;
      if (r) keep.push(r);
    }
    const tag = JSON.stringify(claims);
    const hit = this.encoded.get(src);
    if (hit && hit.n === s.length && hit.claims === tag) return hit;
    const trimmed = trimTrace(s, { maxSamples: PROOF_SAMPLES, keep, claims });
    const out = { n: s.length, claims: tag, d: encodeTrace(trimmed), s: trimmed };
    this.encoded.set(src, out);
    return out;
  }

  /** Local bests as far as the server can know them: pending raises held back. */
  private persist(keepPending: boolean) {
    const best = { ...this.mine.best };
    for (const [k, p] of this.proofs) {
      if (p.base === undefined) delete best[k];
      else best[k] = p.base;
    }
    save(BEST_KEY, JSON.stringify({ ...this.mine, best }));
    // Another live tab's pending records stay (for keys this one has nothing on)
    const others = this.readPending().filter(
      e =>
        e.tab !== this.tab &&
        !this.adopted.has(`${e.tab}:${e.k}`) &&
        !this.proofs.has(e.k) &&
        e.v > (this.mine.best[e.k] ?? 0),
    );
    if (this.proofs.size === 0 && others.length === 0) {
      try {
        localStorage.removeItem(PENDING_KEY);
      } catch {
        // private mode etc.
      }
      return;
    }
    if (!keepPending) return;
    const mine: PendingEntry[] = [];
    for (const [k, p] of this.proofs) {
      const v = this.mine.best[k];
      if (v === undefined) continue;
      const d = this.proofFor(p.src, [k]).d;
      mine.push({ k, v, d, tab: this.tab, ...(p.keep ? { keep: p.keep } : {}) });
    }
    save(PENDING_KEY, JSON.stringify([...others, ...mine]));
  }

  dispose() {
    this.flush(true);
    for (const d of this.disposers) d();
  }

  private raise(k: BestKey, v: number, src?: Float32Array, keep?: [number, number]) {
    if (!(v > (this.mine.best[k] ?? 0))) return false;
    const loud = beatsShown(k, v, this.mine.best[k]);
    if (isProved(k)) {
      const trace = this.trace;
      if (trace === null) return false;
      const prev = this.proofs.get(k);
      this.proofs.set(k, {
        src: src ?? trace,
        keep,
        seq: ++this.proofSeq,
        base: prev ? prev.base : this.mine.best[k],
        runId: trace.id,
        runAt: trace.at,
        tries: 0,
        loud: loud || (prev?.loud ?? false),
      });
      // Post soon, while the proof is fresh
      this.flushAcc = Math.max(this.flushAcc, 17);
    }
    const prev = this.mine.best[k];
    this.mine.best[k] = v;
    this.dirty = true;
    // Saved to the hundredth, but only announced when the shown number goes up
    if (loud) this.onRaise?.(k, v, prev);
    return true;
  }

  /** Something else to post soon (a finished mission). */
  markDirty() {
    this.dirty = true;
    this.flushAcc = Math.max(this.flushAcc, 15);
  }

  /** Keep the current ride's trace (a new one after any reset). */
  private record(dt: number, p: Player) {
    this.clock += dt;
    if (this.suspended) {
      // Drop the ride: the next one starts fresh once we're back
      if (this.trace !== null) this.keepRun(this.trace);
      this.trace = null;
      return;
    }
    const { x, y, z } = p.pos;
    const v = p.speed;
    const moved = Math.hypot(x - this.lastX, y - this.lastY, z - this.lastZ);
    // A new trace whenever energy could appear from outside the physics: a
    // respawn (teleport, or stopped dead from speed) or stepping on the board.
    // Bails carry on in the same trace: they only ever lose energy
    const teleport = moved > 2 + 3 * Math.max(v, this.lastV) * dt;
    // A rescue at speed puts you back only metres away and re-accelerates you
    // within the frame, so the jump + stop alone can miss it: count them too
    const respawned = (this.lastV > 4 && v < 0.05) || p.respawns !== this.lastRespawns;
    this.lastRespawns = p.respawns;
    const prev = this.trace;
    if (p.mode !== 'board') this.trace = null;
    else if (this.trace === null || teleport || respawned) this.trace = new RunTrace(this.clock);
    if (prev !== null && prev !== this.trace) this.keepRun(prev);
    this.trace?.sample(this.clock, x, y, z, v, STATE_CODE[p.state] ?? 0);
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;
    this.lastV = v;
  }

  /** A finished ride goes into the recent list (replays). */
  private keepRun(t: RunTrace) {
    if (t.n < 30) return;
    this.recent.unshift({ id: t.id, at: t.at, samples: t.samples() });
    this.recent.length = Math.min(this.recent.length, RECENT_RUNS);
  }

  /** Recent rides, newest first (the one in progress included). */
  runs(): RideRun[] {
    const cur = this.trace;
    const now =
      cur !== null && cur.n >= 30 ? [{ id: cur.id, at: cur.at, samples: cur.samples() }] : [];
    return [...now, ...this.recent];
  }

  /** Offline (or anywhere stats aren't posted): keep the ride for replays, nothing else. */
  recordOnly(dt: number, p: Player) {
    this.record(dt, p);
  }

  /** Call every frame while in the world. */
  update(dt: number, p: Player, combo: ComboState, downM: number) {
    this.started = true;
    this.add.playS += dt;
    this.record(dt, p);
    if (this.suspended) {
      // Nothing in here is a record: forget any air / grind / combo in progress
      this.airStartY = null;
      this.grindM = 0;
      this.lastBankedAt = combo.lastBanked?.at ?? -1;
      this.tickFlush(dt);
      return;
    }
    if (p.mode === 'board' && p.state !== 'bail') {
      this.add.km += (p.speed * dt) / 1000;
      // Claim only a speed the trace itself holds
      if (this.trace !== null) this.raise('kmh', Math.floor(this.trace.maxV * 36) / 10);
    }
    if (downM > 0) this.raise('downM', downM);

    // Air: height above take-off and time aloft, per jump
    if (p.state === 'air') {
      if (this.airStartY === null) {
        this.airStartY = p.pos.y;
        this.airStartClock = this.clock;
        this.airMaxY = p.pos.y;
        this.airT = 0;
        this.airVoid = false;
      }
      if (p.sky?.active === true) this.airVoid = true;
      this.airT += dt;
      this.airMaxY = Math.max(this.airMaxY, p.pos.y);
    } else if (this.airStartY !== null) {
      if (p.state !== 'bail' && this.trace !== null && !this.airVoid) {
        // The ride up to this landing proves the jump (kept at full rate)
        const t0 = this.trace.t0;
        const jump: [number, number] = [this.airStartClock - t0 - 0.5, this.clock - t0 + 0.1];
        const snap = this.trace.samples();
        this.raise('airM', Math.round((this.airMaxY - this.airStartY) * 100) / 100, snap, jump);
        this.raise('airS', Math.round(this.airT * 100) / 100, snap, jump);
      }
      this.airStartY = null;
    }

    // Grind: length of each one
    if (p.state === 'grind') this.grindM += p.speed * dt;
    else if (this.grindM > 0) {
      this.raise('grindM', Math.round(this.grindM * 10) / 10);
      this.grindM = 0;
    }

    // Banked combos: best combo, best session, tricks landed
    const b = combo.lastBanked;
    if (b !== null && b.at !== this.lastBankedAt) {
      this.lastBankedAt = b.at;
      if (!b.bailed) {
        this.add.tricks += b.label ? b.label.split(' + ').length : 0;
        this.dirty = true;
        if (this.raise('combo', b.points)) this.mine.comboLabel = b.label;
      }
    }
    this.raise('session', combo.session);
    this.tickFlush(dt);
  }

  private tickFlush(dt: number) {
    this.flushAcc += dt;
    if (this.flushAcc >= 20) {
      this.flushAcc = 0;
      this.flush(false);
    }
  }

  /**
   * Post records + lifetime deltas. `beacon` for page hide (fire and forget).
   *
   * A proved record (speed, air, hang time) only ever goes out in the same
   * post as its proof: never on its own, never on a beacon (capped at 64 KB),
   * and never when the proof doesn't fit this post (it waits for the next).
   */
  flush(beacon: boolean) {
    if (!this.started) return;
    // Leaving the page: a pending proof is stored so the next load posts it
    this.persist(beacon);
    if (!this.live() || this.posting || (!this.dirty && this.sessionPosted)) return;
    const add = {
      km: Math.round(this.add.km * 1000) / 1000,
      tricks: this.add.tricks,
      playS: Math.round(this.add.playS),
    };
    const best = { ...this.mine.best };
    for (const k of PROVED) delete best[k];
    const proofs: { keys: ProvedKey[]; d: string }[] = [];
    const sent: SentClaim[] = [];
    if (!beacon) {
      const bySrc = new Map<RunTrace | Float32Array, ProvedKey[]>();
      for (const [k, p] of this.proofs) bySrc.set(p.src, [...(bySrc.get(p.src) ?? []), k]);
      let room = MAX_BODY_PROOF_CHARS;
      for (const [src, keys] of bySrc) {
        const pr = this.proofFor(src, keys);
        if (pr.d.length > room) continue;
        room -= pr.d.length;
        proofs.push({ keys, d: pr.d });
        for (const k of keys) {
          const v = this.mine.best[k];
          const p = this.proofs.get(k)!;
          if (v === undefined) continue;
          best[k] = v;
          sent.push({
            k,
            v,
            seq: p.seq,
            samples: pr.s,
            runId: p.runId,
            runAt: p.runAt,
            loud: p.loud,
          });
        }
      }
    }
    const body = JSON.stringify({
      rider: riderId(),
      name: this.getName(),
      session: !this.sessionPosted,
      best,
      comboLabel: this.mine.comboLabel,
      add,
      proofs,
      ...this.extras?.(),
    });
    if (beacon && navigator.sendBeacon?.(URL_, body)) {
      this.postedTotals(add);
      this.persist(false);
      return;
    }
    this.posting = true;
    void this.post(body, add, sent).finally(() => {
      this.posting = false;
    });
  }

  private postedTotals(add: { km: number; tricks: number; playS: number }) {
    this.sessionPosted = true;
    this.add.km -= add.km;
    this.add.tricks -= add.tricks;
    this.add.playS -= add.playS;
  }

  private async post(
    body: string,
    add: { km: number; tricks: number; playS: number },
    sent: SentClaim[],
  ) {
    // A proof is only let go once the server has said what it did with the
    // claim: no answer (network, an error, a body that never arrives) keeps
    // it for the next post. Re-sending is harmless: a record only rises.
    let out: PostAnswer | null = null;
    try {
      const res = await fetch(URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) return this.again();
      this.postedTotals(add);
      out = (await res.json().catch(() => null)) as PostAnswer | null;
    } catch {
      return this.again();
    }
    if (out === null || typeof out !== 'object') return this.again();
    if (out.linked !== undefined) setLink(out.linked);
    if (out.you && typeof out.you === 'object') this.onYou?.(out.you);
    const you = out.you?.best;
    for (const c of sent) {
      const p = this.proofs.get(c.k);
      const current = p?.seq === c.seq;
      const reason = out.rejected?.[c.k];
      if (reason !== undefined) {
        if (current) this.proofs.delete(c.k);
        this.settle(c, 'refused', reason, you);
      } else if ((you?.[c.k] ?? 0) >= c.v - 0.005) {
        if (current) this.proofs.delete(c.k);
        this.settle(c, 'saved');
      } else if (current && ++p.tries >= 3) {
        // Neither taken nor refused, three times over (out of range…)
        this.proofs.delete(c.k);
        this.settle(c, 'refused', 'not taken by the server', you);
      }
    }
    // Proved bests with nothing pending follow the server: a value it
    // doesn't hold can never be posted again without its ride
    if (you && typeof you === 'object') {
      for (const k of PROVED) {
        if (this.proofs.has(k)) continue;
        const h = you[k];
        if (h === undefined) delete this.mine.best[k];
        else this.mine.best[k] = h;
      }
    }
    this.dirty = this.proofs.size > 0;
    if (this.dirty) this.flushAcc = Math.max(this.flushAcc, 17);
    this.persist(false);
  }

  /** No answer: keep everything for the next post. */
  private again() {
    this.dirty = true;
  }

  /** The server's answer on one claim: tell the game, roll a refusal back. */
  private settle(
    c: SentClaim,
    kind: 'saved' | 'refused',
    reason?: string,
    you?: Partial<Record<BestKey, number>>,
  ) {
    // A refused record goes back to what the server holds, or a real ride
    // below it would never be posted (unless it was raised again since)
    if (kind === 'refused' && (this.mine.best[c.k] ?? 0) === c.v) {
      const held = you?.[c.k] ?? 0;
      if (held > 0) this.mine.best[c.k] = held;
      else delete this.mine.best[c.k];
    }
    const run: RideRun = {
      id: c.runId,
      at: c.runAt,
      samples: c.samples,
      key: c.k,
      value: c.v,
      status: kind,
      ...(reason !== undefined ? { reason } : {}),
    };
    this.onRecord?.({
      kind,
      key: c.k,
      value: c.v,
      ...(reason !== undefined ? { reason } : {}),
      ...(c.loud ? {} : { quiet: true }),
      run,
    });
  }

  /**
   * Send one record again with its ride (an appeal's first step: most
   * refusals were a proof that never arrived). Saved or why not.
   */
  async resubmit(
    k: ProvedKey,
    v: number,
    samples: Float32Array,
  ): Promise<{ saved: boolean; reason?: string; d: string }> {
    const d = encodeTrace(trimTrace(samples, { maxSamples: PROOF_SAMPLES, claims: { [k]: v } }));
    if (!this.live()) return { saved: false, reason: 'offline', d };
    try {
      const res = await fetch(URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rider: riderId(),
          name: this.getName(),
          best: { [k]: v },
          add: {},
          proofs: [{ keys: [k], d }],
        }),
      });
      const out = (await res.json().catch(() => null)) as PostAnswer | null;
      if (!res.ok || out === null) return { saved: false, reason: `Error ${res.status}`, d };
      const held = out.you?.best?.[k] ?? 0;
      if (held >= v - 0.005) {
        if (!this.proofs.has(k)) this.mine.best[k] = Math.max(this.mine.best[k] ?? 0, held);
        this.persist(false);
        return { saved: true, d };
      }
      return { saved: false, reason: out.rejected?.[k] ?? 'not taken by the server', d };
    } catch {
      return { saved: false, reason: 'Network error', d };
    }
  }
}

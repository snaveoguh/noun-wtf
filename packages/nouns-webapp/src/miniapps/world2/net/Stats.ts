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
//
// A rider can link an ETH address (linkWallet below: a signed message, no
// gas). The address then owns the row and its name: every browser linked to
// it posts into the same row, and the board shows the address, so prize
// winners can be paid. The server checks the signature (netlify/lib/walletAuth).

import type { Player } from '../skate/Player';
import type { ComboState } from '../skate/Tricks';

const URL_ = '/.netlify/functions/world-stats';
const RIDER_KEY = 'noun-world-rider-id';
const BEST_KEY = 'noun-world-stats-best';
// Bests kept before the stats board existed
const OLD_KMH_KEY = 'noun-world-fastest-kmh';
const OLD_COMBO_KEY = 'noun-world-best-combo';
const OLD_COMBO_LABEL_KEY = 'noun-world-best-combo-label';
const LINK_KEY = 'noun-world-wallet-link';

export type BestKey = 'kmh' | 'combo' | 'session' | 'airM' | 'airS' | 'grindM' | 'downM';
export type AddKey = 'km' | 'tricks' | 'playS';
export type StatKey = BestKey | AddKey;

/** Records the server only accepts with a run proof. */
const PROVED: BestKey[] = ['kmh', 'airM', 'airS'];
const STRIDE = 6;
const MAX_SAMPLES = 60_000;

/**
 * One ride on the board since the last respawn / getting on:
 * [t, x, y, z, speed, state] samples (state 0 ground, 1 air, 2 grind,
 * 3 manual), every 0.4 s on the ground, every frame-ish in the air, and on
 * every change of state or new top speed.
 */
class RunTrace {
  private data = new Float32Array(STRIDE * 1024);
  n = 0;
  maxV = 0;
  full = false;
  private lastT = -Infinity;
  private lastSt = -1;

  constructor(private t0: number) {}

  sample(clock: number, x: number, y: number, z: number, v: number, st: number) {
    if (this.full) return;
    const t = clock - this.t0;
    const gap = t - this.lastT;
    const due =
      st !== this.lastSt || gap >= (st === 1 ? 1 / 30 : 0.4) || (v > this.maxV && gap >= 0.1);
    if (!due) return;
    if (this.n >= MAX_SAMPLES) {
      this.full = true;
      return;
    }
    if ((this.n + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data.set([t, x, y, z, v, st], this.n * STRIDE);
    this.n++;
    this.lastT = t;
    this.lastSt = st;
    if (v > this.maxV) this.maxV = v;
  }

  encode(): string {
    const bytes = new Uint8Array(this.data.buffer, 0, this.n * STRIDE * 4);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}

const STATE_CODE: Record<string, number> = { ground: 0, air: 1, grind: 2, manual: 3 };

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

export class StatsTracker {
  mine: MyBests = loadBests();
  /** A record the server wouldn't take (shown to the rider, never silent). */
  onRejected?: (k: BestKey, value: number, reason: string) => void;
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
  private airMaxY = 0;
  private airT = 0;
  private grindM = 0;
  private lastBankedAt = -1;
  // Run proofs
  private clock = 0;
  private trace: RunTrace | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastV = 0;
  /** Raised records waiting to be posted, with the ride that proves them. */
  private proofs = new Map<BestKey, { trace: RunTrace; seq: number }>();
  private proofSeq = 0;
  private disposers: (() => void)[] = [];

  constructor(
    private getName: () => string,
    private isOffline: () => boolean,
  ) {
    // Last chance to send totals when the tab closes or backgrounds
    const onHide = () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    this.disposers.push(
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onHide),
    );
  }

  dispose() {
    this.flush(true);
    for (const d of this.disposers) d();
  }

  private raise(k: BestKey, v: number) {
    if (!(v > (this.mine.best[k] ?? 0))) return false;
    if (PROVED.includes(k)) {
      if (this.trace === null || this.trace.full) return false;
      this.proofs.set(k, { trace: this.trace, seq: ++this.proofSeq });
      // Post soon, while the proof is fresh
      this.flushAcc = Math.max(this.flushAcc, 17);
    }
    this.mine.best[k] = v;
    this.dirty = true;
    return true;
  }

  /** Keep the current ride's trace (a new one after any reset). */
  private record(dt: number, p: Player) {
    this.clock += dt;
    const { x, y, z } = p.pos;
    const v = p.speed;
    const moved = Math.hypot(x - this.lastX, y - this.lastY, z - this.lastZ);
    // A new trace whenever energy could appear from outside the physics: a
    // respawn (teleport, or stopped dead from speed) or stepping on the board.
    // Bails carry on in the same trace: they only ever lose energy
    const teleport = moved > 2 + 3 * Math.max(v, this.lastV) * dt;
    const respawned = this.lastV > 4 && v < 0.05;
    if (p.mode !== 'board') this.trace = null;
    else if (this.trace === null || teleport || respawned) this.trace = new RunTrace(this.clock);
    this.trace?.sample(this.clock, x, y, z, v, STATE_CODE[p.state] ?? 0);
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;
    this.lastV = v;
  }

  /** Call every frame while in the world. */
  update(dt: number, p: Player, combo: ComboState, downM: number) {
    this.started = true;
    this.add.playS += dt;
    this.record(dt, p);
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
        this.airMaxY = p.pos.y;
        this.airT = 0;
      }
      this.airT += dt;
      this.airMaxY = Math.max(this.airMaxY, p.pos.y);
    } else if (this.airStartY !== null) {
      if (p.state !== 'bail') {
        this.raise('airM', Math.round((this.airMaxY - this.airStartY) * 100) / 100);
        this.raise('airS', Math.round(this.airT * 100) / 100);
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

    this.flushAcc += dt;
    if (this.flushAcc >= 20) {
      this.flushAcc = 0;
      this.flush(false);
    }
  }

  /** Post records + lifetime deltas. `beacon` for page hide (fire and forget). */
  flush(beacon: boolean) {
    if (!this.started) return;
    save(BEST_KEY, JSON.stringify(this.mine));
    if (this.isOffline() || this.posting || (!this.dirty && this.sessionPosted)) return;
    const add = {
      km: Math.round(this.add.km * 1000) / 1000,
      tricks: this.add.tricks,
      playS: Math.round(this.add.playS),
    };
    // Proofs ride along with a normal post (a beacon is capped at 64 KB)
    const proven = beacon ? [] : [...this.proofs.keys()];
    const sentSeq = new Map(proven.map(k => [k, this.proofs.get(k)!.seq]));
    const byTrace = new Map<RunTrace, BestKey[]>();
    for (const k of proven) {
      const tr = this.proofs.get(k)!.trace;
      byTrace.set(tr, [...(byTrace.get(tr) ?? []), k]);
    }
    const proofs = [...byTrace].map(([tr, keys]) => ({ keys, d: tr.encode() }));
    const best = { ...this.mine.best };
    // A record still waiting on its proof isn't claimed yet
    for (const k of this.proofs.keys()) if (!proven.includes(k)) delete best[k];
    const body = JSON.stringify({
      rider: riderId(),
      name: this.getName(),
      session: !this.sessionPosted,
      best,
      comboLabel: this.mine.comboLabel,
      add,
      proofs,
    });
    const sent = () => {
      this.sessionPosted = true;
      // Raised again since this post was built: that one still needs sending
      for (const [k, seq] of sentSeq) if (this.proofs.get(k)?.seq === seq) this.proofs.delete(k);
      this.dirty = this.proofs.size > 0;
      this.add.km -= add.km;
      this.add.tricks -= add.tricks;
      this.add.playS -= add.playS;
    };
    if (beacon && navigator.sendBeacon?.(URL_, body)) {
      sent();
      return;
    }
    this.posting = true;
    void fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(res => {
        if (!res.ok) return;
        sent();
        // Keep the link in step with the server (linked elsewhere, moved…)
        return res
          .json()
          .then(
            (out: {
              linked?: WalletLinkState | null;
              rejected?: Partial<Record<BestKey, string>>;
              you?: { best?: Partial<Record<BestKey, number>> };
            }) => {
              if (out.linked !== undefined) setLink(out.linked);
              // A refused record goes back to what the server holds, or a
              // real ride below it would never be posted
              for (const [k, reason] of Object.entries(out.rejected ?? {}) as [BestKey, string][]) {
                const claimed = best[k] ?? 0;
                const held = out.you?.best?.[k] ?? 0;
                if ((this.mine.best[k] ?? 0) === claimed) {
                  if (held > 0) this.mine.best[k] = held;
                  else delete this.mine.best[k];
                  save(BEST_KEY, JSON.stringify(this.mine));
                }
                this.onRejected?.(k, claimed, reason);
              }
            },
          )
          .catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        this.posting = false;
      });
  }
}

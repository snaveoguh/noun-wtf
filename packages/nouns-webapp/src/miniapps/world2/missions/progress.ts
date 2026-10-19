// ── Mission progress: a pure state machine over game signals ─────────────
//
// The game (MissionSystem) turns what happened this frame into signals;
// `apply` folds them into the rider's state and returns the missions that
// just finished. Only missions that are *available* (character met, the
// line's earlier missions done) make progress, so the journal reads as a
// set of conversations rather than a checklist that fills itself in.
//
// Record missions never complete from client values: only a 'server'
// signal (the records the stats server accepted with a run proof) can
// finish them. The one client-side condition they can carry (300 km/h *on
// grass*) only gates them; the speed itself must still be a saved record.

import {
  MISSION_BY_ID,
  MISSIONS,
  NPC_IDS,
  validateMissions,
  type MissionDef,
  type NpcId,
  type RecordKey,
} from './defs';

export const MISSIONS_VERSION = 1;

/** Cutscene ids whose seen-flags persist (cutscene/scenes.ts SCENE_IDS; kept here so this stays dependency-free). */
export const SEEN_IDS = ['oracle', 'keymaker', 'twins', 'door', 'one'] as const;

export interface MissionState {
  v: typeof MISSIONS_VERSION;
  /** Characters talked to (ms). */
  met: Partial<Record<NpcId, number>>;
  /** Finished missions (ms). */
  done: Record<string, number>;
  /** Running totals for missions that add up (seconds, metres). */
  prog: Record<string, number>;
  /** Equipped title: a done mission's id. */
  title: string | null;
  /** Fastest seen on grass (km/h, client: only gates "There is no road"). */
  grassKmh: number;
  /** Server-accepted records last seen (shown as progress on record missions). */
  server: Partial<Record<RecordKey, number>>;
  /** Story cutscenes already played for this rider (scene id → ms). Local only. */
  seen: Record<string, number>;
}

export function emptyState(): MissionState {
  return {
    v: MISSIONS_VERSION,
    met: {},
    done: {},
    prog: {},
    title: null,
    grassKmh: 0,
    server: {},
    seen: {},
  };
}

export type Signal =
  | { t: 'met'; npc: NpcId }
  /** A banked combo (no bail): its trick names, and where it was landed. */
  | { t: 'combo'; tricks: readonly string[]; nj: boolean; ud: boolean }
  | { t: 'tag'; color: string }
  | { t: 'fm' }
  | { t: 'fmRide'; dt: number }
  | { t: 'spot'; spot: 'nj' | 'bowl' }
  | { t: 'door' }
  | { t: 'streak'; s: number }
  | { t: 'grind'; m: number }
  | { t: 'crew'; dt: number }
  | { t: 'hoops'; win: boolean }
  | { t: 'delivered'; id: string }
  | { t: 'raceWon'; id: string }
  | { t: 'udHang'; s: number }
  | { t: 'udRide'; m: number }
  | { t: 'speed'; kmh: number; surface: string | null }
  /** Records the server holds for this rider (accepted with proofs). */
  | { t: 'server'; best: Partial<Record<RecordKey, number>> };

/** Character met, not done, and the missions before it done. */
export function available(s: MissionState, m: MissionDef): boolean {
  return (
    s.done[m.id] === undefined &&
    s.met[m.npc] !== undefined &&
    m.after.every(a => s.done[a] !== undefined)
  );
}

/** A character has something for you (their next mission is open to them). */
export function unlockedFor(s: MissionState, npc: NpcId): MissionDef | null {
  return (
    MISSIONS.find(
      m =>
        m.npc === npc && s.done[m.id] === undefined && m.after.every(a => s.done[a] !== undefined),
    ) ?? null
  );
}

/** Characters with a mission waiting whom you haven't met yet. */
export function waitingToMeet(s: MissionState): NpcId[] {
  return NPC_IDS.filter(n => s.met[n] === undefined && unlockedFor(s, n) !== null);
}

/** Available missions, in the journal's order. */
export function activeMissions(s: MissionState): MissionDef[] {
  return MISSIONS.filter(m => available(s, m));
}

/** 0..1 progress and a short label, for the tracker. */
export function progressOf(s: MissionState, m: MissionDef): { f: number; label: string } {
  const o = m.obj;
  const p = s.prog[m.id] ?? 0;
  const frac = (a: number, b: number) => Math.max(0, Math.min(1, a / b));
  switch (o.k) {
    case 'fmRide':
      return {
        f: frac(p, o.s),
        label: `${Math.floor(p / 60)}:${String(Math.floor(p % 60)).padStart(2, '0')} / ${o.s / 60}:00`,
      };
    case 'crew':
      return { f: frac(p, o.s), label: `${Math.floor(p)} / ${o.s} s` };
    case 'streak':
      return {
        f: frac(p, o.s),
        label: `best ${Math.floor(p / 60)}:${String(Math.floor(p % 60)).padStart(2, '0')} / ${o.s / 60}:00`,
      };
    case 'grind':
      return { f: frac(p, o.m), label: `best ${Math.round(p)} / ${o.m} m` };
    case 'udHang':
      return { f: frac(p, o.s), label: `best ${p.toFixed(1)} / ${o.s} s` };
    case 'udRide':
      return { f: frac(p, o.m), label: `${(p / 1000).toFixed(2)} / ${o.m / 1000} km` };
    case 'combo':
      return { f: frac(p, o.n), label: `best ${p} / ${o.n} tricks` };
    case 'record': {
      const v = s.server[o.key] ?? 0;
      const unit = o.key === 'kmh' ? ' km/h' : o.key === 'airS' ? ' s' : ' m';
      const fmt = (x: number) => (o.key === 'kmh' ? Math.round(x).toLocaleString() : x.toFixed(1));
      const grass = o.surface === 'grass' ? ` · grass ${Math.round(s.grassKmh)}` : '';
      return { f: frac(v, o.min), label: `saved ${fmt(v)} / ${fmt(o.min)}${unit}${grass}` };
    }
    default:
      return { f: 0, label: '' };
  }
}

/**
 * Fold one signal into the state (mutates it). Returns the missions that
 * just finished.
 */
export function apply(s: MissionState, sig: Signal, now: number): MissionDef[] {
  const out: MissionDef[] = [];
  if (sig.t === 'met') {
    s.met[sig.npc] ??= now;
    return out;
  }
  if (sig.t === 'speed') {
    if (sig.surface === 'grass') s.grassKmh = Math.max(s.grassKmh, sig.kmh);
    return out;
  }
  if (sig.t === 'server') {
    for (const [k, v] of Object.entries(sig.best) as [RecordKey, number][])
      if (typeof v === 'number' && Number.isFinite(v)) s.server[k] = v;
  }
  const finish = (m: MissionDef) => {
    s.done[m.id] = now;
    delete s.prog[m.id];
    out.push(m);
  };
  const keepMax = (m: MissionDef, v: number, target: number) => {
    s.prog[m.id] = Math.max(s.prog[m.id] ?? 0, v);
    if (s.prog[m.id]! >= target) finish(m);
  };
  const addUp = (m: MissionDef, v: number, target: number) => {
    s.prog[m.id] = (s.prog[m.id] ?? 0) + v;
    if (s.prog[m.id]! >= target) finish(m);
  };
  // One pass over a snapshot of what's open: a mission finished by this
  // signal doesn't let the next one in its line take the same signal
  for (const m of activeMissions(s)) {
    const o = m.obj;
    switch (o.k) {
      case 'trick':
        if (sig.t === 'combo' && sig.tricks.some(n => new RegExp(o.re, 'i').test(n))) finish(m);
        break;
      case 'combo':
        if (sig.t !== 'combo') break;
        if (o.where === 'nj' && !sig.nj) break;
        if (o.where === 'ud' && !sig.ud) break;
        keepMax(m, sig.tricks.length, o.n);
        break;
      case 'tag':
        if (sig.t === 'tag' && (o.color === undefined || sig.color.toLowerCase() === o.color))
          finish(m);
        break;
      case 'fm':
        if (sig.t === 'fm') finish(m);
        break;
      case 'fmRide':
        if (sig.t === 'fmRide') addUp(m, sig.dt, o.s);
        break;
      case 'spot':
        if (sig.t === 'spot' && sig.spot === o.spot) finish(m);
        break;
      case 'door':
        if (sig.t === 'door') finish(m);
        break;
      case 'streak':
        if (sig.t === 'streak') keepMax(m, sig.s, o.s);
        break;
      case 'grind':
        if (sig.t === 'grind') keepMax(m, sig.m, o.m);
        break;
      case 'crew':
        if (sig.t === 'crew') addUp(m, sig.dt, o.s);
        break;
      case 'hoops':
        if (sig.t === 'hoops' && (sig.win || !o.win)) finish(m);
        break;
      case 'deliver':
        if (sig.t === 'delivered' && sig.id === m.id) finish(m);
        break;
      case 'race':
        if (sig.t === 'raceWon' && sig.id === m.id) finish(m);
        break;
      case 'udHang':
        if (sig.t === 'udHang') keepMax(m, sig.s, o.s);
        break;
      case 'udRide':
        if (sig.t === 'udRide') addUp(m, sig.m, o.m);
        break;
      case 'record':
        // Server-accepted values only, never this client's own numbers
        if (sig.t !== 'server') break;
        if (o.surface === 'grass' && !(s.grassKmh >= o.min)) break;
        if ((sig.best[o.key] ?? 0) >= o.min) finish(m);
        break;
    }
  }
  return out;
}

// ── Persistence ──────────────────────────────────────────────────────────

const num = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/** Anything (localStorage, an old shape) → a valid state. */
export function sanitizeState(raw: unknown, now = Date.now()): MissionState {
  const s = emptyState();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return s;
  const o = raw as Record<string, unknown>;
  if (o.v !== MISSIONS_VERSION) return s;
  const met = (o.met ?? {}) as Record<string, unknown>;
  for (const n of NPC_IDS) {
    const t = num(met[n], 0, now + 86_400_000);
    if (t !== undefined) s.met[n] = t;
  }
  const done = (o.done ?? {}) as Record<string, unknown>;
  for (const [id, t] of Object.entries(done)) {
    const ts = num(t, 0, now + 86_400_000);
    if (MISSION_BY_ID[id] !== undefined && ts !== undefined) s.done[id] = ts;
  }
  const prog = (o.prog ?? {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(prog)) {
    const x = num(v, 0, 1e9);
    if (MISSION_BY_ID[id] !== undefined && x !== undefined && s.done[id] === undefined)
      s.prog[id] = x;
  }
  if (typeof o.title === 'string' && s.done[o.title] !== undefined) s.title = o.title;
  s.grassKmh = num(o.grassKmh, 0, 1e6) ?? 0;
  const server = (o.server ?? {}) as Record<string, unknown>;
  for (const k of ['kmh', 'airM', 'airS'] as RecordKey[]) {
    const v = num(server[k], 0, 1e6);
    if (v !== undefined) s.server[k] = v;
  }
  const seen = (o.seen ?? {}) as Record<string, unknown>;
  if (typeof seen === 'object' && !Array.isArray(seen))
    for (const id of SEEN_IDS) {
      const ts = num(seen[id], 0, now + 86_400_000);
      if (ts !== undefined) s.seen[id] = ts;
    }
  return s;
}

/**
 * What the server says this rider has done (validated there): merged in,
 * earliest time wins. Meeting a character is implied by any of their
 * missions being done. Returns the missions that are new here.
 */
export function mergeServer(s: MissionState, done: unknown): MissionDef[] {
  if (done === null || typeof done !== 'object' || Array.isArray(done)) return [];
  const out: MissionDef[] = [];
  for (const [id, t] of Object.entries(done as Record<string, unknown>)) {
    const m = MISSION_BY_ID[id];
    if (m === undefined || typeof t !== 'number' || !Number.isFinite(t)) continue;
    if (s.done[id] === undefined) out.push(m);
    s.done[id] = Math.min(s.done[id] ?? t, t);
    delete s.prog[id];
    s.met[m.npc] = Math.min(s.met[m.npc] ?? t, t);
  }
  return out;
}

/** The missions to post (the server checks every one against its own records). */
export function postable(s: MissionState): Record<string, number> {
  return validateMissions(s.done, undefined, s.server, Date.now());
}

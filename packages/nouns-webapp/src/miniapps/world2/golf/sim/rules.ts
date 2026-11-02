// ── Stroke play ─────────────────────────────────────────────────────────
//
// 1–4 players, pure state in, new state out (the round is plain JSON, so
// it travels in golf:start / golf:result as is).
//
//   newRound(config, holes)          the 1st tee
//   applyShot(state, by, result, h)  count it, penalties, drops, holed,
//                                    pick-ups, whose turn; when everyone's
//                                    done the hole is 'holed' (or the round
//                                    'over' on the last hole)
//   nextHole(state, holes)           on to the next tee (honours) / 'over'
//
// Penalties: water = 1 stroke, dropped on dry ground backed off from where
// it went in toward where it was played from (HoleInfo.dropFor overrides);
// with no dry spot it's replayed from the previous spot. OB = stroke and
// distance: +1 and replay from the previous spot. Pick up at
// min(par + 5, 10) strokes: that's the score.
//
// Turns: on the tee, honours (best score on the last hole first, ties by
// the hole before, then player order); after that, whoever is farthest
// from the pin, holed / picked-up players skipped.

import type {
  CourseSurface,
  GolfConfig,
  Hole,
  LastShot,
  Lie,
  PlayerHole,
  RoundState,
  ShotResult,
  V2,
  V3,
} from '../contract';

import { windFor } from './wind';

/** What the rules (and the CPU) need to know about a hole. */
export interface HoleInfo {
  n: number;
  par: number;
  teeSpot: V3;
  pin: V3;
  /** Tee → green centre line (the CPU aims along it). */
  line?: V2[];
  /** Stroke index (1 = hardest). */
  hcp?: number;
  /** The ground, for drops (and the CPU). */
  surface?: CourseSurface;
  /**
   * A custom water drop: the ball was played from `prev` and went in at
   * `entry`. Return the spot and its lie, or null to replay from `prev`.
   */
  dropFor?: (prev: V3, entry: V3, lie: Lie) => { at: V3; lie: Lie } | null;
}

/** A contract Hole + the course surface → HoleInfo. */
export function holeInfoFrom(hole: Hole, surface: CourseSurface): HoleInfo {
  return {
    n: hole.n,
    par: hole.par,
    teeSpot: { ...hole.teeSpot },
    pin: { ...hole.pin },
    line: hole.line.map(p => ({ x: p.x, z: p.z })),
    hcp: hole.hcp,
    surface,
  };
}

export const maxStrokes = (par: number) => Math.min(par + 5, 10);

const dist2 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The infos for config.holes in play order (missing numbers are skipped). */
export function holesInPlay(config: GolfConfig, holes: HoleInfo[]): HoleInfo[] {
  const by = new Map(holes.map(h => [h.n, h]));
  const list = config.holes.length ? config.holes : holes.map(h => h.n);
  return list.map(n => by.get(n)).filter((h): h is HoleInfo => !!h);
}

const freshHole = (n: number): PlayerHole[] =>
  Array.from({ length: n }, () => ({ strokes: 0, ball: null, lie: 'tee' as Lie, holed: false }));

export function newRound(config: GolfConfig, holes: HoleInfo[]): RoundState {
  const cfg: GolfConfig = {
    ...config,
    holes: config.holes.length ? [...config.holes] : holes.map(h => h.n),
  };
  const np = cfg.players.length;
  return {
    config: cfg,
    hole: 0,
    phase: 'tee',
    cur: freshHole(np),
    card: Array.from({ length: np }, () => cfg.holes.map(() => null)),
    turn: 0,
    wind: windFor(cfg.seed, 0, cfg.wind),
    n: 0,
    last: null,
  };
}

/** Player order on the tee of hole `ix`: honours from the holes before. */
export function honours(state: RoundState, ix: number): number[] {
  const np = state.config.players.length;
  const order = Array.from({ length: np }, (_, i) => i);
  order.sort((a, b) => {
    for (let h = ix - 1; h >= 0; h--) {
      const sa = state.card[a][h] ?? 99;
      const sb = state.card[b][h] ?? 99;
      if (sa !== sb) return sa - sb;
    }
    return a - b;
  });
  return order;
}

/** Where a player's ball is (their tee spot before they've teed off). */
export function ballOf(state: RoundState, by: number, info: HoleInfo): V3 {
  return state.cur[by].ball ?? info.teeSpot;
}

/** Whose turn it is now (-1 when nobody's left on this hole). */
export function whoseTurn(state: RoundState, info: HoleInfo): number {
  const cur = state.cur;
  const live = cur.map((_, i) => i).filter(i => !cur[i].holed && cur[i].picked !== true);
  if (!live.length) return -1;
  const toTee = live.filter(i => cur[i].strokes === 0);
  if (toTee.length) {
    const order = honours(state, state.hole);
    return order.find(i => toTee.includes(i)) ?? toTee[0];
  }
  let best = live[0];
  let bestD = -1;
  for (const i of live) {
    const d = dist2(ballOf(state, i, info), info.pin);
    if (d > bestD + 1e-9) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The default water drop: back from the entry toward where it was played from, on dry ground. */
export function waterDrop(
  surface: CourseSurface,
  prev: V3,
  entry: V3,
  fallback?: V3,
): { at: V3; lie: Lie } | null {
  let dx = prev.x - entry.x;
  let dz = prev.z - entry.z;
  let l = Math.hypot(dx, dz);
  if (l < 1 && fallback) {
    dx = fallback.x - entry.x;
    dz = fallback.z - entry.z;
    l = Math.hypot(dx, dz);
  }
  if (l < 1e-6) return null;
  dx /= l;
  dz /= l;
  const ok = (x: number, z: number) => {
    const lie = surface.lie(x, z);
    return lie !== 'water' && lie !== 'ob' && surface.waterLevel(x, z) === null;
  };
  for (let d = 2; d <= Math.min(80, l + 2); d += 1) {
    const x = entry.x + dx * d;
    const z = entry.z + dz * d;
    if (ok(x, z)) {
      // A club length further, if that's dry too
      const x2 = x + dx;
      const z2 = z + dz;
      const [fx, fz] = ok(x2, z2) ? [x2, z2] : [x, z];
      return { at: { x: fx, y: surface.height(fx, fz), z: fz }, lie: surface.lie(fx, fz) };
    }
  }
  return null;
}

/** "BIRDIE", "PAR", "+4"... for a hole's score. */
export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'HOLE IN ONE';
  const d = strokes - par;
  switch (d) {
    case -4:
      return 'CONDOR';
    case -3:
      return 'ALBATROSS';
    case -2:
      return 'EAGLE';
    case -1:
      return 'BIRDIE';
    case 0:
      return 'PAR';
    case 1:
      return 'BOGEY';
    case 2:
      return 'DOUBLE BOGEY';
    case 3:
      return 'TRIPLE BOGEY';
    default:
      return d > 0 ? `+${d}` : `${d}`;
  }
}

/** Count one shot by player `by` that did `result` on hole `info`. */
export function applyShot(
  state: RoundState,
  by: number,
  result: ShotResult,
  info: HoleInfo,
): RoundState {
  if (state.phase === 'holed' || state.phase === 'over') return state;
  const cur = state.cur.map(p => ({ ...p, ball: p.ball ? { ...p.ball } : null }));
  const me = cur[by];
  if (me === undefined || me.holed || me.picked === true) return state;
  const prev = me.ball ?? { ...info.teeSpot };
  const prevLie: Lie = me.ball ? me.lie : 'tee';
  me.strokes += 1;
  let penalty = 0;
  let call: string | undefined;
  let next: V3;
  let nextLie: Lie;

  if (result.holed) {
    me.holed = true;
    next = { ...info.pin };
    nextLie = 'green';
    call = scoreName(me.strokes, info.par);
  } else if (result.lie === 'water' || result.events.some(e => e.kind === 'water')) {
    penalty = 1;
    call = 'IN THE WATER';
    const entry = result.rest;
    const drop = info.dropFor
      ? info.dropFor(prev, entry, result.lie)
      : info.surface
        ? waterDrop(info.surface, prev, entry, info.teeSpot)
        : null;
    if (drop) {
      next = { ...drop.at };
      nextLie = drop.lie;
    } else {
      next = { ...prev };
      nextLie = prevLie;
    }
  } else if (result.lie === 'ob' || result.events.some(e => e.kind === 'ob')) {
    penalty = 1;
    call = 'OUT OF BOUNDS';
    next = { ...prev };
    nextLie = prevLie;
  } else {
    next = { ...result.rest };
    nextLie = result.lie;
    if (nextLie === 'green' && prevLie !== 'green') call = 'ON THE GREEN';
    else if (nextLie === 'sand') call = 'IN THE BUNKER';
  }
  me.strokes += penalty;
  me.ball = next;
  me.lie = nextLie;

  const cap = maxStrokes(info.par);
  if (!me.holed && me.strokes >= cap) {
    me.strokes = cap;
    me.picked = true;
    call = call ?? 'PICKED UP';
  }

  const last: LastShot = { by, result, penalty, next: { ...next }, nextLie };
  if (call) last.call = call;

  let s: RoundState = { ...state, cur, n: state.n + 1, last };
  const done = cur.every(p => p.holed || p.picked === true);
  if (done) {
    const card = s.card.map((row, i) => {
      const r = [...row];
      r[s.hole] = cur[i].strokes;
      return r;
    });
    const lastHole = s.hole >= s.config.holes.length - 1;
    s = { ...s, card, phase: lastHole ? 'over' : 'holed', turn: -1 };
    return s;
  }
  const anyToTee = cur.some(p => !p.holed && p.picked !== true && p.strokes === 0);
  s = { ...s, phase: anyToTee ? 'tee' : 'play' };
  return { ...s, turn: whoseTurn(s, info) };
}

/** Concede / pick up a player's ball now (scores the cap, or strokes + 1 if lower: a conceded putt). */
export function pickUp(
  state: RoundState,
  by: number,
  info: HoleInfo,
  conceded = false,
): RoundState {
  const cur = state.cur.map(p => ({ ...p }));
  const me = cur[by];
  if (me === undefined || me.holed || me.picked === true) return state;
  me.strokes = conceded ? Math.min(me.strokes + 1, maxStrokes(info.par)) : maxStrokes(info.par);
  if (conceded) me.holed = true;
  else me.picked = true;
  const s: RoundState = { ...state, cur };
  if (cur.every(p => p.holed || p.picked === true)) {
    const card = s.card.map((row, i) => {
      const r = [...row];
      r[s.hole] = cur[i].strokes;
      return r;
    });
    return { ...s, card, phase: s.hole >= s.config.holes.length - 1 ? 'over' : 'holed', turn: -1 };
  }
  return { ...s, turn: whoseTurn(s, info) };
}

/** From a finished hole on to the next tee, or the end of the round. */
export function nextHole(state: RoundState, holes: HoleInfo[]): RoundState {
  if (state.phase !== 'holed') return state;
  const ix = state.hole + 1;
  if (ix >= state.config.holes.length) return { ...state, phase: 'over', turn: -1 };
  const s: RoundState = {
    ...state,
    hole: ix,
    phase: 'tee',
    cur: freshHole(state.config.players.length),
    wind: windFor(state.config.seed, ix, state.config.wind),
    last: null,
    turn: 0,
  };
  const info = holesInPlay(s.config, holes)[ix];
  return { ...s, turn: info !== undefined ? whoseTurn(s, info) : honours(s, ix)[0] };
}

/** The current hole's info. */
export function currentHole(state: RoundState, holes: HoleInfo[]): HoleInfo | undefined {
  return holesInPlay(state.config, holes)[state.hole];
}

// ── Scoring ────────────────────────────────────────────────────────────

/** Each player's strokes over the holes played so far. */
export function totals(state: RoundState): number[] {
  return state.card.map(row => row.reduce<number>((a, s) => a + (s ?? 0), 0));
}

/** Each player's score against par over the holes they've finished. */
export function toPar(state: RoundState, holes: HoleInfo[]): number[] {
  const play = holesInPlay(state.config, holes);
  return state.card.map(row =>
    row.reduce<number>((a, s, i) => (s === null ? a : a + s - (play[i]?.par ?? 4)), 0),
  );
}

/** "E", "+3", "−2". */
export function toParText(d: number): string {
  return d === 0 ? 'E' : d > 0 ? `+${d}` : `−${-d}`;
}

/** The lowest total(s) (indices; ties share it). */
export function winners(state: RoundState): number[] {
  const t = totals(state);
  const best = Math.min(...t);
  return t.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0);
}

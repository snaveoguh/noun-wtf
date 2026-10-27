// ── 8-ball rules (a simple WPA-style set) ───────────────────────────────
//
//   Break      from the kitchen (behind the head string). Legal if a ball
//              drops or 4+ object balls reach a cushion; otherwise it's a
//              foul (ball in hand to the other player). Pot something on
//              a legal break and you go again. The table stays open.
//   8 on the   respotted on the foot spot and the breaker carries on (a
//   break      scratch with it is still a foul). `eightOnBreak: 'win'`
//              makes it an instant win instead (bar rules).
//   Open table the first ball potted on a legal shot after the break
//              decides the groups (solids 1–7 / stripes 9–15). Hitting the
//              8 first on an open table is a foul.
//   Fouls      scratch (the cue ball drops), no contact, wrong ball first
//              (not your group / not the 8 once your group's gone), no
//              cushion after contact with nothing potted. The other player
//              gets ball in hand anywhere (in the kitchen after a break
//              scratch). Potted balls stay down.
//   Turn       you keep shooting while you pot one of yours legally.
//   The 8      once your group's cleared you call a pocket for it. 8 in the
//              called pocket, no foul: you win. 8 early, in another
//              pocket, or with a foul (scratch on the 8): you lose.

import type {
  BallId,
  FoulKind,
  FrameState,
  Group,
  PocketId,
  Seat,
  ShotInput,
  ShotOutcome,
  Vec2,
} from '../contract';

import { makeBall, ShotRun, strike, type Ball, type ShotReport } from './physics';
import { rackBalls, respot } from './rack';
import { POCKETS, R, inKitchen, onCloth } from './table';

export interface RuleOptions {
  eightOnBreak?: 'respot' | 'win';
}

export function groupOf(id: BallId): Group | null {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null;
}

export function other(s: Seat): Seat {
  return s === 0 ? 1 : 0;
}

const GROUP_IDS: Record<Group, BallId[]> = {
  solids: [1, 2, 3, 4, 5, 6, 7],
  stripes: [9, 10, 11, 12, 13, 14, 15],
};

/** Balls of this group still on the table. */
export function remaining(state: FrameState, g: Group): BallId[] {
  return GROUP_IDS[g].filter(id => state.balls[id] !== null);
}

/** This seat is shooting at the 8 (its group's gone). */
export function onEight(state: FrameState, seat: Seat): boolean {
  const g = state.groups[seat];
  return g !== null && remaining(state, g).length === 0;
}

/** What this seat may hit first. */
export function legalFirst(state: FrameState, seat: Seat): BallId[] {
  const on = (id: BallId) => state.balls[id] !== null;
  if (state.phase === 'break') return [...Array(15).keys()].map(i => i + 1).filter(on);
  const g = state.groups[seat];
  if (g === null) return [...GROUP_IDS.solids, ...GROUP_IDS.stripes].filter(on);
  if (onEight(state, seat)) return [8];
  return remaining(state, g);
}

export function newFrame(seed: number, breaker: Seat): FrameState {
  const balls = rackBalls(seed);
  return {
    balls: balls.map(b => ({ x: b.x, y: b.y })),
    phase: 'break',
    turn: breaker,
    groups: [null, null],
    inHand: 'kitchen',
    shots: 0,
    fouls: [0, 0],
    last: null,
    winner: null,
  };
}

/** The state's balls as physics balls (pocketed ones off the table). */
export function toBalls(state: FrameState): Ball[] {
  return state.balls.map((p, id) =>
    p === null ? makeBall(id, 0, 0, false) : makeBall(id, p.x, p.y),
  );
}

/** Can the cue ball go here (ball in hand)? */
export function canPlace(state: FrameState, at: Vec2, where = state.inHand): boolean {
  if (where === null) return false;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
  if (!onCloth(at.x, at.y, 0.002)) return false;
  if (where === 'kitchen' && !inKitchen(at.x)) return false;
  for (let id = 1; id < state.balls.length; id++) {
    const b = state.balls[id];
    if (b === null || b === undefined) continue;
    const dx = b.x - at.x;
    const dy = b.y - at.y;
    if (dx * dx + dy * dy < 4 * R * R * 1.0001) return false;
  }
  return true;
}

/** Is this input acceptable for the shooter right now? (The host checks before running it.) */
export function validInput(state: FrameState, input: ShotInput): boolean {
  if (state.phase === 'over') return false;
  const s = input.shot;
  for (const v of [s.dx, s.dy, s.power, s.side, s.top])
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (s.dx * s.dx + s.dy * s.dy < 1e-8) return false;
  if (input.cue !== undefined) {
    if (state.inHand === null || !canPlace(state, input.cue)) return false;
  } else if (state.balls[0] === null) return false;
  return true;
}

export interface Prepared {
  /** Balls at the moment of the strike (the cue ball where it was placed). */
  balls: Ball[];
  run: ShotRun;
}

/** Set the shot up: place the cue ball, strike it, start the run. */
export function prepare(state: FrameState, input: ShotInput): Prepared {
  const balls = toBalls(state);
  const cue = balls[0]!;
  if (input.cue !== undefined && state.inHand !== null) {
    cue.x = input.cue.x;
    cue.y = input.cue.y;
    cue.on = true;
  }
  const s = input.shot;
  strike(cue, s.dx, s.dy, s.power, s.side, s.top);
  const at = balls.map(b => ({ ...b }));
  return { balls: at, run: new ShotRun(balls) };
}

export interface Judged {
  state: FrameState;
  outcome: ShotOutcome;
}

/** Apply a finished shot to the frame. */
export function judge(
  state: FrameState,
  input: ShotInput,
  report: ShotReport,
  final: readonly Ball[],
  opts: RuleOptions = {},
): Judged {
  const me = state.turn;
  const opp = other(me);
  const breakShot = state.phase === 'break';
  const potted = report.potted.map(p => p.id);
  const scratch = potted.includes(0);
  const objects = potted.filter(id => id !== 0);
  const eight = objects.includes(8);
  const eightPocket = report.potted.find(p => p.id === 8)?.pocket ?? null;
  const wasOnEight = onEight(state, me);

  let foul: FoulKind | null = null;
  if (report.first === null) foul = 'no_contact';
  else if (!breakShot) {
    if (!legalFirst(state, me).includes(report.first)) foul = 'wrong_first';
  }
  if (foul === null && !breakShot && objects.length === 0 && !report.railAfter) foul = 'no_rail';
  if (foul === null && breakShot && objects.length === 0 && report.railBalls < 4)
    foul = 'bad_break';
  if (scratch) foul = 'scratch';

  // Balls where they stopped
  const balls: (Vec2 | null)[] = final.map(b => (b.on ? { x: b.x, y: b.y } : null));
  const next: FrameState = {
    ...state,
    balls,
    groups: [...state.groups] as [Group | null, Group | null],
    fouls: [...state.fouls] as [number, number],
    shots: state.shots + 1,
    phase: 'play',
    inHand: null,
  };
  if (foul !== null) next.fouls[me]++;
  const outcome: ShotOutcome = {
    by: me,
    foul,
    potted: objects,
    scratch,
    assigned: false,
    again: false,
    respotted: false,
  };
  const end = (winner: Seat, reason: string): Judged => {
    next.phase = 'over';
    next.winner = winner;
    next.reason = reason;
    next.turn = me;
    next.last = outcome;
    return { state: next, outcome };
  };

  // ── The 8 ──
  if (eight) {
    if (breakShot) {
      if ((opts.eightOnBreak ?? 'respot') === 'win' && !scratch) return end(me, '8 on the break');
      const at = respot(final, 8);
      next.balls[8] = at;
      outcome.respotted = true;
    } else if (!wasOnEight) return end(opp, '8 down too early');
    else if (foul !== null)
      return end(opp, foul === 'scratch' ? 'scratched on the 8' : 'fouled on the 8');
    else if (input.call === undefined || input.call !== eightPocket)
      return end(opp, '8 in the wrong pocket');
    else return end(me, '8 in the called pocket');
  }

  // ── Groups ──
  if (state.groups[me] === null && !breakShot && foul === null) {
    const firstGroup = objects.map(groupOf).find((g): g is Group => g !== null);
    if (firstGroup !== undefined) {
      next.groups[me] = firstGroup;
      next.groups[opp] = firstGroup === 'solids' ? 'stripes' : 'solids';
      outcome.assigned = true;
    }
  }

  // ── Who's next ──
  let again = false;
  if (foul === null) {
    if (breakShot) again = objects.length > 0;
    else {
      const g = next.groups[me];
      again = g !== null && objects.some(id => groupOf(id) === g);
    }
  }
  outcome.again = again;
  next.turn = again ? me : opp;
  if (foul !== null) next.inHand = breakShot && scratch ? 'kitchen' : 'anywhere';
  if (scratch) next.balls[0] = null;
  next.last = outcome;
  return { state: next, outcome };
}

/** Run a whole shot (host / tests / the CPU's check): the judged state and the run. */
export function playShot(
  state: FrameState,
  input: ShotInput,
  opts: RuleOptions = {},
): Judged & { run: ShotRun; start: Ball[] } {
  const p = prepare(state, input);
  const report = p.run.finish();
  return { ...judge(state, input, report, p.run.balls, opts), run: p.run, start: p.balls };
}

/** The pocket a CPU / UI would call for the 8 by default (nearest the 8). */
export function defaultCall(state: FrameState): PocketId {
  const e = state.balls[8];
  if (e === null || e === undefined) return 0;
  let best: PocketId = 0;
  let bd = Infinity;
  for (const p of POCKETS) {
    const d = (e.x - p.aim.x) * (e.x - p.aim.x) + (e.y - p.aim.y) * (e.y - p.aim.y);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  return best;
}

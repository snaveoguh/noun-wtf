// ── The CPU opponent ────────────────────────────────────────────────────
//
// A ghost-ball search: for every legal ball and every pocket, the ghost
// ball (where the cue ball must be at contact) and the cut angle; lines
// blocked by other balls, cuts past ~78° and side pockets at a steep angle
// are thrown out; the rest are scored on cut and distances. The best few
// are then played out in the real physics with a choice of spin (stun,
// draw, follow) and judged by the rules: pots that keep the turn win, with
// the cue ball's next shot as the tie-break (position play), and fouls
// are heavily penalised. Ball in hand tries cue ball spots straight behind
// the best shots. With nothing on, it plays a safe hit on a legal ball.
//
// Skill (0..1) sets how many shots it checks, whether it plays spin, and
// the noise on the final aim and power: easy misses a lot, hard rarely.
// `think` is a generator so a turn's sims can spread over frames; `plan`
// runs it straight through (tests, offline).

import type { BallId, FrameState, PocketId, Seat, ShotInput, Vec2 } from '../contract';

import { clearPath, firstHit } from './aim';
import { V_MAX } from './physics';
import { rng as makeRng } from './rack';
import { canPlace, defaultCall, legalFirst, onEight, playShot, type RuleOptions } from './rules';
import { HEAD_X, L, POCKETS, R, W, onCloth } from './table';

export const SKILL = { easy: 0.25, normal: 0.6, hard: 0.9, pro: 0.97 } as const;
export type Difficulty = keyof typeof SKILL;

interface Candidate {
  cue: Vec2;
  target: BallId;
  pocket: PocketId;
  dir: Vec2;
  cut: number;
  dCG: number;
  dTP: number;
  score: number;
}

const MU_RG = 0.011 * 9.81;

/** Every potting line from `cue` (unsorted). */
export function candidates(state: FrameState, seat: Seat, cue: Vec2): Candidate[] {
  const out: Candidate[] = [];
  const legal = legalFirst(state, seat);
  const balls = state.balls.map((b, id) => (id === 0 ? null : b));
  for (const id of legal) {
    const t = state.balls[id];
    if (t === null || t === undefined) continue;
    for (const p of POCKETS) {
      const ux0 = p.aim.x - t.x;
      const uy0 = p.aim.y - t.y;
      const dTP = Math.sqrt(ux0 * ux0 + uy0 * uy0);
      if (dTP < 1e-6) continue;
      const ux = ux0 / dTP;
      const uy = uy0 / dTP;
      // Into the pocket from the table side, not along its throat's wall
      const enter = ux * p.nx + uy * p.ny;
      if (enter < (p.corner ? 0.35 : 0.55)) continue;
      const g = { x: t.x - ux * 2 * R, y: t.y - uy * 2 * R };
      if (!onCloth(g.x, g.y, -0.002)) continue;
      const cx = g.x - cue.x;
      const cy = g.y - cue.y;
      const dCG = Math.sqrt(cx * cx + cy * cy);
      if (dCG < 1e-4) continue;
      const dx = cx / dCG;
      const dy = cy / dCG;
      const cosCut = dx * ux + dy * uy;
      if (cosCut < 0.2) continue; // cut past ~78°
      if (!clearPath(balls, cue, g, [id])) continue;
      if (!clearPath(balls, t, p.aim, [id])) continue;
      // The cue ball must actually meet this ball first along that line
      const hit = firstHit(state.balls, cue, dx, dy, 0);
      if (hit === null || hit.kind !== 'ball' || hit.id !== id) continue;
      const score =
        (cosCut * cosCut * (p.corner ? 1 : 0.85)) /
        (1 + dCG * 0.55 + dTP * 1.1) /
        (0.6 + enter * 0.4);
      out.push({
        cue,
        target: id,
        pocket: p.id,
        dir: { x: dx, y: dy },
        cut: Math.acos(cosCut),
        dCG,
        dTP,
        score,
      });
    }
  }
  return out;
}

/** Cue speed (as power) to get the object ball to the pocket with some pace. */
export function powerFor(c: Pick<Candidate, 'cut' | 'dCG' | 'dTP'>, pace = 1): number {
  const vObj = (Math.sqrt(2 * MU_RG * (c.dTP + 0.1)) * 1.45 + 0.3) * pace;
  const vContact = vObj / (0.97 * Math.max(0.25, Math.cos(c.cut)));
  const v0 = 1.25 * Math.sqrt(vContact * vContact + 2 * MU_RG * c.dCG) + 0.05;
  return Math.max(0.06, Math.min(1, (v0 - 0.25) / (V_MAX - 0.25)));
}

/** How good is this cue ball spot for the next shot (0..~1)? */
function positionValue(state: FrameState, seat: Seat, cue: Vec2): number {
  const c = candidates(state, seat, cue);
  let best = 0;
  for (const k of c) if (k.score > best) best = k.score;
  return best;
}

/** Cue ball spots worth trying with ball in hand. */
function placements(state: FrameState, seat: Seat, rand: () => number): Vec2[] {
  const out: Vec2[] = [];
  const kitchen = state.inHand === 'kitchen';
  if (!kitchen) {
    // Straight behind each legal ball's potting line, a little way back
    for (const id of legalFirst(state, seat)) {
      const t = state.balls[id];
      if (t === null || t === undefined) continue;
      for (const p of POCKETS) {
        const ux0 = p.aim.x - t.x;
        const uy0 = p.aim.y - t.y;
        const d = Math.sqrt(ux0 * ux0 + uy0 * uy0);
        if (d < 1e-6 || (ux0 * p.nx + uy0 * p.ny) / d < 0.5) continue;
        for (const back of [0.16, 0.3]) {
          const q = { x: t.x - (ux0 / d) * (2 * R + back), y: t.y - (uy0 / d) * (2 * R + back) };
          // A touch off straight so it doesn't follow in
          q.x += (uy0 / d) * 0.02;
          q.y -= (ux0 / d) * 0.02;
          if (canPlace(state, q)) out.push(q);
        }
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const x = kitchen
      ? -L / 2 + 0.06 + rand() * (HEAD_X + L / 2 - 0.08)
      : (rand() - 0.5) * (L - 0.12);
    const q = { x, y: (rand() - 0.5) * (W - 0.12) };
    if (canPlace(state, q)) out.push(q);
  }
  return out;
}

function gauss(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Aim and power noise for a skill. */
function noisy(input: ShotInput, skill: number, rand: () => number): ShotInput {
  const s = input.shot;
  const sigma = 0.0007 + (1 - skill) * (1 - skill) * 0.03;
  const a = Math.atan2(s.dy, s.dx) + gauss(rand) * sigma;
  const pw = s.power * (1 + gauss(rand) * (1 - skill) * 0.12);
  return {
    ...input,
    shot: { ...s, dx: Math.cos(a), dy: Math.sin(a), power: Math.max(0.04, Math.min(1, pw)) },
  };
}

export interface CpuOptions extends RuleOptions {
  seed?: number;
}

/** The CPU's turn, one sim per step (yield), returning its shot. */
export function* think(
  state: FrameState,
  seat: Seat,
  skill: number,
  opts: CpuOptions = {},
): Generator<void, ShotInput> {
  const rand = makeRng((opts.seed ?? 1) ^ (state.shots * 2654435761));
  // ── The break ──
  if (state.phase === 'break') {
    const cue = { x: HEAD_X - 0.08, y: (rand() - 0.5) * 0.3 };
    const apex = state.balls[1] ?? { x: L / 4, y: 0 };
    const dx = apex.x - cue.x;
    const dy = apex.y - cue.y;
    const n = Math.sqrt(dx * dx + dy * dy);
    const input: ShotInput = {
      shot: { dx: dx / n, dy: dy / n, power: 0.85 + skill * 0.15, side: 0, top: 0 },
      cue: state.inHand !== null ? cue : undefined,
    };
    return noisy(input, Math.min(1, skill + 0.3), rand);
  }

  // ── Where can the cue ball be ──
  const cueAt = state.balls[0];
  const spots: Vec2[] =
    state.inHand !== null || cueAt === null ? placements(state, seat, rand) : [cueAt];
  if (spots.length === 0 && cueAt !== null) spots.push(cueAt);
  let cands: Candidate[] = [];
  for (const s of spots) cands.push(...candidates(state, seat, s));
  cands.sort((a, b) => b.score - a.score);
  // Several spots give the same pot: keep the best few distinct (target, pocket)
  const seen = new Set<string>();
  cands = cands.filter(c => {
    const k = `${c.target}:${c.pocket}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const checks = Math.round(1 + skill * 6);
  const spins: { top: number; pace: number }[] =
    skill >= 0.5
      ? [
          { top: 0, pace: 1 },
          { top: -0.55, pace: 1.15 },
          { top: 0.4, pace: 1 },
        ]
      : [{ top: 0, pace: 1 }];
  const inHand = state.inHand !== null || cueAt === null;
  const eight = onEight(state, seat);

  let best: { input: ShotInput; value: number } | null = null;
  const consider = (input: ShotInput, value: number) => {
    if (best === null || value > best.value) best = { input, value };
  };

  for (const c of cands.slice(0, checks)) {
    for (const sp of spins) {
      const input: ShotInput = {
        shot: { dx: c.dir.x, dy: c.dir.y, power: powerFor(c, sp.pace), side: 0, top: sp.top },
        cue: inHand ? c.cue : undefined,
        call: eight ? c.pocket : undefined,
      };
      if (skill < 0.4) {
        // Easy doesn't look ahead
        consider(input, c.score);
        continue;
      }
      const r = playShot(state, input, opts);
      yield;
      let value = c.score;
      const st = r.state;
      if (st.phase === 'over') value = st.winner === seat ? 100 : -100;
      else if (r.outcome.foul !== null) value -= 5;
      else if (r.outcome.again) {
        const cue = st.balls[0];
        value += 2 + (cue !== null ? positionValue(st, seat, cue) * 3 : 0);
      } else value -= 0.5;
      consider(input, value);
    }
  }

  // ── Nothing on: a safe, legal hit ──
  if (best === null || (best as { value: number }).value < -1) {
    const from = spots[0] ?? cueAt ?? { x: HEAD_X, y: 0 };
    for (const id of legalFirst(state, seat)) {
      const t = state.balls[id];
      if (t === null || t === undefined) continue;
      const dx = t.x - from.x;
      const dy = t.y - from.y;
      const n = Math.sqrt(dx * dx + dy * dy);
      if (n < 1e-6) continue;
      const hit = firstHit(state.balls, from, dx / n, dy / n, 0);
      if (hit === null || hit.kind !== 'ball' || hit.id !== id) continue;
      const input: ShotInput = {
        shot: { dx: dx / n, dy: dy / n, power: Math.min(0.75, 0.25 + n * 0.2), side: 0, top: 0 },
        cue: inHand ? from : undefined,
        call: eight ? defaultCall(state) : undefined,
      };
      const r = playShot(state, input, opts);
      yield;
      const value =
        r.state.phase === 'over'
          ? r.state.winner === seat
            ? 100
            : -100
          : r.outcome.foul
            ? -6
            : -1;
      consider(input, value);
      if (value > -2) break;
    }
  }
  const chosen: ShotInput =
    (best as { input: ShotInput } | null)?.input ??
    ({
      shot: { dx: 1, dy: 0.01, power: 0.4, side: 0, top: 0 },
      cue: inHand ? (spots[0] ?? { x: HEAD_X - 0.1, y: 0 }) : undefined,
      call: eight ? defaultCall(state) : undefined,
    } satisfies ShotInput);
  return noisy(chosen, skill, rand);
}

/** Run the CPU's turn straight through. */
export function plan(
  state: FrameState,
  seat: Seat,
  skill: number,
  opts: CpuOptions = {},
): ShotInput {
  const g = think(state, seat, skill, opts);
  for (;;) {
    const r = g.next();
    if (r.done === true) return r.value;
  }
}

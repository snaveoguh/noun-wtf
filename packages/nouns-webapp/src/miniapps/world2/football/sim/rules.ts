// ── Noun Football: the laws + team shape helpers (pure) ──────────────────
//
// Offside lines, card severity, the formation shape (where a footballer
// stands given the ball), and where everyone lines up for every restart.

import type { PlayerState, TeamId } from '../contract';
import type { FootballSim } from './FootballSim';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * The offside line for `team` attacking: the second-last opponent's
 * progress along the attack (metres, in z·dir), or the halfway line if
 * that's further back.
 */
export function secondLastLine(sim: FootballSim, team: TeamId): number {
  const dir = sim.dir(team);
  const vs: number[] = [];
  for (const o of sim.s.players) if (o.team !== team && o.off !== true) vs.push(o.z * dir);
  vs.sort((a, b) => b - a);
  const second = vs.length >= 2 ? vs[1] : vs.length === 1 ? vs[0] : sim.pitch.length / 2;
  return Math.max(0, second);
}

/** Teammates of `kicker` in an offside position the moment the ball is played. */
export function offsideSet(sim: FootballSim, kicker: PlayerState): string[] {
  const team = kicker.team;
  const dir = sim.dir(team);
  const line = secondLastLine(sim, team);
  const ballV = sim.s.ball.z * dir;
  const out: string[] = [];
  for (const m of sim.s.players) {
    if (m.team !== team || m.id === kicker.id || m.off === true) continue;
    const v = m.z * dir;
    if (v > 0.3 && v > ballV + 0.05 && v > line + 0.05) out.push(m.id);
  }
  return out;
}

/** Card for a foul (null = just a free kick). */
export function cardFor(
  sim: FootballSim,
  pl: PlayerState,
  victim: PlayerState,
  slide: boolean,
): 'yellow' | 'red' | null {
  const dirV = sim.dir(victim.team);
  // Denying an obvious goal-scoring chance: the victim had it, through on goal
  const hadBall = sim.s.ball.lastTouch === victim.id;
  const vv = victim.z * dirV;
  const through =
    hadBall &&
    sim.vOf(victim.team, victim.z) > 0.45 &&
    Math.abs(victim.x) < sim.pitch.boxWidth / 2 + 6 &&
    !sim.s.players.some(
      d =>
        d.team === pl.team &&
        d.id !== pl.id &&
        d.off !== true &&
        !sim.isGK(d.id) &&
        d.z * dirV > vv,
    );
  if (through) return 'red';
  const behind = Math.cos(victim.yaw - pl.yaw) > 0.5;
  const speed = Math.hypot(pl.vx, pl.vz);
  const sev = (slide ? 0.3 : 0.1) + (behind ? 0.28 : 0) + speed / 45 + sim.rnd() * 0.35;
  if (sev > 1.0) return 'red';
  if (sev > 0.74) return 'yellow';
  return null;
}

/**
 * Formation shape: where `pl` stands for a ball at (bx, bz). In
 * possession the block pushes up and spreads, out of it it drops and
 * squeezes; everyone shifts across to the ball's side.
 */
export function shapeSpot(
  sim: FootballSim,
  pl: PlayerState,
  bx: number,
  bz: number,
  inPoss: boolean,
): { x: number; z: number } {
  const team = pl.team;
  const p = sim.pitch;
  const dir = sim.dir(team);
  const slot = sim.slots[team][sim.slotOf.get(pl.id) ?? 0];
  const hl = p.length / 2;
  const hw = p.width / 2;
  if (slot.role === 'GK') return { x: 0, z: -dir * (hl - 1) };
  const tac = sim.config.tactics?.[team] ?? { press: 0.5, width: 0.6, direct: 0.4 };
  const bv = clamp((bz * dir) / hl, -1, 1);
  const bu = clamp((bx * dir) / hw, -1, 1);
  let v: number;
  let u: number;
  if (inPoss) {
    v = slot.v * 0.82 + bv * 0.5 + 0.16;
    u = slot.u * (0.85 + tac.width * 0.3) + bu * 0.22;
  } else {
    v = slot.v * 0.62 + bv * 0.55 - 0.1 + (tac.press - 0.5) * 0.2;
    u = slot.u * 0.68 + bu * 0.36;
    // Defenders stay goalside of the ball
    if (slot.role === 'DF') v = Math.min(v, bv - 0.06);
  }
  v = clamp(v, -0.9, 0.86);
  u = clamp(u, -0.92, 0.92);
  return { x: u * hw * dir, z: v * hl * dir };
}

/** Where `pl` stands for the current restart (or the kick-off line-up). */
export function restartSpots(sim: FootballSim, pl: PlayerState): { x: number; z: number } {
  const s = sim.s;
  const r = s.restart;
  const p = sim.pitch;
  const hl = p.length / 2;
  const hw = p.width / 2;
  const dir = sim.dir(pl.team);
  if (!r) return { x: pl.x, z: pl.z };
  const ours = pl.team === r.team;
  const isTaker = r.taker === pl.id;
  const rdir = sim.dir(r.team);
  const gk = sim.isGK(pl.id);
  // Keepers: on their line unless taking it
  if (gk && !isTaker) {
    if (r.kind === 'penalty' && s.phase === 'shootout' && ours)
      return { x: -hw * 0.45, z: hl - p.boxDepth - 3 };
    return { x: 0, z: -dir * (hl - 0.4) };
  }
  switch (r.kind) {
    case 'kickoff': {
      if (isTaker) return { x: 0, z: -rdir * 0.35 };
      const sp = shapeSpot(sim, pl, 0, 0, ours);
      let z = Math.min(sp.z * dir, -1.2) * dir;
      let x = sp.x;
      const d = Math.hypot(x, z);
      if (!ours && d < p.centreRadius + 0.6) {
        const k = (p.centreRadius + 0.6) / Math.max(0.1, d);
        x *= k;
        z *= k;
        if (z * dir > -0.5) z = -dir * (p.centreRadius + 0.6);
      }
      // the striker's partner stands by the ball
      if (ours && isPartner(sim, pl)) return { x: 2.2, z: -rdir * 0.6 };
      return { x, z };
    }
    case 'penalty': {
      if (isTaker) return { x: r.x, z: r.z - rdir * 1.4 };
      if (s.phase === 'shootout') {
        // everyone else in the centre circle
        const k = sim.slotOf.get(pl.id) ?? 0;
        const a = (k / 11) * Math.PI * 2 + (pl.team ? 0.3 : 0);
        return { x: Math.cos(a) * 4, z: Math.sin(a) * 4 };
      }
      const k = sim.slotOf.get(pl.id) ?? 0;
      const line = rdir * (hl - p.boxDepth - 1.5);
      return { x: (((k * 7 + pl.team * 3) % 20) - 10) * 1.6, z: line };
    }
    case 'corner': {
      if (isTaker) return { x: r.x + Math.sign(r.x) * 0.5, z: r.z + Math.sign(r.z) * 0.5 };
      const end = Math.sign(r.z);
      const slot = sim.slots[pl.team][sim.slotOf.get(pl.id) ?? 0];
      const spots = boxSpots(sim, end, Math.sign(r.x));
      if (ours) {
        // forwards + midfielders attack the box, the back line holds at halfway-ish
        const attackers = sim.s.players.filter(
          q =>
            q.team === pl.team &&
            q.off !== true &&
            !sim.isGK(q.id) &&
            q.id !== r.taker &&
            roleOf(sim, q) !== 'DF',
        );
        const centreBacks = sim.s.players.filter(
          q => q.team === pl.team && q.off !== true && roleOf(sim, q) === 'DF',
        );
        // two tallest-ish defenders go up too (the first two DFs)
        const up = [...attackers, ...centreBacks.slice(0, 2)].slice(0, spots.length);
        const k = up.findIndex(q => q.id === pl.id);
        if (k >= 0) return spots[k];
        return { x: slot.u * hw * 0.6, z: end * hl * 0.15 };
      }
      // defending: mark the attackers in the box (goalside), one at the near post
      const atk = s.players.filter(
        q => q.team === r.team && q.off !== true && !sim.isGK(q.id) && q.id !== r.taker,
      );
      const markers = s.players.filter(
        q => q.team === pl.team && q.off !== true && !sim.isGK(q.id),
      );
      const k = markers.findIndex(q => q.id === pl.id);
      if (k === 0) return { x: Math.sign(r.x) * (p.goalWidth / 2 + 0.6), z: end * (hl - 0.6) };
      const target = atk.length ? spotsFor(sim, atk, r.team)[(k - 1) % atk.length] : null;
      if (target && k - 1 < spots.length + 1)
        return { x: target.x * 0.92, z: target.z + end * 1.0 };
      return { x: slot.u * hw * 0.5, z: end * (hl - p.boxDepth - 4) };
    }
    case 'goal_kick': {
      if (isTaker) return { x: r.x, z: r.z - rdir * 0.9 };
      const sp = shapeSpot(sim, pl, r.x, r.z + rdir * 25, ours);
      // the other team waits outside the box
      if (!ours && sim.inOwnBox(r.team, sp.x, sp.z, 1))
        return { x: sp.x, z: -rdir * (hl - p.boxDepth - 2) };
      return sp;
    }
    case 'free_kick': {
      const gz = rdir * hl;
      const tgx = 0 - r.x;
      const tgz = gz - r.z;
      const dg = Math.hypot(tgx, tgz) || 1;
      if (isTaker) return { x: r.x - (tgx / dg) * 1.1, z: r.z - (tgz / dg) * 1.1 };
      if (!ours && r.direct !== false && dg < 32) {
        // the wall
        const n = sim.config.size === 11 ? 4 : 2;
        const wall = s.players
          .filter(q => q.team === pl.team && q.off !== true && !sim.isGK(q.id))
          .sort(
            (a, b) =>
              Math.hypot(a.x - r.x, a.z - r.z) - Math.hypot(b.x - r.x, b.z - r.z) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, n);
        const k = wall.findIndex(q => q.id === pl.id);
        if (k >= 0) {
          const ux = tgx / dg;
          const uz = tgz / dg;
          const wx = r.x + ux * p.centreRadius;
          const wz = r.z + uz * p.centreRadius;
          const off = (k - (n - 1) / 2) * 0.62 + 0.4;
          return { x: wx + uz * off, z: wz - ux * off };
        }
      }
      const sp = shapeSpot(sim, pl, r.x, r.z, ours);
      return keepAway(sp, r.x, r.z, ours ? 0 : p.centreRadius + 0.5);
    }
    case 'throw_in': {
      if (isTaker) return { x: r.x + Math.sign(r.x) * 0.4, z: r.z };
      const sp = shapeSpot(sim, pl, r.x, r.z, ours);
      return keepAway(sp, r.x, r.z, ours ? 0 : 2);
    }
    default:
      return shapeSpot(sim, pl, r.x, r.z, ours);
  }
}

function keepAway(sp: { x: number; z: number }, x: number, z: number, d: number) {
  const dx = sp.x - x;
  const dz = sp.z - z;
  const l = Math.hypot(dx, dz);
  if (l >= d || d === 0) return sp;
  if (l < 1e-3) return { x: x + d, z };
  return { x: x + (dx / l) * d, z: z + (dz / l) * d };
}

function roleOf(sim: FootballSim, q: PlayerState) {
  return sim.slots[q.team][sim.slotOf.get(q.id) ?? 0].role;
}

/** The kick-off partner: the attacker who isn't taking it. */
function isPartner(sim: FootballSim, pl: PlayerState) {
  const r = sim.s.restart!;
  const fw = sim.s.players.filter(
    q =>
      q.team === pl.team &&
      q.off !== true &&
      roleOf(sim, q) !== 'DF' &&
      !sim.isGK(q.id) &&
      q.id !== r.taker,
  );
  // last forward / midfielder in roster order
  return fw.length > 0 && fw[fw.length - 1].id === pl.id;
}

/** Attacking spots in the box for a corner at end `end` from side `side`. */
function boxSpots(sim: FootballSim, end: number, side: number) {
  const p = sim.pitch;
  const hl = p.length / 2;
  const s = p.sixDepth;
  const pts = [
    { x: side * (p.goalWidth / 2 - 0.5), z: end * (hl - s * 0.6) },
    { x: -side * (p.goalWidth / 2), z: end * (hl - s * 0.9) },
    { x: 0, z: end * (hl - p.penaltySpot) },
    { x: side * p.goalWidth * 0.4, z: end * (hl - p.penaltySpot * 0.75) },
    { x: -side * p.goalWidth * 0.6, z: end * (hl - p.penaltySpot * 0.85) },
    { x: 0, z: end * (hl - p.boxDepth - 1.5) },
  ];
  const n = sim.config.size === 11 ? 6 : sim.config.size === 7 ? 4 : 2;
  return pts.slice(0, n);
}

/** Where each attacker will stand (in their own corner order), for markers. */
function spotsFor(sim: FootballSim, atk: PlayerState[], team: TeamId) {
  void team;
  return atk.map(q => restartSpotsNoMark(sim, q));
}

function restartSpotsNoMark(sim: FootballSim, q: PlayerState) {
  // attackers' spots don't depend on the markers (no recursion)
  return restartSpots(sim, q);
}

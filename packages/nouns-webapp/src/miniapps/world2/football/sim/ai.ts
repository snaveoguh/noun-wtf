// ── Noun Football: the CPU's outfield footballers (pure) ─────────────────
//
// aiThink runs at 10 Hz per footballer nobody controls and picks a target
// and a gait (and, on the ball, a decision); aiSteer runs every step and
// walks them there. Team behaviour comes from three shared ideas:
//   shape     the formation, shifted to the ball (rules.ts shapeSpot);
//   the ball  whoever can get to a loose ball first goes for it (per team);
//   roles     out of possession the nearest presses (the second covers on
//             harder levels or when the human calls for it), the rest mark
//             goalside; in possession the nearest midfielders offer short,
//             forwards hold the offside line and spin in behind.
// Difficulty (1–4) sets reaction time, decision noise, pressing and tackling.

import type { PlayerState, TeamId } from '../contract';
import type { FootballSim } from './FootballSim';

import { FB, wrapAngle } from './FootballSim';
import { secondLastLine, shapeSpot } from './rules';

export interface Brain {
  tx: number;
  tz: number;
  gait: 0 | 1 | 2 | 3;
  /** Seconds on the ball so far (the carrier's reaction clock). */
  hold: number;
  /** Seconds left of a run in behind. */
  runT: number;
  /** The human's "second man press" call (X held). */
  pressCall: number;
  /** Carrier: dribble heading. */
  hx: number;
  hz: number;
}

export const newBrain = (): Brain => ({
  tx: 0,
  tz: 0,
  gait: 0,
  hold: 0,
  runT: 0,
  pressCall: 0,
  hx: 0,
  hz: 1,
});

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Per-step cache: each team's first man to the loose ball. */
const chaserCache = new WeakMap<
  FootballSim,
  { tick: number; ids: [string | null, string | null] }
>();

function chasers(sim: FootballSim): [string | null, string | null] {
  const c = chaserCache.get(sim);
  if (c && c.tick === sim.s.tick) return c.ids;
  const ids: [string | null, string | null] = [null, null];
  const best = [1e9, 1e9];
  for (const q of sim.s.players) {
    if (q.off === true || sim.isGK(q.id) || q.action === 'fallen') continue;
    const ip = sim.interceptPoint(q);
    if (!ip) continue;
    // The intended receiver gets a head start (he's expecting it)
    // the kicking team's receiver is expecting it; the other side reacts late
    const kt = sim.i.kickTeam;
    const t =
      ip.t - (sim.i.receiver === q.id ? 0.4 : 0) + (kt !== null && kt !== q.team ? 0.25 : 0);
    if (t < best[q.team]) {
      best[q.team] = t;
      ids[q.team] = q.id;
    }
  }
  chaserCache.set(sim, { tick: sim.s.tick, ids });
  return ids;
}

export function aiThink(sim: FootballSim, pl: PlayerState, br: Brain) {
  const s = sim.s;
  const pi = sim.i.p[pl.id];
  if (s.phase !== 'live') {
    br.hold = 0;
    if (s.phase === 'goal' && pl.action === 'celebrate') {
      // run to the corner flag
      const p = sim.pitch;
      br.tx = Math.sign(pl.x || 1) * (p.width / 2 - 2);
      br.tz = sim.dir(pl.team) * (p.length / 2 - 3);
      br.gait = 2;
      return;
    }
    if (s.phase === 'final' || s.phase === 'halftime' || s.phase === 'fulltime') {
      br.tx = pl.x;
      br.tz = pl.z;
      br.gait = 0;
      return;
    }
    if (s.restart) {
      const t = sim.restartTarget(pl);
      br.tx = t.x;
      br.tz = t.z;
      const d = Math.hypot(t.x - pl.x, t.z - pl.z);
      br.gait = d > 8 ? 2 : d > 0.5 ? 1 : 0;
    }
    return;
  }
  if (pi.act > 0 && pl.action !== 'jockey') return;
  const o = sim.owner;
  if (o && o.id === pl.id && s.ball.mode === 'free') return carrier(sim, pl, br);
  br.hold = 0;
  if (o && s.ball.mode === 'held') return shape(sim, pl, br, o.team === pl.team);
  if (o && o.team === pl.team) return support(sim, pl, br, o);
  if (o) return defend(sim, pl, br, o);
  loose(sim, pl, br);
}

function shape(sim: FootballSim, pl: PlayerState, br: Brain, inPoss: boolean) {
  const b = sim.s.ball;
  const t = shapeSpot(sim, pl, b.x, b.z, inPoss);
  br.tx = t.x;
  br.tz = t.z;
  const d = Math.hypot(t.x - pl.x, t.z - pl.z);
  br.gait = d > 12 ? 2 : d > 1.2 ? 1 : 0;
}

function loose(sim: FootballSim, pl: PlayerState, br: Brain) {
  const ch = chasers(sim);
  const b = sim.s.ball;
  if (ch[pl.team] === pl.id) {
    const ip = sim.interceptPoint(pl);
    if (ip) {
      br.tx = ip.x;
      br.tz = ip.z;
      br.gait = Math.hypot(ip.x - pl.x, ip.z - pl.z) > 2.5 ? 3 : 2;
      return;
    }
  }
  const last = sim.player(b.lastTouch);
  shape(sim, pl, br, last ? last.team === pl.team : false);
}

function support(sim: FootballSim, pl: PlayerState, br: Brain, carrierPl: PlayerState) {
  const p = sim.pitch;
  const dir = sim.dir(pl.team);
  const role = sim.slots[pl.team][sim.slotOf.get(pl.id) ?? 0].role;
  const base = shapeSpot(sim, pl, carrierPl.x, carrierPl.z, true);
  let tx = base.x;
  let tz = base.z;
  let gait: 0 | 1 | 2 | 3 = 1;
  const line = secondLastLine(sim, pl.team);
  const carrierV = sim.vOf(pl.team, carrierPl.z);
  const wideFinal = carrierV > 0.45 && Math.abs(carrierPl.x) > p.width * 0.25;
  if (wideFinal && (role === 'FW' || (role === 'MF' && sim.slotOf.get(pl.id)! % 2 === 0))) {
    // Attack the box for the cross: near post, far post, penalty spot
    const k = (sim.slotOf.get(pl.id) ?? 0) % 3;
    const side = Math.sign(carrierPl.x);
    const hl = p.length / 2;
    const spots = [
      { x: side * 2.5, z: (hl - 5) * dir },
      { x: -side * 4, z: (hl - 7) * dir },
      { x: 0, z: (hl - p.penaltySpot - 1) * dir },
    ];
    br.tx = spots[k].x;
    br.tz = spots[k].z;
    br.gait = Math.hypot(br.tx - pl.x, br.tz - pl.z) > 3 ? 3 : 1;
    return;
  }
  if (role === 'FW' || (role === 'MF' && Math.abs(base.x) > p.width * 0.3 && carrierV > 0.1)) {
    // Hold the line, then spin in behind now and then
    br.runT = Math.max(0, br.runT - 0.1);
    if (br.runT <= 0 && carrierV > -0.3 && sim.rnd() < 0.04 + 0.01 * sim.difficultyOf(pl.team))
      br.runT = 2.2;
    const lineZ = (line - 0.8) * dir;
    if (br.runT > 0) {
      tz = (line + 9) * dir;
      gait = 3;
    } else {
      tz = dir > 0 ? Math.min(tz, lineZ) : Math.max(tz, lineZ);
      // stay roughly level with the line if the shape is deeper
      if (Math.abs(tz - lineZ) > 8 && carrierV > 0) tz = lineZ - dir * 3;
      gait = 2;
    }
  } else {
    // Offer a short option: an angle off the carrier, in space
    const near = nearestMates(sim, carrierPl, 2);
    if (near.includes(pl.id)) {
      const ax = base.x - carrierPl.x;
      const az = base.z - carrierPl.z;
      const d = Math.hypot(ax, az) || 1;
      const want = 11;
      tx = carrierPl.x + (ax / d) * want;
      tz = carrierPl.z + (az / d) * want;
      // drift away from the nearest opponent
      const opp = nearestOpp(sim, tx, tz, pl.team);
      if (opp && Math.hypot(opp.x - tx, opp.z - tz) < 4) {
        tx += Math.sign(tx - opp.x || 1) * 3;
        tz += Math.sign(tz - opp.z || 1) * 2;
      }
      gait = 2;
    }
  }
  const hw = p.width / 2 - 1;
  const hl = p.length / 2 - 1;
  br.tx = clamp(tx, -hw, hw);
  br.tz = clamp(tz, -hl, hl);
  br.gait = Math.hypot(br.tx - pl.x, br.tz - pl.z) < 1.2 ? 0 : gait;
}

function defend(sim: FootballSim, pl: PlayerState, br: Brain, carrierPl: PlayerState) {
  const dir = sim.dir(pl.team);
  const diff = sim.difficultyOf(pl.team);
  const order = sim.s.players
    .filter(
      q => q.team === pl.team && q.off !== true && !sim.isGK(q.id) && (q.human ?? null) === null,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - carrierPl.x, a.z - carrierPl.z) -
        Math.hypot(b.x - carrierPl.x, b.z - carrierPl.z),
    );
  const rank = order.findIndex(q => q.id === pl.id);
  // A human on the team usually does the pressing themselves: the CPU presses second
  const humanNear = sim.s.players.some(
    q =>
      q.team === pl.team &&
      (q.human ?? null) !== null &&
      Math.hypot(q.x - carrierPl.x, q.z - carrierPl.z) < 8,
  );
  const tac = sim.config.tactics?.[pl.team]?.press ?? 0.5;
  const pressers = humanNear
    ? br.pressCall > 0
      ? 1
      : 0
    : diff >= 3 || tac > 0.65 || br.pressCall > 0
      ? 2
      : 1;
  if (rank >= 0 && rank < pressers) {
    // Close him down from goalside
    const gx = 0;
    const gz = -dir * (sim.pitch.length / 2);
    const ux = gx - carrierPl.x;
    const uz = gz - carrierPl.z;
    const ul = Math.hypot(ux, uz) || 1;
    const off = rank === 0 ? 1.1 : 4.5;
    br.tx = carrierPl.x + carrierPl.vx * 0.25 + (ux / ul) * off;
    br.tz = carrierPl.z + carrierPl.vz * 0.25 + (uz / ul) * off;
    const d = Math.hypot(carrierPl.x - pl.x, carrierPl.z - pl.z);
    br.gait = d > 6 ? 3 : 2;
    const pi = sim.i.p[pl.id];
    if (rank === 0 && d < 1.7 && pi.cd <= 0 && pi.act <= 0) {
      const facing =
        Math.cos(wrapAngle(Math.atan2(carrierPl.x - pl.x, carrierPl.z - pl.z) - pl.yaw)) > 0.4;
      const pTackle = 0.07 + 0.05 * diff;
      if (facing && sim.rnd() < pTackle) sim.tryTackle(pl, false);
      else if (
        sim.rnd() < 0.01 * diff &&
        sim.vOf(pl.team, pl.z) < 0 &&
        Math.hypot(carrierPl.vx, carrierPl.vz) > 4
      )
        sim.tryTackle(pl, true);
    }
    return;
  }
  // Mark: goalside of the nearest attacker to my shape spot
  const base = shapeSpot(sim, pl, carrierPl.x, carrierPl.z, false);
  const opp = nearestOpp(sim, base.x, base.z, pl.team, 11, carrierPl.id);
  if (opp) {
    const gz = -dir * (sim.pitch.length / 2);
    const ux = 0 - opp.x;
    const uz = gz - opp.z;
    const ul = Math.hypot(ux, uz) || 1;
    // tighter the nearer the ball and the harder the CPU
    const dBall = Math.hypot(opp.x - carrierPl.x, opp.z - carrierPl.z);
    const tight = clamp(1 - dBall / 30, 0.15, 0.7) * (0.6 + diff * 0.1);
    const gap = 2.6 - diff * 0.2;
    const mx = opp.x + (ux / ul) * gap;
    const mz = opp.z + (uz / ul) * gap;
    br.tx = base.x * (1 - tight) + mx * tight;
    br.tz = base.z * (1 - tight) + mz * tight;
  } else {
    br.tx = base.x;
    br.tz = base.z;
  }
  const d = Math.hypot(br.tx - pl.x, br.tz - pl.z);
  br.gait = d > 10 ? 3 : d > 1 ? 2 : 0;
}

function nearestMates(sim: FootballSim, c: PlayerState, n: number): string[] {
  return sim.s.players
    .filter(q => q.team === c.team && q.id !== c.id && q.off !== true && !sim.isGK(q.id))
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))
    .slice(0, n)
    .map(q => q.id);
}

function nearestOpp(
  sim: FootballSim,
  x: number,
  z: number,
  team: TeamId,
  within = 99,
  skip?: string,
) {
  let best: PlayerState | undefined;
  let bd = within;
  for (const q of sim.s.players) {
    if (q.team === team || q.off === true || sim.isGK(q.id) || q.id === skip) continue;
    const d = Math.hypot(q.x - x, q.z - z);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** The CPU on the ball: shoot, pass, cross, dribble or shield. */
function carrier(sim: FootballSim, pl: PlayerState, br: Brain) {
  const s = sim.s;
  const p = sim.pitch;
  const dir = sim.dir(pl.team);
  const diff = sim.difficultyOf(pl.team);
  const r = sim.ratings.get(pl.id)!;
  br.hold += 0.1;
  const pressure = sim.pressureOn(pl);
  const goalZ = (dir * p.length) / 2;
  const dGoal = Math.hypot(pl.x, goalZ - pl.z);
  const angle =
    Math.atan2(p.goalWidth / 2, Math.max(0.5, Math.abs(goalZ - pl.z))) *
    2 *
    (Math.abs(pl.x) < p.width ? 1 : 0);
  const react = 0.55 - diff * 0.08 - pressure * 0.2;
  // Dribble heading: at goal, away from the nearest opponent
  const opp = nearestOpp(sim, pl.x, pl.z, pl.team, 8);
  // Head for goal: straight up the pitch in our half, cutting inside in theirs
  const vNow = sim.vOf(pl.team, pl.z);
  const inside = vNow > 0.25 ? 1 : 0.35;
  let hx = ((0 - pl.x) / Math.max(1, dGoal)) * inside;
  let hz = dir;
  if (opp) {
    const ax = pl.x - opp.x;
    const az = pl.z - opp.z;
    const ad = Math.hypot(ax, az) || 1;
    const k = clamp((6 - ad) / 6, 0, 1) * 0.9;
    hx += (ax / ad) * k;
    hz += (az / ad) * k * 0.4;
  }
  const hl = Math.hypot(hx, hz) || 1;
  br.hx = hx / hl;
  br.hz = hz / hl;
  br.tx = pl.x + br.hx * 8;
  br.tz = pl.z + br.hz * 8;
  const space = !opp || Math.hypot(opp.x - pl.x, opp.z - pl.z) > 5;
  br.gait = space ? 3 : 2;
  if (br.hold < react) return;
  const noise = (5 - diff) * 0.08;
  // Shoot?
  const xg = Math.exp(-dGoal / (8 + r.shooting * 5)) * clamp(angle * 2.2, 0.1, 1);
  const shootWant =
    xg + sim.gauss() * noise * 0.3 > 0.16 - diff * 0.01 ||
    (dGoal < 11 && Math.abs(pl.x) < p.boxWidth / 2);
  if (shootWant && dGoal < 30) {
    // the far corner from the keeper
    const gk = sim.s.players.find(q => q.team !== pl.team && sim.isGK(q.id) && q.off !== true);
    const gkx = gk ? gk.x : 0;
    const ax = (gkx >= 0 ? -1 : 1) * (0.5 + sim.rnd() * 0.45);
    sim.startKick(pl, {
      kind: 'shot',
      power: clamp(0.65 + dGoal / 60 + sim.rnd() * 0.15, 0.5, 0.95),
      ax,
      az: 0.15 + sim.rnd() * 0.55,
      to: null,
      finesse: dGoal < 22 && sim.rnd() < 0.35,
      at: 0,
      restart: null,
    });
    br.hold = 0;
    return;
  }
  // Cross from wide in the final third
  const v = sim.vOf(pl.team, pl.z);
  if (v > 0.55 && Math.abs(pl.x) > p.width * 0.28 && sim.rnd() < 0.5) {
    const opp = (1 - pl.team) as TeamId;
    let tgt: PlayerState | undefined;
    let bd = 1e9;
    for (const q of sim.s.players) {
      if (q.team !== pl.team || q.id === pl.id || q.off === true || !sim.inOwnBox(opp, q.x, q.z, 2))
        continue;
      const d = Math.abs(q.x) + sim.pressureOn(q) * 6;
      if (d < bd) {
        bd = d;
        tgt = q;
      }
    }
    if (tgt) {
      sim.startKick(pl, {
        kind: 'lob',
        power: 0.6,
        ax: 0,
        az: dir,
        to: tgt.id,
        finesse: false,
        at: 0,
        restart: null,
      });
      br.hold = 0;
      return;
    }
  }
  // Pass when pressed or after carrying it a while; through balls to runners
  const runner = sim.s.players.find(
    q =>
      q.team === pl.team &&
      q.id !== pl.id &&
      q.off !== true &&
      (sim.i.brains[q.id]?.runT ?? 0) > 0.5,
  );
  const tgt = sim.bestTarget(pl, 'pass', true);
  const tgtProg = tgt ? (tgt.z - pl.z) * dir : -99;
  const finalThird = v > 0.42;
  const wantPass = finalThird
    ? (pressure > 0.8 && sim.rnd() < 0.5) || br.hold > 2.2 + sim.rnd()
    : (pressure > 0.7 && sim.rnd() < 0.45 + diff * 0.05) ||
      (br.hold > 0.8 + sim.rnd() * 1.6 && tgtProg > -4) ||
      br.hold > 3.2;
  const runAhead = runner ? (runner.z - pl.z) * dir : -99;
  const thruX = runner ? runner.x + runner.vx * 0.8 : 0;
  const thruZ = runner ? runner.z + runner.vz * 0.8 + dir * 6 : 0;
  if (
    runner &&
    runAhead > 4 &&
    br.hold > react &&
    laneClear(sim, pl, thruX, thruZ, 2.2) &&
    sim.rnd() < 0.1 + diff * 0.04
  ) {
    sim.startKick(pl, {
      kind: 'through',
      power: 0.5,
      ax: 0,
      az: dir,
      to: runner.id,
      finesse: false,
      at: 0,
      restart: null,
    });
    br.hold = 0;
    return;
  }
  if (wantPass) {
    if (tgt) {
      const long = Math.hypot(tgt.x - pl.x, tgt.z - pl.z) > 28;
      sim.startKick(pl, {
        kind: long ? 'lob' : 'pass',
        power: 0.5,
        ax: 0,
        az: dir,
        to: tgt.id,
        finesse: false,
        at: 0,
        restart: null,
      });
      br.hold = 0;
      return;
    }
  }
  // Beat a man with a skill move now and then
  if (
    opp &&
    Math.hypot(opp.x - pl.x, opp.z - pl.z) < 2.6 &&
    sim.rnd() < 0.08 * diff * r.dribbling
  ) {
    const pi = sim.i.p[pl.id];
    if (pi.cd <= 0) {
      sim.startAction(pl, 'skill', 0.45);
      const side = sim.rnd() < 0.5 ? -1 : 1;
      pi.sx = br.hz * side * 0.8 + br.hx * 0.6;
      pi.sz = -br.hx * side * 0.8 + br.hz * 0.6;
      const l = Math.hypot(pi.sx, pi.sz) || 1;
      pi.sx /= l;
      pi.sz /= l;
      pl.actionDir = side > 0 ? 1 : 3;
      pi.cd = 1.5;
    }
  }
  void s;
}

/** No opponent within `w` m of the line from `from` to (tx, tz)? */
export function laneClear(sim: FootballSim, from: PlayerState, tx: number, tz: number, w: number) {
  const dx = tx - from.x;
  const dz = tz - from.z;
  const L2 = dx * dx + dz * dz || 1;
  for (const o of sim.s.players) {
    if (o.team === from.team || o.off === true) continue;
    const t = clamp(((o.x - from.x) * dx + (o.z - from.z) * dz) / L2, 0, 1);
    const lx = from.x + dx * t - o.x;
    const lz = from.z + dz * t - o.z;
    // a man near the start of the pass blocks it hardest
    if (Math.hypot(lx, lz) < w * (0.6 + t * 0.6)) return false;
  }
  return true;
}

/** Every step: walk toward the brain's target. */
export function aiSteer(sim: FootballSim, pl: PlayerState, br: Brain) {
  const pi = sim.i.p[pl.id];
  pi.face = null;
  if (sim.s.ball.owner === pl.id && sim.s.ball.mode === 'free' && sim.s.phase === 'live') {
    pi.mx = br.hx;
    pi.mz = br.hz;
    pi.gait = br.gait;
    // the receiver of a pass in flight runs onto it
    return;
  }
  // Receiving: run onto the pass
  if (sim.i.receiver === pl.id && sim.s.ball.mode === 'free' && sim.s.phase === 'live') {
    const ip = sim.interceptPoint(pl);
    if (ip) {
      br.tx = ip.x;
      br.tz = ip.z;
      br.gait = Math.hypot(ip.x - pl.x, ip.z - pl.z) > 3 ? 3 : 2;
    }
  }
  const dx = br.tx - pl.x;
  const dz = br.tz - pl.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3 || br.gait === 0) {
    pi.mx = 0;
    pi.mz = 0;
    pi.gait = 0;
    return;
  }
  pi.mx = dx / d;
  pi.mz = dz / d;
  // Arrive: slow down near the target
  pi.gait = d < 1.5 ? 1 : br.gait;
  void FB;
}

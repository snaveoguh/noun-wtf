// ── Noun Football: goalkeepers (pure) ───────────────────────────────────
//
// Always the CPU (like a console game's default). Every step a keeper:
//   holding it   waits a beat, then throws it to a free defender or kicks
//                it long;
//   a shot on    reads the ball's path (the shared prediction), reacts after
//                a short delay (keeping rating), sets or dives across to
//                where it crosses his line, and catches or parries it
//                (rating vs pace and stretch);
//   penalties    guesses a side as it's struck (and sometimes reads it);
//   a loose ball in his box that he gets to first: comes and claims it
//                (hands only in the box and not from a team-mate's pass);
//   otherwise    stands on the line from the ball to the middle of his goal,
//                further out the further the ball is, and narrows the angle
//                one on one.

import type { PlayerState } from '../contract';
import type { FootballSim } from './FootballSim';

import { FB } from './FootballSim';

export interface KeeperBrain {
  /** The human's "keeper rush" call (Y held). */
  rush: number;
  /** Reaction countdown on the current shot (−1 = no shot). */
  react: number;
  /** This shot already decided (saved or beaten). */
  done: boolean;
  /** Dive: target point and time left. */
  dx: number;
  dy: number;
  dt: number;
  /** Penalty guess (−1 / 0 / +1 across, pitch x sign), null = none yet. */
  guess: number | null;
  /** Holding the ball (s). */
  holdT: number;
}

export const newKeeperBrain = (): KeeperBrain => ({
  rush: 0,
  react: -1,
  done: false,
  dx: 0,
  dy: 0,
  dt: 0,
  guess: null,
  holdT: 0,
});

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const DT = 1 / 60;

export function keeperStep(sim: FootballSim, gk: PlayerState, kb: KeeperBrain) {
  const s = sim.s;
  const b = s.ball;
  const p = sim.pitch;
  const pi = sim.i.p[gk.id];
  const r = sim.ratings.get(gk.id)!;
  const dir = sim.dir(gk.team);
  const lineZ = -dir * (p.length / 2);
  pi.face = null;
  // A dive in progress
  if (gk.action === 'gk_dive' && pi.act > 0) {
    if (kb.dt > 0) {
      const k = Math.min(1, DT / kb.dt);
      gk.x += (kb.dx - gk.x) * k;
      gk.y = Math.max(0, gk.y + (Math.max(0, kb.dy - 0.9) - gk.y) * k);
      kb.dt -= DT;
    }
    gk.vx = 0;
    gk.vz = 0;
    contact(sim, gk, kb, true);
    return;
  }
  if (gk.action === 'gk_dive' && pi.act <= 0) gk.y = 0;
  // Restarts: to the spot (the goal kick's taker is placed by the sim)
  if (s.phase !== 'live' && s.phase !== 'shootout') {
    kb.react = -1;
    kb.done = false;
    kb.guess = null;
    if (s.restart) walkTo(sim, gk, sim.restartTarget(gk), 1);
    else walkTo(sim, gk, { x: gk.x, z: gk.z }, 0);
    return;
  }
  // Holding the ball: distribute
  if (b.owner === gk.id && b.mode === 'held') {
    kb.holdT += DT;
    pi.mx = pi.mz = 0;
    pi.gait = 0;
    if (pi.act <= 0) gk.action = 'gk_hold';
    gk.yaw = dir > 0 ? 0 : Math.PI;
    if (kb.holdT > 1.4 && !pi.kick) {
      const short = sim.bestTarget(gk, 'pass', false);
      const free =
        short && sim.pressureOn(short) < 0.3 && Math.hypot(short.x - gk.x, short.z - gk.z) < 32;
      if (free === true && sim.rnd() < 0.6)
        sim.startKick(gk, {
          kind: 'gkthrow',
          power: 0.6,
          ax: 0,
          az: dir,
          to: short!.id,
          finesse: false,
          at: 0,
          restart: null,
        });
      else {
        const long = sim.bestTarget(gk, 'lob', true);
        sim.startKick(gk, {
          kind: 'gkkick',
          power: 0.9,
          ax: 0,
          az: dir,
          to: long?.id ?? null,
          finesse: false,
          at: 0,
          restart: null,
        });
      }
    }
    return;
  }
  kb.holdT = 0;
  // At his feet (a back pass): clear it
  if (b.owner === gk.id && b.mode === 'free') {
    if (!pi.kick && pi.act <= 0) {
      const long = sim.bestTarget(gk, 'lob', true);
      sim.startKick(gk, {
        kind: 'lob',
        power: 0.85,
        ax: 0,
        az: dir,
        to: long?.id ?? null,
        finesse: false,
        at: 0,
        restart: null,
      });
    }
    return;
  }
  // A shot coming?
  if (b.mode === 'free' && b.owner === null) {
    const threat = shotThreat(sim, gk);
    if (threat) {
      if (kb.react < 0 && !kb.done) {
        const pen = sim.i.restartKick === 'penalty' || s.phase === 'shootout';
        kb.react = pen
          ? 0.02
          : 0.08 + (1 - r.keeping) * 0.22 + (4 - sim.difficultyOf(gk.team)) * 0.03;
        if (pen) {
          const read = sim.rnd() < 0.22 + r.keeping * 0.25;
          kb.guess = read ? Math.sign(threat.x) : [-1, 0, 1][Math.floor(sim.rnd() * 3)];
        }
      }
      if (!kb.done) {
        kb.react -= DT;
        if (kb.react <= 0) {
          let tx = threat.x;
          if (kb.guess !== null && kb.guess !== Math.sign(threat.x) && Math.abs(threat.x) > 0.6)
            tx = kb.guess * 2.6;
          const need = Math.abs(tx - gk.x);
          const reach = 0.75;
          if (need < reach && threat.y < 2.1) {
            // Set and take it on the body / hands
            pi.mx = Math.sign(tx - gk.x) * 0.6;
            pi.mz = 0;
            pi.gait = 1;
            gk.action = 'gk_ready';
            contact(sim, gk, kb, false);
          } else if (pi.act <= 0) {
            // Dive
            const maxReach = 2.6 + r.keeping * 0.9;
            const t = Math.max(0.12, threat.t);
            const can = Math.min(maxReach, 0.9 + 6.5 * t);
            const reachX = gk.x + Math.sign(tx - gk.x) * Math.min(need, can);
            sim.startAction(gk, 'gk_dive', 0.95);
            gk.actionDir = Math.sign(tx - gk.x) * (dir > 0 ? -1 : 1);
            kb.dx = reachX;
            kb.dy = threat.y;
            kb.dt = Math.min(t, 0.45);
          }
        }
        return;
      }
    } else if (!kb.done) kb.react = -1;
    if (!threat && Math.hypot(b.vx, b.vz) < 6) {
      kb.done = false;
      kb.guess = null;
    }
    // Claim a loose ball in the box (or a cross)
    if (claim(sim, gk, kb)) return;
  }
  position(sim, gk, kb, lineZ, dir);
}

/** Where a shot crosses this keeper's line (pitch x, height, seconds), if it's on target-ish. */
function shotThreat(sim: FootballSim, gk: PlayerState) {
  const b = sim.s.ball;
  const p = sim.pitch;
  const dir = sim.dir(gk.team);
  const toward = -dir * b.vz;
  if (toward < 7) return null;
  const last = sim.player(b.lastTouch);
  if (last && last.team === gk.team && sim.i.restartKick === null && toward < 16) return null;
  const pred = sim.predict();
  const planeZ = gk.z;
  let prev = { x: b.x, y: b.y, z: b.z, t: 0 };
  for (const q of pred) {
    if ((q.z - planeZ) * -dir >= 0 && (prev.z - planeZ) * -dir < 0) {
      const f = (planeZ - prev.z) / (q.z - prev.z || 1e-6);
      const x = prev.x + (q.x - prev.x) * f;
      const y = prev.y + (q.y - prev.y) * f;
      const t = prev.t + (q.t - prev.t) * f;
      // heading for the goal frame (+ a margin: keepers go for near misses too)
      if (Math.abs(x) < p.goalWidth / 2 + 1.2 && y < p.goalHeight + 0.6) return { x, y, t };
      return null;
    }
    prev = q;
  }
  return null;
}

/** Ball reaches the keeper: catch, parry or beaten. */
function contact(sim: FootballSim, gk: PlayerState, kb: KeeperBrain, diving: boolean) {
  if (kb.done) return;
  const b = sim.s.ball;
  if (b.mode !== 'free' || b.owner !== null) return;
  const r = sim.ratings.get(gk.id)!;
  const hy = gk.y + 1.0;
  const dx = b.x - gk.x;
  const dz = b.z - gk.z;
  const dy = b.y - hy;
  const reachH = diving ? 1.15 : 0.8;
  if (Math.hypot(dx, dz) > reachH || dy > 1.5 || dy < -1.2) return;
  kb.done = true;
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  const stretch = diving ? clamp(Math.abs(kb.dx - gk.x) / 3, 0, 1) + 0.25 : 0;
  const diffAdj = (sim.difficultyOf(gk.team) - 2) * 0.04;
  const pen = sim.i.restartKick === 'penalty' || sim.s.phase === 'shootout';
  let chance = 0.55 + r.keeping * 0.45 - speed / 70 - stretch * 0.3 + diffAdj - (pen ? 0.12 : 0);
  // corners of the goal are hard
  const p = sim.pitch;
  if (Math.abs(b.x) > p.goalWidth / 2 - 0.6 && b.y > p.goalHeight - 0.6) chance -= 0.2;
  if (sim.rnd() > chance) {
    // beaten: let it go past (no more touches on it)
    sim.i.p[gk.id].noTouch = 0.6;
    return;
  }
  const inBox = sim.inOwnBox(gk.team, gk.x, gk.z, 0.3);
  if (inBox && speed < 19 + r.keeping * 4 && stretch < 0.7 && sim.rnd() < 0.75) {
    b.mode = 'held';
    b.owner = gk.id;
    b.vx = b.vy = b.vz = 0;
    if (gk.action !== 'gk_dive') sim.startAction(gk, 'gk_catch', 0.4);
    sim.saved(gk, true);
  } else {
    // Parry: away from the goal, often round the post
    const dir = sim.dir(gk.team);
    const side = Math.sign(b.x - gk.x) || (sim.rnd() < 0.5 ? -1 : 1);
    b.vz = Math.abs(b.vz) * 0.25 * dir + dir * 2;
    b.vx = side * (4 + sim.rnd() * 6);
    b.vy = 2 + sim.rnd() * 3;
    b.wx = b.wy = b.wz = 0;
    sim.saved(gk, false);
    b.lastTouch = gk.id;
    sim.i.p[gk.id].noTouch = 0.5;
  }
}

/** Come and claim a loose ball he gets to first. */
function claim(sim: FootballSim, gk: PlayerState, kb: KeeperBrain): boolean {
  const s = sim.s;
  const b = s.ball;
  const pi = sim.i.p[gk.id];
  if (pi.noTouch > 0) return false;
  const ip = sim.interceptPoint(gk);
  if (!ip) return false;
  const inBox = sim.inOwnBox(gk.team, ip.x, ip.z, 0);
  const rushing = kb.rush > 0;
  if (!inBox && !rushing) return false;
  // first there?
  let first = true;
  for (const q of s.players) {
    if (q.id === gk.id || q.off === true || q.team === gk.team) continue;
    const t = sim.interceptPoint(q);
    if (t && t.t < ip.t - 0.25) {
      first = false;
      break;
    }
  }
  // a team-mate on it is fine too, unless it's coming to the keeper
  if (!first) return false;
  const near = Math.hypot(b.x - gk.x, b.z - gk.z);
  walkTo(sim, gk, ip, near > 4 ? 3 : 2);
  // Pick it up
  const backpass =
    sim.i.kickTeam === gk.team &&
    (sim.i.kickKind === 'pass' || sim.i.kickKind === 'through' || sim.i.kickKind === 'lob') &&
    sim.player(b.lastTouch)?.team === gk.team;
  const handsOk = sim.inOwnBox(gk.team, gk.x, gk.z, 0) && !backpass;
  const hy = gk.y + 1.0;
  if (near < 1.0 && b.y < (handsOk ? 2.7 : 0.6) && Math.abs(b.y - hy) < 2) {
    if (handsOk) {
      b.mode = 'held';
      b.owner = gk.id;
      b.vx = b.vy = b.vz = 0;
      sim.startAction(gk, 'gk_catch', 0.35);
      sim.touched(gk);
    } else if (sim.touched(gk)) {
      b.owner = gk.id;
    }
  }
  return true;
}

function position(sim: FootballSim, gk: PlayerState, kb: KeeperBrain, lineZ: number, dir: number) {
  const b = sim.s.ball;
  const p = sim.pitch;
  const dxB = b.x;
  const dzB = b.z - lineZ;
  const dBall = Math.hypot(dxB, dzB) || 1;
  let depth = clamp(dBall * 0.09, 0.6, 4.5);
  // One on one: come out and narrow the angle
  const o = sim.owner;
  if (o && o.team !== gk.team && dBall < 18) {
    const covered = sim.s.players.some(
      q =>
        q.team === gk.team &&
        q.off !== true &&
        q.id !== gk.id &&
        (q.z - lineZ) * dir < (o.z - lineZ) * dir - 1 &&
        Math.abs(q.x - o.x) < 6,
    );
    if (!covered) depth = clamp(dBall - 3, 1, 9);
  }
  if (kb.rush > 0 && o && o.team !== gk.team) depth = clamp(dBall - 1.5, 1, 14);
  const x = clamp((dxB / dBall) * depth, -(p.goalWidth / 2 + 0.6), p.goalWidth / 2 + 0.6);
  const z = lineZ + (dzB / dBall) * depth;
  walkTo(sim, gk, { x, z }, Math.hypot(x - gk.x, z - gk.z) > 3 ? 2 : 1);
  const pi = sim.i.p[gk.id];
  pi.face = Math.atan2(b.x - gk.x, b.z - gk.z);
  if (pi.act <= 0) gk.action = Math.abs(b.z - lineZ) < p.length * 0.4 ? 'gk_ready' : 'idle';
  void FB;
}

function walkTo(
  sim: FootballSim,
  gk: PlayerState,
  t: { x: number; z: number },
  gait: 0 | 1 | 2 | 3,
) {
  const pi = sim.i.p[gk.id];
  const dx = t.x - gk.x;
  const dz = t.z - gk.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2 || gait === 0) {
    pi.mx = pi.mz = 0;
    pi.gait = 0;
    return;
  }
  pi.mx = dx / d;
  pi.mz = dz / d;
  pi.gait = d < 1 ? 1 : gait;
}

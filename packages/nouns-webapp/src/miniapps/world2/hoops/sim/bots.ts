// Bot AI: turns the game state into a BallerInput for each bot, exactly
// like a human pad would. Decisions happen on a reaction-limited tick
// (difficulty + ratings); steering runs every step so bots never stall.
//
// Offense: clear it after a change of possession (half court), space the
// floor (corners / wings / top), cut, set the odd screen, drive lanes, kick
// out when help comes, shoot when open, hit callers, cross up isolations.
// Defense: man-to-man between man and rim, help on drives, contest shots,
// box out, go for boards, the occasional steal.

import type { CourtGeo } from './court';
import type { HoopsSim } from './HoopsSim';
import type { Brain } from './types';

import { type BallerInput, type GameConfig, SHOT_SWEET, SIM_DT, type TeamId } from '../contract';

export interface BotWorld {
  sim: HoopsSim;
  cfg: GameConfig;
  geo: CourtGeo;
  difficulty: 1 | 2 | 3;
}

/** Offensive spacing spots: (x offset, distance out from the rim along the court). */
const SPOTS: [number, number][] = [
  [-5.6, 5.0],
  [5.6, 5.0],
  [0, 7.6],
  [-7.1, 0.8],
  [7.1, 0.8],
  [-2.8, 5.4],
  [2.8, 5.4],
  [-3.0, 1.2],
  [3.0, 1.2],
];

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function blank(): BallerInput {
  return { moveX: 0, moveZ: 0, sprint: false, shoot: false, pass: false, move: false, call: false };
}

export function botInput(w: BotWorld, i: number): BallerInput {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const b = q.brain;
  const inp = blank();
  if (s.phase !== 'live') {
    b.jumpAt = -1;
    b.stealAt = -1;
    b.shootAt = -1;
    b.passAt = -1;
    b.moveAt = -1;
    return inp;
  }
  const t = s.time;
  const ball = s.ball;
  const holding = ball.state === 'held' && ball.holder === p.id;
  if (sim.busy(i)) return inp;

  // Holding a jumper: let go when the meter reaches our target.
  if (holding && q.act === 'gather') {
    const next = q.meter + SIM_DT / 0.85;
    inp.shoot = next < b.release - SIM_DT / (2 * 0.85);
    return inp;
  }

  // Timed presses (one-step taps).
  if (!holding && b.jumpAt >= 0 && t >= b.jumpAt) {
    inp.shoot = true;
    b.jumpAt = -1;
  }
  if (!holding && b.stealAt >= 0 && t >= b.stealAt) {
    inp.move = true;
    b.stealAt = -1;
  }
  if (holding) {
    // A rebound / contest jump queued before we got the ball isn't a shot.
    b.jumpAt = -1;
    b.stealAt = -1;
    if (b.passAt >= 0 && t >= b.passAt) {
      inp.pass = true;
      inp.passTo = b.passTo !== '' ? b.passTo : undefined;
      if (b.alley) inp.shoot = true;
      b.passAt = -1;
      b.alley = false;
    } else if (b.shootAt >= 0 && t >= b.shootAt) {
      inp.shoot = true;
      b.shootAt = -1;
      const sigma = [0.075, 0.06, 0.045][w.difficulty - 1] * (1.3 - q.rate.shooting * 0.6);
      b.release = SHOT_SWEET + sim.gauss() * sigma;
    } else if (b.moveAt >= 0 && t >= b.moveAt) {
      inp.move = true;
      b.moveAt = -1;
    }
  } else {
    b.passAt = -1;
    b.shootAt = -1;
    b.moveAt = -1;
  }

  react(w, i);

  // Finishing a drive is a per-step read, not a tick decision.
  if (
    holding &&
    b.intent === 'drive' &&
    b.shootAt < 0 &&
    b.passAt < 0 &&
    !(w.cfg.halfCourt && !I.cleared)
  ) {
    const d = sim.distToRim(i);
    const sp = Math.hypot(p.vx, p.vz);
    if (d < 1.6 + 2.6 * q.rate.dunking && sp > 3) {
      inp.shoot = true;
      b.release = SHOT_SWEET;
      b.intent = 'probe';
      return inp;
    }
  }

  if (t >= b.next) {
    const iv = [0.4, 0.3, 0.22][w.difficulty - 1];
    b.next = t + iv + sim.rand() * 0.1;
    decide(w, i);
  }
  inp.call = b.intent === 'cut' || (b.intent === 'spot' && t < b.callUntil);
  steer(w, i, inp);
  return inp;
}

/** Per-step reactions (scheduled with the bot's reaction delay). */
function react(w: BotWorld, i: number): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const b = q.brain;
  const t = s.time;
  const ball = s.ball;
  if (p.y > 0.02 || q.cdJump > 0 || b.jumpAt >= 0 || q.act === 'stumble') return;

  // Contest: an opponent rising to shoot near us.
  for (let j = 0; j < s.players.length; j++) {
    const o = s.players[j];
    if (o.team === p.team) continue;
    const oq = I.players[j];
    const key = `${o.id}:${I.shot?.t ?? 0}:${oq.act}`;
    if (b.sawShot === key) continue;
    const d = Math.hypot(o.x - p.x, o.z - p.z);
    if (oq.act === 'gather' && d < 2.4) {
      b.sawShot = key;
      const toSweet = Math.max(0, (SHOT_SWEET - oq.meter) * 0.85);
      const skill = 0.5 + 0.5 * q.rate.defense;
      if (sim.rand() < 0.35 + 0.5 * skill)
        b.jumpAt = t + Math.max(b.react, toSweet - 0.28 + sim.gauss() * 0.06);
      return;
    }
    if ((oq.act === 'layup' || oq.act === 'dunk') && d < 2.2) {
      b.sawShot = key;
      // Time the jump so the hands are up at the release / slam, and coming
      // down before the ball does (no goaltending).
      const toRelease = Math.max(0, oq.slamAt * oq.dur - oq.at);
      if (sim.rand() < 0.3 + 0.4 * q.rate.defense)
        b.jumpAt = t + Math.max(b.react * 0.6, toRelease - 0.42);
      return;
    }
  }

  // Rebound: ball coming down near us.
  // (Not while a live shot that hasn't hit iron is above the rim: goaltending.)
  const shotLive = I.shot !== null && I.shot.live && !I.shot.touchedRim;
  if (!shotLive && ball.state === 'loose') {
    const d = Math.hypot(ball.x - p.x, ball.z - p.z);
    if (d < 1.4 && ball.vy < 0 && ball.y > 2.1 && ball.y < 3.4) b.jumpAt = t + b.react * 0.4;
  }
}

function rimOf(w: BotWorld, team: TeamId) {
  return w.sim.rimPos(team);
}

/** Absolute spot k for attackers of `team`. */
function spotPos(w: BotWorld, team: TeamId, k: number): [number, number] {
  const rimIdx = w.sim.rimOf(team);
  const rim = w.geo.rims[rimIdx];
  const sg = w.geo.sign[rimIdx];
  const [dx, out] = SPOTS[k];
  return [rim.x + dx, rim.z - sg * out];
}

function decide(w: BotWorld, i: number): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const ball = s.ball;
  const h = sim.holderIndex();
  if (h === i) return decideHandler(w, i);
  if (I.pass !== null && I.pass.to === p.id) {
    setIntent(w, i, 'receive', ball.x + ball.vx * 0.25, ball.z + ball.vz * 0.25, true);
    return;
  }
  if (h >= 0) {
    if (s.players[h].team === p.team) return decideOffBall(w, i, h);
    return decideDefense(w, i, h);
  }
  return decideLoose(w, i);
}

function setIntent(
  w: BotWorld,
  i: number,
  intent: Brain['intent'],
  tx: number,
  tz: number,
  sprint: boolean,
): void {
  const b = w.sim.internal.players[i].brain;
  b.intent = intent;
  const g = w.geo;
  b.tx = clamp(tx, -g.halfW + 0.6, g.halfW - 0.6);
  b.tz = clamp(tz, w.cfg.halfCourt ? 0.6 : -g.halfL + 0.6, g.halfL - 0.6);
  b.sprint = sprint;
}

function decideHandler(w: BotWorld, i: number): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const b = q.brain;
  const t = s.time;
  const geo = w.geo;
  const rimIdx = sim.rimOf(p.team);
  const rim = geo.rims[rimIdx];
  const sg = geo.sign[rimIdx];
  const d = sim.distToRim(i);
  const ux = (rim.x - p.x) / Math.max(1e-6, d);
  const uz = (rim.z - p.z) / Math.max(1e-6, d);
  const [, open] = sim.nearestOpp(i);
  const sp = Math.hypot(p.vx, p.vz);
  const sc = w.cfg.shotClock > 0 ? s.shotClock : 99;
  const R3 = geo.spec.threeRadius;
  const pending = b.shootAt >= 0 || b.passAt >= 0;
  if (pending) return;

  // Half court: take it back past the arc first.
  if (w.cfg.halfCourt && !I.cleared) {
    let ox = p.x - rim.x;
    let oz = p.z - rim.z;
    const l = Math.max(1e-6, Math.hypot(ox, oz));
    ox /= l;
    oz /= l;
    // Out toward the top if we're down on the baseline.
    if (oz * -sg < 0.35) {
      ox *= 0.6;
      oz = -sg * 0.8;
      const l2 = Math.hypot(ox, oz);
      ox /= l2;
      oz /= l2;
    }
    setIntent(w, i, 'clear', rim.x + ox * (R3 + 1.4), rim.z + oz * (R3 + 1.4), true);
    if (open < 1.1 && q.cdMove <= 0 && sim.rand() < 0.25) b.moveAt = t + 0.03;
    return;
  }
  // Full court: bring it up.
  if (!w.cfg.halfCourt && p.z * sg < 0) {
    setIntent(w, i, 'probe', p.x * 0.5, rim.z - sg * 7.5, true);
    if (open < 1.1 && q.cdMove <= 0 && sim.rand() < 0.2) b.moveAt = t + 0.03;
    return;
  }

  const shoot = () => {
    b.shootAt = t + 0.02;
  };
  if (d < 1.9) return shoot();
  if (b.intent === 'drive' && d < 3.6 + q.rate.dunking && sp > 2.6) return shoot();
  if (b.intent === 'drive' && d > 2.5) {
    const cut = sim.laneClearance(p.team, p.x, p.z, rim.x - ux * 0.8, rim.z - uz * 0.8) < 0.7;
    if (cut) {
      // Cut off: pull up if there's room, else reset.
      if (open > 1.4 && d < 7 && sim.rand() < 0.5) return shoot();
      b.intent = 'probe';
      b.tx = p.x - ux * 1.5;
      b.tz = p.z - uz * 1.5;
    }
  }
  if (sc < 2.2) return shoot();

  const mate = sim.bestTeammate(i);
  let mateOpen = 0;
  if (mate >= 0) mateOpen = sim.nearestOpp(mate)[1];
  let helpers = 0;
  for (const o of s.players)
    if (o.team !== p.team && Math.hypot(o.x - p.x, o.z - p.z) < 2.4) helpers++;
  const lane = sim.laneClearance(p.team, p.x, p.z, rim.x - ux * 0.8, rim.z - uz * 0.8);

  // Alley-oop to a cutter.
  for (let j = 0; j < s.players.length; j++) {
    const m = s.players[j];
    const mq = I.players[j];
    if (j === i || m.team !== p.team || mq.brain.intent !== 'cut') continue;
    const md = sim.distToRim(j);
    if (
      md < 5.5 &&
      md > 1.5 &&
      mq.rate.dunking > 0.45 &&
      q.rate.passing > 0.4 &&
      sim.nearestOpp(j)[1] > 1.6 &&
      sim.rand() < 0.12
    ) {
      b.passAt = t + 0.03;
      b.passTo = m.id;
      b.alley = true;
      return;
    }
  }
  const pass = (j: number) => {
    b.passAt = t + 0.03;
    b.passTo = s.players[j].id;
    b.alley = false;
  };
  // Kick out when the help comes.
  if (helpers >= 2 && mate >= 0 && mateOpen > 2 && sim.rand() < 0.7) return pass(mate);

  // Shot selection on expected value: take good looks, and worse ones as
  // the clock / hold time runs down.
  const worth = sim.shotWorth(i);
  const full = w.cfg.shotClock > 0 ? w.cfg.shotClock : 14;
  const urgency = clamp(1 - sc / full, 0, 1) * 0.6 + clamp(I.heldT / 6, 0, 1) * 0.4;
  const bar = [0.56, 0.55, 0.6][w.difficulty - 1] - 0.3 * urgency;
  const mateWorth = mate >= 0 ? sim.shotWorth(mate) : 0;
  if (d < 8 && worth > bar && worth >= mateWorth - 0.1 && sim.rand() < 0.65) return shoot();
  if (lane > 1.4 && d < 8.5 && sim.rand() < 0.35 + q.rate.dunking * 0.35) {
    setIntent(w, i, 'drive', rim.x - ux * 1.3, rim.z - uz * 1.3, true);
    return;
  }
  if (mate >= 0 && mateWorth > worth + 0.15 && sim.rand() < 0.35 + q.rate.passing * 0.3)
    return pass(mate);
  if (mate >= 0 && I.players[mate].calling && sim.rand() < 0.25 + q.rate.passing * 0.2)
    return pass(mate);
  // Isolation: cross him up and go.
  if (open < 1.6 && q.cdMove <= 0 && sim.rand() < 0.35) {
    b.moveAt = t + 0.03;
    setIntent(w, i, 'drive', rim.x - ux * 1.3, rim.z - uz * 1.3, true);
    return;
  }
  if (I.heldT > 4) {
    if (mate >= 0 && sim.rand() < 0.5) return pass(mate);
    if (d < 7.5 && sim.rand() < 0.5) return shoot();
    setIntent(w, i, 'drive', rim.x - ux * 1.3, rim.z - uz * 1.3, true);
    return;
  }
  // Probe: work toward a scoring spot.
  if (b.intent !== 'probe' || Math.hypot(b.tx - p.x, b.tz - p.z) < 0.5) {
    const ang = (sim.rand() - 0.5) * 2.2;
    const r = 4.2 + sim.rand() * 3.4;
    setIntent(w, i, 'probe', rim.x + Math.sin(ang) * r, rim.z - sg * Math.cos(ang) * r, false);
  }
}

function decideOffBall(w: BotWorld, i: number, h: number): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const b = q.brain;
  const t = s.time;
  const H = s.players[h];
  const rim = rimOf(w, p.team);

  // Keep doing a timed cut / screen.
  if ((b.intent === 'cut' || b.intent === 'screen') && t < b.until) return;

  // Full court and the ball's still in the backcourt: run the floor.
  const geo = w.geo;
  const rimIdx = sim.rimOf(p.team);
  const sg = geo.sign[rimIdx];
  const cleared = !w.cfg.halfCourt || I.cleared;

  // Cut to the rim (backdoor) now and then.
  if (cleared && t >= b.nextCut) {
    b.nextCut = t + 4 + sim.rand() * 5;
    const m = q.mark;
    const myDef = s.players.findIndex((o, k) => o.team !== p.team && I.players[k].mark === i);
    const defDist = myDef >= 0 ? Math.hypot(s.players[myDef].x - p.x, s.players[myDef].z - p.z) : 9;
    void m;
    if (sim.rand() < 0.4 || defDist > 2) {
      const side = p.x > rim.x ? 1 : -1;
      setIntent(w, i, 'cut', rim.x + side * 0.9, rim.z - sg * 1.1, true);
      b.until = t + 1.6;
      return;
    }
  }
  // Screen for the handler sometimes.
  if (cleared && sim.rand() < 0.06) {
    const hd = s.players.findIndex((o, k) => o.team !== p.team && I.players[k].mark === h);
    if (hd >= 0) {
      const D = s.players[hd];
      const dd = Math.hypot(D.x - H.x, D.z - H.z);
      if (dd < 2.5) {
        let nx = H.z - D.z;
        let nz = -(H.x - D.x);
        const l = Math.max(1e-6, Math.hypot(nx, nz));
        nx /= l;
        nz /= l;
        const side = sim.rand() < 0.5 ? 1 : -1;
        setIntent(w, i, 'screen', D.x + nx * side * 0.8, D.z + nz * side * 0.8, true);
        b.until = t + 1.5;
        return;
      }
    }
  }
  // Space the floor: pick a free spot away from the ball and teammates.
  const n = w.cfg.size;
  const pool = n <= 2 ? [0, 1, 2, 3, 4] : n === 3 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const taken: [number, number][] = [[H.x, H.z]];
  for (let j = 0; j < s.players.length; j++) {
    if (j === i || j === h || s.players[j].team !== p.team) continue;
    const mb = I.players[j].brain;
    if (j < i && mb.intent === 'spot') taken.push([mb.tx, mb.tz]);
    else taken.push([s.players[j].x, s.players[j].z]);
  }
  let bestK = -1;
  let bestScore = -1e9;
  for (const k of pool) {
    const [sx, sz] = spotPos(w, p.team, k);
    let minD = 1e9;
    for (const [tx, tz] of taken) minD = Math.min(minD, Math.hypot(sx - tx, sz - tz));
    let sc = Math.min(minD, 6) - Math.hypot(sx - p.x, sz - p.z) * 0.15;
    if (k === b.spot) sc += 1.2;
    if (minD < 2.5) sc -= 5;
    if (sc > bestScore) {
      bestScore = sc;
      bestK = k;
    }
  }
  b.spot = bestK;
  const [sx, sz] = spotPos(w, p.team, bestK);
  // Sprint out to spacing on a clear / when far; jog otherwise.
  setIntent(w, i, 'spot', sx, sz, !cleared || Math.hypot(sx - p.x, sz - p.z) > 4);
  // Call for it when open.
  const [, open] = sim.nearestOpp(i);
  if (open > 2.6 && sim.rand() < 0.3) b.callUntil = t + 1;
}

function decideDefense(w: BotWorld, i: number, h: number): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const b = q.brain;
  const t = s.time;
  const H = s.players[h];
  // The rim we defend = the one the offense attacks.
  const rim = rimOf(w, H.team);
  const m = q.mark >= 0 ? q.mark : h;
  const man = s.players[m];
  const geo = w.geo;

  // Help on a drive: the closest off-ball defender steps in.
  const hd = sim.distToRim(h);
  const hsp = Math.hypot(H.vx, H.vz);
  if (m !== h && hd < 5 && hsp > 2.5) {
    const onBall = s.players.findIndex((o, k) => o.team === p.team && I.players[k].mark === h);
    const beaten =
      onBall < 0 ||
      Math.hypot(s.players[onBall].x - rim.x, s.players[onBall].z - rim.z) > hd + 0.3 ||
      Math.hypot(s.players[onBall].x - H.x, s.players[onBall].z - H.z) > 1.8;
    if (beaten) {
      let closest = -1;
      let cd = 1e9;
      for (let k = 0; k < s.players.length; k++) {
        if (s.players[k].team !== p.team || I.players[k].mark === h) continue;
        const dd = Math.hypot(s.players[k].x - H.x, s.players[k].z - H.z);
        if (dd < cd) {
          cd = dd;
          closest = k;
        }
      }
      if (closest === i) {
        const ux = (rim.x - H.x) / Math.max(1e-6, hd);
        const uz = (rim.z - H.z) / Math.max(1e-6, hd);
        setIntent(w, i, 'help', H.x + ux * 1.1, H.z + uz * 1.1, true);
        return;
      }
    }
  }

  const dx = rim.x - man.x;
  const dz = rim.z - man.z;
  const dl = Math.max(1e-6, Math.hypot(dx, dz));
  if (m === h) {
    // On the ball: between man and rim, closer when he's in range.
    let gap = 1.3 + (1 - q.rate.defense) * 0.5;
    if (dl > geo.spec.threeRadius + 2.2) gap += 1.2;
    if (!w.cfg.halfCourt) {
      const sg = geo.sign[w.sim.rimOf(H.team)];
      if (H.z * sg < 0) gap = 3;
    }
    gap = Math.min(gap, dl * 0.8);
    b.gap = gap;
    setIntent(w, i, 'guard', man.x + (dx / dl) * gap, man.z + (dz / dl) * gap, dl > 6);
    const d = Math.hypot(H.x - p.x, H.z - p.z);
    const rate = [0.03, 0.06, 0.09][w.difficulty - 1] * (0.5 + q.rate.defense);
    if (d < 1.35 && q.cdSteal <= 0 && b.stealAt < 0 && sim.rand() < rate) b.stealAt = t + b.react;
    return;
  }
  // Off the ball: between man and rim, sagging toward the ball.
  let tx = man.x + (dx / dl) * Math.min(1.5, dl * 0.5);
  let tz = man.z + (dz / dl) * Math.min(1.5, dl * 0.5);
  tx += (H.x - tx) * 0.25;
  tz += (H.z - tz) * 0.25;
  const fromMan = Math.hypot(tx - man.x, tz - man.z);
  if (fromMan > 3.5) {
    tx = man.x + ((tx - man.x) / fromMan) * 3.5;
    tz = man.z + ((tz - man.z) / fromMan) * 3.5;
  }
  b.gap = -1;
  setIntent(w, i, 'guard', tx, tz, Math.hypot(tx - p.x, tz - p.z) > 5);
}

function decideLoose(w: BotWorld, i: number): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const ball = s.ball;
  const shot = I.shot;

  // Who chases: the two closest on each team.
  let rank = 0;
  const myD = Math.hypot(ball.x - p.x, ball.z - p.z);
  for (let j = 0; j < s.players.length; j++) {
    if (j === i || s.players[j].team !== p.team) continue;
    const d = Math.hypot(ball.x - s.players[j].x, ball.z - s.players[j].z);
    if (d < myD || (d === myD && j < i)) rank++;
  }
  const lead = 0.3;
  const bx = ball.x + ball.vx * lead;
  const bz = ball.z + ball.vz * lead;

  if (shot !== null && shot.live && !shot.touchedRim && !shot.touchedBoard) {
    // Shot in the air: crash or box out.
    const rim = w.geo.rims[shot.rim];
    if (p.team === shot.team) {
      if (rank < 1 || sim.distToRim(i) < 4) {
        const ox = p.x - rim.x;
        const oz = p.z - rim.z;
        const l = Math.max(1e-6, Math.hypot(ox, oz));
        setIntent(w, i, 'crash', rim.x + (ox / l) * 1.7, rim.z + (oz / l) * 1.7, true);
      }
      return;
    }
    const m = q.mark;
    if (m >= 0) {
      // Box out: on the line from the rim to our man, near the rim.
      const man = s.players[m];
      const ox = man.x - rim.x;
      const oz = man.z - rim.z;
      const l = Math.max(1e-6, Math.hypot(ox, oz));
      const r = clamp(l - 0.8, 1.2, 2.2);
      setIntent(w, i, 'boxout', rim.x + (ox / l) * r, rim.z + (oz / l) * r, true);
    }
    return;
  }
  if (rank < 2) {
    setIntent(w, i, 'chase', bx, bz, true);
    return;
  }
  // Everyone else: hold a sensible spot near their man / the play.
  const m = q.mark;
  if (m >= 0) {
    const man = s.players[m];
    setIntent(w, i, 'back', (man.x + bx) / 2, (man.z + bz) / 2, false);
  }
}

/** Turn the intent target into stick input, with avoidance and anti-stuck. */
function steer(w: BotWorld, i: number, inp: BallerInput): void {
  const sim = w.sim;
  const s = sim.live;
  const I = sim.internal;
  const p = s.players[i];
  const q = I.players[i];
  const b = q.brain;
  const t = s.time;
  let tx = b.tx;
  let tz = b.tz;
  // Live targets: chase / receive / guard follow moving things every step.
  if (b.intent === 'chase' || b.intent === 'receive') {
    tx = s.ball.x + s.ball.vx * 0.3;
    tz = s.ball.z + s.ball.vz * 0.3;
  } else if ((b.intent === 'guard' && b.gap >= 0) || b.intent === 'help') {
    // Stay in front of the ball: track the handler every step, lagging by
    // the bot's reaction (easy) or reading him (hard).
    const h = sim.holderIndex();
    if (h >= 0 && s.players[h].team !== p.team) {
      const H = s.players[h];
      const rim = w.sim.rimPos(H.team);
      const lead = [-0.12, 0.0, 0.12][w.difficulty - 1] + (q.rate.defense - 0.6) * 0.2;
      const hx = H.x + H.vx * lead;
      const hz = H.z + H.vz * lead;
      const dx0 = rim.x - hx;
      const dz0 = rim.z - hz;
      const dl = Math.max(1e-6, Math.hypot(dx0, dz0));
      const gap = b.intent === 'help' ? 1.1 : Math.min(b.gap, dl * 0.8);
      tx = hx + (dx0 / dl) * gap;
      tz = hz + (dz0 / dl) * gap;
      b.sprint = Math.hypot(H.vx, H.vz) > 3.5 || Math.hypot(tx - p.x, tz - p.z) > 1.5;
    }
  }
  let dx = tx - p.x;
  let dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2) return;
  dx /= d;
  dz /= d;
  // Avoid bodies in the way (but run through the screen target / ball).
  let ax = 0;
  let az = 0;
  for (let j = 0; j < s.players.length; j++) {
    if (j === i) continue;
    const o = s.players[j];
    const ox = o.x - p.x;
    const oz = o.z - p.z;
    const od = Math.hypot(ox, oz);
    if (od > 1.3 || od < 1e-6) continue;
    const ahead = (ox * dx + oz * dz) / od;
    if (ahead < 0.3) continue;
    const side = ox * dz - oz * dx > 0 ? -1 : 1;
    const wgt = (1.3 - od) / 1.3;
    ax += dz * side * wgt;
    az += -dx * side * wgt;
  }
  // Stuck: moving slowly while far from target.
  const moved = Math.hypot(p.x - b.lx, p.z - b.lz);
  b.lx = p.x;
  b.lz = p.z;
  if (d > 1 && moved < 0.01) b.stuckT += SIM_DT;
  else b.stuckT = Math.max(0, b.stuckT - SIM_DT);
  if (b.stuckT > 0.8) {
    b.stuckT = 0;
    b.sideT = t + 0.6;
    b.side = sim.rand() < 0.5 ? -1 : 1;
  }
  if (t < b.sideT) {
    ax += dz * b.side * 1.2;
    az += -dx * b.side * 1.2;
  }
  let mx = dx + ax;
  let mz = dz + az;
  const ml = Math.max(1e-6, Math.hypot(mx, mz));
  const mag = Math.min(1, d / 1.0 + 0.15);
  mx = (mx / ml) * mag;
  mz = (mz / ml) * mag;
  inp.moveX = mx;
  inp.moveZ = mz;
  const onBall = (b.intent === 'guard' && b.gap >= 0) || b.intent === 'help';
  inp.sprint =
    (b.sprint && q.stamina > (onBall ? 0.08 : 0.25) && (onBall || d > 1.5)) ||
    (d > 5 && q.stamina > 0.5);
}

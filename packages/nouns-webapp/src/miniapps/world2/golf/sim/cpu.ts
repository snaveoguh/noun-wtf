// ── The CPU golfer ──────────────────────────────────────────────────────
//
// Every decision is made by flying candidates through the real physics
// (simulateShot, with this hole's wind), so it plays the course as it is:
//
//   Full shots: every club once at full power at the target (the pin, or
//   for a hole too long to reach, the point down the hole's centre line at
//   that club's distance). The clubs that can get there have their power
//   trimmed to the distance and their aim corrected for the wind's drift;
//   the longest few that fall short stay in as lay-ups. Each candidate is
//   then judged on what a typical miss of this CPU's skill does (pure,
//   pushed and pulled strikes, a touch long and short) by the strokes it
//   expects to need from where they end up (water and OB cost their
//   penalties), so it lays up short of water it might find, and goes for
//   the green when the miss is safe.
//
//   Putts: a grid of aims across the break × three speeds, then a finer
//   grid round the best, scoring each by where it stops (holed best, and
//   short is worse than long: never up, never in).
//
// Then skill-scaled noise goes on power, accuracy and (putts) aim. Skill 1
// is a steady scratch player, 0 a hacker.
//
// cpuThink is a generator that yields after every simulated shot, so a
// caller can spread a decision over frames (pool's cpu.ts does the same);
// cpuSwing runs it straight through.

import type {
  ClubId,
  CourseSurface,
  Lie,
  RoundState,
  ShotResult,
  SwingInput,
  V2,
  V3,
  Wind,
} from '../contract';

import { CLUBS, clubOrder } from './clubs';
import { rollSpeedFor, simulateShot } from './physics';
import { gaussian, type Rng } from './rng';
import { ballOf, type HoleInfo } from './rules';
import { launchOf } from './swing';

const yawTo = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.atan2(b.x - a.x, b.z - a.z);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(b.x - a.x, b.z - a.z);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Expected strokes to hole out from a spot `d` metres from the pin on `lie`. */
export function expectedStrokes(d: number, lie: Lie): number {
  const putts = 1 + 1.15 * (1 - Math.exp(-d / 4.5));
  switch (lie) {
    case 'green':
      return d < 0.3 ? 1 : putts;
    case 'fringe':
      return putts + 0.15;
    case 'tee':
    case 'fairway':
      return d < 25 ? Math.max(putts + 0.35, 2.1 + d * 0.004) : 2.15 + 0.0052 * d;
    case 'path':
      return 2.25 + 0.0052 * d;
    case 'rough':
      return d < 25 ? putts + 0.6 : 2.4 + 0.0055 * d;
    case 'sand':
      return d < 40 ? 2.45 + 0.01 * d : 2.75 + 0.006 * d;
    case 'deep':
      return 2.8 + 0.006 * d;
    default:
      return 3 + 0.006 * d;
  }
}

/** Where along a polyline (arc length) the closest point to p is, and the line's length. */
function project(line: V2[], p: { x: number; z: number }): { s: number; len: number } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const l = Math.sqrt(l2);
    const t = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1) : 0;
    const qx = a.x + dx * t;
    const qz = a.z + dz * t;
    const d = Math.hypot(p.x - qx, p.z - qz);
    if (d < best) {
      best = d;
      bestS = acc + l * t;
    }
    acc += l;
  }
  return { s: bestS, len: acc };
}

function pointAt(line: V2[], s: number): V2 {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + l >= s) {
      const t = l > 0 ? (s - acc) / l : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    acc += l;
  }
  return line[line.length - 1];
}

/** How the CPU misses, by skill. */
export function cpuSpread(skill: number): {
  power: number;
  acc: number;
  aim: number;
  puttPower: number;
} {
  const u = 1 - clamp(skill, 0, 1);
  return {
    power: 0.035 + 0.09 * u,
    acc: 0.2 + 0.4 * u,
    aim: 0.01 + 0.03 * u,
    puttPower: 0.04 + 0.1 * u,
  };
}

interface Ctx {
  course: CourseSurface;
  from: V3;
  lie: Lie;
  normal: V3;
  wind: Wind;
  pin: V3;
  seed: number;
}

function fly(c: Ctx, swing: SwingInput): ShotResult {
  return simulateShot(c.course, c.from, c.lie, launchOf(swing, c.lie, c.normal), c.wind, c.pin, {
    seed: c.seed,
    noPath: true,
  });
}

/** What the CPU expects a result to cost from here on (this shot not counted). */
function cost(c: Ctx, r: ShotResult): number {
  if (r.holed) return 0;
  if (r.lie === 'water' || r.events.some(e => e.kind === 'water')) {
    return 1 + expectedStrokes(flat(r.rest, c.pin), 'rough') + 0.2;
  }
  if (r.lie === 'ob' || r.events.some(e => e.kind === 'ob')) {
    return 1 + 1 + expectedStrokes(flat(c.from, c.pin), c.lie);
  }
  return expectedStrokes(flat(r.rest, c.pin), r.lie);
}

/** The putt search: aims across the break × speeds, then a finer pass. */
function* puttThink(c: Ctx): Generator<void, { aim: number; power: number }, void> {
  const d = flat(c.from, c.pin);
  const aim0 = yawTo(c.from, c.pin);
  const full = CLUBS.P.speed;
  const lieRoll: Lie = c.lie === 'green' ? 'green' : c.lie === 'fringe' ? 'fringe' : 'fairway';
  const p0 = clamp(rollSpeedFor(d + 0.4, lieRoll) / full, 0.02, 1.1);
  const score = (r: ShotResult) => {
    if (r.holed) return -1;
    const dd = flat(r.rest, c.pin);
    // Short of the hole (along the line) is worse
    const along =
      (r.rest.x - c.from.x) * Math.sin(aim0) + (r.rest.z - c.from.z) * Math.cos(aim0) - d;
    return dd + (along < 0 ? 0.4 : 0) + (r.lie === 'water' || r.lie === 'ob' ? 50 : 0);
  };
  let best = { aim: aim0, power: p0, s: Infinity };
  const rx = -Math.cos(aim0);
  const rz = Math.sin(aim0);
  const fx = Math.sin(aim0);
  const fz = Math.cos(aim0);
  // Newton on the read: fly it, see how far right / left of the hole it
  // passed and how far past it stopped, correct aim and pace, repeat
  let aim = aim0;
  let power = p0;
  for (let k = 0; k < 8; k++) {
    const r = simulateShot(
      c.course,
      c.from,
      c.lie,
      launchOf({ club: 'P', aim, power, accuracy: 0 }, c.lie, c.normal),
      c.wind,
      c.pin,
      { seed: c.seed },
    );
    yield;
    const s = score(r);
    if (s < best.s) best = { aim, power, s };
    if (r.holed) break;
    // Closest pass to the hole
    let cl = r.path[0];
    let cd = Infinity;
    for (const q of r.path) {
      const dd = flat(q, c.pin);
      if (dd < cd) {
        cd = dd;
        cl = q;
      }
    }
    const side = (cl.x - c.pin.x) * rx + (cl.z - c.pin.z) * rz;
    aim += Math.atan2(side, Math.max(d, 0.5)) * 0.9;
    // Pace: aim to finish ~0.35 m past the hole
    const past = (r.rest.x - c.pin.x) * fx + (r.rest.z - c.pin.z) * fz;
    let run = 0;
    for (let i = 1; i < r.path.length; i++) run += flat(r.path[i], r.path[i - 1]);
    const want = Math.max(0.2, run + (0.35 - past));
    const v0 = rollSpeedFor(Math.max(run, 0.05), lieRoll);
    const v1 = rollSpeedFor(want, lieRoll);
    if (v0 > 1e-4) power = clamp(power * (v1 / v0), 0.005, 1.1);
  }
  // A small polish round the best, in case Newton stalled
  if (best.s > -1) {
    const a1 = best.aim;
    const p1 = best.power;
    const step = clamp(0.03 / Math.max(d, 1), 0.002, 0.03);
    for (const [da, f] of [
      [-step, 1],
      [step, 1],
      [0, 0.97],
      [0, 1.03],
      [-2 * step, 1],
      [2 * step, 1],
    ] as const) {
      const r = fly(c, { club: 'P', aim: a1 + da, power: clamp(p1 * f, 0.005, 1.1), accuracy: 0 });
      yield;
      const s = score(r);
      if (s < best.s) best = { aim: a1 + da, power: p1 * f, s };
      if (r.holed) break;
    }
  }
  return { aim: best.aim, power: best.power };
}

interface Cand {
  club: ClubId;
  aim: number;
  power: number;
}

/** The full-shot search. */
function* shotThink(
  c: Ctx,
  info: HoleInfo,
  spread: ReturnType<typeof cpuSpread>,
): Generator<void, Cand, void> {
  const dPin = flat(c.from, c.pin);
  const line: V2[] = info.line && info.line.length >= 2 ? info.line : [c.from, c.pin];
  const pr = project(line, c.from);
  const clubs = clubOrder.filter(id => id !== 'P' && (id !== 'D' || c.lie === 'tee'));
  const near = (id: ClubId) => CLUBS[id].total <= Math.max(dPin * 1.6 + 30, 110);

  // Target for a club that goes `dist`: the pin if it reaches, else down the line
  const targetFor = (dist: number): { x: number; z: number; pin: boolean } => {
    if (dist >= dPin - 5) return { x: c.pin.x, z: c.pin.z, pin: true };
    const s = Math.min(pr.s + dist, pr.len);
    const p = pointAt(line, s);
    // Don't aim at a line point beyond the pin's distance
    return { x: p.x, z: p.z, pin: false };
  };

  // Stage 1: every sensible club at full power
  const full = new Map<ClubId, number>();
  for (const id of clubs) {
    if (!near(id)) continue;
    const t = targetFor(CLUBS[id].total);
    const r = fly(c, { club: id, aim: yawTo(c.from, t), power: 1, accuracy: 0 });
    full.set(id, flat(c.from, r.rest));
    yield;
  }

  const cands: Cand[] = [];
  const reach = [...full.entries()].filter(([, d]) => d >= dPin - 3);
  // The clubs that get there with a sensible swing: the two shortest
  reach.sort((a, b) => a[1] - b[1]);
  for (const [id, dFull] of reach.slice(0, 2)) {
    let power = clamp(Math.pow(dPin / Math.max(dFull, 1), 0.85), 0.25, 1);
    if (power < (CLUBS[id].wedge ? 0.25 : 0.6)) continue;
    let aim = yawTo(c.from, c.pin);
    // Two corrections: distance (power) and drift (aim)
    for (let k = 0; k < 2; k++) {
      const r = fly(c, { club: id, aim, power, accuracy: 0 });
      yield;
      const got = flat(c.from, r.rest);
      if (got > 1) power = clamp(power * Math.pow(dPin / got, 0.85), 0.2, 1.05);
      const off = yawTo(c.from, r.rest) - yawTo(c.from, c.pin);
      aim -= Math.atan2(Math.sin(off), Math.cos(off));
    }
    cands.push({ club: id, aim, power });
  }
  // Lay-ups / long clubs that don't reach: the three longest
  const short = [...full.entries()].filter(([, d]) => d < dPin - 3).sort((a, b) => b[1] - a[1]);
  for (const [id, dFull] of short.slice(0, 2)) {
    const t = targetFor(dFull);
    let aim = yawTo(c.from, t);
    const r = fly(c, { club: id, aim, power: 1, accuracy: 0 });
    yield;
    const off = yawTo(c.from, r.rest) - yawTo(c.from, t);
    aim -= Math.atan2(Math.sin(off), Math.cos(off));
    cands.push({ club: id, aim, power: 1 });
    // And a softer one (a lay-up short of trouble)
    if (dFull > 60) cands.push({ club: id, aim, power: 0.85 });
  }
  if (!cands.length) {
    const id = clubs[clubs.length - 1];
    return { club: id, aim: yawTo(c.from, c.pin), power: 1 };
  }

  // Judge each on this CPU's typical misses
  const variants = [
    { a: 0, p: 0, w: 0.4 },
    { a: spread.acc, p: 0, w: 0.15 },
    { a: -spread.acc, p: 0, w: 0.15 },
    { a: 0, p: spread.power, w: 0.15 },
    { a: 0, p: -spread.power, w: 0.15 },
  ];
  let best = cands[0];
  let bestS = Infinity;
  for (const cd of cands) {
    let s = 0;
    for (const v of variants) {
      const r = fly(c, {
        club: cd.club,
        aim: cd.aim,
        power: clamp(cd.power * (1 + v.p), 0, 1.1),
        accuracy: v.a,
      });
      s += v.w * cost(c, r);
      yield;
    }
    if (s < bestS - 1e-9) {
      bestS = s;
      best = cd;
    }
  }
  return best;
}

/**
 * Think about player `by`'s next shot. Yields after every simulated shot;
 * returns the swing (noise included).
 */
export function* cpuThink(
  course: CourseSurface,
  state: RoundState,
  by: number,
  info: HoleInfo,
  rng: Rng,
  skill: number,
  opts: { noise?: boolean } = {},
): Generator<void, SwingInput, void> {
  const from = ballOf(state, by, info);
  const lie: Lie = state.cur[by].ball ? state.cur[by].lie : 'tee';
  const normal = course.normal(from.x, from.z, { x: 0, y: 1, z: 0 });
  const c: Ctx = { course, from, lie, normal, wind: state.wind, pin: info.pin, seed: state.n };
  const spread = cpuSpread(skill);
  const d = flat(from, info.pin);
  // No noise: the plan itself (an aim / pace hint for the HUD, tests)
  const nz = opts.noise === false ? 0 : 1;
  const g = () => gaussian(rng) * nz;

  const putt = lie === 'green' || (lie === 'fringe' && d < 15) || (lie === 'fairway' && d < 8);
  if (putt) {
    const p = yield* puttThink(c);
    return {
      club: 'P',
      aim: p.aim + g() * spread.aim * (1 + d * 0.02),
      power: clamp(p.power * (1 + g() * spread.puttPower), 0.005, 1.1),
      accuracy: 0,
    };
  }
  const best = yield* shotThink(c, info, spread);
  return {
    club: best.club,
    aim: best.aim,
    power: clamp(best.power * (1 + g() * spread.power), 0.1, 1.1),
    accuracy: clamp(g() * spread.acc, -1, 1),
  };
}

/** cpuThink run straight through. */
export function cpuSwing(
  course: CourseSurface,
  state: RoundState,
  by: number,
  info: HoleInfo,
  rng: Rng,
  skill: number,
  opts: { noise?: boolean } = {},
): SwingInput {
  const g = cpuThink(course, state, by, info, rng, skill, opts);
  for (;;) {
    const s = g.next();
    if (s.done === true) return s.value;
  }
}

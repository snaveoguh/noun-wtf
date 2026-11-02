// ── Noun Football: a mock match so the view runs without the sim ────────
//
// A scripted 11-a-side move on a 28 s loop, as plain SimStates:
//   0–2 s   kick-off shape, ball on the spot
//   2–8 s   played back, out wide, a dribble down the right
//   8–10 s  a cross (lob), a header, the keeper dives the wrong way: GOAL
//   10–16 s the scorer wheels away and celebrates, team-mates pile on,
//           the other side drops their heads
//   16–24 s the other side kicks off, runs at goal and shoots: the keeper
//           dives, catches, holds, throws it out
// plus `createPoseSheet`: one footballer per Action on a grid (the contact
// sheet). Deterministic: `seek(t)` replays the same frames.

import type {
  Action,
  BallState,
  Footballer,
  FootballEvent,
  MatchConfig,
  PlayerState,
  Role,
  SimState,
  TeamId,
  TeamKit,
  TeamStats,
} from '../contract';

import { PITCH_11, SIM_DT } from '../contract';

import { ALL_ACTIONS, CELEBRATIONS, showSpeed } from './poses';

export const MOCK_KITS: [TeamKit, TeamKit] = [
  {
    name: 'NOGGLES UTD',
    short: 'NOG',
    shirt: 0xd22209,
    shorts: 0xffffff,
    socks: 0xd22209,
    keeper: 0x22c55e,
  },
  {
    name: 'LIL FC',
    short: 'LIL',
    shirt: 0x2f8bff,
    shorts: 0x0b1f4a,
    socks: 0xffffff,
    keeper: 0xffd400,
  },
];

const NAMES = [
  'BEANS',
  'TOAST',
  'PIZZA',
  'NOGS',
  'PIPE',
  'CRAB',
  'SHARK',
  'COIN',
  'BONSAI',
  'MILK',
  'SAUCE',
  'GOOSE',
  'CHAIR',
  'TACO',
  'MOOSE',
  'LAMP',
  'FRIES',
  'WHALE',
  'CAKE',
  'ROBOT',
  'PEAR',
  'DONUT',
];

/** 4-4-2 shape (x across, z own goal → halfway as −1 … 0) for one side, keeper first. */
const SHAPE: { role: Role; x: number; z: number }[] = [
  { role: 'GK', x: 0, z: -0.96 },
  { role: 'DF', x: 0.62, z: -0.66 },
  { role: 'DF', x: 0.22, z: -0.72 },
  { role: 'DF', x: -0.22, z: -0.72 },
  { role: 'DF', x: -0.62, z: -0.66 },
  { role: 'MF', x: 0.62, z: -0.34 },
  { role: 'MF', x: 0.2, z: -0.4 },
  { role: 'MF', x: -0.2, z: -0.4 },
  { role: 'MF', x: -0.62, z: -0.34 },
  { role: 'FW', x: 0.14, z: -0.06 },
  { role: 'FW', x: -0.14, z: -0.1 },
];

const NUMBERS = [1, 2, 5, 6, 3, 7, 8, 4, 11, 9, 10];

function emptyStats(): TeamStats {
  return {
    shots: 0,
    onTarget: 0,
    poss: 0,
    passes: 0,
    passesDone: 0,
    tackles: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellows: 0,
    reds: 0,
    saves: 0,
  };
}

export function mockConfig(n = 11): MatchConfig {
  const players: Footballer[] = [];
  for (const team of [0, 1] as TeamId[])
    for (let i = 0; i < n; i++)
      players.push({
        id: `t${team}p${i}`,
        team,
        name: NAMES[(team * 11 + i) % NAMES.length],
        number: NUMBERS[i] ?? i + 1,
        role: SHAPE[i]?.role ?? 'MF',
        seedKey: '',
      });
  return {
    size: 11,
    pitch: PITCH_11,
    halfSeconds: 240,
    knockout: false,
    offside: true,
    fouls: true,
    seed: 7,
    players,
    kits: MOCK_KITS,
    formations: ['4-4-2', '4-4-2'],
    difficulty: [2, 2],
    humans: [{ id: 'me', name: 'ME', team: 0 }],
  };
}

const L = PITCH_11.length / 2;
const W = PITCH_11.width / 2;

/** Base spot of player i on a team (team 0 defends −z, attacks +z). */
function home(team: TeamId, i: number, push: number): { x: number; z: number } {
  const s = SHAPE[i];
  const side = team === 0 ? 1 : -1;
  const z = s.role === 'GK' ? s.z * L : (s.z * L * 0.92 + push * 18) * 1;
  return { x: s.x * W * 0.9 * side, z: z * side };
}

export interface MockMatch {
  readonly config: MatchConfig;
  readonly time: number;
  state(): SimState;
  /** Advance; returns the events of the step(s). */
  step(dt: number): FootballEvent[];
  seek(t: number): void;
  /** Loop length (s). */
  readonly length: number;
}

const LOOP = 28;

interface Flight {
  t0: number;
  t1: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  arc: number;
}

/** The scripted ball: who has it or where it's flying, at time t. */
function ballPlan(t: number): { owner: string | null; flight: Flight | null; held?: boolean } {
  if (t < 2) return { owner: null, flight: null };
  if (t < 2.6)
    return {
      owner: null,
      flight: { t0: 2, t1: 2.6, from: { x: 0, y: 0, z: 0 }, to: { x: 6, y: 0, z: -9 }, arc: 0 },
    };
  if (t < 3.6) return { owner: 't0p6', flight: null };
  if (t < 4.6)
    return {
      owner: null,
      flight: {
        t0: 3.6,
        t1: 4.6,
        from: { x: 6, y: 0, z: -8 },
        to: { x: -24, y: 0, z: 2 },
        arc: 1.2,
      },
    };
  if (t < 8) return { owner: 't0p8', flight: null };
  if (t < 9.1)
    return {
      owner: null,
      flight: {
        t0: 8,
        t1: 9.1,
        from: { x: -26, y: 0, z: 40 },
        to: { x: -1, y: 2.2, z: 45 },
        arc: 7,
      },
    };
  if (t < 9.6)
    return {
      owner: null,
      flight: {
        t0: 9.1,
        t1: 9.6,
        from: { x: -1, y: 2.2, z: 45 },
        to: { x: 2.4, y: 1.6, z: L + 1.4 },
        arc: 0.4,
      },
    };
  if (t < 10.4)
    return {
      owner: null,
      flight: {
        t0: 9.6,
        t1: 10.4,
        from: { x: 2.4, y: 1.6, z: L + 1.4 },
        to: { x: 2.2, y: 0, z: L + 1.9 },
        arc: 0.1,
      },
    };
  if (t < 16) return { owner: null, flight: null };
  if (t < 16.6)
    return {
      owner: null,
      flight: { t0: 16, t1: 16.6, from: { x: 0, y: 0, z: 0 }, to: { x: 5, y: 0, z: 4 }, arc: 0 },
    };
  if (t < 20.5) return { owner: 't1p9', flight: null };
  if (t < 21.2)
    return {
      owner: null,
      flight: {
        t0: 20.5,
        t1: 21.2,
        from: { x: 6, y: 0, z: -34 },
        to: { x: -2.6, y: 1.2, z: -L + 0.6 },
        arc: 0.8,
      },
    };
  if (t < 24.5) return { owner: 't0p0', flight: null, held: true };
  if (t < 26)
    return {
      owner: null,
      flight: {
        t0: 24.5,
        t1: 26,
        from: { x: -1, y: 2, z: -L + 4 },
        to: { x: 20, y: 0, z: -28 },
        arc: 3,
      },
    };
  return { owner: 't0p5', flight: null };
}

const SCRIPT: { at: number; ev: FootballEvent }[] = [
  { at: 0.1, ev: { type: 'whistle', kind: 'short' } },
  { at: 2, ev: { type: 'kick', id: 't0p9', kind: 'pass', power: 0.35 } },
  { at: 3.6, ev: { type: 'kick', id: 't0p6', kind: 'pass', power: 0.7 } },
  { at: 4.6, ev: { type: 'touch', id: 't0p8', quality: 0.9 } },
  { at: 8, ev: { type: 'kick', id: 't0p8', kind: 'lob', power: 0.8 } },
  { at: 8.4, ev: { type: 'chance', team: 0, quality: 0.6 } },
  { at: 9.1, ev: { type: 'header', id: 't0p9', power: 0.85 } },
  { at: 9.6, ev: { type: 'net', strength: 0.8 } },
  { at: 9.62, ev: { type: 'goal', team: 0, scorer: 't0p9', assist: 't0p8', ownGoal: false } },
  { at: 9.65, ev: { type: 'whistle', kind: 'long' } },
  { at: 16, ev: { type: 'whistle', kind: 'short' } },
  { at: 16, ev: { type: 'kick', id: 't1p10', kind: 'pass', power: 0.3 } },
  { at: 20.5, ev: { type: 'kick', id: 't1p9', kind: 'shot', power: 0.95 } },
  { at: 20.6, ev: { type: 'chance', team: 1, quality: 0.8 } },
  { at: 21.2, ev: { type: 'save', id: 't0p0', caught: true } },
  { at: 24.5, ev: { type: 'kick', id: 't0p0', kind: 'restart', power: 0.6 } },
  { at: 26, ev: { type: 'bounce', strength: 0.4 } },
];

/** Scripted action overrides: [id, from, to, action, actionDir?]. */
const ACTS: [string, number, number, Action, number?][] = [
  ['t0p9', 1.75, 2.25, 'pass'],
  ['t0p6', 3.35, 3.85, 'pass'],
  ['t0p8', 4.45, 4.9, 'trap'],
  ['t0p8', 7.7, 8.25, 'lob'],
  ['t0p9', 8.75, 9.4, 'header'],
  ['t1p0', 9.2, 10.1, 'gk_dive', -1],
  ['t1p0', 10.1, 12, 'fallen'],
  ['t1p10', 15.8, 16.25, 'pass'],
  ['t1p9', 20.2, 20.75, 'shoot'],
  ['t0p0', 20.6, 21.4, 'gk_dive', 1],
  ['t0p0', 21.4, 22.3, 'gk_catch'],
  ['t0p0', 22.3, 23.9, 'gk_hold'],
  ['t0p0', 23.9, 24.8, 'gk_throw'],
  ['t0p3', 18.5, 19.6, 'slide'],
  ['t1p9', 19.0, 19.6, 'skill', 0],
  ['t0p2', 6.0, 7.4, 'jockey'],
];

export function createMockMatch(): MockMatch {
  const config = mockConfig();
  let time = 0;
  let tick = 0;
  let score: [number, number] = [0, 0];
  const players: PlayerState[] = config.players.map(f => {
    const i = Number(f.id.slice(3));
    const h = home(f.team, i, 0);
    return {
      id: f.id,
      team: f.team,
      x: h.x,
      y: 0,
      z: h.z,
      vx: 0,
      vz: 0,
      yaw: f.team === 0 ? 0 : Math.PI,
      action: f.role === 'GK' ? 'gk_ready' : 'idle',
      actionT: 0,
      stamina: 1,
      yellow: 0,
      human: f.id === 't0p8' ? 'me' : null,
    };
  });
  const ball: BallState = {
    x: 0,
    y: PITCH_11.ballRadius,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    mode: 'dead',
    owner: null,
    lastTouch: null,
  };
  let events: FootballEvent[] = [];
  let goals: SimState['goals'] = [];

  const phaseAt = (t: number): SimState['phase'] =>
    t < 2 || (t >= 15.5 && t < 16) ? 'kickoff' : t >= 9.7 && t < 15.5 ? 'goal' : 'live';

  const targetFor = (p: PlayerState, i: number, t: number) => {
    const ph = phaseAt(t);
    const goalPhase = ph === 'goal';
    // Team shape pushes up with the attack
    const push0 = t < 2 ? 0 : t < 10 ? Math.min(1, (t - 2) / 6) * 1.1 : t < 16 ? 0.4 : 0.1;
    const push1 = t < 16 ? -0.2 : Math.min(1, (t - 16) / 4) * 0.9;
    const h = home(p.team, i, p.team === 0 ? push0 : push1);
    // Ball-carrier runs + the scripted runs
    if (p.id === 't0p8' && t >= 4.6 && t < 8)
      return { x: -24 - (t - 4.6) * 0.5, z: 2 + (t - 4.6) * 11, sprint: true };
    if (p.id === 't0p8' && t >= 3 && t < 4.6) return { x: -24, z: 2, sprint: true };
    if (p.id === 't0p9' && t >= 5 && t < 9.4) return { x: -1, z: 44.4, sprint: true };
    if (p.id === 't0p9' && t >= 9.7 && t < 15.5) return { x: -W + 2, z: L - 2, sprint: true };
    if (goalPhase && p.team === 0 && p.id !== 't0p0' && i >= 5)
      return { x: -W + 4 + (i % 3), z: L - 4 - (i % 4), sprint: false };
    if (p.id === 't1p9' && t >= 16.6 && t < 20.5)
      return { x: 5 + (t - 16.6) * 0.3, z: 4 - (t - 16.6) * 9.6, sprint: true };
    if (p.id === 't0p0' && t >= 20 && t < 21.2) return { x: -2.4, z: -L + 0.8, sprint: false };
    if (p.id === 't0p0' && t >= 22 && t < 24) return { x: -1, z: -L + 4, sprint: false };
    if (p.team === 1 && p.id !== 't1p0' && t < 10 && i < 5 && t > 5)
      return { x: h.x * 0.6 - 4, z: Math.max(h.z, 30), sprint: true };
    return { x: h.x, z: h.z, sprint: false };
  };

  const stepOnce = (dt: number) => {
    const prevT = time;
    time += dt;
    tick++;
    const t = time % LOOP;
    if (t < prevT % LOOP) {
      // Loop: back to the kick-off shape
      score = [0, 0];
      goals = [];
    }
    for (const s of SCRIPT) if (s.at > prevT % LOOP && s.at <= t) events.push(s.ev);
    if (events.some(e => e.type === 'goal')) {
      score = [score[0] + 1, score[1]];
      goals = [
        ...goals,
        { team: 0, scorer: 't0p9', assist: 't0p8', minute: 23, ownGoal: false, penalty: false },
      ];
    }
    const plan = ballPlan(t);
    const goalPhase = phaseAt(t) === 'goal';
    // Players
    players.forEach((p, k) => {
      const i = k % 11;
      const tg = targetFor(p, i, t);
      const dx = tg.x - p.x;
      const dz = tg.z - p.z;
      const d = Math.hypot(dx, dz);
      const top = tg.sprint ? 8.2 : i === 0 ? 3 : 5.2;
      const want = d > 0.4 ? Math.min(top, d * 1.6) : 0;
      const vx = d > 1e-3 ? (dx / d) * want : 0;
      const vz = d > 1e-3 ? (dz / d) * want : 0;
      p.vx += (vx - p.vx) * Math.min(1, dt * 4);
      p.vz += (vz - p.vz) * Math.min(1, dt * 4);
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.6) p.yaw = Math.atan2(p.vx, p.vz);
      else {
        // Watch the ball
        const by = Math.atan2(ball.x - p.x, ball.z - p.z);
        let dy = by - p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        p.yaw += dy * Math.min(1, dt * 3);
      }
      // Action
      let act: Action = sp < 0.3 ? 'idle' : sp < 3.6 ? 'jog' : sp < 6.4 ? 'run' : 'sprint';
      let at = 0;
      let dir: number | undefined;
      if (i === 0) act = 'gk_ready';
      if (plan.owner === p.id && plan.held !== true) act = 'dribble';
      if (goalPhase) {
        if (p.team === 0 && i !== 0)
          act = p.id === 't0p9' && sp < 1 ? 'celebrate' : sp < 0.8 ? 'celebrate' : act;
        if (p.team === 1 && sp < 0.8) act = 'dejected';
      }
      if (p.id === 't0p9' && goalPhase) at = Math.min(1, (t - 9.7) / 5.5);
      for (const [id, a, b, action, ad] of ACTS)
        if (id === p.id && t >= a && t < b) {
          act = action;
          at = (t - a) / (b - a);
          dir = ad;
        }
      if (act === 'celebrate' && p.id !== 't0p9') at = ((t - 9.7) / 5.8) % 1;
      if (act === 'gk_dive') p.y = Math.max(0, Math.sin(Math.PI * Math.min(1, at * 1.4)) * 0.7);
      else p.y = 0;
      p.action = act;
      p.actionT = at;
      p.actionDir = dir;
      p.stamina = Math.max(0.2, 1 - (t / LOOP) * (i === 8 ? 0.7 : 0.3));
    });
    // Ball
    const r = PITCH_11.ballRadius;
    const was = { x: ball.x, y: ball.y, z: ball.z };
    if (plan.flight !== null) {
      const f = plan.flight;
      const u = Math.min(1, (t - f.t0) / (f.t1 - f.t0));
      ball.x = f.from.x + (f.to.x - f.from.x) * u;
      ball.z = f.from.z + (f.to.z - f.from.z) * u;
      ball.y = Math.max(r, f.from.y + (f.to.y - f.from.y) * u + 4 * f.arc * u * (1 - u) + r);
      ball.mode = 'free';
      ball.owner = null;
    } else if (plan.owner !== null) {
      const p = players.find(q => q.id === plan.owner)!;
      ball.mode = plan.held === true ? 'held' : 'free';
      ball.owner = p.id;
      if (plan.held === true) {
        ball.x = p.x + Math.sin(p.yaw) * 0.35;
        ball.z = p.z + Math.cos(p.yaw) * 0.35;
        ball.y = 1;
      } else {
        // Out in front of the feet, a touch every stride
        const lead = 0.55 + 0.25 * Math.abs(Math.sin(t * 5));
        ball.x = p.x + Math.sin(p.yaw) * lead;
        ball.z = p.z + Math.cos(p.yaw) * lead;
        ball.y = r;
      }
      ball.lastTouch = p.id;
    } else {
      ball.mode = t < 2 || (t >= 15.5 && t < 16) ? 'dead' : 'free';
      ball.owner = null;
      if (t >= 15.5 && t < 16.01) {
        ball.x = 0;
        ball.z = 0;
      }
      ball.y = r;
    }
    if (t < 0.05 || (t >= 15.5 && t < 15.6)) {
      ball.x = 0;
      ball.z = 0;
      ball.vx = ball.vy = ball.vz = 0;
    } else {
      ball.vx = (ball.x - was.x) / dt;
      ball.vy = (ball.y - was.y) / dt;
      ball.vz = (ball.z - was.z) / dt;
    }
    // Curl on the cross, topspin on the shot
    ball.wy = plan.flight !== null && plan.flight.arc > 5 ? 3 : 0;
    ball.wx = ball.vz / r;
    ball.wz = -ball.vx / r;
  };

  const state = (): SimState => {
    const t = time % LOOP;
    const ph = phaseAt(t);
    const half = config.halfSeconds;
    return {
      tick,
      time,
      period: 1,
      clock: Math.min(45 * 60 + 150, (22 * 60 + t * 30) as number),
      added: 180,
      phase: ph,
      phaseT: ph === 'goal' ? 15.5 - t : 0,
      score: [score[0], score[1]],
      poss: t >= 16 && t < 21.2 ? 1 : 0,
      attackPlusZ: 0,
      restart:
        ph === 'kickoff'
          ? { kind: 'kickoff', team: t < 2 ? 0 : 1, x: 0, z: 0, taker: t < 2 ? 't0p9' : 't1p10' }
          : null,
      players: players.map(p => ({ ...p })),
      ball: { ...ball },
      shootout: null,
      goals,
      stats: [emptyStats(), emptyStats()],
      charge: t > 7.2 && t < 8 ? { me: { power: (t - 7.2) / 0.8, kind: 'lob' } } : {},
      events: (() => {
        const e = events;
        events = [];
        return e;
      })(),
      sim: { half },
    };
  };

  return {
    config,
    get time() {
      return time;
    },
    length: LOOP,
    state,
    step(dt: number) {
      const n = Math.max(1, Math.round(dt / SIM_DT));
      for (let i = 0; i < n; i++) stepOnce(dt / n);
      const out = events;
      events = [];
      return out;
    },
    seek(to: number) {
      while (time < to - 1e-9) stepOnce(Math.min(SIM_DT, to - time));
      events = [];
    },
  };
}

/** One footballer per Action on a grid (pitch-local), animated by time: the contact sheet. */
export function createPoseSheet(
  cols = 7,
  gap = 4.2,
  /** Which touchline the camera watches from (they face it, turned a little). */
  stand: -1 | 1 = -1,
): { config: MatchConfig; state(time: number): SimState } {
  const actions = ALL_ACTIONS;
  const config = mockConfig();
  const fs: Footballer[] = actions.map((a, i) => ({
    id: `t${i % 2}p${i}`,
    team: (i % 2) as TeamId,
    name: a.toUpperCase(),
    number: i + 1,
    role: a.startsWith('gk_') ? 'GK' : 'MF',
    seedKey: '',
  }));
  config.players = fs;
  const rows = Math.ceil(actions.length / cols);
  return {
    config,
    state(time: number): SimState {
      const players = actions.map((a, i): PlayerState => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const speed = showSpeed(a);
        const cyc = a === 'celebrate' || a === 'dejected' || a === 'gk_hold' ? 4 : 1.6;
        return {
          id: fs[i].id,
          team: fs[i].team,
          x: (r - (rows - 1) / 2) * gap,
          y:
            a === 'gk_dive'
              ? Math.max(0, Math.sin(Math.PI * Math.min(1, ((time / cyc) % 1) * 1.4)) * 0.6)
              : 0,
          z: (c - (cols - 1) / 2) * gap,
          // Moving ones "run" on the spot: velocity without travel
          vx: 0,
          vz: speed,
          yaw: stand < 0 ? -Math.PI / 2 + 0.35 : Math.PI / 2 + 0.35,
          action: a,
          actionT: (time / cyc) % 1,
          actionDir: a === 'gk_dive' ? 1 : a === 'skill' ? Math.floor(time / cyc) % 4 : undefined,
          stamina: 0.8,
          yellow: 0,
          human: i === 0 ? 'me' : null,
        };
      });
      void CELEBRATIONS;
      return {
        tick: Math.floor(time * 60),
        time,
        period: 1,
        clock: 0,
        added: 0,
        phase: 'live',
        phaseT: 0,
        score: [0, 0],
        poss: 0,
        attackPlusZ: 0,
        restart: null,
        players,
        ball: {
          x: -stand * 40,
          y: 0.11,
          z: 0,
          vx: 0,
          vy: 0,
          vz: 0,
          wx: 0,
          wy: 0,
          wz: 0,
          mode: 'dead',
          owner: null,
          lastTouch: null,
        },
        shootout: null,
        goals: [],
        stats: [emptyStats(), emptyStats()],
        charge: {},
        events: [],
      };
    },
  };
}

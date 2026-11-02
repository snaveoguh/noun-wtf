// ── A tiny stand-in FootballSimApi (net tests; the mode until sim/ lands) ─
//
// Not football: each human drives the first outfield player of their team
// (pad → 7 m/s, sprint 9), the ball sticks to whoever reaches it, A kicks it
// forward, crossing a goal line between the posts scores. The CPU footballers
// drift round their spots. Deterministic, plain JSON state (load(state())
// resumes exactly). Emits kick / touch / bounce / goal / whistle / period /
// final events so the net layer has something to carry.

import {
  NO_PAD,
  PITCHES,
  SIM_DT,
  clockRate,
  type Footballer,
  type FootballEvent,
  type FootballSimApi,
  type MatchConfig,
  type PadInput,
  type PlayerState,
  type SimState,
  type TeamId,
  type TeamSize,
  type TeamStats,
} from '../contract';

const zeroStats = (): TeamStats => ({
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
});

/** A match config for tests / quick play: `humans` = [id, team][]. */
export function stubConfig(
  size: TeamSize,
  humans: [string, TeamId][] = [],
  halfSeconds = 60,
): MatchConfig {
  const players: Footballer[] = [];
  for (const team of [0, 1] as TeamId[])
    for (let n = 0; n < size; n++)
      players.push({
        id: `t${team}p${n}`,
        team,
        name: `P${team}${n}`,
        number: n + 1,
        role: n === 0 ? 'GK' : n < size / 2 ? 'DF' : n < size - 1 ? 'MF' : 'FW',
        seedKey: `0-${n}-${n}-${n}-${n}`,
      });
  return {
    size,
    pitch: PITCHES[size],
    halfSeconds,
    knockout: false,
    offside: true,
    fouls: true,
    seed: 7,
    players,
    kits: [
      { name: 'Reds', short: 'RED', shirt: 0xd22, shorts: 0xfff, socks: 0xd22, keeper: 0x2d2 },
      { name: 'Blues', short: 'BLU', shirt: 0x22d, shorts: 0xfff, socks: 0x22d, keeper: 0xdd2 },
    ],
    formations:
      size === 11 ? ['4-4-2', '4-3-3'] : size === 7 ? ['2-3-1', '3-2-1'] : ['2-1-1', '1-2-1'],
    difficulty: [2, 2],
    humans: humans.map(([id, team]) => ({ id, name: id.toUpperCase(), team })),
  };
}

interface Internals {
  held: Record<string, boolean>;
  rng: number;
}

export class StubSim implements FootballSimApi {
  readonly config: MatchConfig;
  private s: SimState;

  constructor(config: MatchConfig) {
    this.config = config;
    const L = config.pitch.length;
    const W = config.pitch.width;
    const players: PlayerState[] = config.players.map((f, i) => {
      const n = i % config.size;
      const sign = f.team === 0 ? -1 : 1;
      return {
        id: f.id,
        team: f.team,
        x: n === 0 ? 0 : ((n % 4) - 1.5) * (W / 5),
        y: 0,
        z: sign * (n === 0 ? L / 2 - 1 : (L / 2) * (1 - n / config.size)),
        vx: 0,
        vz: 0,
        yaw: f.team === 0 ? 0 : Math.PI,
        action: n === 0 ? 'gk_ready' : 'idle',
        actionT: 0,
        stamina: 1,
        yellow: 0,
        human: null,
      };
    });
    for (const h of config.humans) {
      const p = players.find((q, i) => q.team === h.team && i % config.size !== 0 && !q.human);
      if (p) {
        // Next to the ball, so a test's pad finds it
        p.human = h.id;
        p.x = 0;
        p.z = h.team === 0 ? -1.5 : 1.5;
      }
    }
    this.s = {
      tick: 0,
      time: 0,
      period: 1,
      clock: 0,
      added: 60,
      phase: 'kickoff',
      phaseT: 0,
      score: [0, 0],
      poss: 0,
      attackPlusZ: 0,
      restart: { kind: 'kickoff', team: 0, x: 0, z: 0, taker: null },
      players,
      ball: {
        x: 0,
        y: config.pitch.ballRadius,
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
      stats: [zeroStats(), zeroStats()],
      charge: {},
      events: [],
      sim: { held: {}, rng: config.seed } satisfies Internals,
    };
  }

  state(): SimState {
    return structuredClone(this.s);
  }

  load(state: SimState) {
    this.s = structuredClone(state);
    this.s.sim ??= { held: {}, rng: this.config.seed } satisfies Internals;
  }

  step(inputs: Record<string, PadInput>): SimState {
    const s = this.s;
    const internals = s.sim as Internals;
    const ev: FootballEvent[] = [];
    const cfg = this.config;
    const L = cfg.pitch.length;
    s.tick++;
    s.time += SIM_DT;
    s.clock += SIM_DT * clockRate(cfg.halfSeconds);
    if (s.tick === 1) {
      ev.push({ type: 'whistle', kind: 'short' });
      s.phase = 'live';
      s.restart = null;
      s.ball.mode = 'free';
    }
    const b = s.ball;
    for (const p of s.players) {
      const pad = p.human ? (inputs[p.human] ?? NO_PAD) : null;
      if (pad) {
        const sp = pad.sprint ? 9 : 7;
        p.vx = pad.mx * sp;
        p.vz = pad.mz * sp;
        const wasHeld = internals.held[p.human!] === true;
        internals.held[p.human!] = pad.pass;
        if (pad.pass && !wasHeld && b.owner === p.id) {
          b.owner = null;
          const dir = p.team === s.attackPlusZ ? 1 : -1;
          b.vz = dir * 18;
          b.vx = pad.mx * 4;
          b.vy = 2;
          b.wy = pad.finesse ? 6 : 0;
          s.stats[p.team].shots++;
          ev.push({ type: 'kick', id: p.id, kind: 'shot', power: 0.8 });
        }
      } else {
        // Drift round the spot, deterministically
        internals.rng = (Math.imul(internals.rng, 1103515245) + 12345) >>> 0;
        const k = ((internals.rng >>> 8) & 255) / 255 - 0.5;
        p.vx = p.vx * 0.95 + k * 0.2;
        p.vz *= 0.95;
      }
      p.x += p.vx * SIM_DT;
      p.z += p.vz * SIM_DT;
      if (Math.hypot(p.vx, p.vz) > 0.1) p.yaw = Math.atan2(p.vx, p.vz);
      p.action =
        Math.hypot(p.vx, p.vz) > 7.5 ? 'sprint' : Math.hypot(p.vx, p.vz) > 0.5 ? 'run' : p.action;
      p.actionT = (p.actionT + SIM_DT) % 1;
      if (b.owner === null && b.y < 0.5 && Math.hypot(b.x - p.x, b.z - p.z) < 0.8 && p.human) {
        b.owner = p.id;
        b.lastTouch = p.id;
        s.poss = p.team;
        ev.push({ type: 'touch', id: p.id, quality: 0.9 });
      }
    }
    if (b.owner !== null) {
      const o = s.players.find(p => p.id === b.owner)!;
      b.x = o.x + Math.sin(o.yaw) * 0.5;
      b.z = o.z + Math.cos(o.yaw) * 0.5;
      b.y = cfg.pitch.ballRadius;
      b.vx = o.vx;
      b.vz = o.vz;
      b.vy = 0;
    } else {
      b.vy -= 9.81 * SIM_DT;
      b.x += b.vx * SIM_DT;
      b.y += b.vy * SIM_DT;
      b.z += b.vz * SIM_DT;
      if (b.y < cfg.pitch.ballRadius) {
        b.y = cfg.pitch.ballRadius;
        if (b.vy < -1) ev.push({ type: 'bounce', strength: Math.min(1, -b.vy / 10) });
        b.vy = -b.vy * 0.5;
      }
      b.vx *= 0.99;
      b.vz *= 0.99;
    }
    s.stats[s.poss].poss++;
    if (Math.abs(b.z) > L / 2) {
      const team = (b.z > 0 ? s.attackPlusZ : 1 - s.attackPlusZ) as TeamId;
      if (Math.abs(b.x) < cfg.pitch.goalWidth / 2) {
        s.score[team]++;
        const scorer = b.lastTouch ?? '';
        s.goals.push({
          team,
          scorer,
          assist: null,
          minute: Math.floor(s.clock / 60),
          ownGoal: false,
          penalty: false,
        });
        ev.push({ type: 'goal', team, scorer, assist: null, ownGoal: false });
      }
      b.x = 0;
      b.z = 0;
      b.vx = b.vz = b.vy = 0;
      b.owner = null;
    }
    const end = Math.round((cfg.halfSeconds * 2) / SIM_DT);
    if (s.tick === Math.round(cfg.halfSeconds / SIM_DT)) {
      s.period = 2;
      s.attackPlusZ = 1;
      ev.push({ type: 'period', period: 2 });
    }
    if (s.tick >= end && s.phase !== 'final') {
      s.phase = 'final';
      const winner = s.score[0] > s.score[1] ? 0 : s.score[1] > s.score[0] ? 1 : null;
      ev.push({ type: 'whistle', kind: 'end' });
      ev.push({ type: 'final', winner, score: [s.score[0], s.score[1]] });
    }
    s.events = ev;
    return this.state();
  }
}

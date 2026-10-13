// All-bot game runner + box-score formatting (tests, the box-score script,
// and handy for the net layer's NPC-only courts / attract mode).

import type { BallerStats, Baller, GameConfig, SimEvent, TeamSize } from '../contract';

import { JERSEY_COURT, MODE_DEFAULTS } from '../contract';

import { HoopsSim } from './HoopsSim';

export function botRoster(size: TeamSize): Baller[] {
  const out: Baller[] = [];
  for (const team of [0, 1] as const) {
    for (let k = 0; k < size; k++) {
      const n = team * size + k;
      out.push({ id: `bot:${n}`, team, bot: true, name: `Noun ${n}`, seedKey: `bot:${n}` });
    }
  }
  return out;
}

export function botConfig(size: TeamSize, seed: number, difficulty: 1 | 2 | 3 = 2): GameConfig {
  return {
    ...MODE_DEFAULTS[size],
    seed,
    players: botRoster(size),
    court: JERSEY_COURT,
    difficulty,
  };
}

export interface GameRun {
  sim: HoopsSim;
  steps: number;
  finished: boolean;
  events: Record<SimEvent['type'], number>;
  /** Longest stretch of live play without the ball changing hands / being shot (s). */
  longestStall: number;
  howCounts: Record<string, number>;
  /** Shot attempts by kind, and steals split into pickpockets / interceptions. */
  kinds: Record<string, number>;
  /** Share of steps with the ball held and all but one player within 3 m of it (size >= 3). */
  crowded: number;
  /** Longest continuous such stretch (s). */
  crowdedRun: number;
  /** Uncleared half-court makes (bots should never do this). */
  clearViolations: number;
}

export function runBotGame(config: GameConfig, maxSteps = 200_000): GameRun {
  const sim = new HoopsSim(config);
  const events = {} as Record<SimEvent['type'], number>;
  const howCounts: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  let steps = 0;
  let stall = 0;
  let longestStall = 0;
  let live = 0;
  let crowdedSteps = 0;
  let crowdRun = 0;
  let crowdedRun = 0;
  let clearViolations = 0;
  for (; steps < maxSteps; steps++) {
    sim.step({});
    const s = sim.live;
    let progress = s.phase !== 'live';
    for (const e of s.events) {
      events[e.type] = (events[e.type] ?? 0) + 1;
      if (e.type === 'score') howCounts[e.how] = (howCounts[e.how] ?? 0) + 1;
      if (e.type === 'shot') kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      if (e.type === 'violation' && e.kind === 'clear') clearViolations++;
      if (e.type === 'slam' && !e.made) kinds.slamMiss = (kinds.slamMiss ?? 0) + 1;
      if (e.type === 'crossover' && e.ankles) kinds.ankles = (kinds.ankles ?? 0) + 1;
      if (e.type === 'shot' || e.type === 'pass' || e.type === 'steal' || e.type === 'rebound')
        progress = true;
    }
    if (s.phase === 'live' && s.ball.state === 'held') {
      live++;
      let near = 0;
      for (const p of s.players) if (Math.hypot(p.x - s.ball.x, p.z - s.ball.z) < 3) near++;
      if (config.size >= 3 && near >= s.players.length - 1) {
        crowdedSteps++;
        crowdRun += 1 / 60;
        crowdedRun = Math.max(crowdedRun, crowdRun);
      } else crowdRun = 0;
    }
    stall = progress ? 0 : stall + 1 / 60;
    longestStall = Math.max(longestStall, stall);
    if (s.phase === 'final') break;
  }
  return {
    sim,
    steps,
    finished: sim.live.phase === 'final',
    events,
    longestStall,
    howCounts,
    kinds,
    crowded: live > 0 ? crowdedSteps / live : 0,
    crowdedRun,
    clearViolations,
  };
}

function pct(m: number, a: number): string {
  return a > 0 ? `${Math.round((100 * m) / a)}%` : '-';
}

export function teamTotals(sim: HoopsSim, team: 0 | 1): BallerStats {
  const tot: BallerStats = {
    pts: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    reb: 0,
    oreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    dunks: 0,
    tov: 0,
  };
  for (const p of sim.config.players) {
    if (p.team !== team) continue;
    const st = sim.boxScore[p.id];
    for (const k of Object.keys(tot) as (keyof BallerStats)[]) tot[k] += st[k];
  }
  return tot;
}

export function formatBoxScore(sim: HoopsSim): string {
  const s = sim.live;
  const lines: string[] = [];
  const pad = (v: string | number, n: number) => String(v).padStart(n);
  const head = `${'PLAYER'.padEnd(10)}${pad('PTS', 5)}${pad('FG', 7)}${pad('FG%', 6)}${pad('3P', 7)}${pad('REB', 5)}${pad('OREB', 5)}${pad('AST', 5)}${pad('STL', 5)}${pad('BLK', 5)}${pad('DNK', 5)}${pad('TOV', 5)}`;
  const row = (name: string, st: BallerStats) =>
    `${name.padEnd(10)}${pad(st.pts, 5)}${pad(`${st.fgm}-${st.fga}`, 7)}${pad(pct(st.fgm, st.fga), 6)}${pad(`${st.tpm}-${st.tpa}`, 7)}${pad(st.reb, 5)}${pad(st.oreb, 5)}${pad(st.ast, 5)}${pad(st.stl, 5)}${pad(st.blk, 5)}${pad(st.dunks, 5)}${pad(st.tov, 5)}`;
  for (const team of [0, 1] as const) {
    lines.push(`TEAM ${team}  ${s.score[team]}`);
    lines.push(head);
    for (const p of sim.config.players) {
      if (p.team !== team) continue;
      lines.push(row(p.name, sim.boxScore[p.id]));
    }
    lines.push(row('TOTAL', teamTotals(sim, team)));
    lines.push('');
  }
  return lines.join('\n');
}

// All-bot game → box score, from the command line:
//
//   cd packages/nouns-webapp
//   node <tsx>/dist/cli.mjs src/miniapps/world2/hoops/sim/boxscore.ts [size=3] [seed=1] [difficulty=2]
//
// (any TS runner works: tsx, vite-node, …)

import type { TeamSize } from '../contract';

import { botConfig, formatBoxScore, runBotGame } from './harness';

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv.slice(2) ?? [];
const size = Number(argv[0] ?? 3) as TeamSize;
const seed = Number(argv[1] ?? 1);
const difficulty = Number(argv[2] ?? 2) as 1 | 2 | 3;

const t0 = performance.now();
const r = runBotGame(botConfig(size, seed, difficulty));
const ms = performance.now() - t0;
const s = r.sim.live;
const mins = Math.floor(s.time / 60);
const secs = Math.round(s.time % 60);
const lines = [
  `Noun Hoops ${size}v${size} (all bots, seed ${seed}, difficulty ${difficulty})`,
  `Final ${s.score[0]}-${s.score[1]} in ${mins}:${String(secs).padStart(2, '0')} of game time, ${r.steps} steps, ${((ms / r.steps) * 1000).toFixed(0)} µs/step`,
  '',
  formatBoxScore(r.sim),
  `Finishes: ${Object.entries(r.howCounts)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}`,
  `Attempts: ${Object.entries(r.kinds)
    .filter(([k]) => k !== 'slamMiss' && k !== 'ankles')
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}`,
  `Crossovers ${r.events.crossover ?? 0} (ankles broken ${r.kinds.ankles ?? 0}), missed slams ${r.kinds.slamMiss ?? 0}, passes ${r.events.pass ?? 0}, on fire ${r.events.onFire ?? 0}, goaltends ${r.events.goaltend ?? 0}, out of bounds ${r.events.outOfBounds ?? 0}, shot clock ${r.events.shotClock ?? 0}`,
];
console.log(lines.join('\n'));

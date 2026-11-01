// Print the model's scenarios as markdown tables (pasted into ../token-design.md).
//   node --experimental-strip-types docs/strategy/model/run.ts

import {
  allocate,
  daysToExhaustSinks,
  DEFAULT_PARAMS,
  ARCHETYPES,
  NAIVE_RULES,
  simulate,
  type SimResult,
} from './token.ts';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log('## Allocation (1,000,000,000)\n');
for (const [k, v] of Object.entries(allocate(1_000_000_000))) console.log(`- ${k}: ${fmt(v)}`);
console.log(`\nDays for a regular to buy every van upgrade: ${daysToExhaustSinks()}\n`);

function table(name: string, r: SimResult) {
  console.log(`### ${name}\n`);
  console.log(`Farmers took ${pct(r.farmerShare)} of play + creator rewards.\n`);
  console.log('| week | emitted | to players | to farmers | sold | burned | to treasury | held by people |');
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const w of r.rows.filter(x => [0, 4, 12, 26, 51, 52, 78, 103].includes(x.week)))
    console.log(
      `| ${w.week + 1} | ${fmt(w.emitted)} | ${fmt(w.toPlayers)} | ${fmt(w.toFarmers)} | ${fmt(w.sold)} | ${fmt(w.burned)} | ${fmt(w.toTreasury)} | ${fmt(w.held)} |`,
    );
  const t = r.totals;
  console.log(
    `\n2-year totals: emitted ${fmt(t.emitted)}, sold ${fmt(t.sold)}, burned ${fmt(t.burned)}, to treasury ${fmt(t.treasuryIn)}.\n`,
  );
}

table('Defended rules (proposed)', simulate(DEFAULT_PARAMS));
table('Naive points (count everything, no gates)', simulate({ ...DEFAULT_PARAMS, rules: NAIVE_RULES }));
table(
  'Defended rules, players spend 3x less in-game (sinks sensitivity)',
  simulate({
    ...DEFAULT_PARAMS,
    archetypes: ARCHETYPES.map(a => ({ ...a, spendRate: a.spendRate / 3 })),
    agentVolumeWeekly: DEFAULT_PARAMS.agentVolumeWeekly / 4,
  }),
);

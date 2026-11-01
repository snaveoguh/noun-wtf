// node --experimental-strip-types --test docs/strategy/model/token.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allocate,
  ALLOCATION_BPS,
  ARCHETYPES,
  checkConservation,
  COIN_FACTS,
  DEFAULT_PARAMS,
  DEFENDED_RULES,
  distribute,
  emissionSchedule,
  NAIVE_RULES,
  RETRO_CAP_BPS,
  retroConvert,
  retroPoints,
  score,
  simulate,
  TOTAL_SUPPLY,
  type RetroAccount,
  type WeekActivity,
} from './token.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

test('allocation sums to the supply exactly, players + creators get the majority', () => {
  const a = allocate(TOTAL_SUPPLY);
  assert.equal(Object.values(a).reduce((x, y) => x + y, 0), TOTAL_SUPPLY);
  assert.ok(a.retro + a.play + a.creators > TOTAL_SUPPLY / 2);
  assert.ok(a.builders <= TOTAL_SUPPLY * 0.05);
  assert.throws(() => allocate(100, { ...ALLOCATION_BPS, retro: 0 }));
  // Rounding dust lands in the treasury, never lost
  const odd = allocate(999_999_999);
  assert.equal(Object.values(odd).reduce((x, y) => x + y, 0), 999_999_999);
});

test('emission sums to its pool, halves each year, never negative', () => {
  const pool = 250_000_000;
  const s = emissionSchedule(pool, 208);
  assert.equal(s.reduce((a, b) => a + b, 0), pool);
  assert.ok(s.every(x => x >= 0));
  assert.ok(Math.abs(s[52] / s[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(s[104] / s[52] - 0.5) < 1e-6);
  assert.deepEqual(emissionSchedule(7, 0), []);
});

test('distribute never pays more than the pool', () => {
  const { paid, rest } = distribute(1_000, [1, 1, 1]);
  assert.equal(paid.reduce((a, b) => a + b, 0) + rest, 1_000);
  assert.deepEqual(distribute(5, [0, 0]), { paid: [0, 0], rest: 5 });
});

const base: WeekActivity = {
  activeDays: 5,
  coinEarned: 3_000,
  pieces: 4,
  piecesKept: 1,
  provedRecords: 1,
  respectTier: 3,
  linkedWeeks: 10,
  agentTrades: 0,
};

test('gates: no score without enough days, respect or wallet age', () => {
  assert.ok(score(base, DEFENDED_RULES) > 0);
  assert.equal(score({ ...base, activeDays: 2 }, DEFENDED_RULES), 0);
  assert.equal(score({ ...base, respectTier: 1 }, DEFENDED_RULES), 0);
  assert.equal(score({ ...base, linkedWeeks: 1 }, DEFENDED_RULES), 0);
});

test('concave + capped: 100x the COIN is nowhere near 100x the score', () => {
  const a = score(base, DEFENDED_RULES);
  const b = score({ ...base, coinEarned: base.coinEarned * 100 }, DEFENDED_RULES);
  assert.ok(b <= DEFENDED_RULES.weeklyCap);
  assert.ok(b / a < 3, `ratio ${b / a}`);
  // Naive is linear in COIN
  const na = score(base, NAIVE_RULES);
  const nb = score({ ...base, coinEarned: base.coinEarned * 100 }, NAIVE_RULES);
  assert.ok(nb / na > 30);
});

test('one-trick accounts score half (diversity)', () => {
  const coinOnly = { ...base, pieces: 0, piecesKept: 0, provedRecords: 0 };
  const r = { ...DEFENDED_RULES, weeklyCap: Infinity };
  const withSecond = { ...coinOnly, provedRecords: 1 };
  assert.ok(score(withSecond, r) > score(coinOnly, r) * 1.5);
});

test('simulation conserves every token, with either rule set', () => {
  for (const rules of [DEFENDED_RULES, NAIVE_RULES]) {
    const r = simulate({ ...DEFAULT_PARAMS, rules });
    assert.deepEqual(checkConservation(r.ledger), []);
    assert.equal(r.rows.length, DEFAULT_PARAMS.weeks);
  }
});

test('defended rules keep farmers under 10%; naive hands them the majority', () => {
  const d = simulate(DEFAULT_PARAMS);
  const n = simulate({ ...DEFAULT_PARAMS, rules: NAIVE_RULES });
  assert.ok(d.farmerShare < 0.1, `defended ${d.farmerShare}`);
  assert.ok(n.farmerShare > 0.5, `naive ${n.farmerShare}`);
  assert.ok(d.totals.sold < n.totals.sold / 2, 'farmers dump; fewer farmers = less sold');
});

test('deterministic: same params, same result', () => {
  assert.deepEqual(simulate(DEFAULT_PARAMS).rows, simulate(DEFAULT_PARAMS).rows);
});

test('play pool is never overspent across the full four years', () => {
  const r = simulate({ ...DEFAULT_PARAMS, weeks: 208 });
  assert.ok(r.ledger.pools.play >= 0);
  assert.ok(r.totals.emitted <= allocate(TOTAL_SUPPLY).play + allocate(TOTAL_SUPPLY).creators);
  assert.deepEqual(checkConservation(r.ledger), []);
});

test('no farmer archetype gets through the gates when they only do the minimum', () => {
  const sybil = ARCHETYPES.find(a => a.id === 'sybil')!;
  assert.equal(score(sybil.week, DEFENDED_RULES), 0);
});

const acct = (o: Partial<RetroAccount>): RetroAccount => ({
  id: 'x',
  tradeEarned: 0,
  exchangeGain: 0,
  respectTier: 1,
  provedRecords: 0,
  pieces: 0,
  activeDays: 10,
  linked: true,
  ...o,
});

test('retro: unlinked, staff and drive-by accounts get nothing', () => {
  assert.equal(retroPoints(acct({ linked: false, tradeEarned: 1e6 })), 0);
  assert.equal(retroPoints(acct({ staff: true, tradeEarned: 1e6 })), 0);
  assert.equal(retroPoints(acct({ activeDays: 2, tradeEarned: 1e6 })), 0);
});

test('retro: per-account cap holds, the pool is fully accounted for', () => {
  const pool = 225_000_000;
  const accounts = [
    acct({ id: 'whale', tradeEarned: 1e9 }),
    ...Array.from({ length: 300 }, (_, i) => acct({ id: `p${i}`, tradeEarned: 5_000, pieces: 3 })),
    acct({ id: 'gone', linked: false, tradeEarned: 1e9 }),
  ];
  const { paid, toPlay } = retroConvert(pool, accounts);
  const cap = Math.floor((pool * RETRO_CAP_BPS) / 10_000);
  assert.ok(paid.every(p => p <= cap));
  assert.equal(paid[0], cap);
  assert.equal(paid.at(-1), 0);
  assert.equal(paid.reduce((a, b) => a + b, 0) + toPlay, pool);
});

test('retro: tiny populations hit the cap and send the rest back to play', () => {
  // Today's reality: a few dozen riders. Most of the pool must not land on them.
  const pool = 225_000_000;
  const accounts = Array.from({ length: 20 }, (_, i) => acct({ id: `r${i}`, tradeEarned: 10_000 }));
  const { paid, toPlay } = retroConvert(pool, accounts);
  assert.ok(paid.reduce((a, b) => a + b, 0) <= pool * 0.1 + 1);
  assert.ok(toPlay >= pool * 0.9 - 1);
});

test('COIN facts still match the game source', () => {
  const ledger = src('packages/nouns-webapp/src/miniapps/world2/trade/ledger.ts');
  assert.match(ledger, new RegExp(`STARTER_COIN: ${COIN_FACTS.tradeStarter},`));
  assert.match(ledger, new RegExp(`MAX_SPEND: ${COIN_FACTS.maxSpendPerAction},`));
  const sim = src('packages/nouns-webapp/src/miniapps/exchange/engine/sim.ts');
  assert.match(sim, new RegExp(`STARTER_COIN = ${COIN_FACTS.exchangeStarter};`));
  const book = src('packages/nouns-webapp/src/miniapps/exchange/engine/book.ts');
  assert.match(book, new RegExp(`FEE_BPS = ${COIN_FACTS.exchangeFeeBps};`));
  const up = src('packages/nouns-webapp/src/miniapps/world2/trade/upgrades.ts');
  const costs = [...up.matchAll(/cost: (\d+)/g)].map(m => Number(m[1]));
  assert.equal(
    costs.reduce((a, b) => a + b, 0),
    COIN_FACTS.upgradesTotal,
  );
  const supply = src('packages/noun-trade-contracts/SUPPLY.md');
  assert.match(supply, /about 600 COIN of profit a day/);
});

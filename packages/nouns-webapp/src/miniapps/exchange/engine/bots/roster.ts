// ── The trading floor's regulars ─────────────────────────────────────────
//
// Every bot is a real Noun: the seeds are the exact on-chain seeds
// (NounsToken.seeds(id) on mainnet, 0x9C8f…dC03), read once and hard-coded,
// picked for heads that suit the job (a calculator makes markets, a whale is
// the whale). Order: background, body, accessory, head, glasses.

import type { GoodId, Goods } from '../types';
import type { BotDef } from './types';

import { GOODS } from '../goods';

const MIN = 60_000;
const each = (n: number): Goods => {
  const out: Goods = {};
  for (const g of GOODS) out[g as GoodId] = n;
  return out;
};

export const ROSTER: readonly BotDef[] = [
  {
    id: 'bot:abacus',
    name: 'Abacus',
    noun: 18,
    seed: [0, 5, 110, 29, 18], // calculator head
    style: 'maker',
    blurb: 'Market maker. Quotes both sides around fair value, leans to shed inventory.',
    cadence: 12_000,
    budget: { coin: 6000, goods: each(60) },
    maxQty: 10,
    p: { half: 0.035, skew: 0.05, perAct: 3, minSz: 3, maxSz: 9, anchorLast: 0.35, talk: 0.12 },
  },
  {
    id: 'bot:till',
    name: 'Till',
    noun: 11,
    seed: [1, 21, 26, 34, 14], // cash register head
    style: 'maker',
    blurb: 'Backstop maker. Wide, deep quotes so the book is never empty.',
    cadence: 45_000,
    budget: { coin: 5000, goods: each(50) },
    maxQty: 20,
    p: { half: 0.09, skew: 0.03, perAct: 2, minSz: 8, maxSz: 18, anchorLast: 0, talk: 0.15 },
  },
  {
    id: 'bot:sprinkles',
    name: 'Sprinkles',
    noun: 31,
    seed: [1, 26, 40, 108, 5], // ice pop head
    style: 'arb',
    blurb: 'Arbitrageur. Buys where it is cheap, sells where it is dear: towns vs the exchange.',
    cadence: 20_000,
    budget: { coin: 2500, goods: {} },
    maxQty: 12,
    townCap: 80,
    p: { margin: 0.04 },
  },
  {
    id: 'bot:candles',
    name: 'Candles',
    noun: 26,
    seed: [1, 17, 69, 41, 15], // chart-bars head
    style: 'momentum',
    blurb: 'Momentum chaser. Buys what is going up, dumps what is going down.',
    cadence: 40_000,
    budget: { coin: 2000, goods: each(12) },
    maxQty: 6,
    p: { look: 15, trigger: 0.03 },
  },
  {
    id: 'bot:piggy',
    name: 'Piggy',
    noun: 191,
    seed: [0, 26, 14, 154, 6], // piggy bank head
    style: 'meanrev',
    blurb: 'Mean reverter. Fades anything that strays too far from fair value.',
    cadence: 35_000,
    budget: { coin: 2500, goods: each(20) },
    maxQty: 8,
    p: { band: 0.09, rest: 0.07, stale: 10 * MIN },
  },
  {
    id: 'bot:bigblue',
    name: 'Big Blue',
    noun: 98,
    seed: [0, 13, 125, 229, 17], // whale head
    style: 'whale',
    blurb: 'The whale. Mostly asleep. Occasionally moves a whole market.',
    cadence: 40 * MIN,
    budget: { coin: 9000, goods: each(80) },
    maxQty: 60,
    p: { share: 0.45, band: 0.25 },
  },
  {
    id: 'bot:slice',
    name: 'Slice',
    noun: 55,
    seed: [1, 8, 22, 160, 7], // pizza head
    style: 'degen',
    blurb: 'Degen. No plan, all vibes, tiny size.',
    cadence: 25_000,
    budget: { coin: 700, goods: each(6) },
    maxQty: 5,
    p: { band: 0.2 },
  },
];

export const BOT_BY_ID: Record<string, BotDef> = Object.fromEntries(ROSTER.map(b => [b.id, b]));
export const isBot = (owner: string) => owner.startsWith('bot:');

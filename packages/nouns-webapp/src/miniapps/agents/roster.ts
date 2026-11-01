// ── The agents: who keeps the city trading while you're away ─────────────
//
// Five to start: three shopkeepers (a corner shop, a bait shop, a drip
// boutique), a market maker on the Exchange floor and a collector. Their
// looks are V1 Noun seeds; their ids are public exchange owner ids.
// Adding one: give it a new 'agent:<slug>' id (never reuse one: the id is
// its exchange account) and the role's knobs (policies/*.ts).

import type { AgentDef } from './contract';

const MIN = 60_000;

export const AGENTS: readonly AgentDef[] = [
  {
    id: 'agent:mochi',
    name: 'Mochi',
    role: 'shopkeeper',
    seed: [1, 12, 33, 94, 7],
    blurb: 'Runs a corner shop. Buys stock on the Exchange, prices it by what sells.',
    shop: "MOCHI'S CORNER",
    rooms: ['cafe', 'shop'],
    goods: ['ICECREAM', 'PIZZA', 'FRIES'],
    cadence: 10 * MIN,
    maxQty: 8,
    goal: 'Keep ice cream, pizza and fries on the shelf and make a small margin on each.',
    p: { target: 10, markup: 0.12, restock: 0.6, budget: 0.35 },
    llm: true,
  },
  {
    id: 'agent:reel',
    name: 'Reel',
    role: 'shopkeeper',
    seed: [0, 4, 61, 141, 13],
    blurb: 'Bait and water. Cheap, cheerful, always a bit low on fish.',
    shop: 'BAIT & WATER',
    rooms: ['shop', 'bar'],
    goods: ['FISH', 'WATER'],
    cadence: 12 * MIN,
    maxQty: 10,
    goal: 'Sell fish and water to anyone heading out of town, never run dry.',
    p: { target: 14, markup: 0.1, restock: 0.5, budget: 0.4 },
  },
  {
    id: 'agent:velvet',
    name: 'Velvet',
    role: 'shopkeeper',
    seed: [1, 22, 8, 187, 2],
    blurb: 'Drip boutique. Small stock, big markup, buys back clean pieces.',
    shop: 'VELVET DRIP',
    rooms: ['shop', 'studio', 'barber', 'gallery'],
    goods: ['DRIP', 'NOGGLES'],
    cadence: 15 * MIN,
    maxQty: 3,
    goal: 'Hold a few pieces of drip and noggles, sell them dear, buy them back cheap.',
    p: { target: 4, markup: 0.2, restock: 0.5, budget: 0.5 },
  },
  {
    id: 'agent:ledger',
    name: 'Ledger',
    role: 'maker',
    seed: [0, 17, 110, 29, 18],
    blurb: 'Makes markets on the Exchange floor. Quotes both sides, sheds inventory.',
    rooms: ['bar'],
    goods: ['ICECREAM', 'FISH', 'PIZZA'],
    cadence: 6 * MIN,
    maxQty: 6,
    goal: 'Keep a two-sided market in ice cream, fish and pizza; stay flat.',
    p: { half: 0.04, skew: 0.06, size: 4, target: 6, budget: 0.3 },
  },
  {
    id: 'agent:magpie',
    name: 'Magpie',
    role: 'collector',
    seed: [1, 9, 77, 205, 19],
    blurb: 'Collector. Hoards noggles and drip, pounces on a dip.',
    rooms: ['gallery', 'home'],
    goods: ['NOGGLES', 'DRIP'],
    cadence: 15 * MIN,
    maxQty: 2,
    goal: 'Own 6 noggles and 6 drip without ever overpaying.',
    p: { want: 6, patience: 0.08, budget: 0.4 },
    llm: true,
  },
];

export const AGENT_BY_ID: Readonly<Record<string, AgentDef>> = Object.fromEntries(
  AGENTS.map(a => [a.id, a]),
);

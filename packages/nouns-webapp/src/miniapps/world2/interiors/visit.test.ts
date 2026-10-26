import type { RespectEvent, RespectTier } from './contract';

import { describe, expect, it } from 'vitest';

import { discounted, menuOf } from './dialogue';
import { generateLayout } from './layout';
import { residentsFor } from './residents';
import { mulberry32 } from './rng';
import {
  EAT_S,
  HINT_GRACE,
  SHOW_OUT,
  THANK_S,
  answersDoor,
  arrive,
  caughtChance,
  menu,
  step,
  type Effect,
  type Visit,
  type VisitEvent,
} from './visit';

const NO = { near: null, seat: null, stealable: null, watched: false, canBuy: false };

function start(
  kind: 'home' | 'cafe' | 'shop' = 'home',
  tier: RespectTier = 'local',
  id = 'plaza:1,2',
) {
  const l = generateLayout({ id, kind, frontage: 12, depth: 12 });
  const folk = residentsFor(id, l, tier);
  const rnd = mulberry32(42);
  const a = arrive(id, kind, tier, folk, rnd);
  return { ...a, rnd, folk };
}

/** Run events, collecting effects. */
function run(v0: Visit, evs: VisitEvent[], rnd = mulberry32(7)) {
  let v = v0;
  const fx: Effect[] = [];
  for (const e of evs) {
    const r = step(v, e, rnd);
    v = r.visit;
    fx.push(...r.effects);
  }
  return {
    v,
    fx,
    respect: fx.filter(f => f.t === 'respect').map(f => (f as { e: RespectEvent }).e),
  };
}

/** Tick until someone offers food (standing by `near`), at most `max` s. */
function untilOffer(v0: Visit, near: string, max = 300) {
  let v = v0;
  const fx: Effect[] = [];
  const rnd = mulberry32(11);
  for (let t = 0; t < max && v.offer === null; t += 0.25) {
    const r = step(v, { t: 'tick', dt: 0.25, near }, rnd);
    v = r.visit;
    fx.push(...r.effects);
  }
  return { v, fx };
}

/** Tick in small steps for `s` seconds, standing next to `near`. */
const ticks = (s: number, near: string | null = null): VisitEvent[] =>
  Array.from({ length: Math.ceil(s / 0.25) }, () => ({ t: 'tick', dt: 0.25, near }));

describe('visit state machine', () => {
  it('greets you on arrival, warmer the higher your tier', () => {
    const cold = start('home', 'outcast');
    const fan = start('home', 'legend');
    expect(cold.effects[0]).toMatchObject({ t: 'say', tone: 'angry' });
    expect(fan.effects[0]).toMatchObject({ t: 'say', tone: 'happy' });
    expect(fan.visit.residents[0]!.mood).toBeGreaterThan(cold.visit.residents[0]!.mood);
  });

  it('a host offers food, you eat it and say thanks: ate (thanked)', () => {
    const s = start('home', 'regular');
    const host = s.visit.residents[0]!.id;
    // Stand by the host until an offer comes
    let r = untilOffer(s.visit, host) as ReturnType<typeof run>;
    const offered = r.fx.find(f => f.t === 'offer');
    expect(offered).toBeDefined();
    expect(r.v.offer).not.toBeNull();
    expect(menu(r.v, NO)[0]).toMatchObject({ a: 'accept' });
    r = run(r.v, [{ t: 'accept' }, ...ticks(EAT_S + 0.5), { t: 'thank' }]);
    expect(r.fx.some(f => f.t === 'eat')).toBe(true);
    expect(r.respect).toContainEqual({ kind: 'ate', at: 'plaza:1,2', thanked: true });
  });

  it('eating without a thank-you still counts, unthanked', () => {
    const s = start('home', 'regular');
    const host = s.visit.residents[0]!.id;
    let r = untilOffer(s.visit, host) as ReturnType<typeof run>;
    r = run(r.v, [{ t: 'accept' }, ...ticks(EAT_S + THANK_S + 1)]);
    expect(r.respect).toContainEqual({ kind: 'ate', at: 'plaza:1,2', thanked: false });
  });

  it('refusing food: refused_food, and the host is a bit hurt', () => {
    const s = start('home', 'local');
    const host = s.visit.residents[0]!.id;
    let r = untilOffer(s.visit, host) as ReturnType<typeof run>;
    const from = r.v.offer!.from;
    const before = r.v.residents.find(q => q.id === from)!.mood;
    r = run(r.v, [{ t: 'refuse' }]);
    expect(r.respect).toContainEqual({ kind: 'refused_food', at: 'plaza:1,2' });
    expect(r.v.residents.find(q => q.id === from)!.mood).toBeLessThan(before);
  });

  it('walking out on food you were given is refused_food', () => {
    const s = start('home', 'local');
    let r = untilOffer(s.visit, s.visit.residents[0]!.id) as ReturnType<typeof run>;
    r = run(r.v, [{ t: 'accept' }, { t: 'tick', dt: 0.5, near: null }, { t: 'leave' }]);
    expect(r.respect).toContainEqual({ kind: 'refused_food', at: 'plaza:1,2' });
  });

  it('legends get the good stuff', () => {
    const s = start('home', 'legend');
    const r = untilOffer(s.visit, s.visit.residents[0]!.id);
    const o = r.fx.find(f => f.t === 'offer') as { food: { premium: boolean } } | undefined;
    expect(o?.food.premium).toBe(true);
  });

  it('outcasts are not offered food at a shop, and some homes shut the door', () => {
    const s = start('shop', 'outcast');
    const r = run(s.visit, ticks(120, s.visit.residents[0]!.id));
    expect(r.fx.some(f => f.t === 'offer')).toBe(false);
    let shut = 0;
    for (let i = 0; i < 100; i++) if (!answersDoor('home', 'outcast', i / 100)) shut++;
    expect(shut).toBeGreaterThan(50);
    expect(answersDoor('shop', 'outcast', 0)).toBe(true);
    expect(answersDoor('home', 'stranger', 0)).toBe(true);
  });

  it('sitting reports sat once per visit', () => {
    const s = start();
    const r = run(s.visit, [{ t: 'sit', seat: 0 }, { t: 'stand' }, { t: 'sit', seat: 1 }]);
    expect(r.respect.filter(e => e.kind === 'sat')).toHaveLength(1);
    expect(r.v.sitting).toBe(1);
    expect(menu(r.v, NO).some(a => a.a === 'stand')).toBe(true);
  });

  it('gifts move the mood by how much', () => {
    const s = start('home', 'stranger');
    const who = s.visit.residents[0]!.id;
    const m0 = s.visit.residents[0]!.mood;
    const small = run(s.visit, [{ t: 'gift', to: who, coin: 1 }]);
    const big = run(s.visit, [{ t: 'gift', to: who, coin: 25 }]);
    expect(small.v.residents[0]!.mood).toBeGreaterThan(m0);
    expect(big.v.residents[0]!.mood).toBeGreaterThan(small.v.residents[0]!.mood);
    expect(big.respect).toEqual([{ kind: 'gift', to: who, coin: 25 }]);
  });

  it('buying reports bought and resets the clock in a shop', () => {
    const s = start('shop', 'local');
    let r = run(s.visit, ticks(30));
    r = run(r.v, [{ t: 'bought', coin: 12 }]);
    expect(r.respect).toEqual([{ kind: 'bought', at: 'plaza:1,2', coin: 12 }]);
    expect(r.v.since).toBeCloseTo(r.v.t);
  });

  it('stealing unseen: stole, but you stay; caught: stole and thrown out', () => {
    const s = start('shop', 'local');
    const quiet = run(s.visit, [{ t: 'steal', coin: 10, caught: false }]);
    expect(quiet.respect).toEqual([{ kind: 'stole', at: 'plaza:1,2', coin: 10 }]);
    expect(quiet.v.out).toBeNull();
    const caught = run(s.visit, [{ t: 'steal', coin: 10, caught: true }]);
    expect(caught.v.out).toBe('caught');
    expect(caught.fx).toContainEqual({ t: 'out', why: 'caught' });
    expect(menu(caught.v, NO)).toEqual([]);
    // Steal only shows when nobody's looking
    expect(menu(s.visit, { ...NO, stealable: 3, watched: true }).some(a => a.a === 'steal')).toBe(
      false,
    );
    expect(menu(s.visit, { ...NO, stealable: 3 }).some(a => a.a === 'steal')).toBe(true);
    expect(caughtChance(true, 0)).toBe(1);
    expect(caughtChance(false, 1)).toBeLessThan(0.5);
  });

  it('overstaying: a hint, then overstayed, then shown out', () => {
    const s = start('home', 'stranger');
    const welcome = s.visit.welcome;
    const r = run(s.visit, ticks(welcome + HINT_GRACE + SHOW_OUT + 3));
    expect(r.respect.some(e => e.kind === 'overstayed')).toBe(true);
    expect(r.respect.filter(e => e.kind === 'overstayed')).toHaveLength(1);
    expect(r.v.out).toBe('kicked');
    expect(r.fx).toContainEqual({ t: 'out', why: 'kicked' });
  });

  it('leaving after the hint but before the grace is fine', () => {
    const s = start('home', 'local');
    const r = run(s.visit, [...ticks(s.visit.welcome + 2), { t: 'leave' }]);
    expect(r.v.hintedAt).not.toBeNull();
    expect(r.respect.some(e => e.kind === 'overstayed')).toBe(false);
  });

  it('the menu offers what fits the moment', () => {
    const s = start('cafe', 'local');
    const who = s.visit.residents[0]!.id;
    const m = menu(s.visit, { ...NO, near: who, seat: 2, canBuy: true });
    expect(m.map(a => a.a)).toEqual(['sit', 'chat', 'gift', 'buy', 'leave']);
    const g = m.find(a => a.a === 'gift') as { amounts: number[] };
    expect(g.amounts).toEqual([1, 5, 25]);
  });

  it('tiers change prices: legends get a discount', () => {
    const espresso = menuOf('cafe')[0]!;
    expect(discounted(espresso.price, 'legend')).toBeLessThanOrEqual(espresso.price);
    expect(discounted(20, 'legend')).toBe(15);
    expect(discounted(20, 'stranger')).toBe(20);
    expect(discounted(20, 'outcast')).toBe(25);
    expect(discounted(1, 'legend')).toBe(1);
  });

  it('is deterministic with the same rng', () => {
    const a = run(start().visit, ticks(90, 'plaza:1,2#0'), mulberry32(3));
    const b = run(start().visit, ticks(90, 'plaza:1,2#0'), mulberry32(3));
    expect(a.fx).toEqual(b.fx);
  });
});

describe('residents', () => {
  it('1–4 per place, an owner in public places, same people every time', () => {
    for (const kind of ['home', 'cafe', 'shop', 'bar', 'gym'] as const) {
      const l = generateLayout({ id: `x:${kind}`, kind, frontage: 12, depth: 12 });
      const a = residentsFor(`x:${kind}`, l, 'local');
      const b = residentsFor(`x:${kind}`, l, 'legend');
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(4);
      expect(a.map(r => [r.id, r.name, r.seed])).toEqual(b.map(r => [r.id, r.name, r.seed]));
      if (kind !== 'home') expect(a[0]!.role).toBe('owner');
      // The owner starts at the owner's spot
      if (kind === 'shop' || kind === 'cafe' || kind === 'bar')
        expect(l.spots[a[0]!.home]!.owner).toBe(true);
      expect(b[0]!.mood).toBeGreaterThan(a[0]!.mood);
    }
  });
});

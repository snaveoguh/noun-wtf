import { describe, expect, it } from 'vitest';

import { TOWN_SPECS } from '../../trade/towns';
import { decodeTaxi, encodeTaxi, taxiTag } from '../net/wire';

import { PLAZA_SPOTS, registerBuiltins, townDestinations, landmarkDestinations } from './builtin';
import { allDestinations, registerDestinations, type Destination } from './destinations';
import { FARES, mulberry, pickDestination } from './fares';
import { canPickUp, HITCH, hitchSlot, slotsNear, townsOn } from './hitch';
import { LineGate, lineFor } from './lines';
import { allowance, baseFare, dropPay, maxPay, styleCap } from './pay';
import { alleyEnds, locate, routeTo, RouteCursor, needsReroute } from './route';
import { foldBests, parseBests, Shift, SHIFT } from './shift';
import { nearMisses, StyleMeter, STYLE } from './style';

registerBuiltins();

const town = (id: string) => allDestinations().find(d => d.id === `town:${id}`)!;

describe('destinations registry', () => {
  it('has every trade town (from TOWN_SPECS), the landmarks and the plaza spots', () => {
    const ids = new Set(allDestinations().map(d => d.id));
    for (const t of Object.values(TOWN_SPECS))
      if (t.track !== 0) expect(ids.has(`town:${t.id}`)).toBe(true);
    expect(landmarkDestinations().length).toBeGreaterThanOrEqual(5);
    for (const s of PLAZA_SPOTS) expect(ids.has(s.id)).toBe(true);
  });

  it('places towns on their line, about their distance out', () => {
    for (const d of townDestinations()) {
      const spec = TOWN_SPECS[d.area as keyof typeof TOWN_SPECS];
      expect(d.track).toBe(spec.track);
      const r = Math.hypot(d.x, d.z);
      // the lines meander, so straight-line distance is somewhat under along-track
      expect(r).toBeGreaterThan(spec.s * 0.5);
      expect(r).toBeLessThan(spec.s + 2000);
      expect(locate(d.x, d.z).kind).toBe('line');
    }
  });

  it('takes new sources (a town another part adds), first id wins, a broken source is skipped', () => {
    const extra: Destination = {
      id: 'town:gasstop',
      name: 'GAS STOP',
      icon: '⛽',
      kind: 'town',
      x: 500,
      z: -24,
      area: 'city',
      track: 2,
      s: 400,
      r: 15,
    };
    const off = registerDestinations('test-extra', () => [extra, { ...extra, name: 'DUPE' }]);
    const off2 = registerDestinations('test-broken', () => {
      throw new Error('nope');
    });
    const hits = allDestinations().filter(d => d.id === 'town:gasstop');
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('GAS STOP');
    off();
    off2();
    expect(allDestinations().some(d => d.id === 'town:gasstop')).toBe(false);
  });
});

describe('routing', () => {
  it('a city hop goes round the ring road and ends at the stop', () => {
    const a = PLAZA_SPOTS.find(s => s.id === 'spot:mountain')!;
    const b = PLAZA_SPOTS.find(s => s.id === 'spot:godown')!;
    const r = routeTo(a.x, a.z, b);
    expect(r.road).toBe(false);
    // half the ring at most (the short way), and at least the straight line
    expect(r.length).toBeGreaterThanOrEqual(Math.hypot(b.x - a.x, b.z - a.z) - 1);
    expect(r.length).toBeLessThan(4 * 2 * 63.6 * 0.5 + 40);
    // every point is on the ring band (or the ends)
    for (let i = 1; i < r.xs.length - 1; i++) {
      const m = Math.max(Math.abs(r.xs[i]), Math.abs(r.zs[i]));
      expect(m).toBeGreaterThan(56);
      expect(m).toBeLessThan(71);
    }
    expect(r.xs[r.xs.length - 1]).toBe(b.x);
  });

  it('a long haul leaves through the right alley and runs down the line to the town', () => {
    const d = town('cowboy');
    const r = routeTo(0, -61, d);
    expect(r.road).toBe(true);
    const ends = alleyEnds(d.track! - 1);
    // passes the alley's exit
    let near = Infinity;
    for (let i = 0; i < r.xs.length; i++)
      near = Math.min(near, Math.hypot(r.xs[i] - ends.exit.x, r.zs[i] - ends.exit.z));
    expect(near).toBeLessThan(1);
    // the route is the line: about the town's along-track distance plus the plaza bit
    expect(r.length).toBeGreaterThan(d.s!);
    expect(r.length).toBeLessThan(d.s! + 400);
    // no step is a jump
    for (let i = 1; i < r.xs.length; i++)
      expect(Math.hypot(r.xs[i] - r.xs[i - 1], r.zs[i] - r.zs[i - 1])).toBeLessThan(45);
  });

  it('from one line to another goes back up through the city', () => {
    const jersey = town('jersey');
    const cowboy = town('cowboy');
    const r = routeTo(cowboy.x, cowboy.z, jersey);
    // passes through the plaza square
    let minR = Infinity;
    for (let i = 0; i < r.xs.length; i++)
      minR = Math.min(minR, Math.max(Math.abs(r.xs[i]), Math.abs(r.zs[i])));
    expect(minR).toBeLessThan(70);
    expect(r.length).toBeGreaterThan(cowboy.s! + jersey.s! - 500);
  });

  it('down the same line is just the line', () => {
    const cowboy = town('cowboy');
    const beach = town('beach');
    const r = routeTo(cowboy.x, cowboy.z, beach);
    expect(Math.abs(r.length - (beach.s! - cowboy.s!))).toBeLessThan(60);
  });

  it('cursor tracks progress and distance left; re-route when well off', () => {
    const d = town('cowboy');
    const r = routeTo(0, -61, d);
    const c = new RouteCursor(r);
    c.update(r.xs[0], r.zs[0]);
    expect(c.left).toBeCloseTo(r.length, 0);
    const mid = Math.floor(r.xs.length / 2);
    for (let i = 0; i <= mid; i += 20) c.update(r.xs[i], r.zs[i]);
    c.update(r.xs[mid], r.zs[mid]);
    expect(c.off).toBeLessThan(0.5);
    expect(c.left).toBeCloseTo(r.length - r.cum[mid], 0);
    const ahead = c.pointAhead(100, { x: 0, z: 0 });
    expect(Math.hypot(ahead.x - r.xs[mid], ahead.z - r.zs[mid])).toBeGreaterThan(60);
    expect(needsReroute(10, 5)).toBe(false);
    expect(needsReroute(60, 3)).toBe(true);
    expect(needsReroute(200, 0)).toBe(true);
  });
});

describe('fares', () => {
  it('city fares mostly hop, sometimes go far; never to where they stand', () => {
    const all = allDestinations();
    const rand = mulberry(7);
    let far = 0;
    for (let i = 0; i < 400; i++) {
      const d = pickDestination(66, -24, 'city', null, all, rand)!;
      expect(d).not.toBeNull();
      if (d.area === 'city') {
        const m = Math.hypot(d.x - 66, d.z + 24);
        expect(m).toBeGreaterThanOrEqual(FARES.hopMin);
      } else far++;
    }
    expect(far / 400).toBeGreaterThan(FARES.longHaul * 0.6);
    expect(far / 400).toBeLessThan(FARES.longHaul * 1.5);
  });

  it('town fares go somewhere else', () => {
    const all = allDestinations();
    const rand = mulberry(3);
    const cowboy = town('cowboy');
    for (let i = 0; i < 100; i++) {
      const d = pickDestination(
        cowboy.x,
        cowboy.z,
        'cowboy',
        { track: 2, s: cowboy.s! },
        all,
        rand,
      )!;
      expect(d.area).not.toBe('cowboy');
    }
  });

  it('price, clock and pay', () => {
    expect(baseFare(0, 'fare')).toBe(6);
    expect(baseFare(11_500, 'fare')).toBe(98);
    expect(baseFare(11_500, 'hitch')).toBeLessThan(baseFare(11_500, 'fare') / 2);
    expect(styleCap(1000, 'hitch')).toBe(0);
    // a city hop gets a city pace, a long haul the open road's
    expect(allowance(400, false)).toBeGreaterThan(30);
    expect(allowance(11_500, true)).toBeLessThan(11_500 / 30);
    const fast = dropPay(11_500, 'fare', 300, 100, 40);
    const slow = dropPay(11_500, 'fare', 300, 295, 40);
    expect(fast.grade).toBe('S');
    expect(slow.grade).toBe('C');
    expect(fast.total).toBeGreaterThan(slow.total);
    expect(fast.bonusTime).toBeGreaterThan(slow.bonusTime);
    // nothing ever pays over maxPay (the ledger's cap)
    for (const m of [0, 300, 5000, 30_000])
      for (const kind of ['fare', 'hitch'] as const) {
        const p = dropPay(m, kind, 100, 0, 1e9);
        expect(p.total).toBeLessThanOrEqual(maxPay(m, kind));
      }
  });
});

describe('style tips', () => {
  it('chains stunts into a combo and caps the tips', () => {
    const s = new StyleMeter(30);
    const a = s.nearMiss(0);
    expect(a.mult).toBe(1);
    const b = s.air(1.5, 1)!;
    expect(b.mult).toBe(2);
    expect(b.label).toMatch(/BIG AIR 1.5s ×2/);
    expect(s.drift(0.3, 2)).toBeNull();
    const c = s.drift(2, 2.5)!;
    expect(c.mult).toBe(3);
    // out of the window: back to ×1
    expect(s.nearMiss(20).mult).toBe(1);
    for (let i = 0; i < 20; i++) s.air(3, 21 + i);
    expect(s.tips).toBe(30);
    expect(s.bestChain).toBeGreaterThanOrEqual(5);
    expect(s.mult).toBe(STYLE.maxMult);
  });

  it('a crash breaks the chain and costs tips', () => {
    const s = new StyleMeter();
    s.air(2, 0);
    s.air(2, 1);
    const before = s.tips;
    expect(s.crash(4, 2)).toBeNull();
    const c = s.crash(12, 2)!;
    expect(c.points).toBeLessThan(0);
    expect(s.tips).toBe(before + c.points);
    expect(s.nearMiss(2.5).mult).toBe(1);
  });

  it('near misses: close, fast, once per cooldown, never on a crash', () => {
    const cool = new Map<string, number>();
    const car = { x: 0, z: 0, vx: 0, vz: 30 };
    const things = [
      { id: 'a', x: 3, z: 0, vx: 0, vz: 0 },
      { id: 'b', x: 10, z: 0, vx: 0, vz: 0 },
      { id: 'c', x: -2, z: 1, vx: 0, vz: 28 },
    ];
    expect(nearMisses(car, things, false, 0, cool)).toEqual(['a']);
    expect(nearMisses(car, things, false, 1, cool)).toEqual([]);
    expect(nearMisses(car, things, false, 3, cool)).toEqual(['a']);
    expect(nearMisses(car, things, true, 10, cool)).toEqual([]);
  });
});

describe('shift', () => {
  const dest = PLAZA_SPOTS[0];
  it('starts on the first fare, clock waits while they ride, drop gives time back', () => {
    const s = new Shift();
    expect(s.tick(5, 0)).toEqual([]);
    s.board({ id: 'f1', kind: 'fare', name: 'MO', dest, metres: 400, from: 'city', road: false });
    expect(s.on).toBe(true);
    s.tick(10, 80);
    expect(s.clock).toBe(SHIFT.start);
    const pay = s.drop()!;
    expect(pay.total).toBeGreaterThan(baseFare(400, 'fare'));
    expect(s.clock).toBe(SHIFT.start + pay.bonusTime);
    expect(s.totals.fares).toBe(1);
    expect(s.totals.topKmh).toBe(80);
  });

  it('a fare whose clock runs out bails; the shift ends at 0 with the cab empty', () => {
    const s = new Shift();
    const r = s.board({
      id: 'f1',
      kind: 'fare',
      name: 'MO',
      dest,
      metres: 400,
      from: 'city',
      road: false,
    });
    const ev = s.tick(r.allow + 0.1, 0);
    expect(ev[0]).toMatchObject({ t: 'bail' });
    expect(s.ride).toBeNull();
    expect(s.clock).toBe(SHIFT.start - SHIFT.bailCost);
    let over = null;
    for (let i = 0; i < 200 && over === null; i++) {
      const e = s.tick(0.5, 0);
      over = e.find(x => x.t === 'over') ?? null;
    }
    expect(over).not.toBeNull();
    expect(s.on).toBe(false);
  });

  it('local bests fold', () => {
    const b = parseBests('{"coin":50,"fares":2}');
    expect(b).toEqual({ coin: 50, fares: 2, longest: 0, bestChain: 0 });
    expect(parseBests('nope').coin).toBe(0);
    const t = { ...new Shift().totals, coin: 80, fares: 1, longest: 1200.4, bestChain: 3 };
    const f = foldBests(b, t);
    expect(f.beat).toEqual(['coin', 'longest', 'bestChain']);
    expect(f.bests.longest).toBe(1200);
  });
});

describe('hitchhikers', () => {
  it('are deterministic, spaced, clear of towns, and head somewhere real', () => {
    for (const track of [1, 2, 3]) {
      const towns = townsOn(track);
      const list = slotsNear(track, 20_000, 20_000);
      expect(list.length).toBeGreaterThan(5);
      for (const h of list) {
        expect(h.s).toBeGreaterThanOrEqual(HITCH.first - HITCH.jitter);
        for (const t of towns)
          expect(Math.abs(t.mid - h.s)).toBeGreaterThanOrEqual(HITCH.townClear);
        if (h.to !== 'city') {
          const t = TOWN_SPECS[h.to];
          expect(t.track).toBe(track);
          expect(t.s + 120).toBeGreaterThan(h.s);
        }
        expect(hitchSlot(track, h.k)).toEqual(h);
      }
      // sorted nearest first
      const near = slotsNear(track, 5000, 1500);
      for (let i = 1; i < near.length; i++)
        expect(Math.abs(near[i].s - 5000)).toBeGreaterThanOrEqual(Math.abs(near[i - 1].s - 5000));
    }
  });

  it('get in only when you stop beside them with a seat free', () => {
    expect(canPickUp(5, 1, true, false)).toBe(true);
    expect(canPickUp(5, 10, true, false)).toBe(false);
    expect(canPickUp(20, 1, true, false)).toBe(false);
    expect(canPickUp(5, 1, false, false)).toBe(false);
    expect(canPickUp(5, 1, true, true)).toBe(false);
  });
});

describe('lines + wire', () => {
  it('lines fill in the destination; the gate spaces chatter but lets the big ones through', () => {
    expect(lineFor('greet', 'DRY GULCH', () => 0)).toContain('DRY GULCH');
    const g = new LineGate();
    expect(g.allow('fast', 0)).toBe(true);
    expect(g.allow('air', 1)).toBe(false);
    expect(g.allow('bail', 1.2)).toBe(true);
    expect(g.allow('air', 6)).toBe(true);
  });

  it('tx round-trips and rejects junk', () => {
    const w = encodeTaxi({ state: 1, dest: 'Dry Gulch 🤠' });
    expect(w).toEqual([1, 'DRY GULCH ']);
    expect(decodeTaxi(w)).toEqual({ state: 1, dest: 'DRY GULCH ' });
    expect(decodeTaxi([3, ''])).toBeNull();
    expect(decodeTaxi([1, '<script>'])).toBeNull();
    expect(decodeTaxi('x')).toBeNull();
    expect(taxiTag({ state: 0, dest: '' })).toBe('🚕 FOR HIRE');
    expect(taxiTag({ state: 2, dest: 'PUERTO NOUN' })).toBe('👍 → PUERTO NOUN');
  });
});

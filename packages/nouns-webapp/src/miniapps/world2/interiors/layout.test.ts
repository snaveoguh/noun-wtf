import type { InteriorKind } from './contract';

import { describe, expect, it } from 'vitest';

import {
  boxesOverlap,
  doorKeepOut,
  entryPoint,
  generateLayout,
  itemBox,
  layoutGrid,
  turn,
  type ItemType,
  type Layout,
} from './layout';
import { INTERIOR_KINDS } from './names';

const IDS = Array.from({ length: 24 }, (_, i) => `plaza:${(i * 7.3).toFixed(1)},${i % 5}`);
const SIZES: [number, number, number][] = [
  [8, 8, 3],
  [16, 16, 14],
  [12.6, 12, 4.6],
  [6, 7, 3],
  [20, 14, 10],
];

function all(): Layout[] {
  const out: Layout[] = [];
  for (const kind of INTERIOR_KINDS)
    IDS.forEach((id, i) => {
      const [frontage, depth, height] = SIZES[i % SIZES.length]!;
      out.push(generateLayout({ id, kind, frontage, depth, height }));
    });
  return out;
}

const layouts = all();

/** What every kind must have in it. */
const MUST: Record<InteriorKind, ItemType[][]> = {
  home: [['sofa'], ['kitchen'], ['bed']],
  cafe: [['counter'], ['cafe_table']],
  shop: [['counter'], ['shelf', 'gondola']],
  bar: [['counter'], ['stool']],
  studio: [['decks'], ['record_shelf']],
  gallery: [['plinth'], ['bench'], ['desk']],
  arcade: [['cabinet']],
  barber: [['barber_chair'], ['bench']],
  laundromat: [['washer'], ['folding_table']],
  gym: [['treadmill', 'weight_bench']],
};

describe('layout generator', () => {
  it('is deterministic: the same door gives the same room', () => {
    for (const kind of INTERIOR_KINDS) {
      const a = generateLayout({ id: 'town:cowboy:17.5,46', kind, frontage: 12, depth: 14 });
      const b = generateLayout({ id: 'town:cowboy:17.5,46', kind, frontage: 12, depth: 14 });
      expect(b).toEqual(a);
    }
    const c = generateLayout({ id: 'other', kind: 'home', frontage: 12, depth: 14 });
    const d = generateLayout({ id: 'other2', kind: 'home', frontage: 12, depth: 14 });
    expect(c).not.toEqual(d);
  });

  it('furniture never overlaps', () => {
    for (const l of layouts) {
      const solid = l.items.filter(i => i.solid);
      for (let i = 0; i < solid.length; i++)
        for (let j = i + 1; j < solid.length; j++)
          expect(
            boxesOverlap(itemBox(solid[i]!), itemBox(solid[j]!), -0.01),
            `${l.kind} ${l.id}: ${solid[i]!.type} × ${solid[j]!.type}`,
          ).toBe(false);
    }
  });

  it('everything stays inside the room', () => {
    for (const l of layouts)
      for (const it of l.items) {
        const b = itemBox(it);
        expect(b.minX).toBeGreaterThanOrEqual(-l.w / 2 - 1e-6);
        expect(b.maxX).toBeLessThanOrEqual(l.w / 2 + 1e-6);
        expect(b.minZ).toBeGreaterThanOrEqual(-1e-6);
        expect(b.maxZ).toBeLessThanOrEqual(l.d + 1e-6);
        expect(it.h).toBeLessThan(l.h);
      }
  });

  it('nothing blocks the door', () => {
    for (const l of layouts) {
      const keep = doorKeepOut(l);
      for (const it of l.items)
        expect(boxesOverlap(itemBox(it), keep), `${l.kind} ${it.type}`).toBe(false);
    }
  });

  it('every seat (and every spot residents use) is reachable from the door', () => {
    for (const l of layouts) {
      const g = layoutGrid(l);
      const [ex, ez] = entryPoint(l);
      const seen = g.flood(ex, ez);
      expect(g.reached(seen, ex, ez)).toBe(true);
      for (const s of l.seats)
        expect(g.reached(seen, s.ax, s.az), `${l.kind} ${l.id} seat @${s.ax},${s.az}`).toBe(true);
      for (const s of l.spots)
        if (s.owner !== true)
          expect(g.reached(seen, s.x, s.z), `${l.kind} ${l.id} ${s.kind}`).toBe(true);
      // …and a path leads there
      for (const s of l.seats.slice(0, 3)) expect(g.path(ex, ez, s.ax, s.az)).not.toBeNull();
    }
  });

  it('every kind gets its furniture, a seat, and somewhere to stand', () => {
    for (const l of layouts) {
      const types = new Set(l.items.map(i => i.type));
      for (const any of MUST[l.kind])
        expect(
          any.some(t => types.has(t)),
          `${l.kind} ${l.id} lacks ${any.join('/')}: ${[...types].join(',')}`,
        ).toBe(true);
      expect(l.seats.length, `${l.kind} ${l.id}`).toBeGreaterThan(0);
      expect(l.spots.length).toBeGreaterThan(1);
      expect(l.decor.some(d => d.type === 'window')).toBe(true);
    }
  });

  it('shops, cafes and bars have someone behind the counter', () => {
    for (const l of layouts)
      if (l.kind === 'shop' || l.kind === 'cafe' || l.kind === 'bar')
        expect(l.spots.some(s => s.owner === true)).toBe(true);
  });

  it('rooms are rich: plenty of furniture and wall decor', () => {
    for (const l of layouts) {
      expect(l.items.length, `${l.kind} ${l.id}`).toBeGreaterThanOrEqual(6);
      expect(l.decor.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('homes have a bedroom behind a partition with a doorway', () => {
    for (const l of layouts.filter(q => q.kind === 'home')) {
      expect(l.partitions.length).toBe(1);
      const bed = l.items.find(i => i.type === 'bed')!;
      expect(bed.z).toBeGreaterThan(l.partitions[0]!.at);
    }
  });

  it('turn() is three.js yaw', () => {
    // A quarter turn (yaw π/2) takes local +z (front) to world +x
    const [x, z] = turn(0, 1, 1);
    expect(x).toBeCloseTo(Math.sin(Math.PI / 2));
    expect(z).toBeCloseTo(Math.cos(Math.PI / 2));
  });
});

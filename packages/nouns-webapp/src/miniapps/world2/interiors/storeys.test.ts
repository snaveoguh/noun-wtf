import type { InteriorKind } from './contract';

import { describe, expect, it } from 'vitest';

import {
  boxesOverlap,
  entryPoint,
  footLanding,
  generateLayout,
  headLanding,
  itemBox,
  layoutGrid,
  planBuilding,
  type Layout,
} from './layout';
import { INTERIOR_KINDS } from './names';
import { LANDING, STAIR_SLOPE, buildingStairs, storeyCount, upperUse } from './storeys';

/** Every floor of a building (as goIn makes them). */
function building(id: string, kind: InteriorKind, frontage: number, depth: number, height: number) {
  const base = { id, kind, frontage, depth, height };
  const plan = planBuilding(base);
  const floors: Layout[] = plan.floors.map((st, level) =>
    level === 0
      ? generateLayout({
          ...base,
          ...(plan.floors.length > 1 ? { size: plan.size, level: 0, stairs: st } : {}),
        })
      : generateLayout({
          ...base,
          size: plan.size,
          level,
          stairs: st,
          use: upperUse(kind, level, id),
          roof: level === plan.floors.length - 1,
        }),
  );
  return { plan, floors };
}

const centre = (b: {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}): [number, number] => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];

const BUILDINGS: [string, InteriorKind, number, number, number][] = [];
for (const kind of INTERIOR_KINDS)
  for (let i = 0; i < 8; i++)
    BUILDINGS.push([
      `up:${kind}:${i}`,
      kind,
      10 + (i % 3) * 3,
      11 + (i % 4) * 2,
      7 + (i % 4) * 3.5,
    ]);

describe('upstairs', { timeout: 600_000 }, () => {
  it('about one storey per 3.5 m, at most 3; big shops, cafes, homes, studios and galleries get 2', () => {
    expect(storeyCount('bar', 3, 8, 8)).toBe(1);
    expect(storeyCount('bar', 7, 8, 8)).toBe(2);
    expect(storeyCount('bar', 30, 8, 8)).toBe(3);
    expect(storeyCount('home', 3, 10, 9)).toBe(2);
    expect(storeyCount('gym', 3, 10, 9)).toBe(1);
  });

  it('flights alternate sides, climb walkably, and fit with their landings', () => {
    for (const [id, kind, f, d, h] of BUILDINGS) {
      const { plan } = building(id, kind, f, d, h);
      const st = plan.floors;
      for (let i = 0; i + 1 < st.length; i++) {
        const up = st[i]!.up!;
        expect(st[i + 1]!.down).toEqual(up);
        expect(up.rise / (up.z1 - up.z0)).toBeCloseTo(STAIR_SLOPE);
        expect(up.z0 - LANDING).toBeGreaterThanOrEqual(0);
        expect(up.z1 + LANDING).toBeLessThanOrEqual(plan.size.d);
        if (i > 0) expect(up.side).not.toBe(st[i - 1]!.up!.side);
      }
      expect(st[st.length - 1]!.up).toBeNull();
    }
    // A room too shallow for a flight stays one storey
    expect(buildingStairs('home', 20, 9, 6, 3.4, 'shallow')).toHaveLength(1);
  });

  it('every floor: stairs reachable from where you come in, nothing on the stairs or landings', () => {
    let multi = 0;
    for (const [id, kind, f, d, h] of BUILDINGS) {
      const { floors } = building(id, kind, f, d, h);
      if (floors.length > 1) multi++;
      floors.forEach((l, level) => {
        const g = layoutGrid(l);
        const [ex, ez] = entryPoint(l);
        const seen = g.flood(ex, ez);
        expect(g.reached(seen, ex, ez), `${id} floor ${level}: entry`).toBe(true);
        const st = l.stairs;
        if (st?.up != null) {
          const [fx, fz] = centre(footLanding(st.up));
          expect(g.reached(seen, fx, fz), `${id} floor ${level}: foot of the stairs up`).toBe(true);
        }
        if (st?.down != null) {
          const [hx, hz] = centre(headLanding(st.down));
          expect(g.reached(seen, hx, hz), `${id} floor ${level}: head of the stairs`).toBe(true);
        }
        // Every seat and resident spot on the floor is reachable from there
        for (const s of l.seats)
          expect(g.reached(seen, s.ax, s.az), `${id} ${level} seat`).toBe(true);
        for (const s of l.spots)
          if (s.owner !== true)
            expect(g.reached(seen, s.x, s.z), `${id} ${level} ${s.kind}`).toBe(true);
        // Nothing on a flight, a stairwell or a landing
        const kept = l.items.filter(
          it => it.type === 'stairs' || it.type === 'stairwell' || it.type === 'landing',
        );
        for (const it of l.items) {
          if (kept.includes(it)) continue;
          for (const k of kept)
            expect(
              boxesOverlap(itemBox(it), itemBox(k)),
              `${id} floor ${level}: ${it.type} on the ${k.type}`,
            ).toBe(false);
        }
        // Upstairs: no street door; top floor: a way onto the roof
        if (level > 0) expect(l.door.width).toBe(0);
        if (floors.length > 1 && level === floors.length - 1)
          expect(
            l.items.some(it => it.type === 'roof_ladder'),
            `${id}: roof ladder`,
          ).toBe(true);
      });
    }
    expect(multi).toBeGreaterThan(BUILDINGS.length / 2);
  });

  it('a game room upstairs has a pool table', () => {
    let rooms = 0;
    for (const [id, kind, f, d, h] of BUILDINGS) {
      const { floors } = building(id, kind, f, d, h);
      for (const l of floors.slice(1))
        if (l.use === 'gameroom') {
          rooms++;
          expect(
            l.items.some(it => it.type === 'pool_table'),
            id,
          ).toBe(true);
        }
    }
    expect(rooms).toBeGreaterThan(0);
  });
});

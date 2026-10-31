import type { BuildingDoor, RespectEvent } from './contract';

import { describe, expect, it } from 'vitest';

import { buildingFloors, firstSpawnInside, isSpawnHome, pickSpawnHome } from './firstSpawn';
import { generateLayout, planBuilding } from './layout';
import { residentsFor } from './residents';
import { mulberry32 } from './rng';
import { upperUse } from './storeys';
import { arrive, asHouseGuest, HINT_GRACE, SHOW_OUT, step, type Visit } from './visit';

/** A plaza door on a building `w` × `d` × `h` (door in its south wall, facing −z). */
function door(id: string, w: number, d: number, h: number, over: Partial<BuildingDoor> = {}) {
  const x = (id.length * 7) % 40;
  return {
    id,
    area: 'plaza',
    x,
    y: 0,
    z: 0,
    yaw: Math.PI,
    width: 1.2,
    footprint: { minX: x - w / 2, maxX: x + w / 2, minZ: 0, maxZ: d, height: h },
    kind: 'home',
    ...over,
  } satisfies BuildingDoor;
}

const TALL = Array.from({ length: 10 }, (_, i) =>
  door(`plaza:tall${i}`, 11 + (i % 3), 12 + (i % 4), 9),
);

describe('when the first spawn is upstairs', () => {
  it('a plain /world load (and the test flags) starts inside', () => {
    expect(firstSpawnInside('')).toBe(true);
    expect(firstSpawnInside('?offline=1&skip=1&q=low&bday=0')).toBe(true);
    expect(firstSpawnInside('?seed=1-2-3-4-5&name=bob&debug')).toBe(true);
  });

  it('deep links and modes that set their own spawn skip it, and ?spawn=plaza opts out', () => {
    for (const q of [
      '?play=hoops&mode=3',
      '?play=parkour',
      '?play=pool',
      '?play=breaks',
      '?drop=1',
      '?mode=2',
      '?spot=nj',
      '?megaramp=1',
      '?town=cowboy',
      '?offline=1&skip=1&spawn=plaza',
    ])
      expect(firstSpawnInside(q), q).toBe(false);
  });
});

describe('which home you wake up in', () => {
  it('only plaza homes with a street door and a footprint qualify', () => {
    expect(isSpawnHome(door('plaza:a', 12, 12, 9))).toBe(true);
    expect(isSpawnHome(door('plaza:a', 12, 12, 9, { kind: undefined }))).toBe(true);
    expect(isSpawnHome(door('plaza:a', 12, 12, 9, { kind: 'cafe' }))).toBe(false);
    expect(isSpawnHome(door('plaza:a', 12, 12, 9, { area: 'jersey' }))).toBe(false);
    expect(isSpawnHome(door('plaza:a#roof', 12, 12, 9))).toBe(false);
    expect(isSpawnHome({ ...door('plaza:a', 12, 12, 9), footprint: undefined })).toBe(false);
  });

  it('the top floor of a home with an upstairs, on a seat by a roof hatch', () => {
    const pick = pickSpawnHome(TALL, mulberry32(3));
    expect(pick).not.toBeNull();
    const { floors } = buildingFloors(pick!.door);
    expect(floors.length).toBeGreaterThan(1);
    expect(pick!.level).toBe(floors.length - 1);
    const top = floors[pick!.level]!;
    expect(top.items.some(it => it.type === 'roof_ladder')).toBe(true);
    const seat = top.seats[pick!.seat]!;
    expect(seat).toBeDefined();
    // The end of the bed when there's one up there
    if (top.seats.some(s => top.items[s.item]?.type === 'bed'))
      expect(top.items[seat.item]!.type).toBe('bed');
  });

  it('lays out the same floors goIn always has (same seat indices)', () => {
    for (const d of [TALL[0]!, TALL[5]!, door('plaza:low', 5, 5, 2)]) {
      // goIn's own recipe, as it was inline (frontage along the door wall)
      const fp = d.footprint;
      const base = {
        id: d.id,
        kind: 'home' as const,
        frontage: fp.maxX - fp.minX,
        depth: fp.maxZ - fp.minZ,
        height: fp.height,
      };
      const plan = planBuilding(base);
      const multi = plan.floors.length > 1;
      const want = [
        generateLayout({
          ...base,
          ...(multi ? { size: plan.size, level: 0, stairs: plan.floors[0]! } : {}),
        }),
        ...plan.floors.slice(1).map((st, i) =>
          generateLayout({
            ...base,
            size: plan.size,
            level: i + 1,
            stairs: st,
            use: upperUse('home', i + 1, d.id),
            roof: i + 1 === plan.floors.length - 1,
          }),
        ),
      ];
      const got = buildingFloors(d);
      expect(got.floors).toEqual(want);
      expect(got.size).toEqual(plan.size);
    }
  });

  it('not always the same one', () => {
    const ids = new Set<string>();
    for (let s = 1; s <= 20; s++) ids.add(pickSpawnHome(TALL, mulberry32(s))?.door.id ?? 'none');
    expect(ids.has('none')).toBe(false);
    expect(ids.size).toBeGreaterThan(3);
  });

  it('none when there are no homes, or the runtime turns them all down', () => {
    // (every home has an upstairs: their rooms are at least 8.5 m square)
    const low = Array.from({ length: 6 }, (_, i) => door(`plaza:low${i}`, 5, 5, 2));
    expect(low.every(d => buildingFloors(d).floors.length >= 2)).toBe(true);
    expect(pickSpawnHome(low, mulberry32(1))).not.toBeNull();
    // …so it's the other kinds that never qualify
    expect(
      pickSpawnHome(
        TALL.map(d => ({ ...d, kind: 'shop' as const })),
        mulberry32(1),
      ),
    ).toBeNull();
    expect(pickSpawnHome(TALL, mulberry32(1), () => false)).toBeNull();
    expect(pickSpawnHome([], mulberry32(1))).toBeNull();
  });

  it('skips the ones the runtime turns down (no real roof)', () => {
    const banned = new Set(TALL.slice(0, 9).map(d => d.id));
    const pick = pickSpawnHome(TALL, mulberry32(9), d => !banned.has(d.id));
    expect(pick?.door.id).toBe(TALL[9]!.id);
  });
});

describe('the spawn visit is neutral', () => {
  function guest(): { visit: Visit; rnd: () => number } {
    const id = 'plaza:tall0';
    const l = generateLayout({ id, kind: 'home', frontage: 12, depth: 12 });
    const rnd = mulberry32(5);
    const a = arrive(id, 'home', 'stranger', residentsFor(id, l, 'stranger'), rnd);
    return { visit: asHouseGuest(a.visit), rnd };
  }
  const respectOf = (fx: { t: string }[]) =>
    fx.filter((e): e is { t: 'respect'; e: RespectEvent } => e.t === 'respect').map(e => e.e.kind);

  it("sitting (and getting up and sitting again) is never a 'sat'", () => {
    const start = guest();
    const rnd = start.rnd;
    let visit = start.visit;
    const kinds: string[] = [];
    for (const ev of [{ t: 'sit', seat: 0 }, { t: 'stand' }, { t: 'sit', seat: 1 }] as const) {
      const r = step(visit, ev, rnd);
      visit = r.visit;
      kinds.push(...respectOf(r.effects));
    }
    expect(kinds).not.toContain('sat');
    expect(visit.sitting).toBe(1);
  });

  it("staying all day is never 'overstayed', and you're never shown out", () => {
    const start = guest();
    const rnd = start.rnd;
    let visit = start.visit;
    const kinds: string[] = [];
    const says: string[] = [];
    for (let i = 0; i < (3600 + HINT_GRACE + SHOW_OUT) * 2; i++) {
      const r = step(visit, { t: 'tick', dt: 0.5, near: null }, rnd);
      visit = r.visit;
      kinds.push(...respectOf(r.effects));
      for (const e of r.effects) if (e.t === 'out') says.push('out');
    }
    expect(kinds).not.toContain('overstayed');
    expect(says).toEqual([]);
    expect(visit.out).toBeNull();
    expect(visit.hintedAt).toBeNull();
  });

  it('a normal home visit still counts both (the guest pass is only for the spawn)', () => {
    const id = 'plaza:tall0';
    const l = generateLayout({ id, kind: 'home', frontage: 12, depth: 12 });
    const rnd = mulberry32(5);
    let visit = arrive(id, 'home', 'stranger', residentsFor(id, l, 'stranger'), rnd).visit;
    const kinds: string[] = [];
    let r = step(visit, { t: 'sit', seat: 0 }, rnd);
    kinds.push(...respectOf(r.effects));
    visit = r.visit;
    for (let i = 0; i < 2000; i++) {
      r = step(visit, { t: 'tick', dt: 0.5, near: null }, rnd);
      visit = r.visit;
      kinds.push(...respectOf(r.effects));
    }
    expect(kinds).toContain('sat');
    expect(kinds).toContain('overstayed');
  });
});

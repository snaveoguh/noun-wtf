// ── The first spawn: upstairs in a plaza home, sat down (pure, tested) ──
//
// A plain /world load starts you sat on a seat on the top floor of a
// house on the plaza (InteriorSystem.spawnUpstairs), with two ways out
// offered: up onto the roof or down to the front door. Deep links and
// modes (?play=, ?drop=1, ?spot=…) set their own spawn and skip it, and
// `?spawn=plaza` opts out. Everything here is pure: which URLs skip it,
// each floor's layout (the same ones goIn builds), and which home you
// wake up in.

import type { BuildingDoor, InteriorKind } from './contract';

import { generateLayout, planBuilding, type Layout } from './layout';
import { upperUse } from './storeys';

/** `?spawn=plaza`: start out on the plaza as before. */
export const SPAWN_PARAM = 'spawn';

/** Deep links / modes that put you somewhere themselves (or are dev scenes). */
const SETS_OWN_SPAWN = ['play', 'drop', 'mode', 'spot', 'megaramp', 'town', 'dressing'] as const;

/** Should a page with this query string start upstairs in a house? */
export function firstSpawnInside(search: string): boolean {
  const q = new URLSearchParams(search);
  if (q.get(SPAWN_PARAM) === 'plaza') return false;
  return !SETS_OWN_SPAWN.some(k => q.has(k));
}

/** A building's floors as goIn lays them out: the ground floor, then the uppers. */
export function buildingFloors(
  door: Pick<BuildingDoor, 'id' | 'kind' | 'yaw' | 'footprint'>,
  theme?: 'prop-museum',
): { kind: InteriorKind; size: { w: number; d: number; h: number }; floors: Layout[] } {
  const kind = door.kind ?? 'home';
  const fp = door.footprint;
  // Frontage along the door wall, depth into the building
  const along = Math.abs(Math.sin(door.yaw)) > 0.7;
  const frontage = fp === undefined ? undefined : along ? fp.maxZ - fp.minZ : fp.maxX - fp.minX;
  const depth = fp === undefined ? undefined : along ? fp.maxX - fp.minX : fp.maxZ - fp.minZ;
  const base = { id: door.id, kind, frontage, depth, height: fp?.height };
  const plan = planBuilding(base);
  const multi = plan.floors.length > 1;
  const ground = generateLayout({
    ...base,
    ...(theme !== undefined ? { theme } : {}),
    ...(multi ? { size: plan.size, level: 0, stairs: plan.floors[0]! } : {}),
  });
  const uppers = plan.floors.slice(1).map((st, i) =>
    generateLayout({
      ...base,
      size: plan.size,
      level: i + 1,
      stairs: st,
      use: upperUse(kind, i + 1, door.id),
      roof: i + 1 === plan.floors.length - 1,
    }),
  );
  return { kind, size: plan.size, floors: [ground, ...uppers] };
}

export interface SpawnPick {
  door: BuildingDoor;
  /** The top floor (≥ 1), with the roof hatch. */
  level: number;
  /** A seat on that floor (the end of a bed if there is one). */
  seat: number;
}

/** Could you wake up in this one? A plaza home with a street door (not a roof hatch). */
export function isSpawnHome(d: BuildingDoor): boolean {
  return (
    d.area === 'plaza' &&
    (d.kind ?? 'home') === 'home' &&
    !d.id.endsWith('#roof') &&
    d.footprint !== undefined
  );
}

/**
 * A home to wake up in, chosen at random (by `rnd`) among the plaza homes
 * whose top floor (level ≥ 1) has the roof hatch and somewhere to sit, and
 * that `ok` accepts (the runtime checks there's a real roof to climb onto).
 * Null when none does (then you start out on the plaza as before).
 */
export function pickSpawnHome(
  doors: readonly BuildingDoor[],
  rnd: () => number,
  ok: (d: BuildingDoor) => boolean = () => true,
  maxTries = 12,
): SpawnPick | null {
  const pool = doors.filter(isSpawnHome);
  // Fisher–Yates with the given rng, then the first that fits
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  let tries = 0;
  for (const door of pool) {
    if (tries++ >= maxTries) break;
    const { floors } = buildingFloors(door);
    if (floors.length < 2) continue;
    const level = floors.length - 1;
    const top = floors[level]!;
    if (!top.items.some(it => it.type === 'roof_ladder') || top.seats.length === 0) continue;
    if (!ok(door)) continue;
    const beds = top.seats
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => top.items[s.item]?.type === 'bed');
    const from = beds.length > 0 ? beds.map(b => b.i) : top.seats.map((_, i) => i);
    const seat = from[Math.floor(rnd() * from.length)] ?? 0;
    return { door, level, seat };
  }
  return null;
}

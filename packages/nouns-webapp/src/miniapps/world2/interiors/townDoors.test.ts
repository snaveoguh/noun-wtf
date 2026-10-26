import type { NjFrame } from '../world/mountain/nounJersey';

import { describe, expect, it } from 'vitest';

import { GROWN_TOWNS, LAYOUT, type GrownTown, type TownFrame } from '../towns/site';

import { reachable } from './doors';
import { NJ_BUILDINGS, njDoors, recordTown, townDoorPlanLocal } from './townDoors';

/** A town frame in town coords (enough for the builds: the pad, its length and sides). */
function frame(id: GrownTown): TownFrame {
  const L = LAYOUT[id];
  return {
    id,
    site: null as unknown as TownFrame['site'],
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    rx: 1,
    rz: 0,
    yaw: 0,
    side: 1,
    P: 0,
    Lf: 240,
    vmin: -L.near,
    vmax: L.far,
    lagoon: L.lagoon,
    x0: -400,
    z0: -400,
    x1: 400,
    z1: 400,
  };
}

describe('town doors', () => {
  for (const id of GROWN_TOWNS) {
    describe(id, () => {
      const f = frame(id);
      const rec = recordTown(id, f);
      const plan = townDoorPlanLocal(id, f, rec);
      const { doors, footprints } = plan;
      const byId = new Set(doors.map(d => d.id));
      if (process.env.DOORS_DEBUG === id) {
        for (const fp of footprints)
          console.log(
            'fp',
            fp.key,
            fp.minX.toFixed(1),
            fp.maxX.toFixed(1),
            fp.minZ.toFixed(1),
            fp.maxZ.toFixed(1),
            fp.height.toFixed(1),
            fp.sign,
          );
        for (const d of doors)
          console.log(
            'door',
            d.id,
            d.x.toFixed(1),
            d.z.toFixed(1),
            d.yaw.toFixed(2),
            d.name,
            d.kind,
          );
        console.log('forced', plan.forced, 'absorbed', [...plan.absorbed]);
        for (const s of rec.signs)
          console.log('sign', s.text, s.x.toFixed(1), s.y.toFixed(1), s.z.toFixed(1));
      }

      it('finds its buildings', () => {
        expect(footprints.length).toBeGreaterThanOrEqual(6);
      });

      it('every building gets a door (or shares the neighbour it is hidden behind)', () => {
        for (const fp of footprints) {
          const own = byId.has(`town:${id}:${fp.key}`);
          const via = plan.absorbed.get(fp.key);
          expect(own || (via !== undefined && byId.has(via)), fp.key).toBe(true);
        }
        expect(plan.forced.length).toBeLessThanOrEqual(Math.ceil(footprints.length * 0.1));
      });

      it('doors open toward main street and onto open ground', () => {
        const walk = reachable(
          footprints,
          { minX: f.vmin, maxX: f.vmax, minZ: 0, maxZ: f.Lf },
          { x: 0, z: f.Lf / 2 },
        );
        let streetSide = 0;
        for (const d of doors) {
          const nx = Math.sin(d.yaw);
          const nz = Math.cos(d.yaw);
          // Not inside any building: just outside the door is outside them all
          for (const fp of footprints)
            expect(
              d.x + nx * 0.4 > fp.minX + 0.02 &&
                d.x + nx * 0.4 < fp.maxX - 0.02 &&
                d.z + nz * 0.4 > fp.minZ + 0.02 &&
                d.z + nz * 0.4 < fp.maxZ - 0.02,
              d.id,
            ).toBe(false);
          if (plan.forced.includes(d.id.split(':').slice(2).join(':'))) continue;
          expect(walk(d.x + nx * 0.9, d.z + nz * 0.9), d.id).toBe(true);
          if (-Math.sign(d.x) * nx > 0.5) streetSide++;
        }
        // Most face the street (a few on a side street / round a corner)
        expect(streetSide / doors.length).toBeGreaterThan(0.6);
      });

      it('is the same every time', () => {
        const again = townDoorPlanLocal(id, f);
        expect(again.doors).toEqual(doors);
      });

      it('names come off the signs where there are any', () => {
        const named = doors.filter(d => d.name !== undefined && /^[\d &'.A-Z’-]+$/.test(d.name));
        if (rec.signs.length > 3) expect(named.length).toBeGreaterThan(0);
      });
    });
  }
});

describe('Noun Jersey doors', () => {
  // A park frame: Main St along +b, park to +a (side +1), straight down +Z
  const f: NjFrame = {
    site: null as unknown as NjFrame['site'],
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    rx: 1,
    rz: 0,
    yaw: 0,
    side: 1,
    P: 100,
    Lf: 240,
    vmin: -20,
    vmax: 150,
    x0: -500,
    z0: -500,
    x1: 500,
    z1: 500,
  };
  const doors = njDoors(f);

  it('one per building, facing Main St', () => {
    expect(doors.length).toBe(NJ_BUILDINGS.length);
    for (const d of doors) {
      // Main St is toward −a = −x here
      expect(Math.sin(d.yaw)).toBeLessThan(-0.99);
      expect(d.y).toBeGreaterThanOrEqual(100);
      // On the building's front face (its footprint's min x), just proud of it
      expect(d.x).toBeLessThan(d.footprint!.minX + 0.2);
      expect(d.x).toBeGreaterThan(d.footprint!.minX - 0.2);
      expect(d.z).toBeGreaterThan(d.footprint!.minZ);
      expect(d.z).toBeLessThan(d.footprint!.maxZ);
    }
    expect(new Set(doors.map(d => d.id)).size).toBe(doors.length);
  });
});

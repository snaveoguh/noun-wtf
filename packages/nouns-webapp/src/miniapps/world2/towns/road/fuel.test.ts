import { describe, expect, it } from 'vitest';

// (registers the natural surface the pads resolve against)
import '../../world/mountain/terrain';

import { townFrameNow, townToWorld } from '../site';

import { DIESEL_PUMPS } from './diesel';
import { FUEL, burn, fuelEnabled, pumpNear, refuel, throttleScale } from './fuel';
import { stationFrame, stationGround, stationToWorld } from './pads';
import { STATIONS } from './places';
import { pumpSpots } from './stations';

describe('fuel (optional)', () => {
  it('is off by default; ?fuel= wins over the saved choice', () => {
    expect(fuelEnabled('', null)).toBe(false);
    expect(fuelEnabled('?offline=1', null)).toBe(false);
    expect(fuelEnabled('?fuel=1', null)).toBe(true);
    expect(fuelEnabled('', '1')).toBe(true);
    expect(fuelEnabled('?fuel=0', '1')).toBe(false);
  });

  it('burns by distance, more boosting, never below empty', () => {
    expect(burn(FUEL.tank, 1000, false)).toBeCloseTo(FUEL.tank - FUEL.perKm, 6);
    expect(FUEL.tank - burn(FUEL.tank, 1000, true)).toBeCloseTo(FUEL.perKm * FUEL.boostMul, 6);
    expect(burn(0.2, 5000, false)).toBe(0);
    expect(burn(10, -50, false)).toBe(10);
  });

  it('an empty tank limps; filling up stops at a full tank', () => {
    expect(throttleScale(5)).toBe(1);
    expect(throttleScale(0)).toBe(FUEL.limp);
    expect(refuel(0, 1)).toBeCloseTo(FUEL.rate, 6);
    expect(refuel(FUEL.tank - 1, 10)).toBe(FUEL.tank);
  });

  it('a tank covers the longest gap between pumps on any line', () => {
    for (const track of [1, 2, 3]) {
      const s = STATIONS.filter(q => q.track === track && q.kind !== 'rest').map(q => q.s);
      if (track === 3) s.push(20_500);
      s.sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++)
        expect((s[i]! - s[i - 1]!) / 1000).toBeLessThan(FUEL.tank / FUEL.perKm);
    }
  });

  it('every gas station and truck stop has pumps on its forecourt, rest areas none', () => {
    for (const st of STATIONS) {
      const f = stationFrame(st.id, true)!;
      const spots = pumpSpots(f, st);
      if (st.kind === 'rest') expect(spots).toEqual([]);
      else expect(spots.length).toBeGreaterThanOrEqual(2);
      for (const p of spots) {
        expect(p.vp).toBeGreaterThan(f.vmin);
        expect(p.u).toBeGreaterThan(0);
        expect(p.u).toBeLessThan(f.Lf);
        const w = stationToWorld(f, p.vp, p.u, { x: 0, z: 0 });
        expect(pumpNear([w], w.x + 3, w.z)).not.toBeNull();
        expect(Number.isFinite(stationGround(f, p.u))).toBe(true);
      }
    }
    const df = townFrameNow('diesel')!;
    const w = townToWorld(df, DIESEL_PUMPS[0]!.vp, DIESEL_PUMPS[0]!.u, { x: 0, z: 0 });
    expect(pumpNear([w], w.x, w.z + FUEL.reach + 1)).toBeNull();
  });
});

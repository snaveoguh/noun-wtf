import { describe, expect, it } from 'vitest';

import { TOWN_IDS } from '../../trade/towns';
import { LANDMARKS } from '../../world/landmarks/sites';
import { terrainHeight } from '../../world/mountain/terrain';

import { stationFrame, padCoords } from './pads';
import { SIDE_TOWNS, STATIONS } from './places';
import { placeDoors, roadPlace, roadPlaces } from './registry';

const places = roadPlaces(true);

describe('road registry', () => {
  it('lists every town, station and landmark once, with stable ids', () => {
    const ids = places.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOWN_IDS) expect(ids).toContain(`town:${t}`);
    for (const st of STATIONS) expect(ids).toContain(`station:${st.id}`);
    for (const l of LANDMARKS) expect(ids).toContain(`landmark:${l.id}`);
    expect(places.length).toBe(TOWN_IDS.length + STATIONS.length + LANDMARKS.length);
  });

  it('looks places up by id', () => {
    expect(roadPlace('town:peak')!.name).toBe('Powder Peak');
    expect(roadPlace('station:truck-3-33')!.sub).toBe('truckstop');
    expect(roadPlace('landmark:big-noun')!.kind).toBe('landmark');
    expect(roadPlace('town:nowhere')).toBeNull();
    expect(roadPlace('bogus')).toBeNull();
  });

  it('pull-up points sit on the road beside each place', () => {
    for (const p of places) {
      if (p.track === 0) continue;
      expect(Math.abs(p.stop.y - terrainHeight(p.stop.x, p.stop.z)), p.id).toBeLessThan(0.01);
      // Within reach of the place itself (side towns: across the spur)
      expect(Math.hypot(p.stop.x - p.x, p.stop.z - p.z), p.id).toBeLessThan(
        p.kind === 'landmark' ? 260 : 220,
      );
    }
    for (const st of SIDE_TOWNS) {
      const p = roadPlace(`town:${st.id}`)!;
      expect(Math.hypot(p.stop.x - p.x, p.stop.z - p.z)).toBeGreaterThan(st.off - 10);
    }
  });

  it('every station has a door into its shop, truck stops into a diner and a motel too', () => {
    for (const st of STATIONS) {
      const doors = placeDoors(`station:${st.id}`);
      const kinds = doors.map(d => d.kind);
      const f = stationFrame(st.id)!;
      if (st.kind === 'gas') expect(kinds, st.id).toContain('shop');
      if (st.kind === 'truckstop') {
        expect(kinds, st.id).toContain('shop');
        expect(kinds, st.id).toContain('cafe');
        expect(kinds, st.id).toContain('home');
      }
      if (st.kind === 'rest') expect(doors.length, st.id).toBeGreaterThanOrEqual(1);
      for (const d of doors) {
        expect(d.area).toBe(`road:${st.id}`);
        // On the forecourt, at its height there, facing the road
        const c = padCoords(f, d.x, d.z);
        expect(c.vp).toBeGreaterThan(f.vmin);
        expect(Math.abs(d.y - terrainHeight(d.x, d.z)), d.id).toBeLessThan(1.6);
      }
      expect(placeDoors(`station:${st.id}`)).toBe(doors);
    }
  });

  it('every side town has its shops, a cafe and a bar or home to walk into', () => {
    for (const st of SIDE_TOWNS) {
      const doors = placeDoors(`town:${st.id}`);
      expect(doors.length, st.id).toBeGreaterThanOrEqual(6);
      const kinds = new Set(doors.map(d => d.kind));
      expect(kinds.has('shop'), st.id).toBe(true);
      expect(kinds.has('cafe'), st.id).toBe(true);
      for (const d of doors) expect(d.area).toBe(`town:${st.id}`);
    }
    expect(placeDoors('town:city')).toEqual([]);
    expect(placeDoors('town:jersey').length).toBeGreaterThan(5);
  });
});

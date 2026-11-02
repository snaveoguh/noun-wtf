import { describe, expect, it } from 'vitest';

import { TOWN_IDS, TOWN_SPECS, travelMetres } from '../../trade/towns';
import { CAST } from '../cast';
import { GROWN_TOWNS, LAYOUT } from '../site';
import { TOWNS, hotGoods } from '../specs';

import { SIDE_TOWNS, STATIONS, marketNear, stationMarket } from './places';

describe('road trip tables', () => {
  it('the trade table places each side town where it is built (the server travel check reads it)', () => {
    for (const st of SIDE_TOWNS) {
      const spec = TOWN_SPECS[st.id];
      expect(spec.track).toBe(st.track);
      expect(spec.s).toBe(st.s);
      expect(TOWN_IDS).toContain(st.id);
      expect(GROWN_TOWNS).toContain(st.id);
      expect(LAYOUT[st.id].near).toBe(st.near);
      expect(LAYOUT[st.id].far).toBe(st.far);
    }
    expect(new Set(TOWN_IDS).size).toBe(Object.keys(TOWN_SPECS).length);
  });

  it('each new town makes something and wants something else', () => {
    for (const st of SIDE_TOWNS) {
      const m = TOWNS[st.id].market;
      expect(m.makes.length).toBeGreaterThan(0);
      for (const g of m.makes) expect(m.bias[g]).toBeLessThan(1);
      expect(hotGoods(st.id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('travel distances run along the lines, via the plaza between lines', () => {
    expect(travelMetres('peak', 'cowboy')).toBe(11_400 - 3_600);
    expect(travelMetres('pines', 'jersey')).toBe(21_656 - 14_600);
    expect(travelMetres('diesel', 'crater')).toBe(53_650 - 20_500);
    expect(travelMetres('peak', 'pines')).toBe(3_600 + 14_600);
  });

  it('every side town has six customers on its sidewalks, clear of the spur', () => {
    for (const st of SIDE_TOWNS) {
      const cast = CAST[st.id];
      expect(cast.length).toBe(6);
      expect(new Set(cast.map(c => c.id)).size).toBe(6);
      for (const c of cast) {
        expect(c.id.startsWith(`${st.id}:`)).toBe(true);
        expect(Math.abs(Math.abs(c.vp) - 8.6)).toBeLessThan(0.01);
        if (c.vp < 0) expect(Math.abs(c.u - st.len / 2)).toBeGreaterThan(12);
      }
    }
  });

  it('stations trade as the nearest town down their line', () => {
    expect(new Set(STATIONS.map(s => s.id)).size).toBe(STATIONS.length);
    expect(stationMarket('gas-2-7')).toBe('cowboy');
    expect(stationMarket('truck-3-33')).toBe('diesel');
    expect(stationMarket('gas-1-5')).toBe('city');
    expect(marketNear(1, 14_000)).toBe('pines');
    expect(stationMarket('nope')).toBe('city');
  });
});

import { describe, expect, it } from 'vitest';

import { peakHeight, PEAK } from '../peakTerrain';

import { type BasinEnv, basinShouldRecycle, basinSpawn, basinStep } from './basinRiderSim';
import { riderCreate } from './riderSim';
import { BASIN, basinKickersNear } from './terrainBasin';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('the basin free riders', () => {
  it('shred round the player, send kickers and stay on (or over) the snow', () => {
    const r = rng(7);
    const z0 = PEAK.pad + BASIN.start + 25_000;
    const env: BasinEnv = {
      height: peakHeight,
      kickersNear: basinKickersNear,
      px: 0,
      pz: z0,
      phd: 0,
      pv: 60,
    };
    const pack = Array.from({ length: 10 }, () => basinSpawn(riderCreate(), env, r, true));
    let launches = 0;
    let aimed = 0;
    let recycled = 0;
    const dt = 1 / 30;
    for (let f = 0; f < 30 * 90; f++) {
      env.pz += env.pv * dt;
      for (const st of pack) {
        basinStep(st, dt, env, r);
        if (st.launched) launches++;
        if (st.aiming) aimed++;
        expect(st.y).toBeGreaterThan(peakHeight(st.x, st.s) - 0.01);
        if (basinShouldRecycle(st, env)) {
          recycled++;
          basinSpawn(st, env, r);
        }
        expect(Math.hypot(st.x - env.px, st.s - env.pz)).toBeLessThan(1700);
      }
    }
    expect(launches).toBeGreaterThan(30);
    expect(aimed).toBeGreaterThan(1000);
    expect(recycled).toBeGreaterThan(0);
  }, 30_000);
});

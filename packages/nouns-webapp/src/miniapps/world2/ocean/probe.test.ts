import { it } from 'vitest';
import '../world/mountain/terrain';
import { edgeDistance } from '../world/mountain/config';
import { tracks } from '../world/mountain/tracks';
import { coastAt, coastFrameNow, COAST } from './coast';
it('p', () => {
  const c = coastFrameNow()!; const f = c.town;
  tracks.ensure(edgeDistance(f.ox, f.oz) + COAST.far + 2000);
  const main = tracks.tracks.find(t => t.id === f.site.track.id)!;
  const cp = { d: 0, a: 0, u: 0, vp: 0 };
  for (let i = 0; i < main.xs.length; i += 4) { const p = coastAt(c, main.xs[i], main.zs[i], cp); if (p.d > -400) console.log('u', Math.round(p.u), 'vp', Math.round(p.vp), 'd', Math.round(p.d)); }
});

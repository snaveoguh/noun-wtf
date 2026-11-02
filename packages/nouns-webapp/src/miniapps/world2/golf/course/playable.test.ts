// Every hole on the real NOUN LINKS surface is playable: a strong CPU gets
// round all 19 with the real sim, rules and course, never stuck.

import { describe, expect, it } from 'vitest';

import {
  applyShot,
  ballOf,
  cpuSwing,
  holeInfoFrom,
  launchOf,
  mulberry32,
  newRound,
  nextHole,
  simulateShot,
  totals,
  currentHole,
} from '../sim';

import { golfCourse } from './surface';

describe('NOUN LINKS is playable', () => {
  it('a tour-level CPU gets round all 19 holes in a sane score', () => {
    const C = golfCourse();
    const infos = C.layout.holes.map(h => holeInfoFrom(h, C));
    const config = {
      gid: 't',
      seed: 3,
      holes: infos.map(i => i.n),
      wind: 0.3,
      players: [{ id: 'cpu:1', name: 'CPU', human: false, skill: 1 }],
    };
    let st = newRound(config, infos);
    const rng = mulberry32(11);
    const perHole: number[] = [];
    let guard = 0;
    while (st.phase !== 'over' && guard++ < 400) {
      if (st.phase === 'holed') {
        st = nextHole(st, infos);
        continue;
      }
      const info = currentHole(st, infos)!;
      const by = st.turn;
      const swing = cpuSwing(C, st, by, info, rng, 1);
      const from = ballOf(st, by, info);
      const lie = st.cur[by].ball !== null ? st.cur[by].lie : 'tee';
      const r = simulateShot(
        C,
        from,
        lie,
        launchOf(swing, lie, C.normal(from.x, from.z, { x: 0, y: 1, z: 0 })),
        st.wind,
        info.pin,
        { seed: st.n, noPath: true },
      );
      const before = st.hole;
      st = applyShot(st, by, r, info);
      if (st.hole !== before || st.phase !== 'play')
        perHole[before] = st.card[0][before] ?? perHole[before];
    }
    const card = st.card[0];
    console.log('card', card.join(' '), 'total', totals(st)[0], 'par', C.layout.par);
    expect(st.phase).toBe('over');
    for (let i = 0; i < 19; i++) expect(card[i], `hole ${i + 1}`).not.toBeNull();
    // No hole ends in a pick-up for a tour CPU
    C.layout.holes.forEach((h, i) =>
      expect(card[i]!, `hole ${h.n}`).toBeLessThanOrEqual(h.par + 3),
    );
    expect(totals(st)[0]).toBeLessThan(C.layout.par + 22);
  }, 240_000);
});

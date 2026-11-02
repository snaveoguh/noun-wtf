import { describe, expect, it } from 'vitest';

import { MOUNTAIN } from '../../world/mountain/config';
import { tracks, MEGA_SITE, TOWN_SITE } from '../../world/mountain/tracks';

import { STATIONS, STATION_PAD } from './places';
import {
  BILLBOARDS,
  backRows,
  distRows,
  roadsideIn,
  roadsideItems,
  segmentOf,
  segmentSlots,
} from './roadside';

const UP_TO = 46_000;
const items = [1, 2, 3].flatMap(t => [...roadsideItems(t, UP_TO)]);

describe('roadside', () => {
  it('puts km posts, distance signs, homeward signs and billboards on every main', () => {
    for (const t of [1, 2, 3]) {
      const mine = items.filter(i => i.track === t);
      const count = (k: string) => mine.filter(i => i.kind === k).length;
      expect(count('km')).toBeGreaterThan(35);
      expect(count('dist')).toBeGreaterThan(8);
      expect(count('back')).toBeGreaterThan(3);
      expect(count('bb')).toBeGreaterThan(12);
    }
    expect(new Set(items.map(i => i.id)).size).toBe(items.length);
  });

  it('is deterministic: growing in steps gives the same items as all at once', () => {
    const a = roadsideItems(2, 20_000).filter(i => i.s0 < 19_000);
    const b = items.filter(i => i.track === 2 && i.s0 < 19_000);
    expect(a.map(i => [i.id, Math.round(i.s), Math.round(i.x), Math.round(i.z)])).toEqual(
      b.map(i => [i.id, Math.round(i.s), Math.round(i.x), Math.round(i.z)]),
    );
    expect(
      items.slice(0, 6).map(i => [i.id, Math.round(i.s), Math.round(i.x), Math.round(i.z)]),
    ).toMatchSnapshot();
  });

  it('keeps out of reserved stretches, ramps, forecourts and away from other lines', () => {
    for (const it of items) {
      const t = tracks.tracks.find(q => q.id === it.track && q.depth === 0)!;
      for (const m of t.towns)
        expect(it.s < m.s - TOWN_SITE.pre || it.s > m.s + TOWN_SITE.post, it.id).toBe(true);
      for (const m of t.megas)
        expect(it.s < m.s - MEGA_SITE.pre || it.s > m.s + MEGA_SITE.post, it.id).toBe(true);
      for (const r of t.ramps)
        expect(it.s < r.s - r.spec.length - 60 || it.s > r.s + r.spec.land + 30, it.id).toBe(true);
      for (const st of STATIONS)
        if (st.track === it.track)
          expect(Math.abs(it.s - st.s)).toBeGreaterThan(STATION_PAD[st.kind].len / 2 + 30);
      // Off the road surface, never on it
      expect(it.off).toBeGreaterThan(MOUNTAIN.trackHalf + 1);
    }
  });

  it('distance signs name what is actually down the line, nearest first', () => {
    expect(distRows(2, 2000)).toEqual(['POWDER PEAK  2 KM', 'GAS  6 KM', 'DRY GULCH  10 KM']);
    expect(distRows(2, 12_500)).toEqual([
      'TRUCK STOP  4 KM',
      'PUERTO NOUN  16 KM',
      'NOGGLE CITY  21 KM',
    ]);
    expect(distRows(3, 16_500)[0]).toBe('DIESEL FLATS  4 KM');
    expect(backRows(1, 18_000)).toEqual(['LOON LAKE  3 KM', 'THE PLAZA  18 KM']);
    for (const it of items.filter(i => i.kind === 'dist'))
      expect(it.rows.length).toBeGreaterThan(0);
    for (const it of items.filter(i => i.kind === 'bb')) expect(BILLBOARDS).toContain(it.rows[0]);
  });

  it('face the traffic that reads them', () => {
    for (const it of items.slice(0, 80)) {
      const t = tracks.tracks.find(q => q.id === it.track && q.depth === 0)!;
      const p = tracks.pointAt(t, it.s, { x: 0, z: 0, h: 0, k: 0 });
      const along = Math.sin(it.yaw) * Math.sin(p.h) + Math.cos(it.yaw) * Math.cos(p.h);
      // Outbound signs face back up the line, homeward ones face down it
      expect(it.kind === 'back' ? along : -along, it.id).toBeGreaterThan(0.99);
    }
  });

  it('segments hold every text sign once, by nominal spot', () => {
    const t1 = items.filter(i => i.track === 1 && i.kind !== 'bb' && i.s0 < 40_000);
    const segs = [0, 1, 2, 3].flatMap(s => segmentSlots(1, s));
    const ids = new Set(segs.map(i => i.id));
    for (const i of t1) expect(ids.has(i.id)).toBe(true);
    for (const i of segs) expect(segmentOf(i.s0)).toBeLessThan(4);
  });

  it('a chunk only places the slots near it (and gets the same items)', () => {
    const it0 = items.find(i => i.track === 2 && i.kind === 'dist' && i.s > 12_000)!;
    const x0 = Math.floor(it0.x / 128) * 128;
    const z0 = Math.floor(it0.z / 128) * 128;
    const got = roadsideIn(2, x0, z0, x0 + 128, z0 + 128, 0, 60_000);
    expect(got.map(i => i.id)).toContain(it0.id);
    for (const i of got)
      expect(i.x >= x0 && i.x < x0 + 128 && i.z >= z0 && i.z < z0 + 128).toBe(true);
  });
});

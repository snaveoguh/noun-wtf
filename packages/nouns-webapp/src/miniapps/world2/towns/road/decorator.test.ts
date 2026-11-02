import type { ChunkContext } from '../../world/mountain/MountainStream';

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashInts } from '../../world/mountain/config';
import { CHUNK } from '../../world/mountain/MountainStream';
import { sampleTerrain, terrainHeight } from '../../world/mountain/terrain';
import { townStats } from '../build';
import { townFrameNow } from '../site';

import { buildLookForTest, roadAtlases, roadDecorator, roadStats } from './decorator';
import { SIDE_LOOKS } from './looks';
import { stationFrame, stationToWorld } from './pads';
import { SIDE_TOWNS, STATIONS } from './places';
import { roadsideItems } from './roadside';
import { stationLook } from './stations';

// jsdom has no 2D canvas: a do-nothing one is enough to lay out the atlases
const fake2d = new Proxy(
  {},
  {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined),
    set: () => true,
  },
);
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fake2d as never);
});
afterAll(() => vi.restoreAllMocks());

function chunkAt(x: number, z: number, quality: 'high' | 'low' = 'high'): ChunkContext {
  const ix = Math.floor(x / CHUNK);
  const iz = Math.floor(z / CHUNK);
  let k = 0;
  return {
    ix,
    iz,
    size: CHUNK,
    origin: new THREE.Vector3(ix * CHUNK, 0, iz * CHUNK),
    random: () => hashInts(ix, iz + k++, 7),
    height: terrainHeight,
    sample: sampleTerrain,
    toon: false,
    quality,
  };
}

/** Every chunk a frame's AABB touches. */
function chunksOver(f: { x0: number; z0: number; x1: number; z1: number }) {
  const out: ChunkContext[] = [];
  for (let x = Math.floor(f.x0 / CHUNK) * CHUNK; x <= f.x1; x += CHUNK)
    for (let z = Math.floor(f.z0 / CHUNK) * CHUNK; z <= f.z1; z += CHUNK)
      out.push(chunkAt(x + 1, z + 1));
  return out;
}

const deco = roadDecorator();

describe('road decorator', () => {
  it('builds a side town over several chunks, each a handful of draws', () => {
    for (const st of SIDE_TOWNS) {
      const f = townFrameNow(st.id)!;
      const built = chunksOver(f)
        .map(c => ({ c, d: deco.populate(c) }))
        .filter(q => q.d !== null);
      const withParts = built.filter(q =>
        roadStats.chunks.get(`${q.c.ix},${q.c.iz}`)!.what.some(w => w.startsWith(st.id)),
      );
      expect(withParts.length, st.id).toBeGreaterThanOrEqual(3);
      for (const q of withParts) {
        const s = roadStats.chunks.get(`${q.c.ix},${q.c.iz}`)!;
        expect(s.drawCalls, st.id).toBeLessThanOrEqual(10);
      }
      // Its buildings collide (some chunks only hold trees or the junction signs)
      expect(
        withParts.some(q => q.d!.collision!.attributes.position.count > 200),
        st.id,
      ).toBe(true);
      expect(townStats[st.id].live).toBe(true);
      for (const q of built) q.d!.dispose!();
      expect(townStats[st.id].live).toBe(false);
    }
  });

  it('builds each station in the chunks holding its parts', () => {
    for (const st of STATIONS) {
      const f = stationFrame(st.id, true)!;
      const c = stationToWorld(f, f.vmin + 20, f.Lf / 2, { x: 0, z: 0 });
      const built = chunksOver({ x0: c.x - 80, z0: c.z - 80, x1: c.x + 80, z1: c.z + 80 })
        .map(ctx => deco.populate(ctx))
        .filter(d => d !== null);
      const what = [...roadStats.chunks.values()].flatMap(s => s.what);
      expect(
        what.some(w => w.startsWith(st.id)),
        st.id,
      ).toBe(true);
      for (const d of built) d!.dispose!();
    }
  });

  it('frees a segment atlas with the last chunk using it', () => {
    const it0 = roadsideItems(1, 9000).find(i => i.kind === 'km' && i.s > 6000)!;
    const d = deco.populate(chunkAt(it0.x, it0.z))!;
    expect(d).not.toBeNull();
    expect(roadAtlases().some(a => a.key === 'seg:1:0' && a.refs === 1)).toBe(true);
    d.dispose!();
    expect(roadAtlases().some(a => a.key === 'seg:1:0')).toBe(false);
    // The near-city chunks have nothing
    expect(deco.populate(chunkAt(10, 10))).toBeNull();
  });

  it('phones get fewer parked vehicles', () => {
    const st = STATIONS.find(s => s.kind === 'truckstop')!;
    const f = stationFrame(st.id, true)!;
    const hi = buildLookForTest(stationLook(st), f, {
      ground: () => 0,
      lift: () => 0,
      grade: 0,
      low: false,
    });
    const lo = buildLookForTest(stationLook(st), f, {
      ground: () => 0,
      lift: () => 0,
      grade: 0,
      low: true,
    });
    expect(lo.geo.solid.length).toBeLessThan(hi.geo.solid.length);
  });

  it('every look stays inside a sane triangle budget', () => {
    for (const st of SIDE_TOWNS) {
      const f = townFrameNow(st.id)!;
      const b = buildLookForTest(SIDE_LOOKS[st.id], f);
      let tris = 0;
      for (const k of ['solid', 'ground', 'thin', 'glow'] as const)
        for (const g of b.geo[k]) tris += g.attributes.position.count / 3;
      expect(tris, st.id).toBeLessThan(60_000);
      expect(b.plants.length, st.id).toBeGreaterThan(20);
    }
  });
});

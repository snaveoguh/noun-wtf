// Facades: style assignment, wall layout, and the whole plaza's plan and
// geometry (built from the real plaza.glb / collision.glb).

import type { Footprint } from '../../interiors/doors';
import type { SourceTri } from './faces';

import { describe, expect, it } from 'vitest';

import { buildBuilding, IN, MIN_PROUD, shutterSpan } from './details';
import { checkEscape } from './escape';
import { classifyPiece, facesFromTriangles, lmAt, piecesOf } from './faces';
import { facesNearPlane } from './geom';
import {
  baysFor,
  cellsFor,
  escapeSpan,
  freeAlong,
  overlapsDoor,
  rectsOverlap,
  rowsFor,
  segmentFace,
  windowsOf,
} from './layout';
import { doorOnFace, planBuildings } from './plan';
import { loadPlaza } from './plazaFixture.test-util';
import { assignStyles, STYLES, touchingPairs } from './styles';

const fp = (
  key: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height = 13.6,
): Footprint => ({
  key,
  minX,
  maxX,
  minZ,
  maxZ,
  height,
  ground: 0,
});

/** A terrace of `n` buildings along x, fronts on z = 0. */
const terrace = (n: number, w = 12) =>
  Array.from({ length: n }, (_, i) =>
    fp(`t${i}`, i * w, (i + 1) * w, 0, 18, [6.8, 10.2, 13.6, 17][i % 4]),
  );

describe('style assignment', () => {
  it('is deterministic whatever order the buildings come in', () => {
    const fps = terrace(12);
    const a = assignStyles(fps);
    const b = assignStyles([...fps].reverse());
    for (const f of fps) expect(b.get(f.key)).toEqual(a.get(f.key));
  });

  it('never gives two touching buildings the same style', () => {
    const fps = terrace(20);
    const s = assignStyles(fps);
    for (const [p, q] of touchingPairs(fps)) expect(s.get(p)!.style).not.toBe(s.get(q)!.style);
  });

  it('suits the building: two storeys are never towers', () => {
    const s = assignStyles([fp('low', 0, 10, 0, 10, 6.8)]);
    expect(['shopfront', 'brownstone', 'tenement', 'loft']).toContain(s.get('low')!.style);
  });
});

describe('wall layout', () => {
  it('turns a two-triangle wall back into one rectangle, lightmap and all', () => {
    const uv = (s: number, y: number): [number, number] => [0.1 + s * 0.01, 0.2 + y * 0.02];
    const tris: SourceTri[] = [
      {
        p: [
          [0, 0, 5],
          [10, 0, 5],
          [10, 6, 5],
        ],
        uv1: [uv(0, 0), uv(10, 0), uv(10, 6)],
      },
      {
        p: [
          [0, 0, 5],
          [10, 6, 5],
          [0, 6, 5],
        ],
        uv1: [uv(0, 0), uv(10, 6), uv(0, 6)],
      },
    ];
    const f = facesFromTriangles(tris);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nx: 0, nz: 1, at: 5, s0: 0, s1: 10, y0: 0, y1: 6 });
    const l = lmAt(f[0]!.lm!, 4, 3);
    expect(l[0]).toBeCloseTo(uv(4, 3)[0]);
    expect(l[1]).toBeCloseTo(uv(4, 3)[1]);
  });

  it('cuts a terrace wall per building and hides what a neighbour stands against', () => {
    const a = fp('a', 0, 10, 0, 10, 13.6);
    const b = fp('b', 10, 20, 0, 10, 6.8);
    // a's east wall: x = 10, facing +x — b stands against it up to its parapet
    const segs = segmentFace({ nx: 1, nz: 0, at: 10, s0: 0, s1: 10, y0: 0, y1: 14.5 }, [a, b]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.fp).toBe(a);
    expect(segs[0]!.cover).toBeCloseTo(7.7);
    // A front spanning both is cut at their boundary
    const front = segmentFace({ nx: 0, nz: -1, at: 0, s0: 0, s1: 20, y0: 0, y1: 14.5 }, [a, b]);
    expect(front.map(s => s.fp?.key)).toEqual(['a', 'b']);
  });

  it('lays storeys every 3.4 m with the parapet on top, and even bays', () => {
    const rows = rowsFor(13.6, 0, 14.5);
    expect(rows.map(r => r.kind)).toEqual(['ground', 'storey', 'storey', 'storey', 'parapet']);
    expect(rows[1]!.y0).toBeCloseTo(3.4);
    expect(rows[4]!.y1).toBeCloseTo(14.5);
    const bays = baysFor(0, 10, 2.6);
    expect(bays).toHaveLength(4);
    expect(bays[3]![1]).toBe(10);
  });

  it('puts no window where a door is, on any style', () => {
    const b = fp('a', 0, 12, 0, 18, 13.6);
    const segs = segmentFace({ nx: 0, nz: -1, at: 0, s0: 0, s1: 12, y0: 0, y1: 14.5 }, [b]);
    for (const style of STYLES) {
      const cells = cellsFor(segs[0]!, 2.5, 13.6);
      const door = { s: 6, width: 1.4, height: 2.6 };
      for (const w of windowsOf(cells, style)) expect(overlapsDoor(w, door)).toBe(false);
      // and the skin's ground storey is a plain base (no painted window)
      for (const c of cells) if (c.y0 < door.height) expect(c.tile).toBe('base');
    }
  });

  it('keeps a fire escape off the door and off balconies', () => {
    const door = { s: 4, width: 1.4, height: 2.6 };
    const span = escapeSpan(0, 18, door, [[15, 16.5]], [6.8])!;
    expect(span).not.toBeNull();
    expect(span.a).toBeGreaterThan(door.s + door.width / 2 + 0.99);
    expect(span.b <= 15 - 0.2 || span.a >= 16.5 + 0.2).toBe(true);
    // the ladder hangs at the end away from the door
    expect(span.ladderAtS1).toBe(true);
    // nothing fits: too short, or a balcony where the only room is
    expect(escapeSpan(0, 8, door, [], [6.8])).toBeNull();
    expect(escapeSpan(0, 18, door, [[12, 13.5]], [6.8])).toBeNull();
  });

  it('routes vertical relief round a painted piece', () => {
    const r = { s0: 2, s1: 6, y0: 3.6, y1: 6.1 };
    // (the 8 cm sliver under it is dropped)
    expect(freeAlong(3.4, 14, 4, 0.04, [r])).toEqual([[expect.closeTo(6.22, 6), 14]]);
    expect(freeAlong(0, 14, 4, 0.04, [r])).toEqual([
      [0, expect.closeTo(3.48, 6)],
      [expect.closeTo(6.22, 6), 14],
    ]);
    expect(freeAlong(3.4, 14, 8, 0.04, [r])).toEqual([[3.4, 14]]);
  });

  it('never shutters a door', () => {
    for (const s of [2, 5, 9, 14]) {
      const door = { s, width: 1.4, height: 2.6 };
      const span = shutterSpan(0, 16, door);
      if (span === null) continue;
      expect(span[1] <= s - 0.7 - 1.19 || span[0] >= s + 0.7 + 1.19).toBe(true);
    }
  });

  it('classifies balconies and rooftop units, not string courses', () => {
    const tri = (
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      z0: number,
      z1: number,
    ): SourceTri[] => [
      {
        p: [
          [x0, y0, z0],
          [x1, y0, z1],
          [x1, y1, z1],
        ],
      },
      {
        p: [
          [x0, y0, z0],
          [x1, y1, z1],
          [x0, y1, z0],
        ],
      },
    ];
    const [balcony] = piecesOf(tri(0, 1.5, 3.5, 4.5, 75, 76));
    expect(classifyPiece('railing', balcony!).obstacle).toBe(true);
    const [band] = piecesOf(tri(0, 18, 3.4, 3.6, 75.8, 76));
    expect(classifyPiece('trim', band!).obstacle).toBe(false);
  });
});

describe('the real plaza', async () => {
  const plaza = await loadPlaza();
  const faces = facesFromTriangles(plaza.facadeTris);
  const obstacles = plaza.prims
    .filter(p => /^(railing|trim)/.test(p.material))
    .flatMap(p => piecesOf(p.tris).filter(b => classifyPiece(p.material, b).obstacle));
  const decals = facesFromTriangles(plaza.decalTris);
  const plans = planBuildings({ faces, fps: plaza.fps, doors: plaza.doors, obstacles, decals });
  const byKey = new Map(plans.map(p => [p.key, p]));

  it('dresses every building, in every style, with neighbours different', () => {
    expect(plans.length).toBe(plaza.fps.length);
    const counts = new Map<string, number>();
    for (const p of plans) counts.set(p.style, (counts.get(p.style) ?? 0) + 1);
    for (const s of STYLES) expect(counts.get(s) ?? 0, s).toBeGreaterThan(0);
    for (const n of counts.values()) expect(n).toBeLessThan(plans.length * 0.4);
    for (const [a, b] of touchingPairs(plaza.fps))
      expect(byKey.get(a)!.style, `${a} | ${b}`).not.toBe(byKey.get(b)!.style);
  });

  it('re-skins every visible bit of wall (the GLB facades get hidden)', () => {
    // Area of skin cells vs. the wall area no neighbour hides
    let wall = 0;
    let skin = 0;
    for (const f of faces)
      for (const s of segmentFace(f, plaza.fps)) {
        const shown = Math.max(f.y0, s.cover);
        if (shown < f.y1) wall += (s.s1 - s.s0) * (f.y1 - shown);
      }
    for (const p of plans)
      for (const sp of p.segments) for (const c of sp.cells) skin += (c.s1 - c.s0) * (c.y1 - c.y0);
    expect(skin).toBeCloseTo(wall, 0);
  });

  it('opens no window onto a door, and finds every door its wall', () => {
    let doors = 0;
    for (const p of plans)
      for (const sp of p.segments) {
        if (sp.door === null) continue;
        doors++;
        for (const w of sp.windows) expect(overlapsDoor(w, sp.door)).toBe(false);
        for (const c of sp.cells)
          if (c.tile === 'win') expect(overlapsDoor({ ...c, y0: c.y0 }, sp.door)).toBe(false);
      }
    // Every door on a plaza building lands on one of its walls
    const own = plaza.doors.filter(d => plaza.fps.some(f => `plaza:${f.key}` === d.id));
    expect(doors).toBeGreaterThanOrEqual(own.length);
  });

  it('hangs walkable fire escapes on brick and loft buildings, clear of doors', () => {
    const escapes = plans.filter(p => p.escape !== null);
    expect(escapes.length).toBeGreaterThanOrEqual(4);
    for (const p of escapes) {
      expect(['tenement', 'loft']).toContain(p.style);
      const e = p.escape!;
      const roof = p.fp!.ground + p.fp!.height;
      expect(checkEscape(e.plan, { length: e.plan.length, roof, parapet: e.face.y1 })).toEqual([]);
      for (const sp of p.segments)
        if (sp.face === e.face && sp.door !== null)
          expect(
            e.b <= sp.door.s - sp.door.width / 2 - 0.99 ||
              e.a >= sp.door.s + sp.door.width / 2 + 0.99,
          ).toBe(true);
    }
  });

  it('keeps every overlay off every wall: nothing coplanar (no z-fighting)', () => {
    for (const p of plans) {
      const g = buildBuilding(p, { lowDetail: false });
      // Against every wall of the plaza nearby (a neighbour's too), where they overlap
      const c = p.fp!;
      for (const f of faces) {
        const fx = f.nz !== 0 ? (f.s0 + f.s1) / 2 : f.at;
        const fz = f.nz !== 0 ? f.at : (f.s0 + f.s1) / 2;
        const rx = Math.max(c.minX - fx, 0, fx - c.maxX);
        const rz = Math.max(c.minZ - fz, 0, fz - c.maxZ);
        if (Math.hypot(rx, rz) > Math.max(f.s1 - f.s0, 1) / 2 + 3) continue;
        // No face parallel to a wall within 2.5 cm of it (either side)
        for (const geo of [g.detail, g.fine]) {
          const near = facesNearPlane(geo.pos, geo.nrm, f, 0.0025, 0.0225, f);
          expect(near, `${p.key} ${p.style}`).toBe(0);
        }
        // The skin lies exactly in its wall's plane (the wall it replaces is
        // hidden); anything else in it (signs, bay windows) stands well proud
        expect(facesNearPlane(g.skin.pos, g.skin.nrm, f, 0.015, 0.012, f)).toBe(0);
      }
    }
    expect(IN).toBeLessThan(-0.02);
    expect(MIN_PROUD).toBeGreaterThanOrEqual(0.03);
  });

  it('puts no relief over the painted pieces and the mural', () => {
    expect(decals.length).toBeGreaterThan(10);
    let checked = 0;
    for (const p of plans)
      for (const sp of p.segments)
        for (const r of sp.decals) {
          checked++;
          for (const w of sp.windows) expect(rectsOverlap(w, r)).toBe(false);
        }
    expect(checked).toBeGreaterThan(5);
  });

  it('finds doors on the wall they belong to', () => {
    for (const d of plaza.doors) {
      const key = d.id.slice('plaza:'.length);
      const p = byKey.get(key);
      if (p === undefined) continue;
      const hits = p.segments.filter(sp => doorOnFace(d, sp.face, sp.seg.s0, sp.seg.s1) !== null);
      expect(hits.length, d.id).toBeGreaterThan(0);
    }
  });
});

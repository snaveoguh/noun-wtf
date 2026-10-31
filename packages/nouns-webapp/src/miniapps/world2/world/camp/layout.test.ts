import { describe, expect, it } from 'vitest';

import { campLayout, OPEN_PAGES, solidBox } from './layout';
import { CAMP_TOWER, campShellBoxes, campSite, campTier, inCamp } from './site';

// The real numbers: the tower stands on the 13.6 m roof
const { tier, y0, top } = campTier(13.6);
const site = campSite(tier, top);
const win = { x0: site.window.x0 - site.origin.x, x1: site.window.x1 - site.origin.x };
const L = campLayout(site.w, site.d, site.h, win.x0, win.x1);

describe('the CAMP site', () => {
  it('is the top storey of the tallest tower, glassless window on the plaza side', () => {
    expect(top).toBe(CAMP_TOWER.top);
    expect(site.floorY).toBeGreaterThan(145);
    expect(site.h).toBeGreaterThan(3.2);
    // The plaza face is the ring's facade line (z 76), flush all the way up
    expect(site.faceZ).toBeCloseTo(76, 6);
    // A penthouse, not a cupboard
    expect(site.w).toBeGreaterThan(9);
    expect(site.d).toBeGreaterThan(10);
    expect(site.window.x1 - site.window.x0).toBeGreaterThan(6);
    expect(site.window.y0).toBe(site.floorY); // walk straight out
  });

  it('the shell leaves the room hollow and the window open, and closes everything else', () => {
    const boxes = campShellBoxes(site, y0, top);
    const solidAt = (x: number, y: number, z: number) =>
      boxes.some(
        b =>
          x > b.min[0] &&
          x < b.max[0] &&
          y > b.min[1] &&
          y < b.max[1] &&
          z > b.min[2] &&
          z < b.max[2],
      );
    const r = site.room;
    for (let x = r.minX + 0.1; x < r.maxX; x += 0.5)
      for (let z = r.minZ + 0.1; z < r.maxZ; z += 0.5) {
        expect(solidAt(x, site.floorY + 1.5, z)).toBe(false);
        expect(solidAt(x, site.floorY - 0.2, z)).toBe(true); // floor
        expect(solidAt(x, site.ceilY + 0.1, z)).toBe(true); // ceiling
      }
    const midY = site.floorY + 1.5;
    const wallZ = site.faceZ + 0.15;
    // Through the window: open; either side of it: wall
    expect(solidAt((site.window.x0 + site.window.x1) / 2, midY, wallZ)).toBe(false);
    expect(solidAt(site.window.x0 - 0.3, midY, wallZ)).toBe(true);
    expect(solidAt(site.window.x1 + 0.3, midY, wallZ)).toBe(true);
    expect(solidAt(site.window.x0 + 0.5, site.window.y1 + 0.2, wallZ)).toBe(true);
    // The other three walls are solid all the way along
    for (let x = site.tier.minX + 0.05; x < site.tier.maxX; x += 0.4)
      expect(solidAt(x, midY, site.tier.maxZ - 0.1)).toBe(true);
    for (let z = site.tier.minZ + 0.05; z < site.tier.maxZ; z += 0.4) {
      expect(solidAt(site.tier.minX + 0.1, midY, z)).toBe(true);
      expect(solidAt(site.tier.maxX - 0.1, midY, z)).toBe(true);
    }
    expect(inCamp(site, site.origin.x, site.floorY + 0.1, site.origin.z + 3)).toBe(true);
    expect(inCamp(site, site.origin.x, site.floorY + 0.1, site.faceZ - 1)).toBe(false);
  });
});

describe('the CAMP layout', () => {
  const solids = L.pieces.filter(q => q.solid).map(solidBox);

  it('keeps everything inside the room', () => {
    for (const q of L.pieces) {
      const b = solidBox(q);
      expect(b.minX, q.type).toBeGreaterThan(-L.w / 2 - 0.05);
      expect(b.maxX, q.type).toBeLessThan(L.w / 2 + 0.05);
      expect(b.minZ, q.type).toBeGreaterThan(-0.05);
      expect(b.maxZ, q.type).toBeLessThan(L.d + 0.05);
      expect(q.y + q.h, q.type).toBeLessThanOrEqual(L.h);
    }
  });

  it("has the owner's mess: MEME VALUE stacked and open, ice cream tubs, the van plans, a sunset poster", () => {
    const n = (t: string) => L.pieces.filter(q => q.type === t).length;
    expect(n('book_stack')).toBeGreaterThanOrEqual(2);
    expect(n('book_open')).toBeGreaterThanOrEqual(5);
    expect(n('tub')).toBeGreaterThanOrEqual(6);
    expect(n('whiteboard')).toBe(1);
    expect(n('poster')).toBe(1);
    expect(n('boarded_door')).toBe(1);
    expect(n('notice')).toBe(1);
    expect(n('pool_table')).toBe(1);
    // A copy open on the coffee table, the one you read
    const table = L.pieces.find(q => q.type === 'coffee_table')!;
    expect(Math.hypot(L.book.x - table.x, L.book.z - table.z)).toBeLessThan(0.6);
    for (const q of L.pieces.filter(x => x.type === 'book_open'))
      expect(OPEN_PAGES[q.v]).toBeDefined();
  });

  it('leaves the mini ramp clear (nothing on it but riders)', () => {
    const ramp = solidBox(L.pieces.find(q => q.type === 'miniramp')!);
    for (const q of L.pieces) {
      if (q.type === 'miniramp' || q.y > 2) continue;
      const b = solidBox(q);
      const on =
        b.minX < ramp.maxX && ramp.minX < b.maxX && b.minZ < ramp.maxZ && ramp.minZ < b.maxZ;
      expect(on, `${q.type} at ${q.x.toFixed(1)},${q.z.toFixed(1)}`).toBe(false);
    }
  });

  it('solid furniture never overlaps', () => {
    for (let i = 0; i < solids.length; i++)
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i]!;
        const b = solids[j]!;
        const overlap =
          a.minX < b.maxX - 0.02 &&
          b.minX < a.maxX - 0.02 &&
          a.minZ < b.maxZ - 0.02 &&
          b.minZ < a.maxZ - 0.02;
        expect(overlap, `${i} × ${j}`).toBe(false);
      }
  });

  it('spawns are spread out, clear, and every one can walk out of the window', () => {
    const R = 0.36; // the rider's radius, a bit over
    const clear = (x: number, z: number) =>
      x > -L.w / 2 + R &&
      x < L.w / 2 - R &&
      z > R &&
      z < L.d - R &&
      !solids.some(b => x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R);
    expect(L.spawns.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < L.spawns.length; i++) {
      const s = L.spawns[i]!;
      expect(clear(s.x, s.z), `spawn ${i}`).toBe(true);
      for (let j = i + 1; j < L.spawns.length; j++)
        expect(Math.hypot(s.x - L.spawns[j]!.x, s.z - L.spawns[j]!.z)).toBeGreaterThan(1.2);
      // Facing the window
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      expect(fz).toBeLessThan(0);
      expect(Math.abs(fx)).toBeLessThan(0.9);
    }
    // Flood fill on a 0.1 m grid from each spawn to the window opening (z ≈ 0)
    const S = 0.1;
    const nx = Math.ceil(L.w / S);
    const nz = Math.ceil(L.d / S);
    const cell = (x: number, z: number) =>
      [Math.floor((x + L.w / 2) / S), Math.floor(z / S)] as const;
    for (const s of L.spawns) {
      const seen = new Set<number>();
      const [sx, sz] = cell(s.x, s.z);
      const q: [number, number][] = [[sx, sz]];
      seen.add(sz * nx + sx);
      let out = false;
      while (q.length > 0 && !out) {
        const [i, k] = q.pop()!;
        const x = -L.w / 2 + (i + 0.5) * S;
        if (k * S < R + 0.05 && x > L.window.x0 + R && x < L.window.x1 - R) out = true;
        for (const [di, dk] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const a = i + di;
          const b = k + dk;
          if (a < 0 || b < 0 || a >= nx || b >= nz || seen.has(b * nx + a)) continue;
          if (!clear(-L.w / 2 + (a + 0.5) * S, (b + 0.5) * S)) continue;
          seen.add(b * nx + a);
          q.push([a, b]);
        }
      }
      expect(out, `spawn ${s.x},${s.z}`).toBe(true);
    }
  });

  it('is the same room every time (every client sees the same mess)', () => {
    expect(campLayout(site.w, site.d, site.h, win.x0, win.x1)).toEqual(L);
  });
});

import type { InteriorKind } from './contract';

import { describe, expect, it } from 'vitest';

import { buildKit } from './build';
import { Kit, boxAt, panel } from './kit';
import { generateLayout, type Layout } from './layout';
import { INTERIOR_KINDS } from './names';
import { facesOf, findFights, resolveFights, type Face } from './zfight';

const FULL: [number, number, number, number] = [0, 0, 1, 1];
const atlas = {
  slots: { get: () => FULL } as unknown as Map<number, [number, number, number, number]>,
  named: { get: () => FULL } as unknown as Map<string, [number, number, number, number]>,
};

/** Faces a camera inside the room can ever see (not under the floor, not out through a wall). */
function seen(l: Layout) {
  return (f: Face) => {
    const [nx, ny, nz] = f.n;
    const c = f.p[0]!;
    const e = 0.003;
    if (ny < -0.9 && c[1] < 0.02) return false;
    if (nx > 0.9 && c[0] > l.w / 2 - e) return false;
    if (nx < -0.9 && c[0] < -l.w / 2 + e) return false;
    if (nz < -0.9 && c[2] < e) return false;
    if (nz > 0.9 && c[2] > l.d - e) return false;
    return true;
  };
}

describe('z-fighting', { timeout: 900_000 }, () => {
  it('finds a label flush with a door, and pulls the label (added later) forward', () => {
    const kit = new Kit();
    kit.add(boxAt(0, 1, 0, 2, 0, 0.5), 0x111111); // a black fridge…
    kit.add(boxAt(0.2, 0.8, 1.2, 1.6, 0.49, 0.5), 0xffffff); // …a label flush with its door
    kit.addArt(panel(0.5, 0.3, 0.5, 0.6, 0.5), FULL); // …a sticker exactly on it
    const all = kit.all();
    expect(findFights(facesOf(all)).length).toBeGreaterThan(0);
    resolveFights(all);
    expect(findFights(facesOf(all))).toEqual([]);
    // The label moved out in front; the fridge stayed where it was
    all[1]!.geo.computeBoundingBox();
    expect(all[1]!.geo.boundingBox!.max.z).toBeGreaterThan(0.5009);
    all[0]!.geo.computeBoundingBox();
    expect(all[0]!.geo.boundingBox!.max.z).toBeCloseTo(0.5, 6);
  });

  it('faces back to back (a box resting on a shelf) are not a fight', () => {
    const kit = new Kit();
    kit.add(boxAt(0, 1, 0, 1, 0, 1), 0x111111);
    kit.add(boxAt(0.2, 0.4, 1, 1.2, 0.2, 0.4), 0xffffff);
    expect(findFights(facesOf(kit.all()))).toEqual([]);
  });

  it('no room of any kind has two visible faces of different looks on one plane', () => {
    for (const kind of INTERIOR_KINDS as readonly InteriorKind[])
      for (let i = 0; i < 12; i++) {
        const l = generateLayout({
          id: `zf:${kind}:${i}`,
          kind,
          frontage: 8 + (i % 4) * 4,
          depth: 8 + (i % 3) * 4,
        });
        const all = buildKit(l, atlas).all();
        const fights = findFights(facesOf(all).filter(seen(l)));
        expect(
          fights.map(f => `${all[f.a.src]!.tag} × ${all[f.b.src]!.tag}`),
          `${kind} ${l.id}`,
        ).toEqual([]);
      }
  });
});

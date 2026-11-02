// A PetWorld made of axis-aligned boxes (tests, and a stand-in before the
// level's collision is up). Pure.

import type { PetWorld } from './follow';

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export function boxWorld(
  boxes: Box[],
): PetWorld & { inside(x: number, y: number, z: number, r: number): boolean } {
  return {
    ground(x, top, z, depth) {
      let best: number | null = null;
      for (const b of boxes)
        if (
          x >= b.x0 &&
          x <= b.x1 &&
          z >= b.z0 &&
          z <= b.z1 &&
          b.y1 <= top + 1e-6 &&
          b.y1 >= top - depth
        )
          if (best === null || b.y1 > best) best = b.y1;
      return best;
    },
    clear(ax, ay, az, bx, by, bz) {
      let best = 1;
      const d = [bx - ax, by - ay, bz - az];
      const o = [ax, ay, az];
      for (const b of boxes) {
        const lo = [b.x0, b.y0, b.z0];
        const hi = [b.x1, b.y1, b.z1];
        let t0 = 0;
        let t1 = 1;
        let hit = true;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(d[i]!) < 1e-12) {
            if (o[i]! < lo[i]! || o[i]! > hi[i]!) {
              hit = false;
              break;
            }
            continue;
          }
          let ta = (lo[i]! - o[i]!) / d[i]!;
          let tb = (hi[i]! - o[i]!) / d[i]!;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) {
            hit = false;
            break;
          }
        }
        if (hit) best = Math.min(best, t0);
      }
      return best;
    },
    pushout(x, y, z, r) {
      let px = 0;
      let pz = 0;
      for (const b of boxes) {
        if (y < b.y0 - r || y > b.y1 + r) continue;
        const cx = Math.max(b.x0, Math.min(x + px, b.x1));
        const cz = Math.max(b.z0, Math.min(z + pz, b.z1));
        const cy = Math.max(b.y0, Math.min(y, b.y1));
        const dx = x + px - cx;
        const dz = z + pz - cz;
        const dist = Math.hypot(dx, y - cy, dz);
        // only side contacts push sideways (a floor under the body doesn't)
        if (dist >= r || cy !== y) continue;
        const h = Math.hypot(dx, dz);
        if (h < 1e-6) continue;
        px += (dx / h) * (r - dist);
        pz += (dz / h) * (r - dist);
      }
      return [px, pz];
    },
    inside(x, y, z, r) {
      // a body (round in plan, at height y) overlapping a box by more than 1 cm
      return boxes.some(b => {
        if (y <= b.y0 + 0.01 || y >= b.y1 - 0.01) return false;
        const dx = Math.max(b.x0 - x, 0, x - b.x1);
        const dz = Math.max(b.z0 - z, 0, z - b.z1);
        return Math.hypot(dx, dz) < r - 0.01;
      });
    },
  };
}

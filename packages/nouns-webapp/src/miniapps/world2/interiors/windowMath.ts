// ── Where a room's window looks out from, in the real city (pure) ─────────
//
// A room is built in its own frame (layout.ts): the door wall `s` at z = 0
// facing −z, the back wall `n` at z = d, `e` at x = +w/2, `w` at x = −w/2.
// The real building has its door at (door.x, door.z) facing `door.yaw`. The
// room maps onto it by a rotation (never a mirror, so left stays left):
// room −z → the door's outward normal. Each window then lands on the
// matching facade of the real footprint (by its fraction along the wall),
// at its own height, a little out from the wall, looking out along that
// wall's normal. That's where the window camera goes.

import type { BuildingDoor } from './contract';
import type { Decor, Layout } from './layout';

export type Wall = Decor['wall'];

/** World yaw (three.js: forward = (sin, cos)) of a room wall's outward normal. */
export function wallYaw(wall: Wall, doorYaw: number): number {
  switch (wall) {
    case 's':
      return doorYaw;
    case 'n':
      return doorYaw + Math.PI;
    case 'e':
      return doorYaw - Math.PI / 2;
    default:
      return doorYaw + Math.PI / 2;
  }
}

/** A room-frame direction (x, z) turned into the world for a door facing `doorYaw`. */
export function roomDir(x: number, z: number, doorYaw: number): [number, number] {
  const t = doorYaw + Math.PI;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [x * c + z * s, -x * s + z * c];
}

export interface WindowPose {
  /** Camera position (world) and the yaw it looks along. */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * The real-world spot a window looks out from: on the footprint's facade
 * matching the window's wall (room size when there's no footprint), at the
 * window's fraction along that wall and its centre height above the door's
 * ground, `out` metres outside.
 */
export function windowPose(
  door: Pick<BuildingDoor, 'x' | 'y' | 'z' | 'yaw' | 'footprint'>,
  l: Pick<Layout, 'w' | 'd' | 'door'>,
  d: Pick<Decor, 'wall' | 'at' | 'y'>,
  out = 0.4,
): WindowPose {
  // Building axes in the world: u across the frontage (room +x), v into the building (room +z)
  const [ux, uz] = roomDir(1, 0, door.yaw);
  const [vx, vz] = roomDir(0, 1, door.yaw);
  let umin = -l.w / 2 - l.door.x;
  let umax = l.w / 2 - l.door.x;
  let vmin = 0;
  let vmax = l.d;
  const fp = door.footprint;
  if (fp !== undefined) {
    const us: number[] = [];
    const vs: number[] = [];
    for (const [cx, cz] of [
      [fp.minX, fp.minZ],
      [fp.maxX, fp.minZ],
      [fp.minX, fp.maxZ],
      [fp.maxX, fp.maxZ],
    ] as const) {
      us.push((cx - door.x) * ux + (cz - door.z) * uz);
      vs.push((cx - door.x) * vx + (cz - door.z) * vz);
    }
    umin = Math.min(...us);
    umax = Math.max(...us);
    // (The door sits on the street facade, so v runs from about 0 inward)
    vmin = Math.min(...vs);
    vmax = Math.max(...vs);
  }
  const lerp = (a: number, b: number, f: number) => a + (b - a) * Math.min(1, Math.max(0, f));
  let u: number;
  let v: number;
  if (d.wall === 's' || d.wall === 'n') {
    u = lerp(umin, umax, (d.at + l.w / 2) / l.w);
    v = d.wall === 's' ? vmin : vmax;
  } else {
    v = lerp(vmin, vmax, d.at / l.d);
    u = d.wall === 'e' ? umax : umin;
  }
  const yaw = wallYaw(d.wall, door.yaw);
  return {
    x: door.x + ux * u + vx * v + Math.sin(yaw) * out,
    y: door.y + d.y,
    z: door.z + uz * u + vz * v + Math.cos(yaw) * out,
    yaw,
  };
}

/**
 * The part of a window's rendered view to show, for a viewer at (lx, ly, lz)
 * in the pane's frame (x right, y up, z out into the room): the view slides
 * a little against the viewer's offset (a hint of looking through a hole),
 * never past the edges. `[u0, v0, u1, v1]`.
 */
export function parallaxRect(
  lx: number,
  ly: number,
  lz: number,
  show = 0.8,
  slide = 0.12,
): [number, number, number, number] {
  const z = Math.max(0.5, lz);
  const room = (1 - show) / 2;
  const cu = 0.5 - Math.max(-1, Math.min(1, lx / z)) * Math.min(room, slide);
  const cv = 0.5 - Math.max(-1, Math.min(1, ly / z)) * Math.min(room, slide);
  return [cu - show / 2, cv - show / 2, cu + show / 2, cv + show / 2];
}

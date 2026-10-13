// ── Map authoring kit: boxes, ramps, mirror-symmetric halves ───────────

import type { BoxDef, RampDef, RampDir, SolidTag, SpawnDef } from '../world';

export function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  tag: SolidTag,
  color?: number,
): BoxDef {
  return {
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    tag,
    color,
  };
}

export function ramp(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  dir: RampDir,
  look: 'ramp' | 'stairs' = 'ramp',
): RampDef {
  return { x0, x1, z0, z1, y0, y1, dir, look };
}

const flipDirX: Record<RampDir, RampDir> = { '+x': '-x', '-x': '+x', '+z': '+z', '-z': '-z' };
const flipDirZ: Record<RampDir, RampDir> = { '+x': '+x', '-x': '-x', '+z': '-z', '-z': '+z' };

export function mirrorBoxX(b: BoxDef): BoxDef {
  return { ...b, min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] };
}

export function mirrorBoxZ(b: BoxDef): BoxDef {
  return { ...b, min: [b.min[0], b.min[1], -b.max[2]], max: [b.max[0], b.max[1], -b.min[2]] };
}

export function mirrorRampX(r: RampDef): RampDef {
  return { ...r, x0: -r.x1, x1: -r.x0, dir: flipDirX[r.dir] };
}

export function mirrorRampZ(r: RampDef): RampDef {
  return { ...r, z0: -r.z1, z1: -r.z0, dir: flipDirZ[r.dir] };
}

/** Red side → blue side (x mirrored, yaw mirrored, team swapped). */
export function mirrorSpawnX(s: SpawnDef): SpawnDef {
  return {
    ...s,
    x: -s.x,
    yaw: -s.yaw,
    team: s.team === 0 ? 1 : s.team === 1 ? 0 : -1,
  };
}

export function mirrorSpawnZ(s: SpawnDef): SpawnDef {
  return { ...s, z: -s.z, yaw: Math.PI - s.yaw };
}

/** Yaw that looks down +X (red's attack direction). */
export const FACE_EAST = -Math.PI / 2;

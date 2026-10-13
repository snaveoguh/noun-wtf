// Court geometry in sim space (see contract.ts: origin at the centre of the
// floor, +y up, z along the length, x across).

import type { CourtSpec, TeamId } from '../contract';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CourtGeo {
  spec: CourtSpec;
  halfL: number;
  halfW: number;
  /** Rim centres: [0] at +z, [1] at -z. */
  rims: [Vec3, Vec3];
  /** Backboard face z (signed, toward the court), per rim. */
  boardFace: [number, number];
  /** +1 for the +z end, -1 for the -z end. */
  sign: [1, -1];
}

export const BOARD_THICK = 0.06;

export function makeGeo(spec: CourtSpec): CourtGeo {
  const halfL = spec.length / 2;
  const halfW = spec.width / 2;
  const rz = halfL - spec.rimFromBaseline;
  const bz = halfL - spec.boardFromBaseline;
  return {
    spec,
    halfL,
    halfW,
    rims: [
      { x: 0, y: spec.rimHeight, z: rz },
      { x: 0, y: spec.rimHeight, z: -rz },
    ],
    boardFace: [bz, -bz],
    sign: [1, -1],
  };
}

/** Which rim (index into geo.rims) `team` attacks. */
export function attackRim(team: TeamId, halfCourt: boolean): 0 | 1 {
  if (halfCourt) return 0;
  return team === 0 ? 0 : 1;
}

/** Horizontal distance from (x, z) to a rim. */
export function rimDist(geo: CourtGeo, rim: 0 | 1, x: number, z: number): number {
  const r = geo.rims[rim];
  return Math.hypot(x - r.x, z - r.z);
}

/** Is (x, z) a shot from beyond the arc at `rim`? */
export function isThree(geo: CourtGeo, rim: 0 | 1, x: number, z: number): boolean {
  return rimDist(geo, rim, x, z) > geo.spec.threeRadius;
}

/** In bounds (lines are out). Half court also treats the backcourt (z < 0) as out. */
export function inBounds(
  geo: CourtGeo,
  halfCourt: boolean,
  x: number,
  z: number,
  margin = 0,
): boolean {
  if (Math.abs(x) > geo.halfW + margin) return false;
  if (Math.abs(z) > geo.halfL + margin) return false;
  if (halfCourt && z < -margin) return false;
  return true;
}

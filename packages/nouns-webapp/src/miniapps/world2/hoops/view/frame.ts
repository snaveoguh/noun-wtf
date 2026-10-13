// ── Court space → world ─────────────────────────────────────────────────
//
// Sim space (hoops/contract.ts): court-local metres, origin at the centre
// of the floor, +y up, z along the length, x across. Everything the view
// draws lives under one group carrying this transform, so cameras, ballers
// and the ball all work in court space.

import * as THREE from 'three';

import { NJ, njFrame, njToWorld, type NjFrame } from '../../world/mountain/nounJersey';
import { JERSEY_COURT_PARK } from '../contract';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Maps a court-space point to the world. A rigid map (rotation +
 * translation) is expected; a mirrored one also works (the court group then
 * carries a negative scale).
 */
export type CourtToWorld = (x: number, y: number, z: number, out: Vec3Like) => Vec3Like;

/** The court's world matrix, measured from any CourtToWorld (or given directly). */
export function courtMatrix(map: CourtToWorld | THREE.Matrix4): THREE.Matrix4 {
  if (map instanceof THREE.Matrix4) return map.clone();
  const o = { x: 0, y: 0, z: 0 };
  const px = { x: 0, y: 0, z: 0 };
  const py = { x: 0, y: 0, z: 0 };
  const pz = { x: 0, y: 0, z: 0 };
  map(0, 0, 0, o);
  map(1, 0, 0, px);
  map(0, 1, 0, py);
  map(0, 0, 1, pz);
  const m = new THREE.Matrix4();
  m.set(
    px.x - o.x,
    py.x - o.x,
    pz.x - o.x,
    o.x,
    px.y - o.y,
    py.y - o.y,
    pz.y - o.y,
    o.y,
    px.z - o.z,
    py.z - o.z,
    pz.z - o.z,
    o.z,
    0,
    0,
    0,
    1,
  );
  return m;
}

const CA = (JERSEY_COURT_PARK.a0 + JERSEY_COURT_PARK.a1) / 2;
const CB = (JERSEY_COURT_PARK.b0 + JERSEY_COURT_PARK.b1) / 2;

/**
 * The Noun Jersey court as a rigid CourtToWorld: court z = park b − 18
 * (team 0's +z basket is the downhill one, park b 28.85), court x = park
 * a − 59 times the frame's side, which keeps the map a pure rotation
 * whichever side of the line the park landed on. Floor at the pad level.
 */
export function jerseyCourtToWorld(f: NjFrame | null = njFrame()): CourtToWorld | null {
  if (f === null) return null;
  const p = { x: 0, z: 0 };
  return (x, y, z, out) => {
    njToWorld(f, CA + x * f.side, CB + z, p);
    out.x = p.x;
    out.y = f.P + y;
    out.z = p.z;
    return out;
  };
}

/** Park coords of a court point (handy for tests / debugging). */
export function courtToPark(f: NjFrame, x: number, z: number) {
  return { a: CA + x * f.side, b: CB + z, u: CB + z + NJ.U0 };
}

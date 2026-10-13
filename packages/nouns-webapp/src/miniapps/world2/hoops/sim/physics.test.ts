// Ball physics: swishes, banks, rim-outs, bounces.

import { describe, expect, it } from 'vitest';

import { JERSEY_COURT, SIM_DT } from '../contract';

import { type BallBody, newContacts, resetContacts, stepBall } from './ball';
import { makeGeo, type Vec3 } from './court';
import { backspin, predict, solveShot } from './shot';

const geo = makeGeo(JERSEY_COURT);
const rim = geo.rims[0];

interface Flight {
  made: boolean;
  rim: boolean;
  board: boolean;
  net: boolean;
}

/** Fly a ball with the live integrator at SIM_DT. */
function fly(from: Vec3, v: Vec3, spin: Vec3): Flight {
  const b: BallBody = { ...from, vx: v.x, vy: v.y, vz: v.z, sx: spin.x, sy: spin.y, sz: spin.z };
  const c = newContacts();
  const out: Flight = { made: false, rim: false, board: false, net: false };
  for (let i = 0; i < 400; i++) {
    resetContacts(c);
    stepBall(b, SIM_DT, geo, c);
    if (c.rim > 0) out.rim = true;
    if (c.board > 0) out.board = true;
    if (c.through === 0) out.made = true;
    if (c.net === 0) out.net = true;
    if (c.floor > 0) break;
  }
  return out;
}

function shootFrom(x: number, z: number, aim: Vec3 = rim, elev = 0.9, bank = false) {
  const from = { x, y: 2.4, z };
  const v = solveShot(geo, from, aim, elev, bank, 0);
  return fly(from, v, backspin(rim.x - x, rim.z - z));
}

describe('hoops ball physics', () => {
  it('a perfect release swishes from spots all over the half court', () => {
    const spots: [number, number][] = [
      [0, rim.z - 4.5],
      [0, rim.z - 7.2],
      [-5.5, rim.z - 4.5],
      [5.5, rim.z - 4.5],
      [-7, rim.z - 0.8],
      [7, rim.z - 0.8],
      [2.5, rim.z - 2.5],
      [-3, rim.z - 9],
    ];
    for (const [x, z] of spots) {
      const f = shootFrom(x, z);
      expect(f.made, `shot from ${x}, ${z}`).toBe(true);
      expect(f.rim, `rim from ${x}, ${z}`).toBe(false);
      expect(f.board, `board from ${x}, ${z}`).toBe(false);
      expect(f.net).toBe(true);
    }
  });

  it('a lob off the board banks in', () => {
    for (const [x, z] of [
      [-3, rim.z - 3],
      [3.5, rim.z - 2],
      [-1.5, rim.z - 4],
    ] as [number, number][]) {
      const f = shootFrom(x, z, rim, 0.95, true);
      expect(f.board, `glass from ${x}, ${z}`).toBe(true);
      expect(f.made, `bank from ${x}, ${z}`).toBe(true);
    }
  });

  it('a weak shot rims out', () => {
    // Aimed at the front of the rim: catches iron, does not go in.
    const short = { x: rim.x, y: rim.y, z: rim.z - 0.24 };
    const f = shootFrom(0, rim.z - 5, short);
    expect(f.rim).toBe(true);
    expect(f.made).toBe(false);
    const p = predict(
      geo,
      { x: 0, y: 2.4, z: rim.z - 5 },
      solveShot(geo, { x: 0, y: 2.4, z: rim.z - 5 }, short, 0.9, false, 0),
      backspin(0, 1),
      0,
    );
    expect(p.made).toBe(false);
  });

  it('bounces with energy loss and comes to rest', () => {
    const b: BallBody = { x: 0, y: 3, z: 0, vx: 1.5, vy: 0, vz: 0.5, sx: 0, sy: 0, sz: 0 };
    const c = newContacts();
    const peaks: number[] = [];
    let bounces = 0;
    let lastVy = 0;
    for (let i = 0; i < 60 * 20; i++) {
      resetContacts(c);
      stepBall(b, SIM_DT, geo, c);
      if (c.floor > 0.45) bounces++;
      if (lastVy > 0 && b.vy <= 0) peaks.push(b.y);
      lastVy = b.vy;
    }
    expect(bounces).toBeGreaterThan(4);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(b.y).toBeCloseTo(JERSEY_COURT.ballRadius, 3);
    expect(Math.hypot(b.vx, b.vy, b.vz)).toBe(0);
  });
});

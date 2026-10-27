// ── Test kit: ride a Big Drop kicker the way the board does, then fly it ──
//
// Shared by the track's and the SSX course's tests (terrainCarve.test.ts,
// course.test.ts). Pure: no three.js.

import type { KickerShape } from './track';

import { peakHeight, peakNormal } from '../peakTerrain';

import { PEAK_G } from './trackSpeed';

const n = { x: 0, y: 0, z: 0 };

export interface Flight {
  hang: number;
  x: number;
  z: number;
  ny: number;
  impact: number;
  along: number;
  peak: number;
}

/**
 * Player.updateGround's surface follow (skate/Player.ts), in the vertical
 * plane x = const: physics substeps of ≤ 0.5 m, the ground probe (0.5 m up,
 * snap 0.08 + min(0.35, 0.03 v)), normals read at ±0.5 m (peakNormal) and
 * averaged with nose / tail probes, the board's up easing toward them at
 * 22/s, velocity kept tangent to the board. It leaves the ground when the
 * probe misses or the normal turns > 21.6° away at once. Returns where and
 * at what velocity (z, y components) the board takes off.
 */
export function rideOff(x: number, z0: number, v: number, stopZ: number) {
  const nn = { x: 0, y: 0, z: 0 };
  const norm = (z: number): [number, number] => {
    peakNormal(x, z, nn);
    const l = Math.hypot(nn.y, nn.z);
    return [nn.z / l, nn.y / l];
  };
  let pz = z0;
  let py = peakHeight(x, z0);
  let [uz, uy] = norm(z0);
  let vz = uy * v;
  let vy = -uz * v;
  const dt = 1 / 60;
  const h = dt / Math.max(Math.ceil(dt * 90), Math.ceil((v * dt) / 0.5));
  while (pz < stopZ) {
    const snap = 0.08 + Math.min(0.35, Math.hypot(vz, vy) * 0.03);
    const oz = pz + uz * 0.5;
    const oy = py + uy * 0.5;
    let hit = -1;
    for (let t = 0; t <= 0.5 + snap; t += 0.004)
      if (oy - uy * t < peakHeight(x, oz - uz * t)) {
        hit = t;
        break;
      }
    if (hit < 0) return { z: pz, y: py, vz, vy };
    const hz = oz - uz * hit;
    const [rz, ry] = norm(hz);
    if (rz * uz + ry * uy < 0.93 && vz * rz + vy * ry > 0.6) return { z: pz, y: py, vz, vy };
    let az = rz;
    let ay = ry;
    for (const off of [0.32, -0.32]) {
      const [qz, qy] = norm(hz + uy * off);
      if (qz * rz + qy * ry > 0.6) {
        az += qz;
        ay += qy;
      }
    }
    const al = Math.hypot(az, ay);
    pz = hz;
    py = oy - uy * hit;
    const k = 1 - Math.exp(-22 * h);
    uz += (az / al - uz) * k;
    uy += (ay / al - uy) * k;
    const ul = Math.hypot(uz, uy);
    uz /= ul;
    uy /= ul;
    const gd = -PEAK_G * uy;
    vz -= gd * uz * h;
    vy += (-PEAK_G - gd * uy) * h;
    const vu = vz * uz + vy * uy;
    vz -= vu * uz;
    vy -= vu * uy;
    pz += vz * h;
    py += vy * h;
  }
  return null;
}

/**
 * Ride at `speed` up a kicker's ramp the way the board does (rideOff), then
 * fly ballistically at the Big Drop's gravity and come down on the first
 * ground the path meets.
 */
export function flyKicker(k: KickerShape, x0: number, speed: number): Flight {
  const f = { s: k.s, id: `kicker at ${k.s.toFixed(0)}` };
  const off = rideOff(x0, f.s + k.lip - 25, speed, f.s + k.end + 50);
  if (off === null) throw new Error(`${f.id} at ${speed.toFixed(0)} m/s never left the ground`);
  const vx = 0;
  const vz = off.vz;
  let vy = off.vy;
  let z = off.z;
  let y = off.y;
  let x = x0;
  let time = 0;
  let peak = 0;
  const dt = 1 / 240;
  for (let i = 0; i < 240 * 120; i++) {
    const px = x;
    const py = y;
    const pz = z;
    vy -= PEAK_G * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    time += dt;
    peak = Math.max(peak, y - peakHeight(x, z));
    if (y < peakHeight(x, z)) {
      // Bisect the crossing
      let a = 0;
      let b = 1;
      for (let j = 0; j < 30; j++) {
        const m = (a + b) / 2;
        const mx = px + (x - px) * m;
        const my = py + (y - py) * m;
        const mz = pz + (z - pz) * m;
        if (my > peakHeight(mx, mz)) a = m;
        else b = m;
      }
      x = px + (x - px) * b;
      z = pz + (z - pz) * b;
      peakNormal(x, z, n);
      const impact = -(vx * n.x + vy * n.y + vz * n.z);
      const tx = vx + n.x * impact;
      const ty = vy + n.y * impact;
      const tz = vz + n.z * impact;
      return { hang: time, x, z, ny: n.y, impact, along: Math.hypot(tx, ty, tz), peak };
    }
  }
  throw new Error('never came down');
}

// ── The Big Drop's NPC hoverboarders in the basin: free riding (pure) ───
//
// Past the end of the race line there's no line to follow, so out on the
// basin's snowfield (terrainBasin.ts) the riders free-ride round the player
// instead: each one heads the way the player is going, carving wide turns,
// and every second or so looks ahead for a kicker roughly on its way, lines
// up on its ramp and sends it. Valleys and swells throw them too: the same
// rule as on the line, the ground falling away faster than gravity can
// follow. Same RiderState as riderSim.ts (s = peak z, lat = peak x, v = z
// speed, for riders.ts), plus the free-riding fields; spawned on a ring
// round the player and recycled once they're out of the pack.

import type { BasinKicker } from './terrainBasin';

import {
  RIDER,
  riderLaunch,
  riderPickPace,
  riderPopFor,
  type RiderState,
  type Rng,
} from './riderSim';

export const BASIN_RIDER = {
  /** Recycled beyond this from the player (m). */
  window: 1600,
  /** Never slower than this over the snow (m/s), even with the player stood still. */
  minSpeed: 22,
  /** Steering: heading follows its target at this rate (1/s), turning at most `maxTurn` rad/s. */
  steer: 2.4,
  maxTurn: 1.5,
  /** Further than this from the player (m), it drifts back toward the pack. */
  leash: 650,
  /** Looks for a kicker this far ahead (m). */
  look: 320,
} as const;

/** The pack this frame, as (peak x, peak z, speed) triples, for the wildlife to flee. */
export const basinPack: number[] = [];

export interface BasinEnv {
  /** Surface height at (x, z), peak coordinates. */
  height(x: number, z: number): number;
  /** Kickers centred within `r` m of (x, z). */
  kickersNear(x: number, z: number, r: number): readonly BasinKicker[];
  /** The player: peak x, z, heading (rad, atan2(dx, dz)), speed over the snow (m/s). */
  px: number;
  pz: number;
  phd: number;
  pv: number;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** (Re)spawn a free rider on a ring round the player: slow ones ahead, fast ones behind. */
export function basinSpawn(r: RiderState, env: BasinEnv, rng: Rng, initial = false): RiderState {
  r.free = true;
  r.pace = riderPickPace(rng);
  const ahead = r.pace < 0.92 ? true : r.pace > 1.12 ? false : rng() < 0.6;
  const spread = (rng() - 0.5) * (initial ? 2.4 : 1.4);
  const ang = env.phd + (ahead ? 0 : Math.PI) + spread;
  const dist = initial ? 90 + rng() * 650 : 220 + rng() * 520;
  r.x = env.px + Math.sin(ang) * dist;
  r.s = env.pz + Math.cos(ang) * dist;
  r.lat = r.x;
  r.hd = env.phd + (rng() - 0.5) * 0.7;
  r.sp = Math.max(BASIN_RIDER.minSpeed, env.pv * r.pace);
  r.amp = 0.4 + rng() * 0.6;
  r.rate = (2 * Math.PI) / (3 + rng() * 4);
  r.phase = rng() * Math.PI * 2;
  r.powder = true;
  r.bias = 0;
  r.latV = 0;
  r.latA = 0;
  r.vx = Math.sin(r.hd) * r.sp;
  r.v = Math.cos(r.hd) * r.sp;
  r.y = env.height(r.x, r.s);
  r.vy = 0;
  r.air = false;
  r.airT = 0;
  r.airDur = 0;
  r.sinceLand = 9;
  r.landImpact = 0;
  r.trick = 'none';
  r.spin = 0;
  r.hopIn = 5 + rng() * 10;
  r.age = 0;
  r.aiming = false;
  r.aimT = rng();
  r.launched = false;
  r.landed = false;
  return r;
}

/** Out of the pack for good: too far, or somewhere the player won't see it again. */
export function basinShouldRecycle(r: RiderState, env: BasinEnv): boolean {
  const dx = r.x - env.px;
  const dz = r.s - env.pz;
  if (Math.hypot(dx, dz) > BASIN_RIDER.window) return true;
  const along = dx * Math.sin(env.phd) + dz * Math.cos(env.phd);
  if (along < -350 && r.sp <= env.pv + 0.5) return true;
  if (along > 1300 && r.sp > env.pv + 0.5) return true;
  return false;
}

/** Pick a kicker ahead to send (sets the aim fields; none → not aiming). */
export function basinPickAim(r: RiderState, env: BasinEnv, rng: Rng): void {
  const fx = Math.sin(r.hd);
  const fz = Math.cos(r.hd);
  const L = BASIN_RIDER.look;
  let best: BasinKicker | null = null;
  let bestD = Infinity;
  for (const k of env.kickersNear(r.x + fx * L * 0.6, r.s + fz * L * 0.6, L)) {
    // Its ramp foot, ahead of us, and facing roughly our way
    const lip = k.shape.lip;
    const footX = k.x - k.dx * lip * 1.6;
    const footZ = k.z - k.dz * lip * 1.6;
    const ox = footX - r.x;
    const oz = footZ - r.s;
    const d = Math.hypot(ox, oz);
    if ((ox * fx + oz * fz) / Math.max(1, d) < 0.45 || d < 25) continue;
    if (k.dx * fx + k.dz * fz < 0.55) continue;
    const score = d * (0.7 + 0.6 * rng());
    if (score < bestD) {
      bestD = score;
      best = k;
    }
  }
  r.aiming = best !== null;
  if (best === null) return;
  r.aimX = best.x;
  r.aimZ = best.z;
  r.aimDx = best.dx;
  r.aimDz = best.dz;
}

/** Metres to the kicker lip it's lined up on (Infinity when not aiming). */
export function basinToLip(r: RiderState): number {
  if (!r.aiming) return Infinity;
  return (r.aimX - r.x) * r.aimDx + (r.aimZ - r.s) * r.aimDz;
}

/** One frame of free riding. */
export function basinStep(r: RiderState, dt: number, env: BasinEnv, rng: Rng): void {
  r.launched = false;
  r.landed = false;
  r.age += dt;
  r.sinceLand += dt;
  // Pace: a multiple of the player's speed, and they keep shredding if you stop
  const want = Math.max(BASIN_RIDER.minSpeed * (0.7 + 0.3 * r.pace), env.pv * r.pace);
  const dv = (want - r.sp) * (1 - Math.exp(-RIDER.speedRate * dt));
  r.sp += Math.max(-RIDER.maxAccel * dt, Math.min(RIDER.maxAccel * dt, dv));
  r.phase += r.rate * dt;
  // Where it wants to head
  if (!r.air) {
    r.aimT -= dt;
    if (r.aimT <= 0 && !(r.aiming && basinToLip(r) < 80)) {
      r.aimT = 1 + rng() * 1.5;
      basinPickAim(r, env, rng);
    }
  }
  let target = env.phd + Math.sin(r.phase) * 0.6 * r.amp;
  const toLip = basinToLip(r);
  if (r.aiming) {
    if (toLip < -40) r.aiming = false;
    else {
      // Head for a point back down the ramp's centre line, then straight up it
      const back = Math.max(0, toLip - 10) * 0.5;
      const tx = r.aimX - r.aimDx * (toLip + back);
      const tz = r.aimZ - r.aimDz * (toLip + back);
      target = toLip < 30 ? Math.atan2(r.aimDx, r.aimDz) : Math.atan2(tx - r.x, tz - r.s);
    }
  }
  // Drift back to the pack when it's wandered off
  const ox = env.px - r.x;
  const oz = env.pz - r.s;
  const far = Math.hypot(ox, oz);
  if (far > BASIN_RIDER.leash) {
    const home = Math.atan2(ox + Math.sin(env.phd) * 250, oz + Math.cos(env.phd) * 250);
    const k = Math.min(1, (far - BASIN_RIDER.leash) / 500);
    target += wrap(home - target) * k;
  }
  let turn = 0;
  if (!r.air) {
    turn = Math.max(
      -BASIN_RIDER.maxTurn,
      Math.min(BASIN_RIDER.maxTurn, wrap(target - r.hd) * BASIN_RIDER.steer),
    );
    r.hd = wrap(r.hd + turn * dt);
    r.latA = r.sp * turn;
  } else r.latA *= Math.exp(-4 * dt);
  // Move
  const x0 = r.x;
  const z0 = r.s;
  r.x += Math.sin(r.hd) * r.sp * dt;
  r.s += Math.cos(r.hd) * r.sp * dt;
  r.lat = r.x;
  r.vx = dt > 0 ? (r.x - x0) / dt : 0;
  r.v = dt > 0 ? (r.s - z0) / dt : 0;
  const h = env.height(r.x, r.s);
  if (r.air) {
    r.airT += dt;
    r.vy -= RIDER.g * dt;
    r.y += r.vy * dt;
    if (r.y <= h) {
      r.landImpact = Math.max(0, -r.vy) * 0.66;
      r.y = h;
      r.vy = 0;
      r.air = false;
      r.trick = 'none';
      r.spin = 0;
      r.sinceLand = 0;
      r.landed = true;
      r.hopIn = Math.max(r.hopIn, 2 + rng() * 6);
    }
    return;
  }
  // Lips, crests and swells throw it when the snow drops away faster than gravity
  const prevVy = r.vy;
  const groundVy = dt > 0 ? (h - r.y) / dt : 0;
  const snap = 0.08 + Math.min(0.35, r.sp * 0.03);
  const ballistic = r.y + prevVy * dt - 0.5 * RIDER.g * dt * dt;
  if (h < ballistic - snap && prevVy > 0.5) {
    riderLaunch(r, prevVy, 0, rng);
    r.y = ballistic;
    if (toLip < 30) r.aiming = false;
    return;
  }
  r.hopIn -= dt;
  if (r.hopIn <= 0 && r.sinceLand > 1.5) {
    r.hopIn = 5 + rng() * 12;
    riderLaunch(r, riderPopFor(1.1 + rng() * 0.6), 0, rng);
    r.y = h;
    return;
  }
  r.y = h;
  r.vy = groundVy;
}

// ── Ball flight, bounce and roll ────────────────────────────────────────
//
// simulateShot flies a launch over a CourseSurface with a fixed step
// (1/240 s) and returns the whole shot: a 30 Hz path for the view, the
// events (land, bounces, trees, the pin, lips, water, OB, rest), where it
// stopped and on what.
//
// Positions are the ball's LOWEST point (its centre minus BALL_R in y), so
// a ball at rest sits exactly at course.height(x, z); the view lifts it by
// BALL_R along up.
//
// Air: gravity, quadratic drag Cd(S) and Magnus lift CL(S) on the velocity
// relative to the wind (S = rω / v, the spin factor), spin decaying with a
// 22 s time constant, the wind on a log profile (its stated speed is at
// 10 m, ~0.6× at 1 m, ~1.2× at 30 m).
//
// Ground: a contact is found by bisection along the step (the surface is a
// heightfield, so a ball above it at the start of a step and below it at
// the end crossed it in that step: it never tunnels). A bounce takes the
// normal speed times restitution (Penner's speed-dependent turf curve,
// scaled per lie) and a friction impulse on the contact slip, which also
// eats spin (the turf's grip on the spin, κ, is under the rigid-ball 1, so
// a wedge keeps enough backspin to check or pull back). Once the hops die
// it slides (friction on the slip) then rolls: 5/7 of gravity along the
// slope, rolling resistance that rises with speed per lie (greens stimp
// ~10), resting when slow and the slope can't move it (5/7·g·sinθ ≤
// μr·g·cosθ). Over a crest faster than gravity can hold it, it takes off.
//
// Hole: a ball whose path crosses the cup (r 0.054) drops if it falls its
// own radius while crossing the chord (≈1.6 m/s dead centre, less off
// centre); faster it lips out (slowed, kicked away from the centre). The
// flagstick (on by default) knocks down balls flying into it.
//
// Water: dropping below a hazard's surface stops it ('water', rest at the
// entry). OB: touching the ground on an 'ob' lie stops it ('ob'). Trees:
// trunks are cylinders that bounce the ball off; canopies (cone for pines,
// ellipsoid otherwise) slow it and may knock it off line, decided by a
// hash of the seed and the tree, so the same shot does the same thing.

import type {
  CourseSurface,
  Launch,
  Lie,
  ShotEvent,
  ShotResult,
  Tree,
  V3,
  Wind,
} from '../contract';

import { hashInts, mulberry32 } from './rng';
import { BALL_R } from './swing';

export const G = 9.81;
export const CUP_R = 0.054;
export const FLAG_R = 0.0125;
export const FLAG_H = 2.13;
const MASS = 0.04593;
const AREA = Math.PI * BALL_R * BALL_R;
const RHO = 1.225;
/** ½ρA/m: drag / lift accel = K · C · v². */
const K = (0.5 * RHO * AREA) / MASS;
export const DT = 1 / 240;
const PATH_EVERY = 8; // 240 / 8 = 30 Hz
const SPIN_TAU = 22;

/** Aerodynamics, tuned so the bag flies its yardages (clubs.test.ts). */
export const AERO = {
  cd0: 0.21,
  cd1: 0.42,
  cl0: 0.04,
  cl1: 1.45,
  clMax: 0.36,
};

export function cdOf(s: number): number {
  return AERO.cd0 + AERO.cd1 * Math.min(s, 0.45);
}
export function clOf(s: number): number {
  if (s <= 0) return 0;
  return Math.min(AERO.clMax, AERO.cl0 + AERO.cl1 * s);
}

interface Phys {
  /** Restitution scale on the turf curve. */
  e: number;
  /** Bounce friction. */
  mu: number;
  /** How hard the ground grips the spin (rigid ball = 1). */
  kappa: number;
  /** Sliding friction. */
  slide: number;
  /** Rolling resistance (μr) and the speed it doubles at (m/s). */
  roll: number;
  vk: number;
}

export const LIE_PHYS: Record<Lie, Phys> = {
  tee: { e: 1, mu: 0.45, kappa: 0.35, slide: 0.35, roll: 0.11, vk: 4 },
  fairway: { e: 1, mu: 0.45, kappa: 0.35, slide: 0.35, roll: 0.11, vk: 4 },
  fringe: { e: 0.9, mu: 0.5, kappa: 0.3, slide: 0.4, roll: 0.13, vk: 4 },
  green: { e: 0.85, mu: 0.65, kappa: 0.25, slide: 0.4, roll: 0.05, vk: 12 },
  rough: { e: 0.7, mu: 0.6, kappa: 0.5, slide: 0.5, roll: 0.3, vk: 3 },
  deep: { e: 0.4, mu: 0.8, kappa: 0.6, slide: 0.7, roll: 0.7, vk: 2 },
  sand: { e: 0.15, mu: 1, kappa: 0.5, slide: 1.2, roll: 1.8, vk: 1 },
  path: { e: 1.5, mu: 0.25, kappa: 0.5, slide: 0.25, roll: 0.035, vk: 15 },
  water: { e: 0, mu: 1, kappa: 1, slide: 2, roll: 3, vk: 1 },
  ob: { e: 0.7, mu: 0.6, kappa: 0.5, slide: 0.5, roll: 0.3, vk: 3 },
};

/** Penner's turf restitution against normal impact speed (m/s). */
export function turfRestitution(vn: number): number {
  const v = Math.abs(vn);
  if (v > 20) return 0.12;
  return Math.max(0.12, 0.51 - 0.0375 * v + 0.000903 * v * v);
}

/** Wind speed factor at height h above the ground (1 at 10 m). */
export function windProfile(h: number): number {
  const z0 = 0.05;
  const hh = Math.max(h, 0.3);
  const f = Math.log(hh / z0) / Math.log(10 / z0);
  return f < 0 ? 0 : f > 1.6 ? 1.6 : f;
}

/** Flat-ground roll distance (m) for a rolling ball starting at v (m/s) on a lie. */
export function rollDistance(v: number, lie: Lie): number {
  const p = LIE_PHYS[lie];
  return (p.vk / (G * p.roll)) * (v - p.vk * Math.log(1 + v / p.vk));
}

/** The rolling speed that runs `d` metres on flat ground of a lie (inverse of rollDistance). */
export function rollSpeedFor(d: number, lie: Lie): number {
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, lie) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface ShotOptions {
  /** Seed for tree deflections (default 0). */
  seed?: number;
  /** Give up after this long (s, default 45). */
  maxTime?: number;
  /** Flagstick in (default true). */
  flagstick?: boolean;
  /** Skip the 30 Hz path (the CPU's look-ahead): path then holds only start and rest. */
  noPath?: boolean;
}

const cloneV = (v: V3): V3 => ({ x: v.x, y: v.y, z: v.z });

/**
 * Fly a shot. `from` is the ball (lowest point; on the ground, or teed up
 * a little above it), `lie` what it's sitting on (only for the start: a
 * ball launched along the ground rolls from the first step).
 */
export function simulateShot(
  course: CourseSurface,
  from: V3,
  lie: Lie,
  launch: Launch,
  wind: Wind,
  pin: V3,
  opts: ShotOptions = {},
): ShotResult {
  const seed = opts.seed ?? 0;
  const maxTime = opts.maxTime ?? 45;
  const flag = opts.flagstick !== false;
  const record = opts.noPath !== true;

  let px = from.x;
  let pz = from.z;
  let py = Math.max(from.y, course.height(px, pz));
  let vx = launch.vel.x;
  let vy = launch.vel.y;
  let vz = launch.vel.z;
  let wx = launch.spin.x;
  let wy = launch.spin.y;
  let wz = launch.spin.z;

  const n: V3 = { x: 0, y: 1, z: 0 };
  course.normal(px, pz, n);

  const path: V3[] = [];
  const events: ShotEvent[] = [];
  if (record) path.push({ x: px, y: py, z: pz });

  // Along the ground from the start (putts, bumps)?
  let ground = vx * n.x + vy * n.y + vz * n.z < 0.3 && py - course.height(px, pz) < 0.005;
  let t = 0;
  let step = 0;
  let landed = false;
  let carry = 0;
  let apexY = py;
  let holed = false;
  let endKind: 'rest' | 'water' | 'ob' | 'holed' | 'time' = 'time';
  let restLie: Lie = lie;
  let sandSeen = lie === 'sand';
  let inCup = false;

  // Trees: a broad-phase cache refreshed every 0.2 s or after moving
  const trees: Tree[] = [];
  let treeT = -1;
  let treeX = 0;
  let treeZ = 0;
  let treeR = 0;
  const inCanopy = new Set<Tree>();
  let canopyHits = 0;

  const ev = (kind: ShotEvent['kind'], speed?: number) => {
    const e: ShotEvent = { t, kind, at: { x: px, y: py, z: pz } };
    if (speed !== undefined) e.speed = speed;
    events.push(e);
  };

  const refreshTrees = () => {
    const sp = Math.hypot(vx, vz);
    treeR = sp * 0.25 + 2;
    treeX = px;
    treeZ = pz;
    treeT = t;
    trees.length = 0;
    course.treesNear(px, pz, treeR, trees);
  };

  /** Trunks: cylinders from the ground to near the top. */
  const trunkHit = (): boolean => {
    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      const dx = px - tr.x;
      const dz = pz - tr.z;
      const rr = tr.trunk + BALL_R;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      if (py < tr.y - 0.5 || py > tr.y + tr.h1 * 0.92) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d;
      const nz = dz / d;
      const vr = vx * nx + vz * nz;
      if (vr >= 0) continue;
      const tx = vx - vr * nx;
      const tz = vz - vr * nz;
      vx = tx * 0.7 - 0.45 * vr * nx;
      vz = tz * 0.7 - 0.45 * vr * nz;
      px = tr.x + nx * rr;
      pz = tr.z + nz * rr;
      wx *= 0.2;
      wy *= 0.2;
      wz *= 0.2;
      ev('tree', -vr);
      return true;
    }
    return false;
  };

  /** Canopies: drag while inside, a deterministic knock on the way in. */
  const canopy = (dt: number) => {
    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      const dx = px - tr.x;
      const dz = pz - tr.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const hr = py - tr.y;
      let inside = false;
      if (hr >= tr.h0 && hr <= tr.h1 && d < tr.r) {
        if (tr.kind === 0) {
          inside = d < (tr.r * (tr.h1 - hr)) / Math.max(tr.h1 - tr.h0, 0.1);
        } else {
          const cy = (tr.h0 + tr.h1) / 2;
          const ry = Math.max((tr.h1 - tr.h0) / 2, 0.1);
          const a = d / tr.r;
          const b = (hr - cy) / ry;
          inside = a * a + b * b < 1;
        }
      }
      if (!inside) {
        inCanopy.delete(tr);
        continue;
      }
      const h = hashInts(seed, Math.round(tr.x * 100), Math.round(tr.z * 100));
      const dens = 0.05 + 0.07 * ((h & 1023) / 1023);
      const sp = Math.hypot(vx, vy, vz);
      const f = Math.exp(-dens * sp * dt);
      vx *= f;
      vy *= f;
      vz *= f;
      if (!inCanopy.has(tr)) {
        inCanopy.add(tr);
        canopyHits++;
        const r = mulberry32(hashInts(h, canopyHits, Math.round(t * 240)));
        ev('tree', sp);
        if (r() < 0.4) {
          // A branch: knocked off somewhere, mostly down and back
          const keep = 0.15 + 0.35 * r();
          const ang = (r() - 0.5) * Math.PI * 1.6;
          const hx = vx;
          const hz = vz;
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          vx = (hx * c - hz * s) * keep * (r() < 0.5 ? -0.6 : 1);
          vz = (hx * s + hz * c) * keep;
          vy = -Math.abs(vy) * keep - r() * 2;
          wx *= 0.3;
          wy *= 0.3;
          wz *= 0.3;
        } else {
          // Through the leaves: a nudge off line
          const ang = (r() - 0.5) * 0.35;
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const hx = vx;
          vx = hx * c - vz * s;
          vz = hx * s + vz * c;
        }
      }
    }
  };

  const onLie = (l: Lie, sp: number): boolean => {
    if (l === 'ob') {
      ev('ob', sp);
      endKind = 'ob';
      restLie = 'ob';
      return true;
    }
    if (l === 'sand' && !sandSeen) {
      sandSeen = true;
      ev('sand', sp);
    }
    return false;
  };

  const waterCheck = (): boolean => {
    const wl = course.waterLevel(px, pz);
    if (wl !== null && py <= wl + 1e-4) {
      py = wl;
      ev('water', Math.hypot(vx, vy, vz));
      endKind = 'water';
      restLie = 'water';
      return true;
    }
    return false;
  };

  outer: while (t < maxTime) {
    step++;
    t = step * DT;
    if (treeT < 0 || t - treeT > 0.2 || Math.hypot(px - treeX, pz - treeZ) > treeR * 0.5)
      refreshTrees();

    if (!ground) {
      // ── In the air ──
      const h0 = course.height(px, pz);
      const wf = windProfile(py - h0);
      const rx = vx - wind.x * wf;
      const ry = vy;
      const rz = vz - wind.z * wf;
      const sp = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
      const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
      const s = (BALL_R * w) / sp;
      const cd = cdOf(s);
      let ax = -K * cd * sp * rx;
      let ay = -K * cd * sp * ry - G;
      let az = -K * cd * sp * rz;
      if (w > 1e-3) {
        const cl = clOf(s);
        // (ω × v) / |ω| · |v| · K · CL
        const f = (K * cl * sp) / w;
        ax += f * (wy * rz - wz * ry);
        ay += f * (wz * rx - wx * rz);
        az += f * (wx * ry - wy * rx);
      }
      vx += ax * DT;
      vy += ay * DT;
      vz += az * DT;
      const decay = Math.exp(-DT / SPIN_TAU);
      wx *= decay;
      wy *= decay;
      wz *= decay;

      const ox = px;
      const oy = py;
      const oz = pz;
      px += vx * DT;
      py += vy * DT;
      pz += vz * DT;
      if (py > apexY) apexY = py;

      if (trees.length) {
        if (trunkHit()) {
          /* bounced off */
        }
        canopy(DT);
      }

      // Flagstick
      if (flag && py - pin.y < FLAG_H && py - pin.y > 0) {
        // Closest approach of this step's segment to the stick (a step can
        // be longer than the stick is thick)
        const sx = px - ox;
        const sz = pz - oz;
        const sl2 = sx * sx + sz * sz;
        const m =
          sl2 > 1e-12 ? Math.max(0, Math.min(1, ((pin.x - ox) * sx + (pin.z - oz) * sz) / sl2)) : 1;
        const qx = ox + sx * m;
        const qz = oz + sz * m;
        const dx = qx - pin.x;
        const dz = qz - pin.z;
        const rr = FLAG_R + BALL_R;
        if (dx * dx + dz * dz < rr * rr) {
          const hs = Math.hypot(vx, vz);
          ev('pin', hs);
          // Normal from the stick toward where the ball came from
          let nx = dx;
          let nz = dz;
          let d = Math.hypot(nx, nz);
          if (d < 1e-6) {
            nx = -vx;
            nz = -vz;
            d = Math.hypot(nx, nz) || 1;
          }
          nx /= d;
          nz /= d;
          if (nx * (ox - pin.x) + nz * (oz - pin.z) < 0) {
            nx = -nx;
            nz = -nz;
          }
          const vr = vx * nx + vz * nz;
          if (vr < 0) {
            vx = (vx - 2 * vr * nx) * 0.1;
            vz = (vz - 2 * vr * nz) * 0.1;
          }
          vy *= 0.5;
          // The stick takes the spin too
          wx *= 0.05;
          wy *= 0.05;
          wz *= 0.05;
          px = pin.x + nx * rr * 1.01;
          pz = pin.z + nz * rr * 1.01;
        }
      }

      // Water surface on the way down
      if (vy < 0 && waterCheck()) break;

      const h = course.height(px, pz);
      if (py <= h) {
        // Bisection for the contact along this step
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) / 2;
          const x = ox + (px - ox) * m;
          const y = oy + (py - oy) * m;
          const z = oz + (pz - oz) * m;
          if (y > course.height(x, z)) lo = m;
          else hi = m;
        }
        px = ox + (px - ox) * hi;
        pz = oz + (pz - oz) * hi;
        py = course.height(px, pz);
        if (waterCheck()) break;

        course.normal(px, pz, n);
        const l = course.lie(px, pz);
        const vnIn = vx * n.x + vy * n.y + vz * n.z;
        const impact = Math.hypot(vx, vy, vz);
        if (!landed) {
          landed = true;
          carry = Math.hypot(px - from.x, pz - from.z);
          ev('land', impact);
        } else if (-vnIn > 0.8) {
          ev('bounce', impact);
        }
        if (onLie(l, impact)) break;
        if (l === 'water') {
          ev('water', impact);
          endKind = 'water';
          restLie = 'water';
          break;
        }
        // Straight in the cup from the air
        {
          const dx = px - pin.x;
          const dz = pz - pin.z;
          if (dx * dx + dz * dz < CUP_R * CUP_R && Math.hypot(vx, vz) < 4) {
            px = pin.x;
            pz = pin.z;
            py = pin.y;
            ev('holed', impact);
            endKind = 'holed';
            holed = true;
            break;
          }
        }

        const P = LIE_PHYS[l];
        const vn = vnIn < 0 ? vnIn : 0;
        const e = Math.min(0.8, turfRestitution(vn) * P.e);
        // Tangential velocity and slip at the contact
        const tvx = vx - vn * n.x;
        const tvy = vy - vn * n.y;
        const tvz = vz - vn * n.z;
        // ω × (−R n)
        const cx = -BALL_R * (wy * n.z - wz * n.y);
        const cy = -BALL_R * (wz * n.x - wx * n.z);
        const cz = -BALL_R * (wx * n.y - wy * n.x);
        let ux = tvx + cx;
        let uy = tvy + cy;
        let uz = tvz + cz;
        const un = ux * n.x + uy * n.y + uz * n.z;
        ux -= un * n.x;
        uy -= un * n.y;
        uz -= un * n.z;
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        let dvx = 0;
        let dvy = 0;
        let dvz = 0;
        if (ul > 1e-6) {
          const Pm = Math.min(P.mu * (1 + e) * -vn, ul / (1 + 2.5 * P.kappa));
          dvx = (-ux / ul) * Pm;
          dvy = (-uy / ul) * Pm;
          dvz = (-uz / ul) * Pm;
        }
        // Δω = −(5κ / 2R) (n × Δv)
        const kk = (-5 * P.kappa) / (2 * BALL_R);
        wx += kk * (n.y * dvz - n.z * dvy);
        wy += kk * (n.z * dvx - n.x * dvz);
        wz += kk * (n.x * dvy - n.y * dvx);
        // Sidespin about the normal mostly dies in the turf
        const wn = wx * n.x + wy * n.y + wz * n.z;
        wx -= wn * n.x * 0.7;
        wy -= wn * n.y * 0.7;
        wz -= wn * n.z * 0.7;

        const vOut = -e * vn;
        vx = tvx + dvx;
        vy = tvy + dvy;
        vz = tvz + dvz;
        if (l === 'sand') {
          // Plugs: sand takes most of what's left
          const keep = Math.max(0, 0.35 - impact * 0.01);
          vx *= keep;
          vy *= keep;
          vz *= keep;
          wx *= 0.3;
          wy *= 0.3;
          wz *= 0.3;
        }
        if (vOut < 0.6) {
          ground = true;
        } else {
          vx += vOut * n.x;
          vy += vOut * n.y;
          vz += vOut * n.z;
          py += 1e-4;
        }
      }
    } else {
      // ── On the ground ── (n is current: set where it landed or last re-grounded)
      const l = course.lie(px, pz);
      if (l === 'water') {
        const wl = course.waterLevel(px, pz);
        if (wl !== null) py = Math.max(py, wl);
        ev('water', Math.hypot(vx, vy, vz));
        endKind = 'water';
        restLie = 'water';
        break;
      }
      if (onLie(l, Math.hypot(vx, vy, vz))) break;
      const P = LIE_PHYS[l];
      const gN = G * n.y;
      // Gravity along the slope
      const gtx = G * n.y * n.x;
      const gty = -G + G * n.y * n.y;
      const gtz = G * n.y * n.z;
      // Contact slip u = v + ω × (−R n)
      const ux = vx - BALL_R * (wy * n.z - wz * n.y);
      const uy = vy - BALL_R * (wz * n.x - wx * n.z);
      const uz = vz - BALL_R * (wx * n.y - wy * n.x);
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);

      if (ul > 0.05) {
        // Sliding: friction on the slip, spin follows
        const fa = Math.min(P.slide * gN, ul / (3.5 * DT));
        const dvx = (-ux / ul) * fa * DT;
        const dvy = (-uy / ul) * fa * DT;
        const dvz = (-uz / ul) * fa * DT;
        const kk = -5 / (2 * BALL_R);
        wx += kk * (n.y * dvz - n.z * dvy);
        wy += kk * (n.z * dvx - n.x * dvz);
        wz += kk * (n.x * dvy - n.y * dvx);
        vx += dvx + gtx * DT;
        vy += dvy + gty * DT;
        vz += dvz + gtz * DT;
      } else {
        // Rolling
        const gt = Math.sqrt(gtx * gtx + gty * gty + gtz * gtz);
        const mu = P.roll * (1 + sp / P.vk);
        if (sp < 0.03 && (5 / 7) * gt <= P.roll * gN) {
          endKind = 'rest';
          restLie = l;
          break;
        }
        const dec = mu * gN * DT;
        if (sp > dec) {
          const f = (sp - dec) / sp;
          vx *= f;
          vy *= f;
          vz *= f;
        } else {
          vx = 0;
          vy = 0;
          vz = 0;
        }
        vx += (5 / 7) * gtx * DT;
        vy += (5 / 7) * gty * DT;
        vz += (5 / 7) * gtz * DT;
        // Spin locked to the roll: ω = (n × v) / R
        wx = (n.y * vz - n.z * vy) / BALL_R;
        wy = (n.z * vx - n.x * vz) / BALL_R;
        wz = (n.x * vy - n.y * vx) / BALL_R;
      }

      const ox = px;
      const oz = pz;
      px += vx * DT;
      py += vy * DT;
      pz += vz * DT;

      if (trees.length) trunkHit();

      // The cup: did this step's segment cross it?
      {
        const sx = px - ox;
        const sz = pz - oz;
        const sl2 = sx * sx + sz * sz;
        let m = 0;
        if (sl2 > 1e-12)
          m = Math.max(0, Math.min(1, ((pin.x - ox) * sx + (pin.z - oz) * sz) / sl2));
        const cx = ox + sx * m - pin.x;
        const cz = oz + sz * m - pin.z;
        const d2 = cx * cx + cz * cz;
        if (d2 < CUP_R * CUP_R) {
          if (!inCup) {
            inCup = true;
            const hs = Math.hypot(vx, vz);
            // Offset of the line from the centre, chord, time over the hole
            let b = 0;
            if (hs > 1e-6) b = Math.abs(((pin.x - ox) * vz - (pin.z - oz) * vx) / hs);
            const chord = 2 * Math.sqrt(Math.max(CUP_R * CUP_R - b * b, 0));
            const tt = chord / Math.max(hs, 1e-6);
            if (0.5 * G * tt * tt >= BALL_R || hs < 0.05) {
              px = pin.x;
              pz = pin.z;
              py = pin.y;
              ev('holed', hs);
              endKind = 'holed';
              holed = true;
              break outer;
            }
            // Lip out: slowed and kicked away from the centre
            ev('lip', hs);
            const side = Math.sign((pin.x - ox) * vz - (pin.z - oz) * vx) || 1;
            const ang = side * (b / CUP_R) * 0.6 + side * 0.08;
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const nvx = (vx * c - vz * s) * 0.7;
            const nvz = (vx * s + vz * c) * 0.7;
            vx = nvx;
            vz = nvz;
          }
        } else if (Math.hypot(px - pin.x, pz - pin.z) > CUP_R * 1.5) {
          inCup = false;
        }
      }

      // Stick to the ground, or take off over a crest
      const h = course.height(px, pz);
      const gap = py - h;
      if (gap > 0.75 * G * DT * DT + 2e-5) {
        ground = false;
      } else {
        py = h;
        course.normal(px, pz, n);
        const vn = vx * n.x + vy * n.y + vz * n.z;
        const before = Math.sqrt(vx * vx + vy * vy + vz * vz);
        vx -= vn * n.x;
        vy -= vn * n.y;
        vz -= vn * n.z;
        if (Math.abs(vn) < 0.3 * before) {
          const after = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (after > 1e-9) {
            const f = before / after;
            vx *= f;
            vy *= f;
            vz *= f;
          }
        }
      }
    }

    if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz))) break;
    if (record && step % PATH_EVERY === 0) path.push({ x: px, y: py, z: pz });
  }

  if (endKind === 'time') {
    restLie = course.lie(px, pz);
    if (restLie === 'water') restLie = 'rough';
  }
  if (endKind === 'rest' || endKind === 'time') {
    py = course.height(px, pz);
    ev('rest');
  }
  const rest = { x: px, y: py, z: pz };
  if (record) {
    const last = path[path.length - 1];
    if (last === undefined || last.x !== px || last.y !== py || last.z !== pz)
      path.push(cloneV(rest));
  } else {
    path.push(cloneV(rest));
  }
  if (!landed) carry = Math.hypot(px - from.x, pz - from.z);
  return {
    path,
    events,
    rest,
    lie: holed ? 'green' : restLie,
    holed,
    carry,
    total: Math.hypot(px - from.x, pz - from.z),
    apex: Math.max(0, apexY - from.y),
  };
}

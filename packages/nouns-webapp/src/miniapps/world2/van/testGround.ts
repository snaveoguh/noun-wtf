// Analytic test grounds for the van physics specs (heightfields + an optional wall).

import {
  substeps,
  VanSim,
  type GroundHit,
  type VanControls,
  type VanGround,
  type WallPush,
} from './physics';

export type Height = (x: number, z: number) => number;

/** A heightfield ground, ray-marched then bisected; normals by central differences. */
export function heightGround(
  height: Height,
  opts: { grip?: number; wallX?: number } = {},
): VanGround {
  const grip = opts.grip ?? 1;
  const g: VanGround = {
    ray(ox, oy, oz, dx, dy, dz, far, out: GroundHit) {
      let gap = oy - height(ox, oz);
      if (gap < 0) {
        if (dy >= 0) return false;
        fill(out, ox, oz, 0, height, grip);
        return true;
      }
      const step = 0.04;
      let t = 0;
      let prev = 0;
      while (t < far) {
        prev = t;
        t = Math.min(far, t + step);
        gap = oy + dy * t - height(ox + dx * t, oz + dz * t);
        if (gap <= 0) {
          let a = prev;
          let b = t;
          for (let k = 0; k < 20; k++) {
            const m = (a + b) / 2;
            if (oy + dy * m - height(ox + dx * m, oz + dz * m) > 0) a = m;
            else b = m;
          }
          fill(out, ox + dx * b, oz + dz * b, b, height, grip);
          return true;
        }
        if (t >= far) break;
      }
      return false;
    },
  };
  if (opts.wallX !== undefined) {
    const wx = opts.wallX;
    g.push = (ax, ay, az, bx, by, bz, r, out: WallPush) => {
      // A wall filling x ≥ wx: push the capsule's deepest end back to x = wx − r
      const deep = Math.max(ax, bx) + r - wx;
      if (deep <= 0) return false;
      out.x = -deep;
      out.y = 0;
      out.z = 0;
      out.nx = -1;
      out.ny = 0;
      out.nz = 0;
      void ay;
      void az;
      void by;
      void bz;
      return true;
    };
  }
  return g;
}

function fill(out: GroundHit, x: number, z: number, d: number, height: Height, grip: number) {
  const e = 0.05;
  const hx = (height(x + e, z) - height(x - e, z)) / (2 * e);
  const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
  const l = Math.hypot(hx, 1, hz);
  out.x = x;
  out.y = height(x, z);
  out.z = z;
  out.nx = -hx / l;
  out.ny = 1 / l;
  out.nz = -hz / l;
  out.d = d;
  out.grip = grip;
}

export function controls(c: Partial<VanControls> = {}): VanControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, ...c };
}

/** Run `secs` of frames at `fps`, substepped like the game does. */
export function run(
  sim: VanSim,
  ground: VanGround,
  secs: number,
  c: VanControls | ((t: number) => VanControls),
  fps = 60,
  each?: (t: number) => void,
) {
  const dt = 1 / fps;
  let t = 0;
  for (let i = 0; i < Math.round(secs * fps); i++) {
    const cc = typeof c === 'function' ? c(t) : c;
    const n = substeps(dt, sim.speed);
    for (let k = 0; k < n; k++) sim.step(dt / n, cc, ground);
    t += dt;
    each?.(t);
  }
}

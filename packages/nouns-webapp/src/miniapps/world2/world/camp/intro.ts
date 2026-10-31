// ── CAMP's opening shot: over the city, in through the window (pure, tested) ──
//
// The first spawn opens on a flying camera: up over the plaza at sunset, a
// sweeping climb round to the tallest tower, a dive at the window (slowing
// as it comes), in through the opening, up over the rider's head under the
// ceiling, swinging round to settle exactly where the game camera sits
// behind them (so the hand-off has no snap). Everything here is numbers: a
// centripetal Catmull–Rom through the shot's points, walked by arc length
// on an ease-out, plus where the camera looks and its field of view.

import type { CampSite } from './site';

export type V3 = [number, number, number];

export interface Shot {
  pos: V3;
  look: V3;
  fov: number;
}

/** Seconds. */
export const INTRO_SECONDS = 7.5;

const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Centripetal Catmull–Rom point between p1 and p2 (u in 0…1). */
function cr(p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 {
  const a = 0.5;
  const t0 = 0;
  const t1 = t0 + Math.max(1e-4, dist(p0, p1) ** a);
  const t2 = t1 + Math.max(1e-4, dist(p1, p2) ** a);
  const t3 = t2 + Math.max(1e-4, dist(p2, p3) ** a);
  const t = t1 + (t2 - t1) * u;
  const A1 = lerp3(p0, p1, (t - t0) / (t1 - t0));
  const A2 = lerp3(p1, p2, (t - t1) / (t2 - t1));
  const A3 = lerp3(p2, p3, (t - t2) / (t3 - t2));
  const B1 = lerp3(A1, A2, (t - t0) / (t2 - t0));
  const B2 = lerp3(A2, A3, (t - t1) / (t3 - t1));
  return lerp3(B1, B2, (t - t1) / (t2 - t1));
}

/** The shot's control points (world), from the city to the final camera. */
export function introPoints(site: CampSite, rider: V3, final: V3): V3[] {
  const o = site.origin;
  const f = site.faceZ;
  const fy = site.floorY;
  const wy = Math.min(site.window.y1 - 0.75, fy + 2.0);
  const head = Math.min(site.ceilY - 0.45, rider[1] + 2.9);
  return [
    [o.x + 75, 92, f - 120], // far out over the plaza, low sun behind
    [o.x + 48, 128, f - 70], // the climb, swinging round
    [o.x + 14, fy + 6, f - 26], // lined up on the window, a little high
    [o.x, wy, f - 7], // straight at it
    [o.x, wy, f + 0.9], // through the opening
    [rider[0], head, rider[2]], // over the rider's head, under the ceiling
    final,
  ];
}

/**
 * The opening shot as a function of time (0…INTRO_SECONDS), ending on
 * `final` / `finalLook` / `finalFov` (the game camera's own pose).
 */
export function introShot(
  site: CampSite,
  rider: V3,
  final: V3,
  finalLook: V3,
  finalFov: number,
): (sec: number) => Shot {
  const pts = introPoints(site, rider, final);
  // Ends padded so the first and last segments have neighbours
  const ext = (a: V3, b: V3): V3 => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
  const P = [ext(pts[0]!, pts[1]!), ...pts, ext(pts[pts.length - 1]!, pts[pts.length - 2]!)];
  // Dense samples + cumulative length, to walk it by distance
  const N = 60;
  const samples: V3[] = [];
  for (let i = 0; i + 3 < P.length; i++)
    for (let k = 0; k < N; k++) samples.push(cr(P[i]!, P[i + 1]!, P[i + 2]!, P[i + 3]!, k / N));
  samples.push(pts[pts.length - 1]!);
  const cum = [0];
  for (let i = 1; i < samples.length; i++)
    cum.push(cum[i - 1]! + dist(samples[i - 1]!, samples[i]!));
  const total = cum[cum.length - 1]!;
  const at = (s: number): V3 => {
    if (s <= 0) return samples[0]!;
    if (s >= total) return samples[samples.length - 1]!;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < s) lo = mid;
      else hi = mid;
    }
    const t = (s - cum[lo]!) / Math.max(1e-6, cum[hi]! - cum[lo]!);
    return lerp3(samples[lo]!, samples[hi]!, t);
  };
  // Where the window is, and the rider's head
  const win: V3 = [site.origin.x, site.floorY + 1.4, site.faceZ];
  const riderHead: V3 = [rider[0], rider[1] + 1.3, rider[2]];
  return (sec: number) => {
    const t = Math.min(1, Math.max(0, sec / INTRO_SECONDS));
    // Fast over the city, slowing right down into the room
    const pos = at(total * (1 - (1 - t) ** 2.4));
    const toRider = smooth(0.62, 0.8, t);
    const toFinal = smooth(0.86, 1, t);
    const look = lerp3(lerp3(win, riderHead, toRider), finalLook, toFinal);
    // Wide as it dives through the window, then the game's own
    const fov = 52 + 22 * smooth(0.55, 0.78, t) * (1 - toFinal) + (finalFov - 52) * toFinal;
    return { pos, look, fov };
  };
}

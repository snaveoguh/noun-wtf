// ── NOUN TAXI: the way there, on the roads (pure) ─────────────────────────
//
// The road network is two things: the plaza's ring road (a rounded square,
// cars/lanes.ts) and the dirt lines (world/mountain/tracks.ts), one main
// out of each alley, branches forking off the mains. Lines only meet in
// the city, so every route is some of:
//   along the line you're on, back up to where it forks / to the alley;
//   round the ring the short way to the alley (or the city destination);
//   out of the alley and down the destination's main line to its s.
// Off every road (cross-country), it's a straight line to the target.
//
// A Route is a polyline (x/z) with cumulative distance; RouteCursor tracks
// progress along it and how far off it the car is (for the re-route).

import type { Destination } from './destinations';

import { laneLength, lanePoint, nearestS, type Lane } from '../../cars/lanes';
import { ALLEYS, RAMP_O1, alleyToWorld, edgeDistance } from '../../world/mountain/config';
import { TRACK_STEP, tracks, type NearestTrack, type Track } from '../../world/mountain/tracks';

/** The middle of the ring road (between the two lanes). */
export const RING: Lane = { R: 63.6, r: 5, dir: 1 };
/** Ring-road samples (m). */
const RING_STEP = 6;
/** Within this of a line you're on it. */
export const ON_LINE = 40;
/** The alley's plaza end (just inside the ring) in the alley frame. */
const MOUTH_O = 63.6;

export interface Route {
  xs: number[];
  zs: number[];
  /** Cumulative distance at each point (m); cum[0] = 0. */
  cum: number[];
  /** Total length (m). */
  length: number;
  /** Whether any of it is on a dirt line (a long haul). */
  road: boolean;
}

export interface RoadPos {
  /** 'city' inside the plaza square, 'line' on a dirt line, 'off' cross-country. */
  kind: 'city' | 'line' | 'off';
  track: Track | null;
  s: number;
}

const _n: NearestTrack = { track: null, d: 0, side: 0, s: 0, k: 0, weight: 0 };
const _lp = { x: 0, z: 0, yaw: 0 };
const _a = { x: 0, z: 0 };

/** Where on the road network a point is. */
export function locate(x: number, z: number): RoadPos {
  if (edgeDistance(x, z) <= 4) return { kind: 'city', track: null, s: 0 };
  const n = tracks.nearest(x, z, _n);
  if (n.track !== null && n.d < ON_LINE) return { kind: 'line', track: n.track, s: n.s };
  return { kind: 'off', track: null, s: 0 };
}

class Builder {
  xs: number[] = [];
  zs: number[] = [];
  road = false;
  push(x: number, z: number) {
    const n = this.xs.length;
    if (n > 0) {
      const dx = x - this.xs[n - 1];
      const dz = z - this.zs[n - 1];
      if (dx * dx + dz * dz < 0.25) return;
    }
    this.xs.push(x);
    this.zs.push(z);
  }
  done(): Route {
    const cum = [0];
    for (let i = 1; i < this.xs.length; i++)
      cum.push(cum[i - 1] + Math.hypot(this.xs[i] - this.xs[i - 1], this.zs[i] - this.zs[i - 1]));
    return { xs: this.xs, zs: this.zs, cum, length: cum[cum.length - 1] ?? 0, road: this.road };
  }
}

/** Along track t from s0 to s1 (either direction), every TRACK_STEP. */
function alongTrack(b: Builder, t: Track, s0: number, s1: number) {
  b.road = true;
  tracks.ensureS(t, Math.max(s0, s1) + TRACK_STEP * 2);
  const at = (s: number) => {
    const f = Math.max(0, Math.min(t.xs.length - 1.0001, (s - t.s0) / TRACK_STEP));
    const i = Math.floor(f);
    const u = f - i;
    b.push(t.xs[i] + (t.xs[i + 1] - t.xs[i]) * u, t.zs[i] + (t.zs[i + 1] - t.zs[i]) * u);
  };
  at(s0);
  const dir = s1 >= s0 ? 1 : -1;
  // the grid points strictly between
  const i0 =
    dir > 0 ? Math.floor((s0 - t.s0) / TRACK_STEP) + 1 : Math.ceil((s0 - t.s0) / TRACK_STEP) - 1;
  const i1 =
    dir > 0 ? Math.ceil((s1 - t.s0) / TRACK_STEP) - 1 : Math.floor((s1 - t.s0) / TRACK_STEP) + 1;
  for (let i = i0; dir > 0 ? i <= i1 : i >= i1; i += dir)
    if (i >= 0 && i < t.xs.length) b.push(t.xs[i], t.zs[i]);
  at(s1);
}

/** Round the ring the short way from the ring point nearest a to the one nearest b. */
function aroundRing(b: Builder, ax: number, az: number, bx: number, bz: number) {
  const P = laneLength(RING);
  const sa = nearestS(RING, ax, az).s;
  const sb = nearestS(RING, bx, bz).s;
  let d = sb - sa;
  d = ((d % P) + P) % P;
  if (d > P / 2) d -= P;
  const n = Math.max(1, Math.ceil(Math.abs(d) / RING_STEP));
  for (let i = 0; i <= n; i++) {
    lanePoint(RING, sa + (d * i) / n, _lp);
    b.push(_lp.x, _lp.z);
  }
}

/** Alley i's two ends: on the ring, and where its main line starts. */
export function alleyEnds(i: number) {
  const al = ALLEYS[i];
  alleyToWorld(al, al.a, MOUTH_O, _a);
  const mouth = { x: _a.x, z: _a.z };
  alleyToWorld(al, al.a, RAMP_O1, _a);
  return { mouth, exit: { x: _a.x, z: _a.z } };
}

/** The main line a track belongs to (itself for a main). */
function rootOf(t: Track): Track {
  let r = t;
  while (r.parent !== null) r = r.parent;
  return r;
}

/** From (track t, s) back up to the city: along t, onto its parent at the fork, … */
function lineToCity(b: Builder, t: Track, s: number) {
  let cur: Track = t;
  let at = s;
  for (;;) {
    alongTrack(b, cur, at, cur.parent === null ? 0 : cur.s0);
    if (cur.parent === null) break;
    at = cur.s0;
    cur = cur.parent;
  }
  // up the alley onto the ring
  const ends = alleyEnds(cur.id - 1);
  b.push(ends.exit.x, ends.exit.z);
  b.push(ends.mouth.x, ends.mouth.z);
}

/**
 * The route from (x, z) to `d`. Pure function of the shared track network,
 * so it's the same for everyone (and for tests).
 */
export function routeTo(x: number, z: number, d: Destination): Route {
  const b = new Builder();
  b.push(x, z);
  const here = locate(x, z);
  if (here.kind === 'off') {
    b.push(d.x, d.z);
    return b.done();
  }
  if (d.track === null || d.s === null) {
    // A city destination
    let rx = x;
    let rz = z;
    if (here.kind === 'line') {
      lineToCity(b, here.track!, here.s);
      rx = b.xs[b.xs.length - 1];
      rz = b.zs[b.zs.length - 1];
    }
    aroundRing(b, rx, rz, d.x, d.z);
    b.push(d.x, d.z);
    return b.done();
  }
  const dest = tracks.tracks.find(t => t.id === d.track && t.depth === 0);
  if (dest === undefined) {
    b.push(d.x, d.z);
    return b.done();
  }
  if (here.kind === 'line') {
    const t = here.track!;
    if (t === dest) {
      alongTrack(b, t, here.s, d.s);
      b.push(d.x, d.z);
      return b.done();
    }
    if (t.parent !== null && rootOf(t) === dest) {
      // On a branch of the destination's line: up the branch to the fork, then along
      let cur: Track = t;
      let at = here.s;
      while (cur.parent !== null) {
        alongTrack(b, cur, at, cur.s0);
        at = cur.s0;
        cur = cur.parent;
      }
      alongTrack(b, dest, at, d.s);
      b.push(d.x, d.z);
      return b.done();
    }
    lineToCity(b, t, here.s);
  }
  const ends = alleyEnds(dest.id - 1);
  aroundRing(b, b.xs[b.xs.length - 1], b.zs[b.zs.length - 1], ends.mouth.x, ends.mouth.z);
  b.push(ends.mouth.x, ends.mouth.z);
  b.push(ends.exit.x, ends.exit.z);
  alongTrack(b, dest, 0, d.s);
  b.push(d.x, d.z);
  return b.done();
}

/** Progress along a route. */
export class RouteCursor {
  /** Segment index (i → i+1) and the fraction along it. */
  i = 0;
  u = 0;
  /** Distance from the route (m) and what's left of it (m). */
  off = 0;
  left = 0;

  constructor(public route: Route) {
    this.left = route.length;
  }

  /** Move the cursor to the nearest point near where it was (a window ahead, a little back). */
  update(x: number, z: number) {
    const r = this.route;
    const n = r.xs.length;
    if (n < 2) {
      this.off = n === 1 ? Math.hypot(x - r.xs[0], z - r.zs[0]) : 0;
      this.left = this.off;
      return;
    }
    const lo = Math.max(0, this.i - 6);
    const hi = Math.min(n - 2, this.i + 90);
    let best = Infinity;
    let bi = this.i;
    let bu = this.u;
    for (let i = lo; i <= hi; i++) {
      const ax = r.xs[i];
      const az = r.zs[i];
      const dx = r.xs[i + 1] - ax;
      const dz = r.zs[i + 1] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      let u = ((x - ax) * dx + (z - az) * dz) / L2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = x - (ax + dx * u);
      const ez = z - (az + dz * u);
      const d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bi = i;
        bu = u;
      }
    }
    this.i = bi;
    this.u = bu;
    this.off = Math.sqrt(best);
    const segL = r.cum[bi + 1] - r.cum[bi];
    this.left = r.length - (r.cum[bi] + segL * bu);
  }

  /** The point `ahead` m further along the route from the cursor. */
  pointAhead(ahead: number, out: { x: number; z: number }): { x: number; z: number } {
    const r = this.route;
    const n = r.xs.length;
    if (n === 0) return out;
    if (n === 1) {
      out.x = r.xs[0];
      out.z = r.zs[0];
      return out;
    }
    const want = r.cum[this.i] + (r.cum[this.i + 1] - r.cum[this.i]) * this.u + ahead;
    let i = this.i;
    while (i < n - 2 && r.cum[i + 1] < want) i++;
    const segL = r.cum[i + 1] - r.cum[i] || 1e-9;
    const u = Math.max(0, Math.min(1, (want - r.cum[i]) / segL));
    out.x = r.xs[i] + (r.xs[i + 1] - r.xs[i]) * u;
    out.z = r.zs[i] + (r.zs[i + 1] - r.zs[i]) * u;
    return out;
  }
}

/** Off the route long enough (or far enough) to plan a new one? */
export function needsReroute(off: number, offFor: number): boolean {
  return off > 140 || (off > 45 && offFor > 2);
}

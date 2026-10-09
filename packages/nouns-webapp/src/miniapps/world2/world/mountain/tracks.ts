// ── Dirt track network: one line out of every alley, forking further out ─
//
// Tracks are polylines grown outward step by step from a fixed seed: a main
// line starts at each alley exit, meanders (smooth 1D noise curvature) but is
// always pulled back to "away from the city", so it only ever goes downhill.
// Mains fork every ~0.7–1.6 km into a side branch that drifts off at an
// angle, runs a few km and fades back into the grass.
//
// Growth is lazy (only as far out as anyone has looked) but strictly
// sequential per track, so the result never depends on query order: every
// client gets the same network. A coarse grid of segment references (each
// segment registered in every cell within INFLUENCE of it) makes "nearest
// track" a single map lookup plus ~15–30 point–segment distances.
//
// Launch ramps are scheduled as each track grows (so they're as
// deterministic as the line itself): the line runs dead straight through
// every ramp's run-in and landing, forks wait until a landing hill has
// recovered, and the terrain carves that landing hill after each lip.

import {
  ALLEYS,
  MOUNTAIN,
  RAMP_O1,
  alleyToWorld,
  edgeDistance,
  hashInts,
  outward,
  smoothstep,
  vnoise1,
  wrapAngle,
} from './config';

const STEP = 12;
const CELL = 64;
/** Max distance at which a track still shapes the terrain (m). */
export const INFLUENCE = 96;
const MAX_K = 1 / 70;
/** Generate this far beyond any queried distance from the city. */
const AHEAD = 300;

export interface Track {
  id: number;
  depth: number;
  /** Along-track distance of point 0. */
  s0: number;
  /** Track ends (fades out) at this along-track distance. */
  end: number;
  xs: number[];
  zs: number[];
  hs: number[];
  ks: number[];
  /** Heading bias off "straight outward" (branches drift away). */
  bias: number;
  biasFade: number;
  nextFork: number;
  forks: number;
  done: boolean;
  seedA: number;
  seedB: number;
  /** Scheduled ramps, in along-track order (lip position filled in once grown). */
  ramps: Ramp[];
  /** Along-track distance of the next ramp lip to schedule. */
  nextRamp: number;
  /** The main line a branch split from. */
  parent: Track | null;
  /** Mega ramp sites (mains only), in along-track order. */
  megas: MegaSite[];
  /** Nominal along-track distance of the next mega ramp site to schedule. */
  nextMega: number;
}

export interface NearestTrack {
  track: Track | null;
  /** Perpendicular distance (INFLUENCE when none). */
  d: number;
  /** Signed: + is to the right of travel. */
  side: number;
  s: number;
  /** Signed curvature (+ = turning right). */
  k: number;
  /** 0..1 strength (branches fade at their end). */
  weight: number;
}

// ── Ramps ──

export type RampSize = 'small' | 'medium' | 'big';

export interface RampSpec {
  size: RampSize;
  /** Lip height (m), deck length (m), width (m), lip slope exponent. */
  height: number;
  length: number;
  width: number;
  power: number;
  /** Landing hill after the lip: extra drop (m) over `land` m, recovered over `recover` m. */
  drop: number;
  land: number;
  recover: number;
}

export const RAMP_SPECS: Record<RampSize, RampSpec> = {
  small: {
    size: 'small',
    height: 1.0,
    length: 5,
    width: 3.8,
    power: 2.0,
    drop: 3,
    land: 45,
    recover: 130,
  },
  medium: {
    size: 'medium',
    height: 2.5,
    length: 10,
    width: 5.2,
    power: 1.8,
    drop: 10,
    land: 130,
    recover: 420,
  },
  big: {
    size: 'big',
    height: 5.2,
    length: 16,
    width: 7.2,
    power: 1.9,
    drop: 20,
    land: 200,
    recover: 820,
  },
};

const RAMP_FIRST = 260;
const RAMP_FIRST_BRANCH = 520;
/** Gap after one landing hill has recovered before the next ramp's run-in. */
const RAMP_GAP = 40;
const RAMP_GAP_JITTER = 200;

export interface Ramp {
  track: Track;
  k: number;
  spec: RampSpec;
  /** Along-track distance of the lip. */
  s: number;
  /** Lip position + heading. */
  x: number;
  z: number;
  heading: number;
}

// ── Mega ramp sites ──
//
// Main lines get a noggles mega ramp set piece (world/MegaRamp.ts) a short
// way below their alley — the hero, on the +Z line — and then every
// 3–5 km. Each site reserves a stretch of the line: dead straight from the
// approach bridge to past the terrace (terrain.ts cuts a level pad into the
// slope there), no launch ramps and no forks. The ramp itself stands beside
// the line, `off` m to one side. Only the along-track position and side are
// fixed here (growth never evaluates the terrain); the pad level, bridge
// length, etc. are resolved lazily by terrain.ts → megaFrame().

export const MEGA_SITE = {
  /** Ramp centreline: lateral offset from the track centre (m). */
  off: 16,
  /** Hero site (+Z main): back of the drop-in deck, along-track m. */
  heroS: 420,
  /** First site on the other mains. */
  first: 2200,
  firstJitter: 1600,
  /** Spacing between sites along a main. */
  gap: 3000,
  gapJitter: 2000,
  /** Straight, ramp-free line this far before / after the drop-in deck. */
  pre: 210,
  post: 300,
  /** No forks this far before the deck (branches must clear the terrace). */
  forkClear: 600,
  /** Sites are fixed this far ahead of the growth frontier. */
  look: 800,
} as const;

export interface MegaSite {
  track: Track;
  k: number;
  /** Along-track distance of the back of the drop-in deck (pad u = 0). */
  s: number;
  /** +1: ramp to the right of travel, −1: to the left. */
  side: number;
  /** Lazily resolved placement (terrain.ts → megaFrame). */
  frame: unknown;
  /** Anchor (ramp middle) — the chunk that owns the build. */
  ax: number;
  az: number;
}

class TrackNetwork {
  tracks: Track[] = [];
  private cells = new Map<number, number[]>();
  /** Every track has grown at least this far from the city. */
  private reach = 0;
  private lastKey = NaN;
  private lastList: number[] | undefined;
  /** Segment refs: track index * 2^20 + point index. */
  private static PACK = 1 << 20;

  constructor() {
    ALLEYS.forEach((al, i) => {
      const p = alleyToWorld(al, al.a, MOUNTAIN.wallZ, { x: 0, z: 0 });
      const h = al.angle;
      this.addTrack({
        id: i + 1,
        depth: 0,
        s0: 0,
        end: Infinity,
        x: p.x,
        z: p.z,
        h,
        bias: 0,
      });
    });
  }

  private addTrack(o: {
    id: number;
    depth: number;
    s0: number;
    end: number;
    x: number;
    z: number;
    h: number;
    bias: number;
    parent?: Track;
  }) {
    const t: Track = {
      id: o.id,
      depth: o.depth,
      s0: o.s0,
      end: o.end,
      xs: [o.x],
      zs: [o.z],
      hs: [o.h],
      ks: [0],
      bias: o.bias,
      biasFade: 2500,
      nextFork: o.s0 + 700 + hashInts(o.id, 1, 11) * 900,
      forks: 0,
      done: false,
      seedA: (MOUNTAIN.seed + o.id * 7919) | 0,
      seedB: (MOUNTAIN.seed + o.id * 104729 + 3) | 0,
      ramps: [],
      parent: o.parent ?? null,
      megas: [],
      nextMega:
        o.depth !== 0
          ? Infinity
          : o.id === 1
            ? MEGA_SITE.heroS
            : MEGA_SITE.first + hashInts(o.id, 0, 61) * MEGA_SITE.firstJitter,
      nextRamp:
        o.s0 + (o.depth === 0 ? RAMP_FIRST : RAMP_FIRST_BRANCH) + hashInts(o.id, 0, 31) * 120,
    };
    this.tracks.push(t);
    return t;
  }

  private grow(ti: number) {
    const t = this.tracks[ti];
    const i = t.xs.length - 1;
    const x = t.xs[i];
    const z = t.zs[i];
    let h = t.hs[i];
    const s = t.s0 + i * STEP;
    if (s >= t.end) {
      t.done = true;
      return;
    }
    const out = outward(x, z, _o);
    const ls = s - t.s0;
    const bias = t.bias * (1 - smoothstep(0, t.biasFade, ls));
    const diff = wrapAngle(Math.atan2(out.x, out.z) + bias - h);
    // Fix the next mega ramp site well before the line gets there: clear of
    // the last launch ramp's landing hill, and far enough ahead that the
    // whole reserved stretch is still to be grown
    if (s + MEGA_SITE.look >= t.nextMega) {
      let sb = Math.max(t.nextMega, s + MEGA_SITE.pre + STEP);
      const lr = t.ramps[t.ramps.length - 1];
      if (lr !== undefined)
        sb = Math.max(sb, lr.s + lr.spec.land + lr.spec.recover + RAMP_GAP + MEGA_SITE.pre);
      const k = t.megas.length;
      t.megas.push({
        track: t,
        k,
        s: sb,
        side: hashInts(t.id, k, 67) < 0.5 ? -1 : 1,
        frame: null,
        ax: NaN,
        az: NaN,
      });
      t.nextMega = sb + MEGA_SITE.gap + hashInts(t.id, k + 1, 61) * MEGA_SITE.gapJitter;
    }
    const mega = this.megaNear(t, s);
    // Schedule the next ramp once its run-in comes into view
    const last = t.ramps[t.ramps.length - 1];
    if ((last === undefined || last.s < t.nextRamp) && s + 60 >= t.nextRamp - 30) {
      const n = t.ramps.length;
      const r = hashInts(t.id, t.nextRamp | 0, 41);
      const spec = r < 0.45 ? RAMP_SPECS.small : r < 0.8 ? RAMP_SPECS.medium : RAMP_SPECS.big;
      // A branch only gets a ramp where its landing hill stays clear of the
      // line it split from (the run-in + landing will be straight from here)
      const blocker = this.megaOverlap(
        t,
        t.nextRamp - spec.length - 40,
        t.nextRamp + spec.land + spec.recover,
      );
      if (blocker !== null) {
        // Keep launch ramps (and their landing hills) off a mega ramp terrace
        t.nextRamp = blocker.s + MEGA_SITE.post + RAMP_GAP + hashInts(t.id, blocker.k, 47) * 120;
      } else if (t.parent !== null && this.nearParent(t, x, z, h, t.nextRamp - s, spec)) {
        t.nextRamp += 150;
      } else {
        t.ramps.push({ track: t, k: n, spec, s: t.nextRamp, x: NaN, z: NaN, heading: NaN });
      }
    }
    const pend = t.ramps[t.ramps.length - 1];
    // Dead straight from the run-in to well into the landing
    const straight =
      (pend !== undefined &&
        s >= pend.s - pend.spec.length - 40 &&
        s <= pend.s + pend.spec.land * 0.8) ||
      (mega !== null && s >= mega.s - MEGA_SITE.pre && s <= mega.s + MEGA_SITE.post);
    if (pend !== undefined && s > pend.s + pend.spec.land * 0.8 && t.nextRamp <= pend.s) {
      t.nextRamp =
        pend.s +
        pend.spec.land +
        pend.spec.recover +
        RAMP_GAP +
        hashInts(t.id, pend.k, 43) * RAMP_GAP_JITTER;
    }
    // Mains run straight out of their alley for a bit before meandering
    const ease = t.depth === 0 ? smoothstep(20, 160, ls) : 1;
    let k =
      (0.0105 * vnoise1(s / 150, t.seedA) + 0.0045 * vnoise1(s / 53, t.seedB)) * ease +
      0.0024 * diff;
    // Never more than ~45° off straight-out-from-the-city, so the line
    // always runs downhill (along-track gradient ≥ slope · cos 45°)
    const raw = wrapAngle(Math.atan2(out.x, out.z) - h);
    if (Math.abs(diff) > 1.0 || Math.abs(raw) > 0.75)
      k = Math.sign(Math.abs(raw) > 0.75 ? raw : diff) * MAX_K;
    k = Math.max(-MAX_K, Math.min(MAX_K, k));
    if (straight) k = 0;
    h += k * STEP;
    const nx = x + Math.sin(h) * STEP;
    const nz = z + Math.cos(h) * STEP;
    t.xs.push(nx);
    t.zs.push(nz);
    t.hs.push(h);
    t.ks.push(k);
    this.index(ti, i);
    // Forks: mains split off a branch every so often
    const ns = s + STEP;
    // (no forking in the middle of a ramp's run-in / landing hill)
    const megaN = this.megaNear(t, ns);
    const busy =
      (pend !== undefined &&
        ns >= pend.s - pend.spec.length - 60 &&
        ns <= pend.s + pend.spec.land + pend.spec.recover) ||
      (megaN !== null &&
        ns >= megaN.s - MEGA_SITE.forkClear &&
        ns <= megaN.s + MEGA_SITE.post + 60);
    if (t.depth === 0 && ns >= t.nextFork && !busy) {
      t.forks++;
      const side = hashInts(t.id, t.forks, 13) < 0.5 ? -1 : 1;
      const len = 1400 + hashInts(t.id, t.forks, 17) * 2200;
      this.addTrack({
        id: t.id * 1000 + t.forks,
        depth: 1,
        s0: ns,
        end: ns + len,
        x: nx,
        z: nz,
        h: h + side * 0.32,
        bias: side * (0.45 + hashInts(t.id, t.forks, 19) * 0.25),
        parent: t,
      });
      t.nextFork = ns + 700 + hashInts(t.id, t.forks + 1, 11) * 900;
    }
  }

  /** The mega site whose fork-free stretch contains s (or null). */
  private megaNear(t: Track, s: number): MegaSite | null {
    for (let i = t.megas.length - 1; i >= 0; i--) {
      const m = t.megas[i];
      if (s >= m.s - MEGA_SITE.forkClear && s <= m.s + MEGA_SITE.post + 60) return m;
      if (s > m.s + MEGA_SITE.post + 60) break;
    }
    return null;
  }

  /** A mega site whose reserved stretch overlaps along-track [a, b], or null. */
  private megaOverlap(t: Track, a: number, b: number): MegaSite | null {
    for (const m of t.megas)
      if (b >= m.s - MEGA_SITE.pre - 20 && a <= m.s + MEGA_SITE.post) return m;
    return null;
  }

  /** Mega ramp sites (on any main) whose anchor lies in the rectangle. */
  megasIn(x0: number, z0: number, x1: number, z1: number): MegaSite[] {
    this.ensure(
      Math.max(
        edgeDistance(x0, z0),
        edgeDistance(x1, z1),
        edgeDistance(x0, z1),
        edgeDistance(x1, z0),
      ) + INFLUENCE,
    );
    const out: MegaSite[] = [];
    for (const t of this.tracks) {
      if (t.depth !== 0) continue;
      for (const m of t.megas) {
        if (Number.isNaN(m.ax)) {
          const p = this.pointAt(t, m.s + 60, _p);
          m.ax = p.x + Math.cos(p.h) * m.side * MEGA_SITE.off;
          m.az = p.z - Math.sin(p.h) * m.side * MEGA_SITE.off;
        }
        if (m.ax >= x0 && m.ax < x1 && m.az >= z0 && m.az < z1) out.push(m);
      }
    }
    return out;
  }

  /** Register segment (point i → i+1) in every cell within INFLUENCE. */
  private index(ti: number, i: number) {
    const t = this.tracks[ti];
    const x0 = Math.min(t.xs[i], t.xs[i + 1]) - INFLUENCE;
    const x1 = Math.max(t.xs[i], t.xs[i + 1]) + INFLUENCE;
    const z0 = Math.min(t.zs[i], t.zs[i + 1]) - INFLUENCE;
    const z1 = Math.max(t.zs[i], t.zs[i + 1]) + INFLUENCE;
    const ref = ti * TrackNetwork.PACK + i;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const key = cellKey(cx, cz);
        let l = this.cells.get(key);
        if (l === undefined) this.cells.set(key, (l = []));
        l.push(ref);
      }
    }
    this.lastKey = NaN;
  }

  /** Grow every live track until it is at least `r` (+ margin) from the city. */
  ensure(r: number) {
    const want = r + AHEAD;
    if (want <= this.reach) return;
    let guard = 0;
    for (;;) {
      let min = Infinity;
      for (let ti = 0; ti < this.tracks.length; ti++) {
        const t = this.tracks[ti];
        if (t.done) continue;
        const n = t.xs.length - 1;
        let d = edgeDistance(t.xs[n], t.zs[n]);
        while (d < want && !t.done && guard++ < 2e6) {
          this.grow(ti);
          const m = t.xs.length - 1;
          d = edgeDistance(t.xs[m], t.zs[m]);
        }
        if (!t.done) min = Math.min(min, d);
      }
      // New branches may have appeared behind the frontier: loop until stable
      if (min >= want || guard >= 2e6) break;
    }
    this.reach = want;
  }

  /**
   * Would a ramp `ahead` m in front of branch t (heading h from x, z) put
   * its run-in or landing hill within reach of the parent line?
   */
  private nearParent(t: Track, x: number, z: number, h: number, ahead: number, spec: RampSpec) {
    const par = t.parent!;
    const s = t.s0 + (t.xs.length - 1) * STEP;
    this.ensureS(par, s + ahead + spec.land + spec.recover + 400);
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const r = INFLUENCE + 50;
    for (let q = ahead - spec.length - 40; q <= ahead + spec.land + spec.recover * 0.6; q += 30) {
      const px = x + fx * q;
      const pz = z + fz * q;
      for (let i = 0; i < par.xs.length; i += 2) {
        const dx = par.xs[i] - px;
        const dz = par.zs[i] - pz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /** Make sure `t` has points out to along-track distance s. */
  ensureS(t: Track, s: number) {
    if (t.done || t.s0 + (t.xs.length - 1) * STEP >= s) return;
    const ti = this.tracks.indexOf(t);
    while (!t.done && t.s0 + (t.xs.length - 1) * STEP < s) this.grow(ti);
  }

  /** Per-track nearest points (≤ 8 tracks) from the last nearestAll(). */
  readonly near: NearestTrack[] = Array.from({ length: 8 }, () => ({
    track: null,
    d: INFLUENCE,
    side: 0,
    s: 0,
    k: 0,
    weight: 0,
  }));
  nearCount = 0;

  /**
   * Closest point of every track within INFLUENCE of (x, z) → this.near[0 ..
   * nearCount). Distances are *effective*: a fading track (branch end, alley
   * start) counts as further away, so anything built from them stays
   * continuous. Returns the overall nearest (or `out` with track = null).
   */
  nearest(x: number, z: number, out: NearestTrack): NearestTrack {
    this.ensure(edgeDistance(x, z) + INFLUENCE);
    out.track = null;
    out.d = INFLUENCE;
    out.side = 0;
    out.s = 0;
    out.k = 0;
    out.weight = 0;
    this.nearCount = 0;
    const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    let list: number[] | undefined;
    if (key === this.lastKey) list = this.lastList;
    else {
      list = this.cells.get(key);
      this.lastKey = key;
      this.lastList = list;
    }
    if (list === undefined) return out;
    const near = this.near;
    for (let n = 0; n < list.length; n++) {
      const ref = list[n];
      const ti = Math.floor(ref / TrackNetwork.PACK);
      const i = ref - ti * TrackNetwork.PACK;
      const t = this.tracks[ti];
      const ax = t.xs[i];
      const az = t.zs[i];
      const dx = t.xs[i + 1] - ax;
      const dz = t.zs[i + 1] - az;
      let u = ((x - ax) * dx + (z - az) * dz) / (STEP * STEP);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = x - (ax + dx * u);
      const ez = z - (az + dz * u);
      const d2 = ex * ex + ez * ez;
      if (d2 >= INFLUENCE * INFLUENCE) continue;
      let e: NearestTrack | null = null;
      for (let q = 0; q < this.nearCount; q++) if (near[q].track === t) e = near[q];
      if (e !== null && d2 >= e.d * e.d) continue;
      const s = t.s0 + (i + u) * STEP;
      let w = Number.isFinite(t.end) ? smoothstep(t.end, t.end - 260, s) : 1;
      if (t.depth === 0) w *= smoothstep(0, 10, s);
      const de = Math.sqrt(d2) + (1 - w) * INFLUENCE;
      if (de >= INFLUENCE) continue;
      if (e === null) {
        if (this.nearCount >= near.length) continue;
        e = near[this.nearCount++];
        e.track = t;
      } else if (de >= e.d) continue;
      e.d = de;
      e.side = (ex * dz - ez * dx) / STEP;
      e.s = s;
      e.k = t.ks[i] + (t.ks[i + 1] - t.ks[i]) * u;
      e.weight = w;
    }
    for (let q = 0; q < this.nearCount; q++) {
      const e = near[q];
      if (e.d < out.d) {
        out.track = e.track;
        out.d = e.d;
        out.side = e.side;
        out.s = e.s;
        out.k = e.k;
        out.weight = e.weight;
      }
    }
    return out;
  }

  /** Point + heading at along-track distance s (clamped to what exists). */
  pointAt(t: Track, s: number, out: { x: number; z: number; h: number; k: number }) {
    this.ensureS(t, s + STEP);
    const f = Math.max(0, Math.min(t.xs.length - 1.0001, (s - t.s0) / STEP));
    const i = Math.floor(f);
    const u = f - i;
    out.x = t.xs[i] + (t.xs[i + 1] - t.xs[i]) * u;
    out.z = t.zs[i] + (t.zs[i + 1] - t.zs[i]) * u;
    out.h = t.hs[i + 1];
    out.k = t.ks[i] + (t.ks[i + 1] - t.ks[i]) * u;
    return out;
  }

  /** Ramp k on track t (lip filled in), or null. */
  rampAt(t: Track, k: number): Ramp | null {
    const r = t.ramps[k];
    if (r === undefined) return null;
    if (Number.isNaN(r.x)) {
      if (r.s > t.end - 300) return null;
      const p = this.pointAt(t, r.s, _p);
      r.x = p.x;
      r.z = p.z;
      r.heading = p.h;
    }
    return r;
  }

  /** Ramp indices whose lip / landing hill could affect along-track distance s. */
  rampRange(t: Track, s: number): [number, number] {
    // Make sure ramps up to just past s are scheduled
    this.ensureS(t, s + 120);
    const list = t.ramps;
    if (list.length === 0) return [0, -1];
    // Landing zones never overlap, so only the last lip before s (+ neighbours) matter
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid].s <= s) lo = mid;
      else hi = mid - 1;
    }
    return [Math.max(0, lo - 1), Math.min(list.length - 1, lo + 1)];
  }

  /** All ramps whose lip lies in the rectangle. */
  rampsIn(x0: number, z0: number, x1: number, z1: number): Ramp[] {
    this.ensure(
      Math.max(
        edgeDistance(x0, z0),
        edgeDistance(x1, z1),
        edgeDistance(x0, z1),
        edgeDistance(x1, z0),
      ) + INFLUENCE,
    );
    const sRange = new Map<Track, [number, number]>();
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const l = this.cells.get(cellKey(cx, cz));
        if (l === undefined) continue;
        for (const ref of l) {
          const ti = Math.floor(ref / TrackNetwork.PACK);
          const i = ref - ti * TrackNetwork.PACK;
          const t = this.tracks[ti];
          const s = t.s0 + i * STEP;
          const r = sRange.get(t);
          if (r === undefined) sRange.set(t, [s, s + STEP]);
          else {
            r[0] = Math.min(r[0], s);
            r[1] = Math.max(r[1], s + STEP);
          }
        }
      }
    }
    const out: Ramp[] = [];
    for (const [t, [sa, sb]] of sRange) {
      this.ensureS(t, sb + 120);
      for (let k = 0; k < t.ramps.length; k++) {
        const q = t.ramps[k];
        if (q.s < sa - 40 || q.s > sb + 40) continue;
        const r = this.rampAt(t, k);
        if (r !== null && r.x >= x0 && r.x < x1 && r.z >= z0 && r.z < z1) out.push(r);
      }
    }
    return out;
  }

  /** Main track that starts at alley `i`. */
  main(i: number): Track {
    return this.tracks.find(t => t.id === i + 1)!;
  }
}

const _o = { x: 0, z: 0 };
const _p = { x: 0, z: 0, h: 0, k: 0 };

function cellKey(cx: number, cz: number) {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/** The one shared network (pure function of the seed). */
export const tracks = new TrackNetwork();

/** Start of the main line out of alley i (beyond its ramp). */
export function alleyExit(i: number, out: { x: number; z: number }) {
  return alleyToWorld(ALLEYS[i], ALLEYS[i].a, RAMP_O1, out);
}

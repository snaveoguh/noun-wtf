// ── Mega ramp set piece ──────────────────────────────────────────────────
//
// A Bob Burnquist-style backyard mega ramp, built in code and fully
// self-contained: a 25 m scaffold roll-in, a flat run-up deck, a big
// kicker, a 13 m gap, a long downhill landing, a run-out with a giant
// grindable rainbow arch (red pixel noggles hanging in the middle) and a
// vert quarter pipe to finish.
//
// Local frame: x = 0 is the centreline, y = 0 is the ground the scaffold
// stands on, z = 0 is the back of the drop-in deck and +Z is the riding
// direction. Everything (visuals, collision, rails, spawn, footprint) is in
// that frame until `placeMegaRamp` moves it into the world.
//
// Collision meshes are children of `group` (deck surfaces double as their
// own collision; skirts and guard rails are invisible), so moving the group
// moves the collision with it. Rails are plain points and need the same
// transform: `placeMegaRamp` does both consistently.

import type { RailDef } from '../physics/Rails';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { SURFACES } from './proceduralTextures';

// ── Dimensions ───────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const ARCH_TUBE_R = 0.11;

/**
 * Key heights / stations of the build (metres, local frame). Tuned against
 * the skate physics (Player DEFAULT_TUNING: ground speed caps at 17 m/s, so
 * the lip speed is ~14.2 m/s whatever the roll-in height): a straight rolled
 * launch lands a third of the way down the landing slope, an ollie / flip at
 * the lip lands near its foot, both well under the bail impact.
 */
export const MEGA_RAMP = {
  width: 10,
  deckThickness: 0.3,
  /** Drop-in deck height (top surface). */
  topY: 25,
  topDeckLen: 3.5,
  crestRadius: 4,
  rollInAngle: 50 * DEG,
  rollInRadius: 12,
  /** Flat run-up deck between the roll-in and the kicker. */
  runY: 7,
  runFlat: 8,
  kickerHeight: 2.4,
  kickerAngle: 36 * DEG,
  /** Horizontal gap, kicker lip → landing deck. */
  gap: 13,
  /** Landing deck sits a little below the lip. */
  landingDrop: 0.4,
  landingDeckLen: 0.4,
  knuckleRadius: 4,
  landingAngle: 38 * DEG,
  landingRadius: 9,
  /** Run-out floor height (a slab on the ground). */
  floorY: 0.3,
  runOut: 36,
  qpRadius: 5.5,
  qpAngle: 84 * DEG,
  qpDeck: 3,
  /** Arch rail: span along Z, apex height above the run-out floor, side offset. */
  archSpan: 20,
  archHeight: 6.8,
  archFoot: 0.5,
  archLeadIn: 1.8,
  archX: 2.6,
  archStart: 8,
} as const;

export interface MegaRampStations {
  /** z where the drop-in deck ends / roll-in starts. */
  crestZ: number;
  /** z / y of the bottom of the roll-in transition (start of the run deck). */
  runStartZ: number;
  kickerStartZ: number;
  lipZ: number;
  lipY: number;
  landingStartZ: number;
  landingY: number;
  knuckleZ: number;
  landingBottomZ: number;
  runOutStartZ: number;
  archStartZ: number;
  archEndZ: number;
  archApexY: number;
  qpStartZ: number;
  qpLipZ: number;
  qpLipY: number;
  endZ: number;
}

export interface MegaRamp {
  /** Visual + collision, local frame (origin = ground under the back of the drop-in deck). */
  group: THREE.Group;
  /** Collision meshes (children of `group`; deck surfaces are visible, skirts invisible). */
  collision: THREE.Mesh[];
  /** Grind rails (arch + quarter-pipe coping) in the local frame. Feed to `RailSet.load`. */
  rails: RailDef[];
  /** Top of the drop-in, facing +Z. */
  spawn: { position: THREE.Vector3; yaw: number };
  /** Local-space bounds (incl. legs that dip below y = 0 for uneven terrain). */
  footprint: THREE.Box3;
  stations: MegaRampStations;
}

export interface PlacedMegaRamp {
  collision: THREE.Mesh[];
  rails: RailDef[];
  spawn: { position: THREE.Vector3; yaw: number };
  footprint: THREE.Box3;
  matrix: THREE.Matrix4;
}

// ── Small helpers ────────────────────────────────────────────────────────

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) % 2147483647 || 1;
  }
  next() {
    this.s = (this.s * 16807) % 2147483647;
    return (this.s - 1) / 2147483646;
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length) % a.length];
  }
}

const paint = (color: number, roughness = 0.6, metalness = 0.05) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

type P2 = [number, number]; // [z, y]

/** 2D ramp profile in the (z, y) plane, built from straight runs and circular arcs. */
class Profile {
  pts: P2[] = [];
  /** Current heading angle (radians, + = climbing toward +Z). */
  a = 0;
  constructor(z: number, y: number, a = 0) {
    this.pts.push([z, y]);
    this.a = a;
  }
  get z() {
    return this.pts[this.pts.length - 1][0];
  }
  get y() {
    return this.pts[this.pts.length - 1][1];
  }
  line(len: number, step = 1.2) {
    const n = Math.max(1, Math.ceil(len / step));
    const [z0, y0] = [this.z, this.y];
    for (let i = 1; i <= n; i++) {
      const t = (len * i) / n;
      this.pts.push([z0 + Math.cos(this.a) * t, y0 + Math.sin(this.a) * t]);
    }
    return this;
  }
  /** Circular arc turning the heading from the current angle to `to`. */
  arc(to: number, radius: number, stepDeg = 2) {
    const a0 = this.a;
    const n = Math.max(1, Math.ceil(Math.abs(to - a0) / (stepDeg * DEG)));
    let prev = a0;
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((to - a0) * i) / n;
      const chord = 2 * radius * Math.sin(Math.abs(a - prev) / 2);
      const mid = (a + prev) / 2;
      this.pts.push([this.z + Math.cos(mid) * chord, this.y + Math.sin(mid) * chord]);
      prev = a;
    }
    this.a = to;
    return this;
  }
  /** Straight run at the current heading until y reaches `y`. */
  lineToY(y: number) {
    const s = Math.sin(this.a);
    if (Math.abs(s) < 1e-6) return this;
    const len = (y - this.y) / s;
    if (len > 0) this.line(len);
    return this;
  }
  /** Linear-interpolated y at z (profile must be monotonic in z). */
  yAt(z: number): number {
    const p = this.pts;
    if (z <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (p[i][0] >= z) {
        const t = (z - p[i - 1][0]) / Math.max(1e-6, p[i][0] - p[i - 1][0]);
        return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
      }
    }
    return p[p.length - 1][1];
  }
}

/** Per-point unit normals (z, y) of a profile, pointing "up" off the riding surface. */
function profileNormals(pts: P2[]): P2[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dz, dy) || 1;
    return [-dy / l, dz / l];
  });
}

/**
 * A plywood deck that follows a profile: smooth-shaded riding surface,
 * flat-shaded painted sides and underside. Group 0 = top, group 1 = rest.
 */
function deckGeometry(pts: P2[], width: number, thickness: number): THREE.BufferGeometry {
  const nrm = profileNormals(pts);
  const bot: P2[] = pts.map((p, i) => [p[0] - nrm[i][0] * thickness, p[1] - nrm[i][1] * thickness]);
  const hw = width / 2;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    na: THREE.Vector3,
    nb: THREE.Vector3,
    nc: THREE.Vector3,
    nd: THREE.Vector3,
    uva: [number, number],
    uvb: [number, number],
    uvc: [number, number],
    uvd: [number, number],
  ) => {
    // a-b-c, a-c-d (counter-clockwise seen from the normal side)
    for (const [v, n, t] of [
      [a, na, uva],
      [b, nb, uvb],
      [c, nc, uvc],
      [a, na, uva],
      [c, nc, uvc],
      [d, nd, uvd],
    ] as const) {
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      uv.push(t[0], t[1]);
    }
  };
  const V = (x: number, p: P2) => new THREE.Vector3(x, p[1], p[0]);
  const N = (n: P2) => new THREE.Vector3(0, n[1], n[0]);
  // Arc length along the top for the plank texture's V
  const arc = [0];
  for (let i = 1; i < pts.length; i++)
    arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const S = 0.22; // texture repeats per metre
  // Top surface (smooth normals)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    quad(
      V(hw, p0),
      V(-hw, p0),
      V(-hw, p1),
      V(hw, p1),
      N(nrm[i]),
      N(nrm[i]),
      N(nrm[i + 1]),
      N(nrm[i + 1]),
      [hw * S, arc[i] * S],
      [-hw * S, arc[i] * S],
      [-hw * S, arc[i + 1] * S],
      [hw * S, arc[i + 1] * S],
    );
  }
  const topCount = pos.length / 3;
  // Underside, sides, end caps (flat normals)
  const flat = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    const uvOf = (v: THREE.Vector3): [number, number] =>
      Math.abs(n.x) > 0.7 ? [v.z * S, v.y * S] : [v.x * S, (v.z + v.y) * S];
    quad(a, b, c, d, n, n, n, n, uvOf(a), uvOf(b), uvOf(c), uvOf(d));
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = pts[i];
    const t1 = pts[i + 1];
    const b0 = bot[i];
    const b1 = bot[i + 1];
    flat(V(-hw, b0), V(hw, b0), V(hw, b1), V(-hw, b1)); // underside
    flat(V(hw, b0), V(hw, t0), V(hw, t1), V(hw, b1)); // +x side
    flat(V(-hw, t0), V(-hw, b0), V(-hw, b1), V(-hw, t1)); // -x side
  }
  const f = 0;
  const l = pts.length - 1;
  flat(V(-hw, pts[f]), V(hw, pts[f]), V(hw, bot[f]), V(-hw, bot[f]));
  flat(V(hw, pts[l]), V(-hw, pts[l]), V(-hw, bot[l]), V(hw, bot[l]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, topCount, 0);
  g.addGroup(topCount, pos.length / 3 - topCount, 1);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Invisible collision skirt: closes the space under a raised deck from its
 * underside down to `bottom`, on both sides and (optionally) both ends, so
 * riders bounce off the scaffold instead of clipping into it.
 */
function skirtGeometry(
  pts: P2[],
  width: number,
  thickness: number,
  bottom: number,
  ends: { start: boolean; end: boolean },
): THREE.BufferGeometry {
  const nrm = profileNormals(pts);
  const hw = width / 2;
  const pos: number[] = [];
  const push = (...vs: THREE.Vector3[]) => {
    for (const v of vs) pos.push(v.x, v.y, v.z);
  };
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
    push(a, b, c, a, c, d);
  const under = pts.map((p, i): P2 => [p[0], p[1] - nrm[i][1] * thickness]);
  for (const x of [-hw, hw]) {
    for (let i = 0; i < under.length - 1; i++) {
      const a = under[i];
      const b = under[i + 1];
      quad(
        new THREE.Vector3(x, a[1], a[0]),
        new THREE.Vector3(x, b[1], b[0]),
        new THREE.Vector3(x, bottom, b[0]),
        new THREE.Vector3(x, bottom, a[0]),
      );
    }
  }
  const endWall = (p: P2) =>
    quad(
      new THREE.Vector3(-hw, p[1], p[0]),
      new THREE.Vector3(hw, p[1], p[0]),
      new THREE.Vector3(hw, bottom, p[0]),
      new THREE.Vector3(-hw, bottom, p[0]),
    );
  if (ends.start) endWall(under[0]);
  if (ends.end) endWall(under[under.length - 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Cylinder between two points (for merged scaffold / tube geometry). */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()),
  );
  g.translate(a.x, a.y, a.z);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * Scaffold tower under a deck profile between z0 and z1: legs on a grid,
 * ledgers every `lift` metres and alternating diagonal braces on the outer
 * faces. Returns raw geometries (merged by the caller).
 */
function scaffold(
  under: (z: number) => number,
  z0: number,
  z1: number,
  width: number,
  out: THREE.BufferGeometry[],
  opts: { bay?: number; lift?: number; foot?: number } = {},
) {
  const bay = opts.bay ?? 3.2;
  const lift = opts.lift ?? 3;
  const foot = opts.foot ?? -0.6;
  const n = Math.max(1, Math.round((z1 - z0) / bay));
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(z0 + ((z1 - z0) * i) / n);
  const hw = width / 2 - 0.3;
  const xs = [-hw, 0, hw];
  // Chunky tubes: thin ones turn into solid ink at distance
  const R = 0.11;
  const tops = zs.map(z => under(z) - 0.02);
  // Legs + base plates
  for (let i = 0; i < zs.length; i++) {
    if (tops[i] < 0.3) continue;
    for (const x of xs) {
      out.push(strut(new THREE.Vector3(x, foot, zs[i]), new THREE.Vector3(x, tops[i], zs[i]), R));
      out.push(box(0.36, 0.06, 0.36, x, 0.03, zs[i]));
    }
  }
  // Ledgers + braces
  for (let i = 0; i < zs.length; i++) {
    for (let y = lift; y < tops[i] - 0.4; y += lift) {
      // across the frame (x)
      out.push(strut(new THREE.Vector3(-hw, y, zs[i]), new THREE.Vector3(hw, y, zs[i]), R * 0.8));
      if (i + 1 < zs.length && y < tops[i + 1] - 0.4) {
        for (const x of xs) {
          out.push(
            strut(new THREE.Vector3(x, y, zs[i]), new THREE.Vector3(x, y, zs[i + 1]), R * 0.8),
          );
        }
        // Diagonal on the outer faces (alternating direction per lift)
        const up = y + lift < Math.min(tops[i], tops[i + 1]) - 0.2;
        if (up) {
          const flip = Math.round(y / lift + i) % 2 === 0;
          for (const x of [-hw, hw]) {
            const a = new THREE.Vector3(x, y, flip ? zs[i] : zs[i + 1]);
            const b = new THREE.Vector3(x, y + lift, flip ? zs[i + 1] : zs[i]);
            out.push(strut(a, b, R * 0.7));
          }
        }
      }
    }
  }
}

/** Classic 8-bit noggles in the local (u, v) plane, u = along Z, v = up; 1 px = s metres. */
function noggles(s: number): THREE.Group {
  const red = paint(0xd22209, 0.5);
  const white = paint(0xffffff, 0.5);
  const black = paint(0x0b0b0b, 0.5);
  const g = new THREE.Group();
  g.name = 'MegaNoggles';
  const px = (x: number, y: number, w: number, h: number, m: THREE.Material, d = 1) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d * s, h * s, w * s), m);
    // Pixel x runs along +Z: seen from the -X side the arm is on the left,
    // white lens halves left of black, like the classic glyph
    mesh.position.set(0, (y + h / 2) * s, (x + w / 2 - 5.5) * s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  for (const ox of [0, 8]) {
    px(ox, 0, 6, 1, red);
    px(ox, 5, 6, 1, red);
    px(ox, 1, 1, 4, red);
    px(ox + 5, 1, 1, 4, red);
    px(ox + 1, 1, 2, 4, white, 0.8);
    px(ox + 3, 1, 2, 4, black, 0.8);
  }
  px(6, 3, 2, 1, red);
  px(-3, 3, 3, 1, red);
  px(-3, 1, 1, 2, red);
  return g;
}

// ── Build ────────────────────────────────────────────────────────────────

export function buildMegaRamp(opts: { seed?: number } = {}): MegaRamp {
  const D = MEGA_RAMP;
  const rng = new Rng(opts.seed ?? 1);
  const W = D.width;
  const T = D.deckThickness;

  const group = new THREE.Group();
  group.name = 'MegaRamp';
  const collision: THREE.Mesh[] = [];
  const rails: RailDef[] = [];

  // Materials
  const sidePaint = rng.pick([0x3f8cff, 0xff5a36, 0xa66bff, 0x1fc7b0] as const);
  const trimPaint = rng.pick([0xffd21f, 0xffffff, 0xff7ab8] as const);
  const wood = new THREE.MeshStandardMaterial({
    map: SURFACES.wood(),
    color: 0xfff4e6,
    roughness: 0.8,
    metalness: 0,
  });
  const side = paint(sidePaint, 0.55);
  const trim = paint(trimPaint, 0.5);
  const green = paint(0x3fd463, 0.5, 0.1);
  const steel = paint(0xc9d0d8, 0.3, 0.8);
  const archPaint = paint(0xffd21f, 0.35, 0.4);
  const invisible = new THREE.MeshBasicMaterial({ visible: false });

  const addDeck = (pts: P2[], name: string) => {
    const m = new THREE.Mesh(deckGeometry(pts, W, T), [wood, side]);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    collision.push(m);
    // Painted edge trim strips along both top edges (visual only)
    const strip: THREE.BufferGeometry[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (const x of [-W / 2 + 0.18, W / 2 - 0.18]) {
        const a = new THREE.Vector3(x, pts[i][1] + 0.012, pts[i][0]);
        const b = new THREE.Vector3(x, pts[i + 1][1] + 0.012, pts[i + 1][0]);
        const g = new THREE.PlaneGeometry(0.22, a.distanceTo(b));
        g.rotateX(-Math.PI / 2);
        g.rotateX(-Math.atan2(b.y - a.y, b.z - a.z));
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        strip.push(g);
      }
    }
    const merged = mergeGeometries(strip, false);
    if (merged !== null) {
      const s = new THREE.Mesh(merged, trim);
      s.receiveShadow = true;
      group.add(s);
    }
    return m;
  };
  const addSkirt = (pts: P2[], ends: { start: boolean; end: boolean }) => {
    const m = new THREE.Mesh(skirtGeometry(pts, W, T, -1, ends), invisible);
    m.visible = false;
    m.name = 'MegaRampSkirt';
    group.add(m);
    collision.push(m);
  };

  // ── Section A: drop-in deck → roll-in → run deck → kicker ──────────
  const a = new Profile(0, D.topY);
  a.line(D.topDeckLen, 0.6);
  const crestZ = a.z;
  a.arc(-D.rollInAngle, D.crestRadius, 2);
  // Straight roll-in, sized so the transition bottoms out exactly at runY
  const transDrop = D.rollInRadius * (1 - Math.cos(D.rollInAngle));
  a.lineToY(D.runY + transDrop);
  a.arc(0, D.rollInRadius, 2);
  // Snap tiny float drift so the run deck is perfectly level
  a.pts[a.pts.length - 1][1] = D.runY;
  const runStartZ = a.z;
  a.line(D.runFlat, 1.0);
  const kickerStartZ = a.z;
  const kickerRadius = D.kickerHeight / (1 - Math.cos(D.kickerAngle));
  a.arc(D.kickerAngle, kickerRadius, 1.5);
  const lipZ = a.z;
  const lipY = a.y;
  addDeck(a.pts, 'MegaRampRollIn');
  addSkirt(a.pts, { start: true, end: true });

  // ── Section B: landing deck → knuckle → landing → run-out → QP ─────
  const landingStartZ = lipZ + D.gap;
  const landingY = lipY - D.landingDrop;
  const b = new Profile(landingStartZ, landingY);
  b.line(D.landingDeckLen, 0.5);
  const knuckleZ = b.z;
  b.arc(-D.landingAngle, D.knuckleRadius, 2);
  const landDrop = D.landingRadius * (1 - Math.cos(D.landingAngle));
  b.lineToY(D.floorY + landDrop);
  const landingBottomZ = b.z;
  b.arc(0, D.landingRadius, 2);
  b.pts[b.pts.length - 1][1] = D.floorY;
  const runOutStartZ = b.z;
  b.line(D.runOut, 2);
  const qpStartZ = b.z;
  b.arc(D.qpAngle, D.qpRadius, 3);
  const qpLipZ = b.z;
  const qpLipY = b.y;
  addDeck(b.pts, 'MegaRampLanding');
  // Skirt only under the raised part (landing deck → bottom of landing)
  const raised = b.pts.filter(p => p[0] <= landingBottomZ + 0.01);
  addSkirt(raised, { start: true, end: false });
  // Plinth under the run-out so it sits flush on uneven ground
  {
    const len = qpStartZ - runOutStartZ + 2;
    const plinth = new THREE.Mesh(
      box(W, D.floorY - T + 0.8, len, 0, (D.floorY - T - 0.8) / 2, runOutStartZ - 1 + len / 2),
      side,
    );
    plinth.receiveShadow = true;
    group.add(plinth);
    collision.push(plinth);
  }
  // QP deck + its skirt
  const qpDeck = new Profile(qpLipZ, qpLipY).line(D.qpDeck, 1);
  addDeck(qpDeck.pts, 'MegaRampQPDeck');
  addSkirt(
    [[qpStartZ + 0.6, Math.max(D.floorY, b.yAt(qpStartZ + 0.6) - 0.1)], ...qpDeck.pts] as P2[],
    { start: false, end: true },
  );
  const endZ = qpDeck.z;

  // Coping on the QP lip
  {
    const c = new THREE.Mesh(
      strut(
        new THREE.Vector3(-W / 2, qpLipY + 0.02, qpLipZ + 0.02),
        new THREE.Vector3(W / 2, qpLipY + 0.02, qpLipZ + 0.02),
        0.06,
        12,
      ),
      steel,
    );
    c.castShadow = true;
    group.add(c);
    rails.push({
      id: 'megaramp_qp_coping',
      type: 'coping',
      points: [
        [-W / 2 + 0.2, qpLipY + 0.04, qpLipZ + 0.03],
        [W / 2 - 0.2, qpLipY + 0.04, qpLipZ + 0.03],
      ],
    });
  }

  // ── Scaffolding (green metal) ──────────────────────────────────────
  const scaf: THREE.BufferGeometry[] = [];
  const underA = (z: number) => a.yAt(z) - T;
  const underB = (z: number) => b.yAt(z) - T;
  scaffold(underA, 0.15, lipZ - 0.15, W, scaf);
  scaffold(underB, landingStartZ + 0.15, landingBottomZ, W, scaf);
  scaffold(z => (z < qpLipZ ? b.yAt(z) : qpDeck.yAt(z)) - T, qpStartZ + 1.5, endZ - 0.15, W, scaf, {
    bay: 1.5,
  });
  // Guard rails around the drop-in deck (visual tubes + invisible collision)
  {
    const y0 = D.topY;
    const h = 1.05;
    const hw = W / 2 - 0.05;
    const L = D.topDeckLen - 0.3;
    for (const [p, q] of [
      [new THREE.Vector3(-hw, y0 + h, 0.1), new THREE.Vector3(hw, y0 + h, 0.1)],
      [new THREE.Vector3(-hw, y0 + h, 0.1), new THREE.Vector3(-hw, y0 + h, L)],
      [new THREE.Vector3(hw, y0 + h, 0.1), new THREE.Vector3(hw, y0 + h, L)],
    ] as const) {
      scaf.push(strut(p, q, 0.04));
      scaf.push(strut(p.clone().setY(y0 + h / 2), q.clone().setY(y0 + h / 2), 0.03));
    }
    for (const [x, z] of [
      [-hw, 0.1],
      [hw, 0.1],
      [-hw, L],
      [hw, L],
      [0, 0.1],
    ] as const)
      scaf.push(strut(new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y0 + h, z), 0.04));
    for (const [w, d, x, z] of [
      [W, 0.2, 0, 0.1],
      [0.2, L, -hw, L / 2],
      [0.2, L, hw, L / 2],
    ] as const) {
      const m = new THREE.Mesh(box(w, h, d, x, y0 + h / 2, z), invisible);
      m.visible = false;
      group.add(m);
      collision.push(m);
    }
  }
  const scafMesh = new THREE.Mesh(mergeGeometries(scaf, false)!, green);
  scafMesh.name = 'MegaRampScaffold';
  scafMesh.castShadow = true;
  scafMesh.receiveShadow = true;
  group.add(scafMesh);
  for (const g of scaf) g.dispose();

  // ── Rainbow arch rail + noggles ────────────────────────────────────
  const archStartZ = runOutStartZ + D.archStart;
  const archEndZ = archStartZ + D.archSpan;
  const footY = D.floorY + D.archFoot;
  const archY = (u: number) => {
    // s(u) has zero slope at both ends → the arch grows out of flat feet
    const s = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
    return footY + D.archHeight * Math.sin(Math.PI * s);
  };
  // Flat lead-in feet either side give a generous pop window to lock on
  const archPts: THREE.Vector3[] = [new THREE.Vector3(D.archX, footY, archStartZ - D.archLeadIn)];
  const archN = 80;
  for (let i = 0; i <= archN; i++) {
    const u = i / archN;
    archPts.push(new THREE.Vector3(D.archX, archY(u), archStartZ + u * D.archSpan));
  }
  archPts.push(new THREE.Vector3(D.archX, footY, archEndZ + D.archLeadIn));
  const archApexY = footY + D.archHeight;
  {
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(archPts, false, 'centripetal'),
        260,
        ARCH_TUBE_R,
        10,
        false,
      ),
      archPaint,
    );
    tube.name = 'MegaRampArch';
    tube.castShadow = true;
    group.add(tube);
    const parts: THREE.BufferGeometry[] = [];
    // Feet posts + base plates
    for (const u of [-D.archLeadIn / D.archSpan, 0.06, 0.94, 1 + D.archLeadIn / D.archSpan]) {
      const z = archStartZ + u * D.archSpan;
      const top = archY(Math.min(1, Math.max(0, u))) - 0.08;
      parts.push(
        strut(new THREE.Vector3(D.archX, D.floorY, z), new THREE.Vector3(D.archX, top, z), 0.05),
      );
      parts.push(box(0.5, 0.04, 0.5, D.archX, D.floorY + 0.02, z));
    }
    const posts = new THREE.Mesh(mergeGeometries(parts, false)!, steel);
    posts.castShadow = true;
    group.add(posts);
    // Painted platform pad under the arch (flush decal, no collision)
    const pad = new THREE.Mesh(
      box(
        3.4,
        0.02,
        D.archSpan + 2 * D.archLeadIn + 1.2,
        D.archX,
        D.floorY + 0.011,
        (archStartZ + archEndZ) / 2,
      ),
      trim,
    );
    pad.receiveShadow = true;
    group.add(pad);
    rails.push({
      id: 'megaramp_arch',
      type: 'rail',
      points: archPts.map(p => [p.x, p.y + ARCH_TUBE_R, p.z] as [number, number, number]),
    });

    // Noggles: as big as fits inside the arch with a margin
    let s = 0.5;
    const hang = 0.45;
    const topY = archApexY - ARCH_TUBE_R - hang;
    const halfWidthAt = (y: number) => {
      // arch is symmetric: find u where archY(u) = y on the rising side
      let lo = 0;
      let hi = 0.5;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (archY(m) < y) lo = m;
        else hi = m;
      }
      return (0.5 - lo) * D.archSpan;
    };
    while (s > 0.2) {
      const bottom = topY - 6 * s;
      // noggles span 17 px, centred on px 5.5 (−3 … 14) → 8.5 px either side
      if (halfWidthAt(bottom) - 0.35 > 8.5 * s) break;
      s -= 0.01;
    }
    const nog = noggles(s);
    nog.position.set(D.archX, topY - 6 * s, (archStartZ + archEndZ) / 2);
    group.add(nog);
    // Hangers from the apex
    const hangers: THREE.BufferGeometry[] = [];
    // Above the centre of each lens frame (px 3 and px 11, centred on px 5.5)
    for (const dz of [-2.5 * s, 5.5 * s]) {
      const z = (archStartZ + archEndZ) / 2 + dz;
      hangers.push(
        strut(
          new THREE.Vector3(D.archX, topY - 0.05, z),
          new THREE.Vector3(D.archX, archApexY - 0.05, z),
          0.025,
        ),
      );
    }
    const hm = new THREE.Mesh(mergeGeometries(hangers, false)!, steel);
    group.add(hm);
  }

  group.updateMatrixWorld(true);
  const footprint = new THREE.Box3().setFromObject(group);
  footprint.min.y = Math.min(footprint.min.y, -1);

  return {
    group,
    collision,
    rails,
    spawn: { position: new THREE.Vector3(0, D.topY, D.topDeckLen * 0.45), yaw: 0 },
    footprint,
    stations: {
      crestZ,
      runStartZ,
      kickerStartZ,
      lipZ,
      lipY,
      landingStartZ,
      landingY,
      knuckleZ,
      landingBottomZ,
      runOutStartZ,
      archStartZ,
      archEndZ,
      archApexY,
      qpStartZ,
      qpLipZ,
      qpLipY,
      endZ,
    },
  };
}

/**
 * Move a built ramp into the world: sets the group transform (so its
 * collision children follow) and returns world-space rails, spawn and
 * footprint. `position` is where the local origin lands (ground level under
 * the back of the drop-in deck); `yaw` turns the riding direction (+Z).
 */
export function placeMegaRamp(
  ramp: MegaRamp,
  position: THREE.Vector3,
  yaw: number,
): PlacedMegaRamp {
  const g = ramp.group;
  g.position.copy(position);
  g.rotation.set(0, yaw, 0);
  g.updateMatrixWorld(true);
  const m = g.matrixWorld.clone();
  const v = new THREE.Vector3();
  return {
    collision: ramp.collision,
    rails: ramp.rails.map(r => ({
      ...r,
      points: r.points.map(p => {
        v.set(p[0], p[1], p[2]).applyMatrix4(m);
        return [v.x, v.y, v.z] as [number, number, number];
      }),
    })),
    spawn: {
      position: ramp.spawn.position.clone().applyMatrix4(m),
      yaw: ramp.spawn.yaw + yaw,
    },
    footprint: ramp.footprint.clone().applyMatrix4(m),
    matrix: m,
  };
}

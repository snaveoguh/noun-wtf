// ── GOLF BUGGY: the model, and where the course's buggies go (mostly pure) ──
//
// An electric two-seater in the house box-and-wedge style (kit.ts): a low
// tub on small fat wheels, a front cowl, a bench for two, a canopy roof on
// four thin posts, a windscreen frame (bars only: a solid pane would block
// the chase camera's view), and a bag rack behind the bench carrying a golf
// bag with club heads sticking out. Like every procedural car it's one
// body mesh (paint + glow groups, two draws) plus the shared wheel rig, all
// on the shared car materials (no textures, no new shader programs).
//
// The course (golf/) parks buggies through `CarSystem.parkBuggies(group,
// spots)`; the bookkeeping that doesn't need three.js lives here so it can
// be tested: which spots are new, which paint each gets, how a buggy sits
// on a slope from four wheel probes.

import type { Built } from './models';
import type { CarSpec } from './specs';

import { Kit } from './kit';

/** Where a buggy waits (golf/contract.ts `BuggySpot`, same shape: y = the ground there). */
export interface BuggySpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const DARK = 0x1d1f24;
const CHROME = 0xd7dde2;
const WHITE = 0xf4f1ea;
const SEAT = 0xf3ead6;
const LAMP = 0xfff3c4;
const TAIL = 0xff2d3a;
const BAG = 0xb8322a;
const BAG_TRIM = 0xf4f1ea;
const TYRE = 0x232624;

type V3 = [number, number, number];

/** The buggy's body (models.ts BUILDERS.buggy). */
export function buggyBody(s: CarSpec, P: number): Built {
  const k = new Kit();
  const g = s.geo;
  const L = g.length / 2;
  // chassis: the floor deck, sills between the wheels
  k.box(DARK, [1.16, 0.08, 2.1], [0, 0.3, -0.02]);
  for (const x of [-0.6, 0.6]) k.box(P, [0.08, 0.16, 1.08], [x, 0.38, 0.02]);
  // front cowl over the front wheels, a black bumper, a little lamp pair
  k.box(P, [1.32, 0.34, 0.8], [0, 0.67, g.axleF + 0.02], { noseDrop: 0.14, topZ: 0.86 });
  k.box(DARK, [1.24, 0.1, 0.1], [0, 0.4, L - 0.04]);
  for (const x of [-0.42, 0.42])
    k.box(LAMP, [0.2, 0.08, 0.04], [x, 0.66, L - 0.05], { rot: [0.3, 0, 0] }, true);
  // dash, the steering column and wheel (driver on the left, +X)
  k.box(DARK, [1.2, 0.2, 0.16], [0, 0.9, 0.48], { rot: [-0.25, 0, 0] });
  k.box(DARK, [0.04, 0.04, 0.34], [g.seat[0], 0.98, 0.36], { rot: [-0.85, 0, 0] });
  k.cyl(DARK, 0.17, 0.035, [g.seat[0], 1.1, 0.26], 'z', 12);
  k.cyl(CHROME, 0.04, 0.05, [g.seat[0], 1.1, 0.26], 'z', 6);
  // the bench: base in paint, a cream cushion (top at 0.66) and backrest
  k.box(P, [1.24, 0.26, 0.52], [0, 0.42, -0.2]);
  k.box(SEAT, [1.22, 0.12, 0.5], [0, 0.6, -0.2]);
  k.box(SEAT, [1.22, 0.44, 0.1], [0, 0.88, -0.49], { rot: [-0.14, 0, 0], topX: 0.97 });
  // rear body over the back wheels, tail lamps
  k.box(P, [1.32, 0.34, 0.78], [0, 0.67, g.axleR - 0.06], { tailDrop: 0.04 });
  for (const x of [-0.5, 0.5]) k.box(TAIL, [0.16, 0.08, 0.04], [x, 0.7, -L + 0.01], {}, true);
  // canopy: four thin posts up to a flat roof with a dark rim
  const roofY = g.height - 0.04;
  const postF = 0.42;
  const postR = -0.68;
  for (const x of [-0.6, 0.6]) {
    post(k, [x, 0.84, postF], [x * 0.98, roofY, postF - 0.06]);
    post(k, [x, 0.84, postR], [x * 0.98, roofY, postR]);
  }
  k.box(WHITE, [1.42, 0.06, 1.58], [0, roofY + 0.03, -0.14], { topX: 0.98, topZ: 0.98 });
  k.box(DARK, [1.44, 0.03, 1.6], [0, roofY, -0.14]);
  // windscreen frame: a top bar and a mid rail between the front posts
  k.box(CHROME, [1.18, 0.035, 0.035], [0, roofY - 0.18, postF - 0.05]);
  k.box(CHROME, [1.18, 0.03, 0.03], [0, 1.22, postF - 0.02]);
  // bag rack: a tray on the rear deck and a hoop holding the bag
  const rackZ = -L + 0.36;
  k.box(DARK, [0.56, 0.05, 0.42], [0, 0.87, rackZ]);
  k.box(DARK, [0.5, 0.05, 0.05], [0, 1.14, rackZ + 0.16]);
  for (const x of [-0.24, 0.24]) k.box(DARK, [0.04, 0.3, 0.04], [x, 1.0, rackZ + 0.16]);
  golfBag(k, [0, 0.9, rackZ]);
  return { body: k.build(), flames: null, doors: [] };
}

/** A thin post from `a` to `b` (a box turned to lean between them). */
function post(k: Kit, a: V3, b: V3) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  k.box(CHROME, [0.045, len, 0.045], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], {
    rot: [Math.atan2(dz, dy), 0, -Math.atan2(dx, dy)],
  });
}

/** The bag, leaning back on the rack, with four clubs: two head covers, two irons. */
function golfBag(k: Kit, base: V3) {
  const lean = -0.22;
  const up: V3 = [0, Math.cos(lean), Math.sin(lean)];
  const along = (d: number, side = 0, fwd = 0): V3 => [
    base[0] + side,
    base[1] + up[1] * d,
    base[2] + up[2] * d + fwd,
  ];
  const H = 0.78;
  k.box(BAG, [0.3, H, 0.3], along(H / 2), { rot: [lean, 0, 0], topX: 1.05, topZ: 1.05 });
  k.box(BAG_TRIM, [0.32, 0.06, 0.32], along(0.12), { rot: [lean, 0, 0] });
  k.box(BAG_TRIM, [0.33, 0.07, 0.33], along(H - 0.04), { rot: [lean, 0, 0] });
  // a side pocket and the strap
  k.box(BAG, [0.06, 0.34, 0.2], along(0.42, 0.17), { rot: [lean, 0, 0] });
  k.box(DARK, [0.04, 0.6, 0.04], along(0.45, -0.16, -0.12), { rot: [lean, 0, 0] });
  // clubs out of the top: shafts, then heads
  const clubs: [number, number, number, 'cover' | 'iron', number][] = [
    [-0.08, 0.06, 0.22, 'cover', 0x2f7d4a],
    [0.08, 0.06, 0.19, 'cover', 0xd8232a],
    [-0.07, -0.07, 0.15, 'iron', CHROME],
    [0.07, -0.07, 0.12, 'iron', CHROME],
  ];
  for (const [x, z, h, kind, col] of clubs) {
    const top = along(H + h, x, z);
    k.box(CHROME, [0.022, h + 0.1, 0.022], along(H + h / 2 - 0.05, x, z), { rot: [lean, 0, 0] });
    if (kind === 'cover') {
      k.ball(col, 0.075, top, [1, 1.15, 1]);
      k.ball(WHITE, 0.035, [top[0], top[1] + 0.08, top[2]]);
    } else k.box(col, [0.05, 0.05, 0.11], [top[0], top[1], top[2] + 0.03], { rot: [lean, 0, 0] });
  }
}

/** Small fat wheels: a wide tyre, a white hub, a dark cap (models.ts wheelGeo). */
export function buggyWheel(k: Kit, r: number, w: number) {
  k.cyl(TYRE, r, w, [0, 0, 0], 'x', 12);
  k.cyl(TYRE, r * 0.92, w * 1.12, [0, 0, 0], 'x', 12);
  k.cyl(WHITE, r * 0.58, w * 1.16, [0, 0, 0], 'x', 10);
  k.cyl(DARK, r * 0.2, w * 1.24, [0, 0, 0], 'x', 6);
}

// ── Parking bookkeeping (pure) ──

/** A spot's identity (cm / centiradian), so re-parking the same spots is a no-op. */
export function spotKey(s: BuggySpot): string {
  return `${Math.round(s.x * 100)},${Math.round(s.y * 100)},${Math.round(s.z * 100)},${Math.round(s.yaw * 100)}`;
}

/** The key of a whole group's spot list (order matters: paints go by index). */
export function spotsKey(spots: readonly BuggySpot[]): string {
  return spots.map(spotKey).join(';');
}

/** Valid spots only (finite numbers), so a bad layout can't put a buggy at NaN. */
export function cleanSpots(spots: readonly BuggySpot[]): BuggySpot[] {
  return spots.filter(
    s =>
      s !== null &&
      typeof s === 'object' &&
      [s.x, s.y, s.z, s.yaw].every(n => typeof n === 'number' && Number.isFinite(n)),
  );
}

/** Paint for the i-th buggy of a group: mostly cream, a white and a green now and then. */
export function buggyPaint(i: number, paints: number): number {
  const order = [0, 0, 1, 0, 2, 0, 1, 3];
  return order[((i % order.length) + order.length) % order.length] % Math.max(1, paints);
}

/**
 * How a parked buggy sits on the ground from the heights under its four
 * wheels (FL, FR, RL, RR; +X is the car's left): the origin height and the
 * pitch (nose up +) / roll (left side up +) of the plane through them.
 */
export function restOn(
  h: readonly [number, number, number, number],
  geo: Pick<CarSpec['geo'], 'axleF' | 'axleR' | 'halfTrack'>,
): { y: number; pitch: number; roll: number } {
  const [fl, fr, rl, rr] = h;
  const front = (fl + fr) / 2;
  const rear = (rl + rr) / 2;
  const left = (fl + rl) / 2;
  const right = (fr + rr) / 2;
  const wb = geo.axleF - geo.axleR;
  const pitch = Math.atan2(front - rear, wb);
  const roll = Math.atan2(left - right, 2 * geo.halfTrack);
  // origin sits between the axles' midpoint and the model origin (z = 0)
  const zMid = (geo.axleF + geo.axleR) / 2;
  const y = (front + rear) / 2 - Math.tan(pitch) * zMid;
  return { y, pitch, roll };
}

/** Buggies further than this from the camera aren't built, drawn, collided or stepped (m). */
export const BUGGY_FAR = 250;
/** …and wake again inside this (a little hysteresis, so one on the edge doesn't flicker). */
export const BUGGY_WAKE = 235;

/** Should a buggy at squared distance `d2` be asleep, given whether it is now? */
export function buggyAsleep(d2: number, asleep: boolean): boolean {
  return asleep ? d2 > BUGGY_WAKE * BUGGY_WAKE : d2 > BUGGY_FAR * BUGGY_FAR;
}

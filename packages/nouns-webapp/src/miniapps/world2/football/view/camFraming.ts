// ── Noun Football cameras: the framing math (pure, pitch space) ─────────
//
// Every shot is { pos, look, fov } in pitch-local metres (football/
// contract.ts: centre spot at the origin, +y up, z along the length, x
// across). camera.ts damps between shots and maps them into the world.
//
//   broadcast  the TV gantry on the main stand (x = stand · GANTRY_X,
//              GANTRY_Y up), on a rail along the touchline: it slides with
//              play and zooms (fov) to fit a width of pitch round the
//              focus. Never opens up far enough to show the far stand's
//              roof rim at the top of the frame.
//   player     low, behind the controlled player along the attack.
//   high       tactical: high over the main touchline, the whole width.
//   walkout / celebration / setpiece   the cinematic shots.
//   goalcam / tele                     the replay angles.

import type { PitchSpec } from '../contract';

import { GRASS, STADIUM } from '../contract';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Shot {
  pos: V3;
  look: V3;
  /** Vertical field of view (deg). */
  fov: number;
}

export interface FrameCtx {
  pitch: PitchSpec;
  /** Viewport width / height. */
  aspect: number;
  /** Which touchline the main stand (TV gantry) is on: −1 = −x, +1 = +x. */
  stand: -1 | 1;
}

const DEG = 180 / Math.PI;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

/** The TV gantry: out over the main stand's front rows, up in the roof line. */
export const GANTRY_X = GRASS.width / 2 + 24;
export const GANTRY_Y = 25;
/** The far stand's roof rim: the top of a broadcast frame stays this far under it. */
export const ROOF_MARGIN = 7;
/** Width of pitch a broadcast frame fits round its focus: wide … tight (m). */
export const BROADCAST_WIDE = 58;
export const BROADCAST_TIGHT = 30;

/** Vertical fov (deg) that shows `width` m across at `dist` m, for an aspect. */
export function fovForWidth(width: number, dist: number, aspect: number): number {
  const hf = 2 * Math.atan(width / 2 / Math.max(dist, 1e-3));
  return 2 * Math.atan(Math.tan(hf / 2) / Math.max(aspect, 0.2)) * DEG;
}

/** Elevation (rad, + up) of the direction from `a` to `b`. */
const elevation = (a: V3, b: V3) => Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));

/**
 * Largest vertical fov (deg) from `pos` looking at `look` whose top edge,
 * where it reaches the far stand's outer wall, stays under the roof rim.
 */
export function roofLimitFov(pos: V3, look: V3, stand: -1 | 1): number {
  const farX = -stand * STADIUM.halfX;
  const d = Math.abs(farX - pos.x);
  const maxElev = Math.atan2(STADIUM.height - ROOF_MARGIN - pos.y, d);
  const pitchAng = elevation(pos, look);
  return Math.max(8, (maxElev - pitchAng) * 2 * DEG);
}

/**
 * The broadcast shot round a focus (pitch x / z), `zoom` 0 wide … 1 tight.
 * The rail cam slides along z with play (not all the way: the far end stays
 * a long view, like TV); fov fits the width, capped by the roof rule and
 * on portrait screens.
 */
export function broadcastShot(fx: number, fz: number, zoom: number, ctx: FrameCtx): Shot {
  const { pitch, aspect, stand } = ctx;
  const halfL = pitch.length / 2;
  const camZ = clamp(fz * 0.78, -halfL * 0.72, halfL * 0.72);
  const pos = v3(stand * GANTRY_X, GANTRY_Y, camZ);
  // Look a touch toward the camera from the focus, so the ball sits a
  // little above centre and the play ahead of it gets the room
  const look = v3(fx + stand * 1.5, 0.4, fz);
  const dist = Math.hypot(look.x - pos.x, look.y - pos.y, look.z - pos.z);
  // A small pitch never needs the wide end of a big one
  const wide = Math.min(BROADCAST_WIDE, pitch.length * 0.62);
  const tight = Math.min(BROADCAST_TIGHT, wide * 0.7);
  const width = lerp(wide, tight, clamp(zoom, 0, 1));
  let fov = fovForWidth(width, dist, aspect);
  fov = Math.min(fov, roofLimitFov(pos, look, stand), aspect < 1 ? 58 : 46);
  return { pos, look, fov: Math.max(9, fov) };
}

/**
 * How tight the broadcast frames (0 wide … 1): tighter with the ball in
 * either box, wider when it's flying fast or high.
 */
export function broadcastZoom(
  bx: number,
  by: number,
  bz: number,
  speed: number,
  pitch: PitchSpec,
): number {
  const halfL = pitch.length / 2;
  const toLine = halfL - Math.abs(bz);
  const inBox = Math.abs(bx) < pitch.boxWidth / 2 + 4 && toLine < pitch.boxDepth + 6;
  let z = inBox ? 0.62 : 0.28 * clamp(1 - toLine / halfL, 0, 1);
  z -= clamp((speed - 12) / 18, 0, 1) * 0.45;
  z -= clamp((by - 4) / 10, 0, 1) * 0.35;
  return clamp(z, 0, 1);
}

/** Behind the controlled player, low, looking up the pitch the way they attack (dir ±1 in z). */
export function playerShot(px: number, pz: number, attack: 1 | -1, ctx: FrameCtx): Shot {
  const back = 8.5;
  const pos = v3(px * 0.9, 4.2, pz - attack * back);
  const look = v3(px, 1, pz + attack * 7);
  return { pos, look, fov: ctx.aspect < 1 ? 72 : 55 };
}

/** Tactical: high over the main touchline, the full width of the pitch. */
export function highShot(fz: number, ctx: FrameCtx): Shot {
  const { pitch, aspect, stand } = ctx;
  const halfL = pitch.length / 2;
  const z = clamp(fz * 0.7, -halfL * 0.6, halfL * 0.6);
  const h = Math.max(38, pitch.width * 0.95);
  const pos = v3(stand * pitch.width * 0.42, h, z);
  const look = v3(0, 0, z);
  const dist = Math.hypot(pos.x - look.x, pos.y, 0);
  // Fit a length-wise window (z) across the screen, and both touchlines (x) up it
  const across = fovForWidth(Math.min(pitch.length * 0.75, 70), dist, aspect);
  // Signed angles in the vertical plane across the pitch (a touchline can be behind the camera's foot)
  const ang = (x: number) => Math.atan2(-pos.y, (x - pos.x) * -stand);
  const mid = ang(look.x);
  const near = ang((stand * pitch.width) / 2);
  const far = ang((-stand * pitch.width) / 2);
  const up = 2 * Math.max(Math.abs(near - mid), Math.abs(far - mid)) * DEG * 1.12;
  return { pos, look, fov: clamp(Math.max(across, up), 30, 80) };
}

/** Kick-off walk-out / pre-match: a slow low arc round the centre circle. */
export function walkoutShot(time: number, ctx: FrameCtx): Shot {
  // On the main stand's side of the centre circle, swinging slowly round it
  const b = Math.sin(time * 0.11) * 0.9;
  const r = Math.max(14, ctx.pitch.centreRadius * 1.8);
  const pos = v3(ctx.stand * r * Math.cos(b), 3.2 + Math.sin(time * 0.17) * 0.6, r * Math.sin(b));
  const look = v3(0, 1.3, 0);
  return { pos, look, fov: ctx.aspect < 1 ? 62 : 44 };
}

/** A goal celebration close-up: in front of the scorer, orbiting slowly. */
export function celebrationShot(
  px: number,
  pz: number,
  yaw: number,
  time: number,
  ctx: FrameCtx,
): Shot {
  const a = yaw + Math.sin(time * 0.4) * 0.6;
  const r = 6.2;
  const halfL = ctx.pitch.length / 2 + 4;
  const halfW = ctx.pitch.width / 2 + 3;
  const pos = v3(
    clamp(px + Math.sin(a) * r, -halfW, halfW),
    2.4,
    clamp(pz + Math.cos(a) * r, -halfL, halfL),
  );
  const look = v3(px, 1.35, pz);
  return { pos, look, fov: ctx.aspect < 1 ? 58 : 40 };
}

/** Set piece: behind the ball, on the line from the ball to the goal it's going at. */
export function setPieceShot(bx: number, bz: number, goalZ: number, ctx: FrameCtx): Shot {
  let dx = 0 - bx;
  let dz = goalZ - bz;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const back = 6;
  const pos = v3(bx - dx * back, 2.8, bz - dz * back);
  const ahead = Math.min(d, 18);
  const look = v3(bx + dx * ahead, 1, bz + dz * ahead);
  return { pos, look, fov: ctx.aspect < 1 ? 64 : 48 };
}

export type ReplayAngle = 'goalcam' | 'tele';

/**
 * Replay angles round the ball: `goalcam` from behind the net the ball
 * went in (goal at `goalZ`), up a little; `tele` a low long lens from the
 * near touchline.
 */
export function replayShot(
  angle: ReplayAngle,
  bx: number,
  by: number,
  bz: number,
  goalZ: number,
  ctx: FrameCtx,
): Shot {
  const { pitch, stand, aspect } = ctx;
  if (angle === 'goalcam') {
    const s = Math.sign(goalZ) || 1;
    const pos = v3(clamp(bx * 0.25, -6, 6), 4.6, s * (pitch.length / 2 + pitch.goalDepth + 5.5));
    const look = v3(bx, Math.min(by, 2.5) * 0.5 + 0.6, bz);
    const dist = Math.hypot(pos.x - look.x, pos.z - look.z);
    return { pos, look, fov: clamp(fovForWidth(22, dist, aspect), 26, 70) };
  }
  const pos = v3(
    stand * (pitch.width / 2 + 5),
    2.2,
    clamp(bz * 0.85 - Math.sign(goalZ) * 6, -pitch.length / 2, pitch.length / 2),
  );
  const look = v3(bx, Math.min(by, 3) * 0.6 + 0.7, bz);
  const dist = Math.hypot(pos.x - look.x, pos.z - look.z);
  return { pos, look, fov: clamp(fovForWidth(16, dist, aspect), 14, 60) };
}

/** Lead the ball: where play is going in ~0.35 s, the jump clamped. */
export function leadPoint(bx: number, bz: number, vx: number, vz: number, lead = 0.35, max = 9) {
  let lx = vx * lead;
  let lz = vz * lead;
  const l = Math.hypot(lx, lz);
  if (l > max) {
    lx *= max / l;
    lz *= max / l;
  }
  return { x: bx + lx, z: bz + lz };
}

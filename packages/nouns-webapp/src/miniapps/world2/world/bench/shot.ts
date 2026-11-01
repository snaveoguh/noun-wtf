// ── The bench's cinematic shot (pure) ────────────────────────────────────
//
// Sat down, the camera glides in behind and a little above the bench,
// on the line from the mural's centre through the bench (so the bench sits
// centred under the picture), and holds there on a slow push-in with a
// gentle sideways drift: the sitters' heads and shoulders along the bottom
// of the frame, the GIF mural centred above them. A long lens (31° → 33°
// vertical, the game's on-foot camera is 62°); on a portrait screen it opens just enough to keep the
// mural's whole width in frame.

import type { BenchSite, V3 } from './place';

export interface ShotPose {
  pos: V3;
  look: V3;
  fov: number;
}

/** Into the shot from the game camera (s); back out to it (s). */
export const GLIDE_IN = 1.8;
export const GLIDE_OUT = 1.1;
/** The push-in's length (s): after this it only drifts. */
const PUSH = 20;

export const SHOT = {
  /** Behind the bench (m): start → end of the push-in. */
  back0: 8.2,
  back1: 7,
  /** Camera height over the ground (m): just over the sitters' heads. */
  h0: 2.35,
  h1: 2.15,
  /** Vertical FOV (°): long lens, opening a touch as it pushes in to hold the framing. */
  fov0: 31,
  fov1: 33,
  /** The look sits this far under the mural's centre (m): sitters along the frame's bottom. */
  drop: 3,
  /** Sideways drift (m) and its period (s). */
  drift: 0.4,
  driftPeriod: 46,
  /** Horizontal room kept either side of the mural on a narrow screen (m). */
  sideRoom: 1.6,
  maxFov: 74,
} as const;

/** Ease out (cubic). */
const easeOut = (k: number) => 1 - (1 - k) ** 3;
/** Smoothstep. */
export const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/** The shot `t` seconds after sitting, for a screen of `aspect` (w / h). */
export function benchShot(site: BenchSite, t: number, aspect: number): ShotPose {
  const [lx, ly, lz] = site.look;
  // From the mural's centre out through the bench, and on behind it
  let bx = site.x - lx;
  let bz = site.z - lz;
  const bl = Math.hypot(bx, bz) || 1;
  bx /= bl;
  bz /= bl;
  const k = easeOut(Math.min(1, Math.max(0, t) / PUSH));
  const back = SHOT.back0 + (SHOT.back1 - SHOT.back0) * k;
  const h = SHOT.h0 + (SHOT.h1 - SHOT.h0) * k;
  // The drift fades in with the push, so the glide in is a straight line
  const side = SHOT.drift * Math.sin((t / SHOT.driftPeriod) * Math.PI * 2) * k;
  const px = site.x + bx * back - bz * side;
  const pz = site.z + bz * back + bx * side;
  const pos: V3 = [px, site.y + h, pz];
  const look: V3 = [lx, ly - SHOT.drop, lz];
  let fov = SHOT.fov0 + (SHOT.fov1 - SHOT.fov0) * k;
  // Narrow screens: keep the mural's whole width (plus room) in frame
  const dist = Math.hypot(lx - px, lz - pz);
  const halfH = Math.atan((site.halfW + SHOT.sideRoom) / dist);
  const a = aspect > 0 ? aspect : 16 / 9;
  const need = (2 * Math.atan(Math.tan(halfH) / a) * 180) / Math.PI;
  fov = Math.min(SHOT.maxFov, Math.max(fov, need));
  return { pos, look, fov };
}

/** `a` → `b` by `k` (0…1, eased by the caller). */
export function blendPose(a: ShotPose, b: ShotPose, k: number): ShotPose {
  const l = (x: number, y: number) => x + (y - x) * k;
  return {
    pos: [l(a.pos[0], b.pos[0]), l(a.pos[1], b.pos[1]), l(a.pos[2], b.pos[2])],
    look: [l(a.look[0], b.look[0]), l(a.look[1], b.look[1]), l(a.look[2], b.look[2])],
    fov: l(a.fov, b.fov),
  };
}

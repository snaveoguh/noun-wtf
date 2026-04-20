// ── Camera Rig — Tuning Constants ────────────────────────────────────
//
// Third-person action-game camera rig config. All magic numbers live
// here so designers can tune without diving into the rig loop.
//
// Units: three.js world units (1 unit ≈ 1 meter in this game).

export interface ZoomPreset {
  /** Back distance from target along camera forward. */
  dist: number;
  /** Extra Y offset (above target) as a multiplier on dist. */
  y: number;
}

/**
 * Camera zoom presets — cycled via number keys 1–5.
 *
 * Values migrated from WorldPage.tsx (~line 1222). Range chosen so preset[0]
 * is near first-person (0.3) and preset[4] is top-down bird's-eye (15).
 * Spec requires the 0.3–40 band; Z key override takes dist to 40.
 */
export const CAMERA_ZOOM_PRESETS: ZoomPreset[] = [
  { dist: 0.3, y: 0.02 }, // 1 — first person
  { dist: 1.5, y: 0.12 }, // 2 — close
  { dist: 3.5, y: 0.3 }, // 3 — default (medium)
  { dist: 7, y: 0.5 }, // 4 — far
  { dist: 15, y: 0.8 }, // 5 — bird's eye
];

/** Default zoom preset index (matches legacy default of 1.5u back). */
export const DEFAULT_ZOOM_INDEX = 1;

/** Z-key bird's-eye override distance + Y multiplier. */
export const BIRDSEYE_DIST = 40;
export const BIRDSEYE_Y_MULT = 1.2;

// ── Spring-follow (critically-damped second-order) ────────────────────
//
// Higher omega = stiffer, faster convergence. Critically damped = no
// overshoot. These numbers target "feels responsive, never swimmy" in
// playtest.

/** Base position spring stiffness (rad/s). */
export const POS_OMEGA_BASE = 6.0;
/** Position spring stiffness while sprinting — tighter follow. */
export const POS_OMEGA_SPRINT = 9.0;
/** Position spring stiffness while in slo-mo — more cinematic drift. */
export const POS_OMEGA_SLOMO = 3.5;

/** Look-at spring stiffness (rad/s). Looser than pos so cam aim leads smoothly. */
export const LOOK_OMEGA_BASE = 8.0;
export const LOOK_OMEGA_SPRINT = 10.0;
export const LOOK_OMEGA_SLOMO = 5.0;

// ── Offsets ───────────────────────────────────────────────────────────

/** Height above target the camera looks at (chest/shoulder level). */
export const TARGET_LOOK_HEIGHT = 0.4;
/** Height above target the camera sits (rises with zoom dist). */
export const CAM_UP_OFFSET = 0.3;
/** Lateral shoulder offset. v1 = 0 (no shoulder swap). */
export const SHOULDER_OFFSET = 0.0;

// ── Velocity look-ahead ──────────────────────────────────────────────

/**
 * How strongly to bias look-at toward player velocity vector. Tuned so a
 * sprint forward noticeably pulls the aim point ahead, but strafing
 * doesn't whip the camera.
 */
export const LOOKAHEAD_GAIN = 0.35;
/** Max world-units the look-ahead can displace the aim point. */
export const LOOKAHEAD_MAX = 2.2;

// ── Collision push-in ────────────────────────────────────────────────

/** Y offset on target for the collision ray origin (hip-height). */
export const COLLISION_RAY_ORIGIN_Y = 0.4;
/** Pull-in distance from the hit point back toward target (clearance). */
export const COLLISION_CLEARANCE = 0.3;
/** Lerp factor to snap camera IN on hit (fast — prevents geometry clipping). */
export const COLLISION_SNAP_IN = 0.35;

// ── Cinematic orbit on slo-mo ────────────────────────────────────────

/** Max orbit amplitude (radians) at slo-mo factor = 0. */
export const CINEMATIC_ORBIT_AMP = 0.35;
/** Orbit oscillation frequency (rad/s). */
export const CINEMATIC_ORBIT_FREQ = 0.7;

// ── FOV ──────────────────────────────────────────────────────────────

export const FOV_BASE = 50;
export const FOV_SPRINT_KICK = 6;
export const FOV_AIM_KICK = -12;
/** Slo-mo sine-pulse amplitude. */
export const FOV_SLOMO_PULSE_AMP = 4;
/** Slo-mo sine-pulse base frequency (rad/s) — modulated by (1 - factor). */
export const FOV_SLOMO_PULSE_FREQ = 2.5;
/** FOV spring stiffness (rad/s). */
export const FOV_OMEGA = 7.0;
/** Min delta (deg) before we bother calling updateProjectionMatrix. */
export const FOV_UPDATE_THRESHOLD = 0.1;

// ── Camera touch zone (mobile) ───────────────────────────────────────
//
// Middle-right thin vertical strip. Drag → cameraAngle orbit.
// x: 40%–75% of viewport. Y: full height minus safe areas.

export const TOUCH_ZONE_X_START = 0.4;
export const TOUCH_ZONE_X_END = 0.75;
/** Radians of cameraAngle orbit per px of horizontal touch drag. */
export const TOUCH_ORBIT_SENSITIVITY = 0.006;

// ── Keybind configuration ────────────────────────────────────────────

/** Number keys that cycle zoom presets (index = key - 1). */
export const ZOOM_KEYS: readonly string[] = ['1', '2', '3', '4', '5'];
/** Bird's-eye override key. */
export const BIRDSEYE_KEY = 'z';

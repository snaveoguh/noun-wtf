// ── Movement Tuning — single live-mutable source of truth for feel ───
//
// Every locomotion knob lives here in ONE mutable object (`TUNING`).
// locomotion.ts and its leaf states read this directly each frame, so
// the in-browser tuning panel can mutate it live and the change lands
// on the very next tick. Presets are full snapshots you can hot-swap to
// compare feel (Hugo's options-maxxing default — never single-track a
// creative decision).
//
// Units: tiles/frame at a 60fps tick (matches the rest of the engine).

export interface MovementTuning {
  // ── Base ground speeds ──
  walkSpeed: number; // cruise target
  sprintSpeed: number; // sprint target — also the input "soft cap"

  // ── Acceleration model (Quake/Source-style) ──
  groundAccel: number; // accel coefficient toward wishspeed on ground
  groundFriction: number; // per-frame speed bleed when grounded
  airAccel: number; // air-strafe accel coefficient (the skill knob)
  airWishCap: number; // cap on the per-frame air wishspeed (low = classic strafe)

  // ── Speed caps ──
  softCap: number; // input accel can't push you past this on its own
  hardCap: number; // absolute clamp — momentum (dash/slide/wallrun/bhop) lives between soft & hard

  // ── Jump / gravity ──
  jumpVz: number;
  jumpCutMult: number; // vz *= this on early release (variable height)
  gravity: number; // rising gravity
  fallGravityMult: number; // extra gravity while descending (snappier arc)
  coyoteFrames: number;
  jumpBufferFrames: number;
  airJumpsMax: number; // double-jump count

  // ── Bunny hop ──
  bhopWindow: number; // frames after landing in which a jump skips ground friction
  bhopBoost: number; // speed multiplier on a clean chained hop

  // ── Dash ──
  dashSpeed: number;
  dashDurationFrames: number;
  dashExitScale: number; // fraction of dash speed kept on exit (high = chains)
  dashIFrames: number;

  // ── Slide ──
  slideAccel: number; // forward boost per frame while sliding
  slideFriction: number; // per-frame retain factor (closer to 1 = slicker)
  slideJumpBoost: number; // speed multiplier when jumping out of a slide
  slideMaxFrames: number;

  // ── Wall-run ──
  wallRunAccel: number; // tangent accel along the wall (real sling, not 0.05)
  wallRunGravityFactor: number;
  wallRunMaxFrames: number;
  wallRunJumpVz: number;
  wallRunJumpPush: number;
  wallRunEntryBoost: number; // speed multiplier on latch

  // ── Climb (legacy face-climb) ──
  climbSpeed: number;
  climbStrafe: number;
  climbReach: number;
  wallJumpVz: number;
  wallJumpPush: number;
}

// ── Presets ─────────────────────────────────────────────────────────

// "Flow" — momentum that compounds. Titanfall/Apex + Neon-White dash
// chains. The default; built to feel fast and rewarding out of the box.
const FLOW: MovementTuning = {
  walkSpeed: 0.7,
  sprintSpeed: 1.4,
  groundAccel: 0.6,
  groundFriction: 0.12,
  airAccel: 0.22,
  airWishCap: 1.6,
  softCap: 1.4,
  hardCap: 6.0,
  jumpVz: 8.6,
  jumpCutMult: 0.45,
  gravity: 0.5,
  fallGravityMult: 1.35,
  coyoteFrames: 7,
  jumpBufferFrames: 6,
  airJumpsMax: 1,
  bhopWindow: 5,
  bhopBoost: 1.03,
  dashSpeed: 5.5,
  dashDurationFrames: 10,
  dashExitScale: 0.92,
  dashIFrames: 10,
  slideAccel: 0.07,
  slideFriction: 0.992,
  slideJumpBoost: 1.3,
  slideMaxFrames: 48,
  wallRunAccel: 0.18,
  wallRunGravityFactor: 0.1,
  wallRunMaxFrames: 90,
  wallRunJumpVz: 8.2,
  wallRunJumpPush: 3.2,
  wallRunEntryBoost: 1.1,
  climbSpeed: 0.4,
  climbStrafe: 0.25,
  climbReach: 2.5,
  wallJumpVz: 7.4,
  wallJumpPush: 2.4,
};

// "Strafe" — Quake/CPMA skill ceiling. Low air wish cap so speed only
// comes from clean strafe-jumping. High hard cap, slick ground.
const STRAFE: MovementTuning = {
  ...FLOW,
  walkSpeed: 0.65,
  sprintSpeed: 1.3,
  groundAccel: 0.5,
  groundFriction: 0.08,
  airAccel: 0.6,
  airWishCap: 0.5,
  softCap: 1.3,
  hardCap: 8.0,
  jumpVz: 8.0,
  bhopWindow: 7,
  bhopBoost: 1.0,
  dashExitScale: 0.85,
};

// "Floaty" — Spider-Man hang-time, gentle gravity, strong air control,
// big double-jump. Forgiving and traversal-y.
const FLOATY: MovementTuning = {
  ...FLOW,
  groundAccel: 0.5,
  airAccel: 0.35,
  airWishCap: 2.0,
  gravity: 0.3,
  fallGravityMult: 1.1,
  jumpVz: 7.6,
  airJumpsMax: 2,
  hardCap: 5.0,
};

// "Skate" — THPS-ish: very slick, hard to stop, momentum is king. Pairs
// with the (currently decoupled) skating.ts when that gets wired.
const SKATE: MovementTuning = {
  ...FLOW,
  groundAccel: 0.35,
  groundFriction: 0.03,
  airAccel: 0.15,
  airWishCap: 1.2,
  softCap: 1.6,
  hardCap: 9.0,
  slideFriction: 0.997,
  slideAccel: 0.1,
  dashExitScale: 0.96,
};

// "Classic" — reproduces the old (disliked) feel: hard 2.0 cap, near-zero
// air control, momentum-killing. Kept as a safety A/B reference.
const CLASSIC: MovementTuning = {
  ...FLOW,
  walkSpeed: 0.55,
  sprintSpeed: 1.2,
  groundAccel: 0.18,
  groundFriction: 0.22,
  airAccel: 0.04,
  airWishCap: 1.2,
  softCap: 1.2,
  hardCap: 2.0,
  jumpVz: 7.8,
  gravity: 0.55,
  fallGravityMult: 1.0,
  bhopBoost: 1.0,
  bhopWindow: 0,
  dashSpeed: 8,
  dashExitScale: 0.6,
  slideAccel: 0,
  slideFriction: 0.985,
  slideJumpBoost: 1.0,
  wallRunAccel: 0.05,
  wallRunGravityFactor: 0.15,
  wallRunJumpPush: 1.4,
  wallRunEntryBoost: 1.0,
};

export const PRESETS = {
  Flow: FLOW,
  Strafe: STRAFE,
  Floaty: FLOATY,
  Skate: SKATE,
  Classic: CLASSIC,
} as const;

export type PresetName = keyof typeof PRESETS;

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

// ── Live state ──────────────────────────────────────────────────────

/** The single live config the locomotion system reads every frame. */
export const TUNING: MovementTuning = { ...FLOW };

let _activePreset: PresetName = 'Flow';
export function activePreset(): PresetName {
  return _activePreset;
}

/** Hot-swap to a preset (full snapshot copy into the live object). */
export function applyPreset(name: PresetName): void {
  Object.assign(TUNING, PRESETS[name]);
  _activePreset = name;
}

/** Patch individual knobs live (from the tuning panel sliders). */
export function setTuning(patch: Partial<MovementTuning>): void {
  Object.assign(TUNING, patch);
}

// ── Slider metadata for the tuning panel ────────────────────────────

export interface TuningField {
  key: keyof MovementTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
}

export const TUNING_FIELDS: TuningField[] = [
  { key: 'walkSpeed', label: 'Walk', min: 0.2, max: 2, step: 0.05, group: 'Speed' },
  { key: 'sprintSpeed', label: 'Sprint', min: 0.4, max: 3, step: 0.05, group: 'Speed' },
  { key: 'softCap', label: 'Soft cap', min: 0.5, max: 4, step: 0.05, group: 'Speed' },
  { key: 'hardCap', label: 'Hard cap', min: 2, max: 14, step: 0.5, group: 'Speed' },
  { key: 'groundAccel', label: 'Ground accel', min: 0.05, max: 1, step: 0.01, group: 'Accel' },
  { key: 'groundFriction', label: 'Ground friction', min: 0, max: 0.4, step: 0.005, group: 'Accel' },
  { key: 'airAccel', label: 'Air accel', min: 0, max: 1, step: 0.01, group: 'Accel' },
  { key: 'airWishCap', label: 'Air wish cap', min: 0.2, max: 3, step: 0.05, group: 'Accel' },
  { key: 'jumpVz', label: 'Jump power', min: 4, max: 14, step: 0.1, group: 'Jump' },
  { key: 'gravity', label: 'Gravity (rise)', min: 0.15, max: 1, step: 0.01, group: 'Jump' },
  { key: 'fallGravityMult', label: 'Fall gravity x', min: 1, max: 2, step: 0.05, group: 'Jump' },
  { key: 'jumpCutMult', label: 'Jump cut', min: 0.1, max: 1, step: 0.05, group: 'Jump' },
  { key: 'airJumpsMax', label: 'Air jumps', min: 0, max: 3, step: 1, group: 'Jump' },
  { key: 'coyoteFrames', label: 'Coyote frames', min: 0, max: 14, step: 1, group: 'Jump' },
  { key: 'bhopWindow', label: 'Bhop window', min: 0, max: 12, step: 1, group: 'Bhop' },
  { key: 'bhopBoost', label: 'Bhop boost', min: 1, max: 1.15, step: 0.005, group: 'Bhop' },
  { key: 'dashSpeed', label: 'Dash speed', min: 2, max: 12, step: 0.5, group: 'Dash' },
  { key: 'dashDurationFrames', label: 'Dash frames', min: 4, max: 24, step: 1, group: 'Dash' },
  { key: 'dashExitScale', label: 'Dash chain', min: 0.3, max: 1, step: 0.02, group: 'Dash' },
  { key: 'slideAccel', label: 'Slide accel', min: 0, max: 0.2, step: 0.005, group: 'Slide' },
  { key: 'slideFriction', label: 'Slide slickness', min: 0.95, max: 1, step: 0.001, group: 'Slide' },
  { key: 'slideJumpBoost', label: 'Slide-jump boost', min: 1, max: 1.6, step: 0.05, group: 'Slide' },
  { key: 'wallRunAccel', label: 'Wallrun accel', min: 0, max: 0.4, step: 0.01, group: 'Wallrun' },
  { key: 'wallRunJumpPush', label: 'Wallrun kick', min: 0.5, max: 5, step: 0.1, group: 'Wallrun' },
  { key: 'wallRunJumpVz', label: 'Wallrun jump', min: 4, max: 12, step: 0.2, group: 'Wallrun' },
  { key: 'wallRunEntryBoost', label: 'Wallrun entry', min: 1, max: 1.5, step: 0.02, group: 'Wallrun' },
];

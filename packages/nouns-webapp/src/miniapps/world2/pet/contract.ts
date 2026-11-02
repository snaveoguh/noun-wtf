// ── CAMP pet: shared types + tuning (pure) ───────────────────────────────
//
// MOCHI, the hairless flying mouse that naps on CAMP's fridge until you
// adopt it, then follows you round Noun World. Three parts like hoops/:
//   follow.ts / pose.ts / wire.ts / name.ts / store.ts  pure, tested
//   model.ts                                           the voxel MOCHI (one draw)
//   PetSystem.ts / PetUi.tsx / sound.ts                the game side

/** Looks by wire code. Append only: a code never changes meaning. */
export const PET_LOOKS = ['', 'mochi'] as const;
export type PetLook = Exclude<(typeof PET_LOOKS)[number], ''>;
export const DEFAULT_LOOK: PetLook = 'mochi';

/** What the player asked for (Settings in the pet card). */
export type FollowPref = 'auto' | 'head' | 'beside' | 'fly';
export const FOLLOW_PREFS: readonly FollowPref[] = ['auto', 'beside', 'head', 'fly'];

/**
 * What the pet is doing right now. The first three are the follow modes;
 * the rest are forced by context. Wire codes = index: append only.
 */
export const PET_MODES = ['beside', 'head', 'fly', 'ride', 'watch', 'away', 'perch'] as const;
export type PetMode = (typeof PET_MODES)[number];

/** Gaits the pose code knows, picked from the pet's own motion. */
export type Gait =
  | 'stand'
  | 'idle'
  | 'walk'
  | 'trot'
  | 'run'
  | 'hop'
  | 'sit'
  | 'sleep'
  | 'happy'
  | 'fly'
  | 'perch'
  | 'ride';

export const PET = {
  /** Body radius for collision checks (m). */
  radius: 0.22,
  /** Standing height to the ear tips (m). */
  height: 0.54,
  /** Beside: offset in the rider's frame (x right, z forward; m). */
  besideSide: 0.95,
  besideBack: 0.55,
  /** Fly: beside the rider's head (m). */
  flySide: 0.9,
  flyUp: 0.15,
  flyBack: 0.25,
  /** Ground speed caps (m/s): trot, run, and the catch-up sprint. */
  walk: 1.6,
  run: 6,
  sprint: 13,
  /** On a board above this (m/s), auto follow flies. */
  flyAbove: 3.2,
  /** Further than this from the rider (m): poof back beside them. */
  poofFar: 18,
  /** More than this above / below the rider while they stand (m): poof. */
  poofDrop: 3.5,
  /** Making no progress toward the rider this long (s): poof. */
  stuckFor: 1.4,
  /** The rider moved this far in one frame (m): a teleport, poof. */
  teleport: 7,
  /** Idle rider: sit after (s), sleep after (s). */
  sitAfter: 2.5,
  sleepAfter: 25,
  /** Happy spin length (s). */
  happyFor: 1.3,
  /** Remote pets aren't drawn past this (m); local pet always is. */
  drawFar: 55,
  /** Adopt prompt: within this of the fridge (m, horizontal). */
  adoptReach: 2.4,
  /** Max name length (chars). */
  nameMax: 12,
} as const;

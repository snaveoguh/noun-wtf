// ── Move Definitions — The Full Moveset ─────────────────���────────────

import type { MoveType } from './types';
import {
  PUNCH_RANGE,
  PUNCH_DAMAGE_MIN,
  PUNCH_DAMAGE_MAX,
  PUNCH_DURATION,
  KICK_RANGE,
  KICK_DAMAGE_MIN,
  KICK_DAMAGE_MAX,
  KICK_DURATION,
  KICK_KNOCKBACK,
  UPPERCUT_RANGE,
  UPPERCUT_DAMAGE,
  UPPERCUT_DURATION,
  UPPERCUT_LAUNCH_VY,
  GROUND_SLAM_DAMAGE,
  GROUND_SLAM_RADIUS,
  GROUND_SLAM_STUN,
  BACKFLIP_DURATION,
  BACKFLIP_IFRAMES,
  DASH_DURATION,
  DASH_IFRAMES,
  DASH_DAMAGE,
  SPIN_ATTACK_RANGE,
  SPIN_ATTACK_DAMAGE,
  SPIN_ATTACK_DURATION,
  FORCE_PUSH_DAMAGE,
  FORCE_PUSH_KNOCKBACK,
  FORCE_PUSH_COOLDOWN,
  FORCE_PUSH_LIFE,
  FORCE_PUSH_RANGE,
  ROUNDHOUSE_DAMAGE,
  METEOR_DAMAGE,
  CYCLONE_DAMAGE,
  GUNSHOT_RANGE,
  GUNSHOT_DAMAGE,
  GUNSHOT_DURATION,
  HEADSHOT_DAMAGE,
} from './types';
import { randInt } from './physics';

export interface MoveDefinition {
  type: MoveType;
  damage: number | (() => number); // fixed or random range
  range: number;
  duration: number; // frames
  knockback: number;
  stunDuration: number; // frames target is stunned
  iFrames: number; // invincibility frames for self
  launchVy: number; // vertical launch (negative = up)
  isAoE: boolean;
  cooldown: number; // frames
  canAerial: boolean; // can use while airborne
}

export const MOVE_DEFS: Record<MoveType, MoveDefinition> = {
  punch: {
    type: 'punch',
    damage: () => randInt(PUNCH_DAMAGE_MIN, PUNCH_DAMAGE_MAX),
    range: PUNCH_RANGE,
    duration: PUNCH_DURATION,
    knockback: 1,           // was 3 — subtle stumble only
    stunDuration: 6,
    iFrames: 0,
    launchVy: 0,
    isAoE: false,
    cooldown: 0,
    canAerial: true,
  },
  kick: {
    type: 'kick',
    damage: () => randInt(KICK_DAMAGE_MIN, KICK_DAMAGE_MAX),
    range: KICK_RANGE,
    duration: KICK_DURATION,
    knockback: KICK_KNOCKBACK, // now 2 (was 6)
    stunDuration: 10,
    iFrames: 0,
    launchVy: 0,
    isAoE: false,
    cooldown: 0,
    canAerial: true,
  },
  uppercut: {
    type: 'uppercut',
    damage: UPPERCUT_DAMAGE,
    range: UPPERCUT_RANGE,
    duration: UPPERCUT_DURATION,
    knockback: 1.5,         // was 4 — slight lift only
    stunDuration: 15,
    iFrames: 0,
    launchVy: UPPERCUT_LAUNCH_VY,
    isAoE: false,
    cooldown: 0,
    canAerial: false,
  },
  groundSlam: {
    type: 'groundSlam',
    damage: GROUND_SLAM_DAMAGE,
    range: GROUND_SLAM_RADIUS,
    duration: 24,
    knockback: 2,           // was 10 — heavy impact, minimal push
    stunDuration: GROUND_SLAM_STUN,
    iFrames: 0,
    launchVy: 0,
    isAoE: true,
    cooldown: 0,
    canAerial: true,
  },
  backflip: {
    type: 'backflip',
    damage: 0,
    range: 0,
    duration: BACKFLIP_DURATION,
    knockback: 0,
    stunDuration: 0,
    iFrames: BACKFLIP_IFRAMES,
    launchVy: -8,
    isAoE: false,
    cooldown: 0,
    canAerial: false,
  },
  dash: {
    type: 'dash',
    damage: DASH_DAMAGE,
    range: 24,
    duration: DASH_DURATION,
    knockback: 1,           // was 4
    stunDuration: 4,
    iFrames: DASH_IFRAMES,
    launchVy: 0,
    isAoE: false,
    cooldown: 0,
    canAerial: false,
  },
  spinAttack: {
    type: 'spinAttack',
    damage: SPIN_ATTACK_DAMAGE,
    range: SPIN_ATTACK_RANGE,
    duration: SPIN_ATTACK_DURATION,
    knockback: 2,           // was 8
    stunDuration: 12,
    iFrames: 0,
    launchVy: 0,
    isAoE: true,
    cooldown: 0,
    canAerial: false,
  },
  forcePush: {
    type: 'forcePush',
    damage: FORCE_PUSH_DAMAGE,
    range: FORCE_PUSH_RANGE,
    duration: FORCE_PUSH_LIFE,
    knockback: FORCE_PUSH_KNOCKBACK, // now 3 (was 14)
    stunDuration: 20,
    iFrames: 0,
    launchVy: 0,
    isAoE: true,
    cooldown: FORCE_PUSH_COOLDOWN,
    canAerial: true,
  },
  headbutt: {
    type: 'headbutt',
    damage: 30,
    range: 24,
    duration: 18,
    knockback: 2,           // was 10 — heavy impact, stays close
    stunDuration: 25,
    iFrames: 4,
    launchVy: 0,
    isAoE: false,
    cooldown: 0,
    canAerial: false,
  },
  block: {
    type: 'block',
    damage: 0,
    range: 0,
    duration: 999,
    knockback: 0,
    stunDuration: 0,
    iFrames: 0,
    launchVy: 0,
    isAoE: false,
    cooldown: 0,
    canAerial: false,
  },
  // ── Special combo moves ──
  roundhouse: {
    type: 'roundhouse',
    damage: ROUNDHOUSE_DAMAGE,
    range: 44,
    duration: 20,
    knockback: 3,           // was 12
    stunDuration: 20,
    iFrames: 4,
    launchVy: 0,
    isAoE: true,
    cooldown: 0,
    canAerial: false,
  },
  meteor: {
    type: 'meteor',
    damage: METEOR_DAMAGE,
    range: 56,
    duration: 30,
    knockback: 3,           // was 16
    stunDuration: 30,
    iFrames: 8,
    launchVy: 0,
    isAoE: true,
    cooldown: 0,
    canAerial: true,
  },
  cyclone: {
    type: 'cyclone',
    damage: CYCLONE_DAMAGE,
    range: 52,
    duration: 28,
    knockback: 3,           // was 14
    stunDuration: 24,
    iFrames: 12,
    launchVy: -6,
    isAoE: true,
    cooldown: 0,
    canAerial: false,
  },
  // ── Ranged / Gun moves ──
  gunshot: {
    type: 'gunshot',
    damage: GUNSHOT_DAMAGE,
    range: GUNSHOT_RANGE,
    duration: GUNSHOT_DURATION,
    knockback: 0.5,         // barely moves — collapse in place
    stunDuration: 0,        // wounded state handles this instead
    iFrames: 0,
    launchVy: 0,
    isAoE: false,
    cooldown: 30,           // half-second between shots
    canAerial: false,
  },
  headshot: {
    type: 'headshot',
    damage: HEADSHOT_DAMAGE,
    range: GUNSHOT_RANGE,
    duration: GUNSHOT_DURATION,
    knockback: 0,           // drops in place
    stunDuration: 0,
    iFrames: 0,
    launchVy: 0,
    isAoE: false,
    cooldown: 30,
    canAerial: false,
  },
};

/** Resolve damage (handles both fixed and random) */
export function resolveDamage(move: MoveDefinition, comboMultiplier: number): number {
  const base = typeof move.damage === 'function' ? move.damage() : move.damage;
  return Math.round(base * comboMultiplier);
}

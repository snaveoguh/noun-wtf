// ── Paint blasters ─────────────────────────────────────────────────────
//
// Every shot is a real paint projectile: it travels at `speed` m/s, drops
// under `gravity`, and splats whatever it meets. Spread is a cone (radians)
// built from base + movement + bloom; scope tightens it.

export type WeaponId = 'splatter' | 'hopper' | 'shotgun' | 'longsplat' | 'launcher';
export type DamageSource = WeaponId | 'grenade' | 'fall';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Kill-feed / HUD short label. */
  short: string;
  /** Number key (1-based). */
  key: number;
  auto: boolean;
  /** Seconds between shots. */
  rate: number;
  /** Damage per ball (per pellet for the shotgun). */
  dmg: number;
  headMult: number;
  pellets: number;
  /** Base cone half-angle (radians), standing still. */
  spread: number;
  /** Extra spread at full run speed. */
  moveSpread: number;
  /** Extra spread while airborne. */
  airSpread: number;
  bloomPerShot: number;
  bloomMax: number;
  /** Bloom recovery (rad/s). */
  bloomDecay: number;
  speed: number;
  gravity: number;
  mag: number;
  reload: number;
  kind: 'ball' | 'bomb';
  splash?: { radius: number; dmg: number };
  /** Scope field-of-view multiplier (sniper). */
  zoom?: number;
  /** Spread multiplier when scoped. */
  scopedSpread?: number;
  /** Ball radius for hits + visuals. */
  radius: number;
  /** View kick (radians of pitch) per shot. */
  kick: number;
  /** Rep level that unlocks it. */
  unlock: number;
  /** Preferred engagement distance for bots (m). */
  botRange: number;
  blurb: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  splatter: {
    id: 'splatter',
    name: 'Splatter',
    short: 'Splatter',
    key: 1,
    auto: false,
    rate: 0.15,
    dmg: 28,
    headMult: 1.6,
    pellets: 1,
    spread: 0.006,
    moveSpread: 0.014,
    airSpread: 0.03,
    bloomPerShot: 0.009,
    bloomMax: 0.035,
    bloomDecay: 0.12,
    speed: 88,
    gravity: 5,
    mag: 12,
    reload: 1.0,
    kind: 'ball',
    radius: 0.07,
    kick: 0.018,
    unlock: 1,
    botRange: 14,
    blurb: 'Starter paint pistol. Snappy, accurate, always loaded.',
  },
  hopper: {
    id: 'hopper',
    name: 'Hopper',
    short: 'Hopper',
    key: 2,
    auto: true,
    rate: 0.085,
    dmg: 15,
    headMult: 1.5,
    pellets: 1,
    spread: 0.011,
    moveSpread: 0.022,
    airSpread: 0.05,
    bloomPerShot: 0.0055,
    bloomMax: 0.05,
    bloomDecay: 0.16,
    speed: 82,
    gravity: 5,
    mag: 32,
    reload: 1.7,
    kind: 'ball',
    radius: 0.07,
    kick: 0.01,
    unlock: 1,
    botRange: 16,
    blurb: 'Full-auto paint rifle. Hold the trigger, hose the turf.',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Noggle Shotgun',
    short: 'Noggle Shotgun',
    key: 3,
    auto: false,
    rate: 0.72,
    dmg: 12,
    headMult: 1.25,
    pellets: 9,
    spread: 0.07,
    moveSpread: 0.012,
    airSpread: 0.02,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomDecay: 1,
    speed: 62,
    gravity: 7,
    mag: 6,
    reload: 2.0,
    kind: 'ball',
    radius: 0.06,
    kick: 0.05,
    unlock: 2,
    botRange: 6,
    blurb: 'Nine-ball spread. Up close it repaints a Noun in one pump.',
  },
  longsplat: {
    id: 'longsplat',
    name: 'Long-Splat',
    short: 'Long-Splat',
    key: 4,
    auto: false,
    rate: 1.1,
    dmg: 80,
    headMult: 1.6,
    pellets: 1,
    spread: 0.035,
    moveSpread: 0.05,
    airSpread: 0.09,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomDecay: 1,
    speed: 175,
    gravity: 3,
    mag: 5,
    reload: 2.3,
    kind: 'ball',
    zoom: 3.4,
    scopedSpread: 0.03,
    radius: 0.08,
    kick: 0.07,
    unlock: 3,
    botRange: 32,
    blurb: 'Scoped long gun (hold RMB). One splat to the noggles ends it.',
  },
  launcher: {
    id: 'launcher',
    name: 'Noggle Launcher',
    short: 'Noggle Launcher',
    key: 5,
    auto: false,
    rate: 0.95,
    dmg: 55,
    headMult: 1,
    pellets: 1,
    spread: 0.008,
    moveSpread: 0.01,
    airSpread: 0.02,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomDecay: 1,
    speed: 30,
    gravity: 15,
    mag: 4,
    reload: 2.4,
    kind: 'bomb',
    splash: { radius: 4.2, dmg: 90 },
    radius: 0.16,
    kick: 0.06,
    unlock: 4,
    botRange: 14,
    blurb: 'Lobs an arcing paint bomb. Splash paints everything nearby.',
  },
};

export const WEAPON_ORDER: WeaponId[] = ['splatter', 'hopper', 'shotgun', 'longsplat', 'launcher'];

export const GRENADE = {
  name: 'Paint Grenade',
  speed: 19,
  gravity: 18,
  fuse: 1.5,
  restitution: 0.42,
  splash: { radius: 4.6, dmg: 100 },
  perLife: 2,
  /** Seconds to regain one grenade. */
  regen: 18,
  radius: 0.12,
  unlock: 1,
};

export function sourceLabel(s: DamageSource): string {
  if (s === 'grenade') return 'Paint Grenade';
  if (s === 'fall') return 'gravity';
  return WEAPONS[s].short;
}

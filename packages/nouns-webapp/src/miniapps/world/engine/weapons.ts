// ── GTA 3 Style Weapon System ────────────────────────────────────────
//
// Walk over spinning pickups to auto-equip. F to fire.
// Weapons attach to the character's handslot.r bone.

// ── Types ────────────────────────────────────────────────────────────

export type WeaponType = 'spray_can' | 'pistol' | 'shotgun' | 'uzi';

export interface WeaponDef {
  type: WeaponType;
  damage: number;
  range: number;       // world units
  fireRate: number;    // seconds between shots
  ammo: number;        // max magazine size (Infinity allowed)
  reloadTime: number;  // seconds to reload
  color: string;       // pickup glow / mesh tint
  label: string;       // display name
  /** Spray can / paint tool — F opens graffiti UI instead of firing a bullet. */
  isPaintTool?: boolean;
}

export interface WeaponState {
  equipped: WeaponType | null;
  ammo: number;
  maxAmmo: number;
  lastFired: number;   // timestamp (ms)
  isReloading: boolean;
  reloadStart: number; // timestamp (ms)
  muzzleFlash: number; // countdown frames for flash effect
  /** Weapons the player owns. spray_can is always owned by default; guns added on pickup. */
  owned: Set<WeaponType>;
}

// ── Weapon Definitions ───────────────────────────────────────────────

export const WEAPON_DEFS: Record<WeaponType, WeaponDef> = {
  spray_can: {
    type: 'spray_can',
    damage: 0,
    range: 6,
    fireRate: 0.05,
    ammo: Infinity,
    reloadTime: 0,
    color: '#ff44ff', // rainbow in practice — see GunAttachment animation
    label: 'Spray Can',
    isPaintTool: true,
  },
  pistol: {
    type: 'pistol',
    damage: 25,
    range: 100,
    fireRate: 0.5,
    ammo: 12,
    reloadTime: 1.5,
    color: '#8888aa',
    label: 'Pistol',
  },
  shotgun: {
    type: 'shotgun',
    damage: 40,
    range: 50,
    fireRate: 1.0,
    ammo: 8,
    reloadTime: 2.0,
    color: '#aa6633',
    label: 'Shotgun',
  },
  uzi: {
    type: 'uzi',
    damage: 10,
    range: 80,
    fireRate: 0.1,
    ammo: 30,
    reloadTime: 2.5,
    color: '#333333',
    label: 'Uzi',
  },
};

// ── Pickup State ─────────────────────────────────────────────────────

export interface WeaponPickup {
  id: number;
  type: WeaponType;
  worldX: number;
  worldY: number;
  picked: boolean;
  spawnTime: number;
}

let _nextPickupId = 0;
let _pickups: WeaponPickup[] = [];

export function spawnWeaponPickup(type: WeaponType, worldX: number, worldY: number): WeaponPickup {
  const pickup: WeaponPickup = {
    id: _nextPickupId++,
    type,
    worldX,
    worldY,
    picked: false,
    spawnTime: Date.now(),
  };
  _pickups.push(pickup);
  return pickup;
}

export function getActivePickups(): WeaponPickup[] {
  return _pickups.filter(p => !p.picked);
}

export function clearPickups() {
  _pickups = [];
}

// ── Pickup Radius ────────────────────────────────────────────────────

const PICKUP_RADIUS = 50; // auto-pickup when player walks within this distance (game coords)

/** Check if player is near any weapon pickup — GTA style auto-pickup */
export function checkWeaponPickup(
  playerX: number,
  playerY: number,
  weaponState: WeaponState,
): WeaponPickup | null {
  for (const pickup of _pickups) {
    if (pickup.picked) continue;
    const dx = playerX - pickup.worldX;
    const dy = playerY - pickup.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PICKUP_RADIUS) {
      pickup.picked = true;
      equipWeapon(weaponState, pickup.type);
      console.log(`[Weapons] Picked up ${pickup.type}! Player(${playerX.toFixed(0)},${playerY.toFixed(0)}) Pickup(${pickup.worldX},${pickup.worldY}) dist=${dist.toFixed(1)}`);
      return pickup;
    }
  }
  return null;
}

// ── Player Weapon State ──────────────────────────────────────────────

export function createWeaponState(): WeaponState {
  const def = WEAPON_DEFS.spray_can;
  return {
    equipped: 'spray_can',
    ammo: def.ammo,
    maxAmmo: def.ammo,
    lastFired: 0,
    isReloading: false,
    reloadStart: 0,
    muzzleFlash: 0,
    owned: new Set<WeaponType>(['spray_can']),
  };
}

export function equipWeapon(state: WeaponState, type: WeaponType) {
  const def = WEAPON_DEFS[type];
  state.equipped = type;
  state.ammo = def.ammo;
  state.maxAmmo = def.ammo;
  state.isReloading = false;
  state.reloadStart = 0;
  state.muzzleFlash = 0;
  state.owned.add(type);
}

/** Switch to a weapon the player already owns. No-op if not owned. Returns true on success. */
export function switchWeapon(state: WeaponState, type: WeaponType): boolean {
  if (!state.owned.has(type)) return false;
  if (state.equipped === type) return false;
  const def = WEAPON_DEFS[type];
  state.equipped = type;
  state.ammo = def.ammo;
  state.maxAmmo = def.ammo;
  state.isReloading = false;
  state.reloadStart = 0;
  state.muzzleFlash = 0;
  return true;
}

/** Cycle to the next owned weapon (mobile chip). Returns the newly-equipped type. */
export function cycleWeapon(state: WeaponState): WeaponType | null {
  const order: WeaponType[] = ['spray_can', 'pistol', 'shotgun', 'uzi'];
  const owned = order.filter(t => state.owned.has(t));
  if (owned.length === 0) return null;
  const currentIdx = state.equipped ? owned.indexOf(state.equipped) : -1;
  const next = owned[(currentIdx + 1) % owned.length];
  switchWeapon(state, next);
  return next;
}

export function unequipWeapon(state: WeaponState) {
  state.equipped = null;
  state.ammo = 0;
  state.maxAmmo = 0;
  state.isReloading = false;
  state.muzzleFlash = 0;
}

// ── Fire ─────────────────────────────────────────────────────────────

export interface FireResult {
  fired: boolean;
  damage: number;
  range: number;
  needsReload: boolean;
}

/**
 * Attempt to fire the equipped weapon.
 * Returns whether the shot happened plus damage/range info for hit detection.
 */
export function fireWeapon(state: WeaponState): FireResult {
  const noFire: FireResult = { fired: false, damage: 0, range: 0, needsReload: false };

  if (!state.equipped) return noFire;
  if (state.isReloading) return noFire;

  const def = WEAPON_DEFS[state.equipped];
  const now = Date.now();

  // Fire rate check
  if (now - state.lastFired < def.fireRate * 1000) return noFire;

  // Ammo check — paint tools have infinite ammo and never reload
  if (!def.isPaintTool) {
    if (state.ammo <= 0) {
      startReload(state);
      return { ...noFire, needsReload: true };
    }
    state.ammo--;
    state.muzzleFlash = 6; // 6 frames of flash
  }

  state.lastFired = now;

  return {
    fired: true,
    damage: def.damage,
    range: def.range,
    needsReload: !def.isPaintTool && state.ammo <= 0,
  };
}

// ── Reload ───────────────────────────────────────────────────────────

export function startReload(state: WeaponState) {
  if (!state.equipped || state.isReloading) return;
  const def = WEAPON_DEFS[state.equipped];
  if (def.isPaintTool) return; // paint tools don't reload
  if (state.ammo >= state.maxAmmo) return;
  state.isReloading = true;
  state.reloadStart = Date.now();
}

/** Call every frame — checks if reload is complete */
export function tickReload(state: WeaponState) {
  if (!state.isReloading || !state.equipped) return;
  const def = WEAPON_DEFS[state.equipped];
  if (Date.now() - state.reloadStart >= def.reloadTime * 1000) {
    state.ammo = def.ammo;
    state.isReloading = false;
  }
}

/** Tick muzzle flash countdown */
export function tickMuzzleFlash(state: WeaponState) {
  if (state.muzzleFlash > 0) state.muzzleFlash--;
}

// ── HUD Info ─────────────────────────────────────────────────────────

export function getWeaponHudInfo(state: WeaponState): {
  label: string;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
} | null {
  if (!state.equipped) return null;
  const def = WEAPON_DEFS[state.equipped];
  return {
    label: def.label,
    ammo: state.ammo,
    maxAmmo: state.maxAmmo,
    reloading: state.isReloading,
  };
}

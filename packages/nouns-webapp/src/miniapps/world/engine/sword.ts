// ── Sword Combat System ─────────────────────────────────────────────
//
// Melee weapon: pick up from ground, attach to handslot.r.
// Light attack (J), Heavy attack (K), Stab (H), Block (Shift), Parry.
// Combo chain: light-light-heavy = "Executioner" (50 dmg AoE).
// Sword range: 2 world units (close combat).

import type { Player, RemotePlayer, MoveType, Direction } from './types';
import type { CombatState } from './combat';
import {
  COMBO_WINDOW,
  PARRY_WINDOW,
} from './types';
import {
  spawnHitSparks,
  spawnDamageText,
  spawnSpecialText,
  spawnComboFlash,
  spawnGroundSlamWave,
  createScreenShake,
  createSlowMo,
} from './particles';
import { dist, angleBetween } from './physics';
import { directionFromDelta } from './input';

// ── Sword Move Types ────────────────────────────────────────────────

export type SwordMoveType =
  | 'lightAttack'
  | 'heavyAttack'
  | 'stab'
  | 'swordBlock';

// ── Animation mapping — uses existing Character3D clip names ────────

export const SWORD_ANIM_MAP: Record<SwordMoveType, string> = {
  lightAttack: '1H_Melee_Attack_Chop',
  heavyAttack: '1H_Melee_Attack_Slice_Diagonal',
  stab: '1H_Melee_Attack_Stab',
  swordBlock: 'Block',
};

// ── Sword Move Definitions ──────────────────────────────────────────

export interface SwordMoveDef {
  type: SwordMoveType;
  damage: number;
  range: number;          // world units
  duration: number;       // frames
  knockback: number;
  stunDuration: number;   // frames target is stunned
  iFrames: number;
  isAoE: boolean;
  cooldown: number;       // frames between swings
  animation: string;      // GLB clip name
}

export const SWORD_RANGE = 2; // close combat — 2 world units

export const SWORD_MOVE_DEFS: Record<SwordMoveType, SwordMoveDef> = {
  lightAttack: {
    type: 'lightAttack',
    damage: 15,
    range: SWORD_RANGE,
    duration: 10,           // quick slash
    knockback: 1,
    stunDuration: 5,
    iFrames: 0,
    isAoE: false,
    cooldown: 12,           // fast recovery
    animation: '1H_Melee_Attack_Chop',
  },
  heavyAttack: {
    type: 'heavyAttack',
    damage: 30,
    range: SWORD_RANGE,
    duration: 22,           // slow but powerful
    knockback: 2.5,
    stunDuration: 14,
    iFrames: 0,
    isAoE: false,
    cooldown: 28,           // long recovery
    animation: '1H_Melee_Attack_Slice_Diagonal',
  },
  stab: {
    type: 'stab',
    damage: 25,
    range: SWORD_RANGE + 0.5, // slight lunge forward
    duration: 16,
    knockback: 1.5,
    stunDuration: 10,
    iFrames: 2,             // brief i-frames on lunge
    isAoE: false,
    cooldown: 20,
    animation: '1H_Melee_Attack_Stab',
  },
  swordBlock: {
    type: 'swordBlock',
    damage: 0,
    range: 0,
    duration: 999,          // held while shift is down
    knockback: 0,
    stunDuration: 0,
    iFrames: 0,
    isAoE: false,
    cooldown: 0,
    animation: 'Block',
  },
};

// ── Sword Block / Parry Constants ───────────────────────────────────

export const SWORD_BLOCK_REDUCTION = 0.8;    // 80% damage reduction when blocking
export const SWORD_PARRY_WINDOW = 8;         // first 8 frames = parry window
export const SWORD_PARRY_REFLECT_MULT = 1.0; // reflect 100% of damage back

// ── Executioner Combo ───────────────────────────────────────────────

export const EXECUTIONER_SEQ: SwordMoveType[] = ['lightAttack', 'lightAttack', 'heavyAttack'];
export const EXECUTIONER_DAMAGE = 50;
export const EXECUTIONER_RANGE = 3;  // AoE radius for finisher

// ── Sword State ─────────────────────────────────────────────────────

export interface SwordState {
  hasSword: boolean;
  swinging: boolean;
  swingTimer: number;       // frames remaining in current swing
  comboCount: number;       // hits landed in current combo chain
  blockActive: boolean;
  parryWindow: number;      // frames remaining in parry window (counts down from SWORD_PARRY_WINDOW)
  cooldownTimer: number;    // frames until next swing allowed
  lastMoves: SwordMoveType[]; // last 3 moves for combo detection
  comboTimer: number;       // frames until combo chain resets
  currentMove: SwordMoveType | null;
}

export function createSwordState(): SwordState {
  return {
    hasSword: false,
    swinging: false,
    swingTimer: 0,
    comboCount: 0,
    blockActive: false,
    parryWindow: 0,
    cooldownTimer: 0,
    lastMoves: [],
    comboTimer: 0,
    currentMove: null,
  };
}

// ── Pickup Logic ────────────────────────────────────────────────────

export interface SwordPickup {
  id: number;
  worldX: number;
  worldY: number;
  picked: boolean;
  spawnTime: number;
}

let _nextSwordPickupId = 0;
let _swordPickups: SwordPickup[] = [];

export function spawnSwordPickup(worldX: number, worldY: number): SwordPickup {
  const pickup: SwordPickup = {
    id: _nextSwordPickupId++,
    worldX,
    worldY,
    picked: false,
    spawnTime: Date.now(),
  };
  _swordPickups.push(pickup);
  return pickup;
}

export function getActiveSwordPickups(): SwordPickup[] {
  return _swordPickups.filter(p => !p.picked);
}

export function clearSwordPickups() {
  _swordPickups = [];
}

const SWORD_PICKUP_RADIUS = 28;

/** Check if player walks over a sword pickup — auto-equip */
export function checkSwordPickup(
  playerX: number,
  playerY: number,
  swordState: SwordState,
): SwordPickup | null {
  for (const pickup of _swordPickups) {
    if (pickup.picked) continue;
    const dx = playerX - pickup.worldX;
    const dy = playerY - pickup.worldY;
    if (Math.sqrt(dx * dx + dy * dy) < SWORD_PICKUP_RADIUS) {
      pickup.picked = true;
      swordState.hasSword = true;
      return pickup;
    }
  }
  return null;
}

// ── Equip / Unequip ─────────────────────────────────────────────────

export function equipSword(state: SwordState) {
  state.hasSword = true;
  state.swinging = false;
  state.swingTimer = 0;
  state.comboCount = 0;
  state.blockActive = false;
  state.parryWindow = 0;
  state.cooldownTimer = 0;
  state.lastMoves = [];
  state.comboTimer = 0;
  state.currentMove = null;
}

export function unequipSword(state: SwordState) {
  state.hasSword = false;
  state.swinging = false;
  state.swingTimer = 0;
  state.comboCount = 0;
  state.blockActive = false;
  state.parryWindow = 0;
  state.cooldownTimer = 0;
  state.lastMoves = [];
  state.comboTimer = 0;
  state.currentMove = null;
}

// ── Resolve Sword Input ─────────────────────────────────────────────

/**
 * When sword is equipped, J/K/H/Shift map to sword moves instead
 * of the default punch/kick/headbutt/block.
 */
export function resolveSwordMove(
  justPressed: Set<string>,
  shiftHeld: boolean,
): SwordMoveType | null {
  if (shiftHeld) return 'swordBlock';
  if (justPressed.has('j')) return 'lightAttack';
  if (justPressed.has('k')) return 'heavyAttack';
  if (justPressed.has('h')) return 'stab';
  return null;
}

// ── Combo Detection ─────────────────────────────────────────────────

function matchesSwordSequence(moves: SwordMoveType[], seq: SwordMoveType[]): boolean {
  if (moves.length < seq.length) return false;
  const recent = moves.slice(-seq.length);
  return seq.every((m, i) => recent[i] === m);
}

/** Register a sword hit. Returns combo multiplier and whether Executioner triggered. */
export function registerSwordHit(
  swordState: SwordState,
): { multiplier: number; isExecutioner: boolean } {
  // Reset if combo window expired
  if (swordState.comboTimer <= 0) {
    swordState.comboCount = 0;
    swordState.lastMoves = [];
  }

  swordState.comboCount++;
  swordState.comboTimer = COMBO_WINDOW;

  // Check for Executioner combo: light-light-heavy
  if (matchesSwordSequence(swordState.lastMoves, EXECUTIONER_SEQ)) {
    swordState.lastMoves = [];
    swordState.comboCount = 0;
    return { multiplier: 1, isExecutioner: true };
  }

  // Standard combo multipliers (3-hit = 1.5x, 5-hit = 2x)
  let multiplier = 1;
  if (swordState.comboCount >= 5) multiplier = 2.0;
  else if (swordState.comboCount >= 3) multiplier = 1.5;

  return { multiplier, isExecutioner: false };
}

/** Tick sword combo timer each frame */
export function tickSwordCombo(swordState: SwordState) {
  if (swordState.comboTimer > 0) {
    swordState.comboTimer--;
    if (swordState.comboTimer <= 0) {
      swordState.comboCount = 0;
      swordState.lastMoves = [];
    }
  }
}

// ── Execute Sword Attack ────────────────────────────────────────────

export interface SwordHitResult {
  targetId: string;
  damage: number;
  knockX: number;
  knockY: number;
  move: SwordMoveType;
  combo: number;
  isExecutioner: boolean;
}

/**
 * Execute a sword attack. Returns hit results for multiplayer broadcast.
 */
export function executeSwordMove(
  player: Player,
  swordState: SwordState,
  move: SwordMoveType,
  mouseWorldX: number,
  mouseWorldY: number,
  remotePlayers: Map<string, RemotePlayer>,
  combat: CombatState,
): SwordHitResult[] {
  // Can't swing if no sword
  if (!swordState.hasSword) return [];

  // Can't act while in bad state
  if (
    player.state === 'stunned' || player.state === 'dead' ||
    player.state === 'respawning' || player.state === 'knocked' ||
    player.state === 'wounded'
  ) {
    return [];
  }

  // Cooldown check
  if (swordState.cooldownTimer > 0 && move !== 'swordBlock') return [];

  // Can't start new attack while swinging (except block)
  if (swordState.swinging && move !== 'swordBlock') return [];

  const def = SWORD_MOVE_DEFS[move];

  // ── Block ──
  if (move === 'swordBlock') {
    swordState.blockActive = true;
    swordState.parryWindow = SWORD_PARRY_WINDOW;
    player.state = 'blocking';
    player.blockTimer = 0;
    return [];
  }

  // ── Attack ──
  swordState.swinging = true;
  swordState.swingTimer = def.duration;
  swordState.cooldownTimer = def.cooldown;
  swordState.currentMove = move;

  // Track for combo detection
  swordState.lastMoves.push(move);
  if (swordState.lastMoves.length > 3) swordState.lastMoves.shift();

  // Set player state
  player.state = 'attacking';
  player.attackTimer = def.duration;
  player.iFrames = Math.max(player.iFrames, def.iFrames);

  // Face toward mouse
  player.scaleX = mouseWorldX >= player.x ? 1 : -1;
  player.direction = directionFromDelta(mouseWorldX - player.x, mouseWorldY - player.y);

  // Stab lunge — push player forward slightly
  if (move === 'stab') {
    const angle = angleBetween(player.x, player.y, mouseWorldX, mouseWorldY);
    player.vx += Math.cos(angle) * 1.5;
    player.vy += Math.sin(angle) * 1.5;
  }

  // ── Hit detection ──
  const hits: SwordHitResult[] = [];

  remotePlayers.forEach((remote, id) => {
    if (remote.state === 'dead' || remote.state === 'respawning') return;

    const d = dist(player.x, player.y, remote.x, remote.y);

    // Directional check: target must be in front and in range
    const targetAngle = angleBetween(player.x, player.y, remote.x, remote.y);
    const aimAngle = angleBetween(player.x, player.y, mouseWorldX, mouseWorldY);
    const angleDelta = Math.abs(aimAngle - targetAngle);
    const hit = d < def.range * 16 && angleDelta < Math.PI / 2;
    // Note: range is in world units (2), multiply by ~16 (TILE_SIZE) for pixel distance

    if (hit) {
      const { multiplier, isExecutioner } = registerSwordHit(swordState);

      let damage: number;
      let knockback: number;
      let range: number;
      let isAoE = false;

      if (isExecutioner) {
        // Executioner finisher — 50 dmg AoE
        damage = EXECUTIONER_DAMAGE;
        knockback = 3;
        range = EXECUTIONER_RANGE * 16;
        isAoE = true;
      } else {
        damage = Math.round(def.damage * multiplier);
        knockback = def.knockback;
        range = def.range * 16;
      }

      const knockAngle = angleBetween(player.x, player.y, remote.x, remote.y);
      const knockX = Math.cos(knockAngle) * knockback;
      const knockY = Math.sin(knockAngle) * knockback;

      hits.push({
        targetId: id,
        damage,
        knockX,
        knockY,
        move,
        combo: swordState.comboCount,
        isExecutioner,
      });

      // Visual effects
      const hitX = (player.x + remote.x) / 2;
      const hitY = (player.y + remote.y) / 2;
      spawnHitSparks(combat.particles, hitX, hitY, 10 + damage / 2);
      spawnDamageText(combat.floatingTexts, remote.x, remote.y, damage, multiplier > 1);
      combat.shake = createScreenShake(2 + damage / 8, 8);

      if (swordState.comboCount >= 3) {
        spawnComboFlash(combat.particles, hitX, hitY);
      }

      if (isExecutioner) {
        spawnSpecialText(combat.floatingTexts, player.x, player.y - 20, 'EXECUTIONER');
        spawnGroundSlamWave(combat.particles, player.x, player.y + 16);
        combat.shake = createScreenShake(10, 18);
        combat.slowMo = createSlowMo(0.2, 10);
      }
    }
  });

  // Executioner AoE — hit all nearby enemies (not just aimed target)
  if (hits.some(h => h.isExecutioner)) {
    remotePlayers.forEach((remote, id) => {
      if (remote.state === 'dead' || remote.state === 'respawning') return;
      if (hits.some(h => h.targetId === id)) return; // already hit

      const d = dist(player.x, player.y, remote.x, remote.y);
      if (d < EXECUTIONER_RANGE * 16) {
        const knockAngle = angleBetween(player.x, player.y, remote.x, remote.y);
        hits.push({
          targetId: id,
          damage: EXECUTIONER_DAMAGE,
          knockX: Math.cos(knockAngle) * 3,
          knockY: Math.sin(knockAngle) * 3,
          move: 'heavyAttack',
          combo: 0,
          isExecutioner: true,
        });
        spawnHitSparks(combat.particles, remote.x, remote.y, 12);
        spawnDamageText(combat.floatingTexts, remote.x, remote.y, EXECUTIONER_DAMAGE, true);
      }
    });
  }

  return hits;
}

// ── Apply Sword Block / Parry to Incoming Damage ────────────────────

/**
 * Check if sword block/parry applies to incoming damage.
 * Returns { blocked, parried, reducedDamage, reflectDamage }.
 */
export function applySwordBlock(
  swordState: SwordState,
  incomingDamage: number,
  combat: CombatState,
  playerX: number,
  playerY: number,
): {
  blocked: boolean;
  parried: boolean;
  reducedDamage: number;
  reflectDamage: number;
} {
  if (!swordState.blockActive) {
    return { blocked: false, parried: false, reducedDamage: incomingDamage, reflectDamage: 0 };
  }

  // Parry window check — first 8 frames of block
  if (swordState.parryWindow > 0) {
    // Perfect parry — reflect damage back
    spawnHitSparks(combat.particles, playerX, playerY, 18);
    spawnSpecialText(combat.floatingTexts, playerX, playerY - 16, 'PARRY!');
    combat.shake = createScreenShake(5, 10);
    combat.slowMo = createSlowMo(0.3, 6);
    return {
      blocked: true,
      parried: true,
      reducedDamage: 0,
      reflectDamage: Math.round(incomingDamage * SWORD_PARRY_REFLECT_MULT),
    };
  }

  // Normal block — 80% damage reduction
  const reducedDamage = Math.round(incomingDamage * (1 - SWORD_BLOCK_REDUCTION));
  spawnHitSparks(combat.particles, playerX, playerY, 6);
  return {
    blocked: true,
    parried: false,
    reducedDamage,
    reflectDamage: 0,
  };
}

// ── Tick Sword State Each Frame ─────────────────────────────────────

export function tickSword(swordState: SwordState, shiftHeld: boolean) {
  if (!swordState.hasSword) return;

  // Swing timer
  if (swordState.swingTimer > 0) {
    swordState.swingTimer--;
    if (swordState.swingTimer <= 0) {
      swordState.swinging = false;
      swordState.currentMove = null;
    }
  }

  // Cooldown timer
  if (swordState.cooldownTimer > 0) {
    swordState.cooldownTimer--;
  }

  // Parry window countdown
  if (swordState.parryWindow > 0) {
    swordState.parryWindow--;
  }

  // Release block when shift released
  if (swordState.blockActive && !shiftHeld) {
    swordState.blockActive = false;
    swordState.parryWindow = 0;
  }

  // Tick combo
  tickSwordCombo(swordState);
}

// ── HUD Info ────────────────────────────────────────────────────────

export function getSwordHudInfo(state: SwordState): {
  label: string;
  comboCount: number;
  blocking: boolean;
  parryWindow: boolean;
  currentMove: SwordMoveType | null;
} | null {
  if (!state.hasSword) return null;
  return {
    label: 'Sword',
    comboCount: state.comboCount,
    blocking: state.blockActive,
    parryWindow: state.parryWindow > 0,
    currentMove: state.currentMove,
  };
}

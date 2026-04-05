// ── Combat Engine — The Main Event ───────────────────────────────────
//
// Handles attack execution, hit detection, damage application,
// state transitions, and all the insane combat physics.

import type {
  Player,
  RemotePlayer,
  MoveType,
  ForcePush,
  Particle,
  FloatingText,
  ScreenShake,
  SlowMo,
  KillFeedEntry,
} from './types';
import {
  PLAYER_MAX_HP,
  RESPAWN_TIME,
  GROUND_Y,
  BLOCK_REDUCTION,
  PARRY_WINDOW,
  BACKFLIP_DURATION,
  DASH_DURATION,
  DASH_SPEED,
} from './types';
import { MOVE_DEFS, resolveDamage } from './moves';
import { registerHit, tickCombo } from './combo';
import {
  dist,
  angleBetween,
  applyGravity,
  applyFriction,
} from './physics';
import {
  spawnHitSparks,
  spawnDustTrail,
  spawnDeathExplosion,
  spawnComboFlash,
  spawnGroundSlamWave,
  spawnDamageText,
  spawnComboText,
  spawnSpecialText,
  createForcePush,
  createScreenShake,
  createSlowMo,
} from './particles';
import { getMovementVector, directionFromDelta, type InputState } from './input';
import { SPAWN_X, SPAWN_Y, ISLAND_MAP } from './tilemap';
import { moveWithCollision } from './physics';
import { PLAYER_SPEED, SPRITE_SIZE } from './types';

// ── Player factory ────────────────────────────────────���───────────────

export function createPlayer(
  x: number,
  y: number,
  nounId: number,
  seedKey: string,
): Player {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    direction: 'down',
    state: 'idle',
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    nounId,
    seedKey,
    attackTimer: 0,
    attackType: null,
    stunTimer: 0,
    iFrames: 0,
    airborneVy: 0,
    airborneY: GROUND_Y,
    blockTimer: 0,
    dashVx: 0,
    dashVy: 0,
    dashTimer: 0,
    comboHits: 0,
    comboTimer: 0,
    lastMoves: [],
    flipRotation: 0,
    scaleX: 1,
    hitFlash: 0,
    deathTimer: 0,
    respawnTimer: 0,
  };
}

// ─��� Cooldown tracker (for force push etc) ─────────────────────────────

export interface CooldownState {
  forcePush: number;
}

export function createCooldowns(): CooldownState {
  return { forcePush: 0 };
}

// ── Game state container ──────────────────────────────────────────────

export interface CombatState {
  particles: Particle[];
  floatingTexts: FloatingText[];
  forcePushes: ForcePush[];
  shake: ScreenShake | null;
  slowMo: SlowMo | null;
  killFeed: KillFeedEntry[];
  cooldowns: CooldownState;
}

export function createCombatState(): CombatState {
  return {
    particles: [],
    floatingTexts: [],
    forcePushes: [],
    shake: null,
    slowMo: null,
    killFeed: [],
    cooldowns: createCooldowns(),
  };
}

// ── Execute a move ────────────────────────────────────────────────────

interface HitResult {
  targetId: string;
  damage: number;
  knockX: number;
  knockY: number;
  move: MoveType;
  combo: number;
}

/**
 * Execute an attack move. Returns hit results for multiplayer broadcast.
 */
export function executeMove(
  player: Player,
  move: MoveType,
  mouseWorldX: number,
  mouseWorldY: number,
  remotePlayers: Map<string, RemotePlayer>,
  combat: CombatState,
): HitResult[] {
  const def = MOVE_DEFS[move];
  if (!def) return [];

  // Can't act while stunned or dead
  if (player.state === 'stunned' || player.state === 'dead' || player.state === 'respawning') {
    return [];
  }

  // Ground slam requires airborne
  if (move === 'groundSlam' && player.airborneY >= GROUND_Y) return [];

  // Force push cooldown
  if (move === 'forcePush' && combat.cooldowns.forcePush > 0) return [];

  // Can't attack during attack (except aerial moves and backflip)
  if (player.attackTimer > 0 && !def.canAerial && move !== 'backflip') return [];

  // Set attack state
  player.attackType = move;
  player.attackTimer = def.duration;
  player.iFrames = Math.max(player.iFrames, def.iFrames);

  // Face toward mouse
  const angle = angleBetween(player.x, player.y, mouseWorldX, mouseWorldY);
  player.scaleX = mouseWorldX >= player.x ? 1 : -1;
  player.direction = directionFromDelta(mouseWorldX - player.x, mouseWorldY - player.y);

  // ── Move-specific behavior ──

  if (move === 'backflip') {
    player.state = 'backflip';
    player.airborneVy = def.launchVy;
    player.airborneY = -1; // start airborne
    player.flipRotation = 0;
    // Move backward
    player.vx += -player.scaleX * 4;
    player.vy -= 2;
    spawnDustTrail(combat.particles, player.x, player.y + SPRITE_SIZE / 2, 8);
    return [];
  }

  if (move === 'dash') {
    player.state = 'dashing';
    player.dashTimer = DASH_DURATION;
    player.dashVx = Math.cos(angle) * DASH_SPEED;
    player.dashVy = Math.sin(angle) * DASH_SPEED;
    spawnDustTrail(combat.particles, player.x, player.y + SPRITE_SIZE / 2, 6);
    // Dash can do contact damage — check below
  }

  if (move === 'forcePush') {
    combat.cooldowns.forcePush = def.cooldown;
    const pushAngle = angleBetween(player.x, player.y, mouseWorldX, mouseWorldY);
    combat.forcePushes.push(
      createForcePush(player.x, player.y, pushAngle, '#4488ff'),
    );
    player.state = 'attacking';
  }

  if (move === 'groundSlam') {
    // Slam down immediately
    player.airborneVy = 15;
    player.state = 'attacking';
    spawnGroundSlamWave(combat.particles, player.x, player.y + SPRITE_SIZE / 2);
    combat.shake = createScreenShake(6, 12);
  }

  // Set attacking state for remaining combat moves
  player.state = 'attacking';

  if (move === 'block') {
    player.state = 'blocking';
    player.blockTimer = 0;
    return [];
  }

  if (move === 'uppercut') {
    // Small self-hop
    if (player.airborneY >= GROUND_Y) {
      player.airborneVy = -4;
      player.airborneY = -1;
    }
  }

  // ── Hit detection against remote players ──
  const hits: HitResult[] = [];

  remotePlayers.forEach((remote, id) => {
    if (remote.state === 'dead' || remote.state === 'respawning') return;

    const d = dist(player.x, player.y, remote.x, remote.y);

    let hit = false;
    if (def.isAoE) {
      hit = d < def.range;
    } else {
      // Directional: check if target is in front of player and in range
      const targetAngle = angleBetween(player.x, player.y, remote.x, remote.y);
      const angleDelta = Math.abs(angleBetween(player.x, player.y, mouseWorldX, mouseWorldY) - targetAngle);
      hit = d < def.range && angleDelta < Math.PI / 2;
    }

    if (hit) {
      // Register combo
      const { multiplier, special } = registerHit(player, move);

      const actualMove = special || move;
      const actualDef = MOVE_DEFS[actualMove];
      const damage = resolveDamage(actualDef, multiplier);

      const knockAngle = angleBetween(player.x, player.y, remote.x, remote.y);
      const knockX = Math.cos(knockAngle) * actualDef.knockback;
      const knockY = Math.sin(knockAngle) * actualDef.knockback;

      hits.push({
        targetId: id,
        damage,
        knockX,
        knockY,
        move: actualMove,
        combo: player.comboHits,
      });

      // Visual effects
      const hitX = (player.x + remote.x) / 2;
      const hitY = (player.y + remote.y) / 2;
      spawnHitSparks(combat.particles, hitX, hitY, 8 + damage / 3);
      spawnDamageText(combat.floatingTexts, remote.x, remote.y, damage, multiplier > 1);
      combat.shake = createScreenShake(2 + damage / 10, 6);

      if (player.comboHits >= 3) {
        spawnComboText(combat.floatingTexts, player.x, player.y, player.comboHits);
        spawnComboFlash(combat.particles, hitX, hitY);
      }

      if (special) {
        spawnSpecialText(combat.floatingTexts, player.x, player.y - 20, special);
        combat.shake = createScreenShake(8, 15);
        combat.slowMo = createSlowMo(0.3, 8);
      }

      // Launch target if uppercut
      if (actualDef.launchVy < 0) {
        // Will be applied via network
      }
    }
  });

  return hits;
}

// ── Apply incoming damage to local player ─────────────────────────────

export function applyDamageToPlayer(
  player: Player,
  damage: number,
  knockX: number,
  knockY: number,
  attackMove: MoveType,
  combat: CombatState,
): boolean {
  // i-frames protect
  if (player.iFrames > 0) return false;
  if (player.state === 'dead' || player.state === 'respawning') return false;

  let actualDamage = damage;

  // Block / Parry
  if (player.state === 'blocking') {
    if (player.blockTimer <= PARRY_WINDOW) {
      // Perfect parry — reflect damage!
      spawnHitSparks(combat.particles, player.x, player.y, 15);
      spawnSpecialText(combat.floatingTexts, player.x, player.y, 'PARRY!');
      combat.shake = createScreenShake(4, 8);
      return false; // no damage, caller should get reflected hit
    }
    // Normal block
    actualDamage = Math.round(damage * BLOCK_REDUCTION);
    spawnDustTrail(combat.particles, player.x, player.y, 4);
  }

  player.hp = Math.max(0, player.hp - actualDamage);
  player.hitFlash = 1;
  player.vx += knockX;
  player.vy += knockY;

  // Stun
  const def = MOVE_DEFS[attackMove];
  if (def && player.state !== 'blocking') {
    player.stunTimer = def.stunDuration;
    player.state = 'stunned';
  }

  // Launch if uppercut
  if (def && def.launchVy < 0 && player.airborneY >= GROUND_Y) {
    player.airborneVy = def.launchVy;
    player.airborneY = -1;
    player.state = 'airborne';
  }

  spawnHitSparks(combat.particles, player.x, player.y, 6);
  spawnDamageText(combat.floatingTexts, player.x, player.y, actualDamage, false);

  // Check death
  if (player.hp <= 0) {
    player.state = 'dead';
    player.deathTimer = 60;
    spawnDeathExplosion(combat.particles, player.x, player.y);
    combat.shake = createScreenShake(8, 15);
    combat.slowMo = createSlowMo(0.3, 8);
    return true; // player died
  }

  return false;
}

// ── Tick player state each frame ──────────────────────────────────────

export function tickPlayer(player: Player, input: InputState, combat: CombatState) {
  // Decrement timers
  if (player.stunTimer > 0) player.stunTimer--;
  if (player.iFrames > 0) player.iFrames--;
  if (player.attackTimer > 0) player.attackTimer--;
  if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - 0.06);
  if (combat.cooldowns.forcePush > 0) combat.cooldowns.forcePush--;
  tickCombo(player);

  // ── Dead / respawning ──
  if (player.state === 'dead') {
    player.deathTimer--;
    if (player.deathTimer <= 0) {
      player.state = 'respawning';
      player.respawnTimer = RESPAWN_TIME;
    }
    applyFriction(player, 0.9);
    return;
  }

  if (player.state === 'respawning') {
    player.respawnTimer--;
    if (player.respawnTimer <= 0) {
      // Respawn!
      player.state = 'idle';
      player.hp = player.maxHp;
      player.x = SPAWN_X;
      player.y = SPAWN_Y;
      player.vx = 0;
      player.vy = 0;
      player.iFrames = 60; // spawn protection
      player.airborneY = GROUND_Y;
      player.airborneVy = 0;
    }
    return;
  }

  // ── Stunned ──
  if (player.stunTimer > 0) {
    player.state = 'stunned';
    applyFriction(player, 0.9);
    applyGravity(player);
    const pos = moveWithCollision(player.x, player.y, player.vx, player.vy, ISLAND_MAP);
    player.x = pos.x;
    player.y = pos.y;
    return;
  }

  // ── Backflip animation ─���
  if (player.state === 'backflip') {
    player.flipRotation += (Math.PI * 2) / BACKFLIP_DURATION;
    applyGravity(player);
    applyFriction(player, 0.92);
    const pos = moveWithCollision(player.x, player.y, player.vx, player.vy, ISLAND_MAP);
    player.x = pos.x;
    player.y = pos.y;
    if (player.attackTimer <= 0) {
      player.state = player.airborneY < GROUND_Y ? 'airborne' : 'idle';
      player.flipRotation = 0;
    }
    return;
  }

  // ── Dashing ──
  if (player.state === 'dashing') {
    player.dashTimer--;
    const pos = moveWithCollision(
      player.x,
      player.y,
      player.dashVx,
      player.dashVy,
      ISLAND_MAP,
    );
    player.x = pos.x;
    player.y = pos.y;
    if (player.dashTimer <= 0) {
      player.state = 'idle';
      player.vx = player.dashVx * 0.3;
      player.vy = player.dashVy * 0.3;
    }
    // Dash dust
    if (player.dashTimer % 3 === 0) {
      spawnDustTrail(combat.particles, player.x, player.y + SPRITE_SIZE / 2, 2);
    }
    return;
  }

  // ── Blocking ──
  if (player.state === 'blocking') {
    player.blockTimer++;
    if (!input.shiftHeld) {
      player.state = 'idle';
      player.blockTimer = 0;
    }
    applyFriction(player);
    return;
  }

  // ��─ Attacking ──
  if (player.attackTimer > 0 && player.state === 'attacking') {
    applyFriction(player, 0.92);
    applyGravity(player);
    const pos = moveWithCollision(player.x, player.y, player.vx, player.vy, ISLAND_MAP);
    player.x = pos.x;
    player.y = pos.y;
    if (player.attackTimer <= 0) {
      player.state = player.airborneY < GROUND_Y ? 'airborne' : 'idle';
      player.attackType = null;
    }
    return;
  }

  // ── Airborne ���─
  if (player.airborneY < GROUND_Y) {
    player.state = 'airborne';
    applyGravity(player);
    applyFriction(player, 0.98);
    const pos = moveWithCollision(player.x, player.y, player.vx, player.vy, ISLAND_MAP);
    player.x = pos.x;
    player.y = pos.y;
    return;
  }

  // ── Normal movement ──
  const { dx, dy } = getMovementVector(input.keys, input.cameraAngle);

  if (dx !== 0 || dy !== 0) {
    player.state = 'walking';
    player.direction = directionFromDelta(dx, dy);
    if (dx !== 0) player.scaleX = dx > 0 ? 1 : -1;
    player.vx = dx * PLAYER_SPEED;
    player.vy = dy * PLAYER_SPEED;
  } else {
    if (player.state === 'walking') player.state = 'idle';
    applyFriction(player);
  }

  const pos = moveWithCollision(player.x, player.y, player.vx, player.vy, ISLAND_MAP);
  player.x = pos.x;
  player.y = pos.y;
}

// ── Apply hit to remote player (visual only — authoritative on sender) ──

export function applyHitToRemote(
  remote: RemotePlayer,
  damage: number,
  knockX: number,
  knockY: number,
  move: MoveType,
  combat: CombatState,
) {
  remote.hp = Math.max(0, remote.hp - damage);
  remote.hitFlash = 1;
  remote.targetX += knockX * 2;
  remote.targetY += knockY * 2;

  spawnHitSparks(combat.particles, remote.x, remote.y, 8);
  spawnDamageText(combat.floatingTexts, remote.x, remote.y, damage, false);

  const def = MOVE_DEFS[move];
  if (def && def.launchVy < 0) {
    remote.airborneY = -20;
  }

  if (remote.hp <= 0) {
    remote.state = 'dead';
    spawnDeathExplosion(combat.particles, remote.x, remote.y);
    combat.shake = createScreenShake(6, 12);
    combat.slowMo = createSlowMo(0.3, 6);
  }
}

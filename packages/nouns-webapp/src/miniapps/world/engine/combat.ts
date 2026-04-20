// ── Combat Engine — The Main Event ───────────────────────────────────
//
// Handles attack execution, hit detection, damage application,
// state transitions, and all the insane combat physics.

import type {
  Player,
  PlayerState,
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
  WOUNDED_DURATION,
  KNOCKED_DURATION,
  GUNSHOT_RESPAWN_TIME,
  SPRITE_SIZE,
} from './types';
import { MOVE_DEFS, resolveDamage } from './moves';
import { registerHit, tickCombo } from './combo';
import { dist, angleBetween, applyFriction } from './physics';
import { stepLocomotion, stepPassive, readLocomotionInput } from './locomotion';
import { startDash } from './dash';
import { playerToBody, bodyToPlayer, createMovementBody, type MovementBody } from './movementBody';
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
import { directionFromDelta, type InputState } from './input';
import { SPAWN_X, SPAWN_Y, ISLAND_MAP } from './tilemap';

// ── Player factory ────────────────────────────────────���───────────────

export function createPlayer(x: number, y: number, nounId: number, seedKey: string): Player {
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
    jumpCount: 0,
    blockTimer: 0,
    dashVx: 0,
    dashVy: 0,
    dashTimer: 0,
    comboHits: 0,
    comboTimer: 0,
    lastMoves: [],
    knockedTimer: 0,
    woundedTimer: 0,
    consecutiveGunshots: 0,
    flipRotation: 0,
    scaleX: 1,
    hitFlash: 0,
    deathTimer: 0,
    respawnTimer: 0,
    isSkating: false,
    trickName: null,
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

  // Can't act while stunned, dead, knocked down, or wounded
  if (
    player.state === 'stunned' ||
    player.state === 'dead' ||
    player.state === 'respawning' ||
    player.state === 'knocked' ||
    player.state === 'wounded'
  ) {
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
    // Progressive jump: jump → double → triple → backflip
    player.jumpCount++;
    if (player.jumpCount <= 3) {
      // Spider-Man style — high launch, floaty hang time
      const jumpPower = -4 - player.jumpCount * 1.2; // -5.2, -6.4, -7.6
      player.state = 'airborne';
      player.airborneVy = jumpPower;
      if (player.airborneY >= GROUND_Y) player.airborneY = -0.5;
    } else {
      // 4th press = backflip — massive launch
      player.state = 'backflip';
      player.airborneVy = -8;
      if (player.airborneY >= GROUND_Y) player.airborneY = -0.5;
      player.flipRotation = 0;
      player.jumpCount = 0; // reset after backflip
    }
    return [];
  }

  if (move === 'dash') {
    // Delegate velocity + bullet-time triggering to dash.ts. Combat
    // still owns the attack-move side (iFrames, damage, anim state) —
    // dash.ts handles the shared velocity/FOCUS plumbing that both
    // locomotion (double-tap) and combat (move list) need.
    const body = getBody(player);
    startDash(body, Math.cos(angle), Math.sin(angle), {
      speed: DASH_SPEED,
      durationFrames: DASH_DURATION,
      // Attack dash iFrames come from the MOVE_DEFS entry above; keep
      // body.iFrames in sync so locomotion dispatchers don't clobber.
      iFrames: player.iFrames,
      kind: 'ground',
    });
    bodyToPlayer(body, player);
    // Mirror dash fields onto Player for legacy consumers (net, anim).
    player.dashTimer = DASH_DURATION;
    player.dashVx = body.dashVx;
    player.dashVy = body.dashVy;
    player.state = 'dashing';
    spawnDustTrail(combat.particles, player.x, player.y + SPRITE_SIZE / 2, 6);
    // Dash can do contact damage — check below
  }

  if (move === 'forcePush') {
    combat.cooldowns.forcePush = def.cooldown;
    const pushAngle = angleBetween(player.x, player.y, mouseWorldX, mouseWorldY);
    combat.forcePushes.push(createForcePush(player.x, player.y, pushAngle, '#4488ff'));
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
      const angleDelta = Math.abs(
        angleBetween(player.x, player.y, mouseWorldX, mouseWorldY) - targetAngle,
      );
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
      return false;
    }
    // Normal block
    actualDamage = Math.round(damage * BLOCK_REDUCTION);
    spawnDustTrail(combat.particles, player.x, player.y, 4);
  }

  player.hp = Math.max(0, player.hp - actualDamage);
  player.hitFlash = 1;

  // ── Knockback is now subtle — just a slight push ──
  player.vx += knockX;
  player.vy += knockY;

  const def = MOVE_DEFS[attackMove];

  // ── Headshot = instant kill ──
  if (attackMove === 'headshot') {
    player.hp = 0;
    player.state = 'dead';
    player.attackType = 'headshot'; // signals Death_B animation
    player.deathTimer = 60;
    player.consecutiveGunshots = 0;
    spawnDeathExplosion(combat.particles, player.x, player.y);
    spawnSpecialText(combat.floatingTexts, player.x, player.y - 20, 'HEADSHOT');
    combat.shake = createScreenShake(10, 18);
    combat.slowMo = createSlowMo(0.2, 10);
    return true;
  }

  // ── Gunshot = collapse to one knee ──
  if (attackMove === 'gunshot') {
    player.consecutiveGunshots++;

    if (player.consecutiveGunshots >= 2) {
      // Two gunshots = death
      player.hp = 0;
      player.state = 'dead';
      player.attackType = null; // uses Death_A
      player.deathTimer = GUNSHOT_RESPAWN_TIME;
      player.consecutiveGunshots = 0;
      spawnDeathExplosion(combat.particles, player.x, player.y);
      spawnSpecialText(combat.floatingTexts, player.x, player.y - 20, 'EXECUTED');
      combat.shake = createScreenShake(8, 15);
      combat.slowMo = createSlowMo(0.3, 8);
      return true;
    }

    // First gunshot: collapse to one knee (wounded state)
    player.state = 'wounded';
    player.woundedTimer = WOUNDED_DURATION;
    player.stunTimer = 0; // wounded overrides stun
    spawnHitSparks(combat.particles, player.x, player.y, 10);
    spawnDamageText(combat.floatingTexts, player.x, player.y, actualDamage, false);
    combat.shake = createScreenShake(4, 8);
    return false;
  }

  // ── Melee hits: reset gunshot counter (only consecutive gunshots count) ──
  player.consecutiveGunshots = 0;

  // ── 3-hit combo knockdown ──
  // comboHits is tracked on the ATTACKER, but we check the victim's
  // recent received hits. Use stunTimer accumulation as a proxy:
  // if the player is already stunned and gets hit again, count toward knockdown.
  if (player.state === 'stunned' || player.state === 'knocked') {
    // Already reeling — this hit stacks
  }

  // Check if this is a combo-worthy situation (attacker's combo is in HitResult)
  // The combo count is passed via the damage multiplier from the attacker side.
  // For the victim, track consecutive hits received while stunned.
  if (def && player.state !== 'blocking') {
    player.stunTimer += def.stunDuration;

    // If accumulated stun exceeds threshold, it's a combo knockdown
    if (player.stunTimer >= 20 && player.state === 'stunned') {
      // 3-hit combo knockdown — play Death_A at 0.5x, auto-stand after 2 seconds
      player.state = 'knocked';
      player.knockedTimer = KNOCKED_DURATION;
      player.stunTimer = 0;
      player.vx *= 0.3; // slow to a crawl
      player.vy *= 0.3;
      spawnSpecialText(combat.floatingTexts, player.x, player.y - 20, 'KNOCKDOWN');
      spawnGroundSlamWave(combat.particles, player.x, player.y + 16);
      combat.shake = createScreenShake(6, 12);
      combat.slowMo = createSlowMo(0.4, 6);
    } else if (player.state !== 'knocked') {
      player.state = 'stunned';
    }
  }

  // Launch if uppercut (still works but with reduced knockback)
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
    return true;
  }

  return false;
}

// ── Tick player state each frame ──────────────────────────────────────
//
// Motion for non-combat states goes through locomotion.ts. Combat
// states that need motion (knocked, wounded, attacking mid-move,
// dashing) still call into locomotion via stepPassive() so they share
// the same gravity / collision / ground-snap pipeline.
//
// A MovementBody is kept per-Player in a WeakMap so timers (coyote,
// jumpBuffer, climb state) persist across frames.

const playerBodies = new WeakMap<Player, MovementBody>();

function getBody(player: Player): MovementBody {
  let body = playerBodies.get(player);
  if (!body) {
    body = createMovementBody(player.x, player.y);
    playerBodies.set(player, body);
  }
  return playerToBody(player, body);
}

export function getPlayerBody(player: Player): MovementBody | null {
  return playerBodies.get(player) ?? null;
}

export function getOrCreatePlayerBody(player: Player): MovementBody {
  return getBody(player);
}

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
      player.knockedTimer = 0;
      player.woundedTimer = 0;
      player.consecutiveGunshots = 0;
      player.attackType = null;
      // Reset locomotion body so new spawn position sticks + no stale climb.
      const body = getBody(player);
      body.z = 0;
      body.vz = 0;
      body.climb = null;
    }
    return;
  }

  // ── Passive-motion combat states ──
  // Knocked / wounded / stunned / blocking share the same physics:
  // existing velocity + gravity + wall-slide, no locomotion input.
  if (
    player.state === 'knocked' ||
    player.state === 'wounded' ||
    player.state === 'blocking' ||
    player.stunTimer > 0
  ) {
    if (player.state === 'knocked') {
      player.knockedTimer--;
      applyFriction(player, 0.95);
    } else if (player.state === 'wounded') {
      player.woundedTimer--;
      applyFriction(player, 0.95);
    } else if (player.state === 'blocking') {
      player.blockTimer++;
      applyFriction(player);
    } else {
      player.state = 'stunned';
      applyFriction(player, 0.9);
    }

    const body = getBody(player);
    stepPassive(body, ISLAND_MAP);
    bodyToPlayer(body, player);

    // Transitions out of passive.
    if (player.state === 'knocked' && player.knockedTimer <= 0) {
      player.state = 'idle';
      player.stunTimer = 0;
      player.iFrames = 30;
    } else if (player.state === 'wounded' && player.woundedTimer <= 0) {
      player.state = 'idle';
      player.iFrames = 20;
    } else if (player.state === 'blocking' && !input.shiftHeld) {
      player.state = 'idle';
      player.blockTimer = 0;
    }
    return;
  }

  // ── Backflip animation ──
  if (player.state === 'backflip') {
    player.flipRotation += (Math.PI * 2) / BACKFLIP_DURATION;
    applyFriction(player, 0.92);
    const body = getBody(player);
    stepPassive(body, ISLAND_MAP);
    bodyToPlayer(body, player);
    if (player.attackTimer <= 0) {
      player.state = body.grounded ? 'idle' : 'airborne';
      player.flipRotation = 0;
    }
    return;
  }

  // ── Dashing ──
  if (player.state === 'dashing') {
    player.dashTimer--;
    player.vx = player.dashVx;
    player.vy = player.dashVy;
    const body = getBody(player);
    body.vz = 0; // dashes are grounded horizontal
    stepPassive(body, ISLAND_MAP);
    bodyToPlayer(body, player);
    if (player.dashTimer <= 0) {
      player.state = 'idle';
      player.vx = player.dashVx * 0.3;
      player.vy = player.dashVy * 0.3;
    }
    if (player.dashTimer % 3 === 0) {
      spawnDustTrail(combat.particles, player.x, player.y + SPRITE_SIZE / 2, 2);
    }
    return;
  }

  // ── Attacking ──
  if (player.state === 'attacking') {
    if (player.attackTimer <= 0) {
      // Attack finished — return to idle
      player.state = player.airborneY < GROUND_Y ? 'airborne' : 'idle';
      player.attackType = null;
      // Fall through to normal locomotion
    } else {
      applyFriction(player, 0.92);
      const body = getBody(player);
      stepPassive(body, ISLAND_MAP);
      bodyToPlayer(body, player);
      return;
    }
  }

  // ── Normal locomotion (walk / run / jump / climb) ──
  const body = getBody(player);
  const locoInput = readLocomotionInput(input);
  // TS narrows player.state aggressively through the preceding returns;
  // cast to the full PlayerState union so our sentinel checks compile.
  const currentState = player.state as PlayerState;
  locoInput.canClimb = currentState !== 'attacking';

  stepLocomotion(body, locoInput, ISLAND_MAP);
  bodyToPlayer(body, player);

  // Animation state reflects what locomotion did.
  if (locoInput.moveX !== 0 || locoInput.moveY !== 0) {
    player.state = locoInput.sprint ? 'dashing' : 'walking';
    player.direction = directionFromDelta(locoInput.moveX, locoInput.moveY);
    if (locoInput.moveX !== 0) player.scaleX = locoInput.moveX > 0 ? 1 : -1;
  } else {
    const s = player.state as PlayerState;
    if (s === 'walking' || s === 'dashing') {
      player.state = 'idle';
    }
  }

  // Airborne state wins for animation when off the ground.
  if (!body.grounded && (player.state as PlayerState) !== 'backflip') {
    player.state = 'airborne';
  }
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
  // Subtle knockback — no flying across the map
  remote.targetX += knockX;
  remote.targetY += knockY;

  spawnHitSparks(combat.particles, remote.x, remote.y, 8);
  spawnDamageText(combat.floatingTexts, remote.x, remote.y, damage, false);

  const def = MOVE_DEFS[move];
  if (def && def.launchVy < 0) {
    remote.airborneY = -20;
  }

  // Gunshot: show wounded state on remote
  if (move === 'gunshot' && remote.hp > 0) {
    remote.state = 'wounded';
  }

  // Headshot: instant kill on remote
  if (move === 'headshot') {
    remote.hp = 0;
    remote.state = 'dead';
    spawnDeathExplosion(combat.particles, remote.x, remote.y);
    spawnSpecialText(combat.floatingTexts, remote.x, remote.y - 20, 'HEADSHOT');
    combat.shake = createScreenShake(10, 18);
    combat.slowMo = createSlowMo(0.2, 10);
    return;
  }

  if (remote.hp <= 0) {
    remote.state = 'dead';
    spawnDeathExplosion(combat.particles, remote.x, remote.y);
    combat.shake = createScreenShake(6, 12);
    combat.slowMo = createSlowMo(0.3, 6);
  }
}

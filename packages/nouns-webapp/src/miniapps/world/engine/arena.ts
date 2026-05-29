// ── Arena — giant sea-monster survival run (Loop v1) ─────────────────
//
// A wave-survival roguelite loop layered on top of the existing NPC AI.
// Monsters rise out of the surrounding ocean, wade onto the island, and
// hunt the player. Killing them banks score; clearing a wave spawns a
// bigger one. Taking too many hits ends the run.
//
// This module owns the run/wave/score state and the two combat bridges:
//   - tickArena      : drive monster AI + apply their hits to the player
//   - resolveNpcHits : player attacks/gunfire → monster damage + death
//
// It deliberately mutates the same `npcs` + `npcCharStates` arrays that
// WorldPage already renders, keeping them index-aligned. tick/spawn
// return `true` when the roster changed so the caller can re-render.

import type { NPC, NPCDef } from './npcs';
import { tickNPC, damageNPC } from './npcs';
import type { Player, MoveType } from './types';
import { MAP_SIZE, TILE_SIZE } from './types';
import type { CombatState } from './combat';
import { applyDamageToPlayer } from './combat';
import { MOVE_DEFS, resolveDamage } from './moves';
import { dist, angleBetween } from './physics';
import {
  spawnHitSparks,
  spawnDamageText,
  spawnDeathExplosion,
  createScreenShake,
} from './particles';
import type { CharacterState } from './Character3D';
import type { Direction } from './types';
import { ARENA_TUNING } from './arenaTuning';

const WORLD_CENTER = (MAP_SIZE / 2) * TILE_SIZE;

// ── Monster roster — giant, always-hunting variants ──────────────────

const MONSTER_DEFS: NPCDef[] = [
  {
    name: 'Tide Brute',
    seed: { background: 0, body: 21, accessory: 0, head: 8, glasses: 8 },
    hp: 90,
    speed: 0.72,
    aggroRange: 99999, // always marches at the player
    attackRange: 46,
    attackDamage: [8, 14],
    attackCooldown: 70,
    patrolRadius: 0,
    respawnTime: 999999, // never respawns within a run
    xpReward: 100,
    scale: 2.8,
  },
  {
    name: 'Abyss Maw',
    seed: { background: 0, body: 4, accessory: 12, head: 95, glasses: 5 },
    hp: 140,
    speed: 0.6,
    aggroRange: 99999,
    attackRange: 56,
    attackDamage: [12, 20],
    attackCooldown: 85,
    patrolRadius: 0,
    respawnTime: 999999,
    xpReward: 180,
    scale: 3.6,
  },
  {
    name: 'Reef Stalker',
    seed: { background: 0, body: 15, accessory: 30, head: 142, glasses: 3 },
    hp: 60,
    speed: 1.0, // fast skirmisher
    aggroRange: 99999,
    attackRange: 40,
    attackDamage: [6, 10],
    attackCooldown: 55,
    patrolRadius: 0,
    respawnTime: 999999,
    xpReward: 80,
    scale: 2.2,
  },
];

// ── Run state ─────────────────────────────────────────────────────────

export interface ArenaRun {
  active: boolean;
  over: boolean;
  wave: number;
  score: number;
  kills: number;
  /** Monsters scheduled vs. already surfaced this wave. */
  toSpawnThisWave: number;
  spawnedThisWave: number;
  spawnTimer: number;
  waveBreak: number; // counts down between waves; 0 = wave in progress
  nextId: number;
}

export function createArenaRun(): ArenaRun {
  return {
    active: false,
    over: false,
    wave: 0,
    score: 0,
    kills: 0,
    toSpawnThisWave: 0,
    spawnedThisWave: 0,
    spawnTimer: 0,
    waveBreak: 0,
    nextId: 0,
  };
}

/** How many monsters surface in a given wave. */
function waveCount(wave: number): number {
  return ARENA_TUNING.waveBase + Math.floor(wave * ARENA_TUNING.waveGrowth);
}

/**
 * Begin a fresh run. Clears the roster and queues wave 1. Mutates the
 * shared arrays in place so existing render bindings keep working.
 */
export function startRun(run: ArenaRun, npcs: NPC[], charStates: CharacterState[]): void {
  npcs.length = 0;
  charStates.length = 0;
  run.active = true;
  run.over = false;
  run.wave = 1;
  run.score = 0;
  run.kills = 0;
  run.nextId = 0;
  run.toSpawnThisWave = waveCount(1);
  run.spawnedThisWave = 0;
  run.spawnTimer = 30; // brief beat before the first one surfaces
  run.waveBreak = 0;
}

// ── Spawning ──────────────────────────────────────────────────────────

function makeCharState(npc: NPC): CharacterState {
  return {
    x: npc.x,
    z: npc.y,
    y: 0,
    direction: 'down' as Direction,
    state: 'walking',
    attackType: null,
    hitFlash: 0,
    hp: npc.hp,
    maxHp: npc.maxHp,
    weaponEquipped: null,
    muzzleFlash: 0,
    isSkating: false,
    trickName: null,
    trickTimer: 0,
    airborneVy: 0,
    vx: 0,
    vy: 0,
    paintColor: null,
    swordEquipped: false,
  };
}

function spawnSeaMonster(run: ArenaRun, npcs: NPC[], charStates: CharacterState[]): void {
  // Scale a monster's HP up gently with the wave so later waves bite, then
  // bake in the live tuning multipliers for hp + move speed.
  const base = MONSTER_DEFS[Math.floor(Math.random() * MONSTER_DEFS.length)];
  const hpScale = 1 + (run.wave - 1) * 0.18;
  const def: NPCDef = {
    ...base,
    hp: Math.round(base.hp * hpScale * ARENA_TUNING.hpMul),
    speed: base.speed * ARENA_TUNING.speedMul,
  };

  const tilesMin = ARENA_TUNING.spawnTilesMin;
  const tilesMax = Math.max(tilesMin, ARENA_TUNING.spawnTilesMax);
  const angle = Math.random() * Math.PI * 2;
  const r = (tilesMin + Math.random() * (tilesMax - tilesMin)) * TILE_SIZE;
  const x = WORLD_CENTER + Math.cos(angle) * r;
  const y = WORLD_CENTER + Math.sin(angle) * r;

  const npc: NPC = {
    id: run.nextId++,
    def,
    x,
    y,
    vx: 0,
    vy: 0,
    homeX: x,
    homeY: y,
    hp: def.hp,
    maxHp: def.hp,
    state: 'chase',
    direction: 'down',
    attackCooldown: 0,
    stunTimer: 0,
    deathTimer: 0,
    respawnTimer: 0,
    hitFlash: 0,
    patrolTargetX: x,
    patrolTargetY: y,
    patrolWaitTimer: 0,
  };
  npcs.push(npc);
  charStates.push(makeCharState(npc));
}

// ── Per-frame run tick ────────────────────────────────────────────────

/**
 * Advance the run one frame: surface queued monsters, drive their AI,
 * apply their attacks to the player, sweep the dead, and handle
 * wave-clear / run-over. Returns true if the roster changed (a spawn or
 * a removal) so the caller can bump its render key.
 */
export function tickArena(
  run: ArenaRun,
  npcs: NPC[],
  charStates: CharacterState[],
  player: Player,
  combat: CombatState,
): boolean {
  if (!run.active) return false;
  let rosterChanged = false;

  // ── Staggered spawning within the active wave ──
  if (run.waveBreak <= 0 && run.spawnedThisWave < run.toSpawnThisWave) {
    run.spawnTimer--;
    if (run.spawnTimer <= 0) {
      spawnSeaMonster(run, npcs, charStates);
      run.spawnedThisWave++;
      run.spawnTimer = ARENA_TUNING.spawnInterval;
      rosterChanged = true;
    }
  }

  // ── Monster AI + their attacks on the player ──
  for (const npc of npcs) {
    const r = tickNPC(npc, player.x, player.y, player.hp);
    if (r.didAttack && r.damage > 0) {
      const ka = angleBetween(npc.x, npc.y, player.x, player.y);
      applyDamageToPlayer(
        player,
        r.damage,
        Math.cos(ka) * 1.2,
        Math.sin(ka) * 1.2,
        'punch' as MoveType,
        combat,
      );
    }
  }

  // ── Sweep monsters whose death animation has finished ──
  for (let i = npcs.length - 1; i >= 0; i--) {
    const npc = npcs[i];
    if (npc.hp <= 0 && npc.deathTimer <= 0) {
      npcs.splice(i, 1);
      charStates.splice(i, 1);
      rosterChanged = true;
    }
  }

  // ── Wave clear → break → next wave ──
  if (run.spawnedThisWave >= run.toSpawnThisWave && npcs.length === 0) {
    if (run.waveBreak <= 0) {
      run.waveBreak = ARENA_TUNING.waveBreak;
    } else {
      run.waveBreak--;
      if (run.waveBreak <= 0) {
        run.wave++;
        run.toSpawnThisWave = waveCount(run.wave);
        run.spawnedThisWave = 0;
        run.spawnTimer = 30;
      }
    }
  }

  // ── Player death ends the run ──
  if (player.hp <= 0) {
    run.active = false;
    run.over = true;
  }

  return rosterChanged;
}

// ── Player attacks → monster damage ───────────────────────────────────

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * Resolve a player melee/ranged move against the live monsters. Mirrors
 * the remote-player hit geometry in combat.executeMove, but with hitbox
 * reach widened by monster size so big targets are fair to hit. Banks
 * score + kills on the run and routes hit/kill juice into combat.
 */
export function resolveNpcHits(
  run: ArenaRun,
  player: Player,
  move: MoveType,
  mouseWorldX: number,
  mouseWorldY: number,
  npcs: NPC[],
  combat: CombatState,
): void {
  if (!run.active) return;
  const def = MOVE_DEFS[move];
  if (!def) return;
  const aimAngle = angleBetween(player.x, player.y, mouseWorldX, mouseWorldY);

  for (const npc of npcs) {
    if (npc.hp <= 0) continue;
    const d = dist(player.x, player.y, npc.x, npc.y);
    // Giant bodies get a proportionally larger hit reach.
    const reach = def.range + (npc.def.scale ?? 1) * 8;

    let hit: boolean;
    if (def.isAoE) {
      hit = d < reach;
    } else {
      const targetAngle = angleBetween(player.x, player.y, npc.x, npc.y);
      hit = d < reach && angleDiff(aimAngle, targetAngle) < Math.PI / 2;
    }
    if (!hit) continue;

    const dmg = resolveDamage(def, 1);
    const ka = angleBetween(player.x, player.y, npc.x, npc.y);
    const knock = def.knockback * 0.3;
    const killed = damageNPC(
      npc,
      dmg,
      Math.cos(ka) * knock,
      Math.sin(ka) * knock,
      def.stunDuration,
    );

    spawnHitSparks(combat.particles, npc.x, npc.y, 8 + dmg / 3);
    spawnDamageText(combat.floatingTexts, npc.x, npc.y, dmg, false);
    combat.shake = createScreenShake(2 + dmg / 10, 6);

    if (killed) {
      run.kills++;
      run.score += npc.def.xpReward;
      spawnDeathExplosion(combat.particles, npc.x, npc.y);
      combat.shake = createScreenShake(8, 15);
      combat.killFeed.push({
        killer: `Noun #${player.nounId}`,
        victim: npc.def.name,
        move,
        timestamp: Date.now(),
      });
    }
  }
}

// ── NPC System — Hostile Nouns that patrol and fight ─────────────────

import type { Direction } from './types';
import {
  TILE_SIZE,
  MAP_SIZE,
} from './types';
import { dist, angleBetween, randInt, randRange, isWalkable } from './physics';
import { ISLAND_MAP } from './tilemap';
import type { INounSeed } from '@/wrappers/nounToken';

// ── NPC Definitions ───────────────────────────────────────────────────

export interface NPCDef {
  name: string;
  seed: INounSeed;
  hp: number;
  speed: number;
  aggroRange: number; // pixels — start chasing player
  attackRange: number;
  attackDamage: [number, number]; // min, max
  attackCooldown: number; // frames between attacks
  patrolRadius: number;
  respawnTime: number; // frames
  xpReward: number;
  /** Uniform render-size multiplier. >1 = giant sea monster. */
  scale?: number;
}

export const NPC_DEFS: NPCDef[] = [
  {
    name: 'Queen Crown',
    seed: { background: 0, body: 9, accessory: 0, head: 168, glasses: 4 }, // queencrown head, gold body
    hp: 60,
    speed: 0.4,
    aggroRange: 100,
    attackRange: 32,
    attackDamage: [6, 12],
    attackCooldown: 60,
    patrolRadius: 80,
    respawnTime: 600,
    xpReward: 50,
  },
];

// ── NPC State ─────────────────────────────────────────────────────────

export type NPCState = 'patrol' | 'chase' | 'attack' | 'stunned' | 'dead';

export interface NPC {
  id: number;
  def: NPCDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  hp: number;
  maxHp: number;
  state: NPCState;
  direction: Direction;
  attackCooldown: number;
  stunTimer: number;
  deathTimer: number;
  respawnTimer: number;
  hitFlash: number;
  // Patrol
  patrolTargetX: number;
  patrolTargetY: number;
  patrolWaitTimer: number;
}

// ── NPC spawn positions (world coords, on grass tiles) ────────────────

function findSpawnPositions(): [number, number][] {
  const positions: [number, number][] = [];
  const cx = MAP_SIZE / 2;
  const cy = MAP_SIZE / 2;

  // Spawn NPCs in a ring around the island center
  const offsets = [
    [6, -6], [-6, -4], [8, 4], [-5, 8], [10, -2],
    [-8, -8], [4, 10], [-10, 2], [6, 6], [-4, -10],
  ];

  for (const [ox, oy] of offsets) {
    const tx = cx + ox;
    const ty = cy + oy;
    if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
      if (isWalkable(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, ISLAND_MAP)) {
        positions.push([tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2]);
      }
    }
  }

  return positions;
}

// ── Initialize NPCs ──────────────────────────────────────────────────

export function createNPCs(): NPC[] {
  const positions = findSpawnPositions();
  const npcs: NPC[] = [];

  for (let i = 0; i < NPC_DEFS.length && i < positions.length; i++) {
    const def = NPC_DEFS[i];
    const [x, y] = positions[i];
    npcs.push({
      id: i,
      def,
      x,
      y,
      vx: 0,
      vy: 0,
      homeX: x,
      homeY: y,
      hp: def.hp,
      maxHp: def.hp,
      state: 'patrol',
      direction: 'down',
      attackCooldown: 0,
      stunTimer: 0,
      deathTimer: 0,
      respawnTimer: 0,
      hitFlash: 0,
      patrolTargetX: x,
      patrolTargetY: y,
      patrolWaitTimer: 0,
    });
  }

  return npcs;
}

// ── Tick NPC AI ───────────────────────────────────────────────────────

export function tickNPC(
  npc: NPC,
  playerX: number,
  playerY: number,
  playerHp: number,
): { didAttack: boolean; damage: number } {
  let result = { didAttack: false, damage: 0 };

  // Decay hit flash
  if (npc.hitFlash > 0) npc.hitFlash = Math.max(0, npc.hitFlash - 0.06);
  if (npc.attackCooldown > 0) npc.attackCooldown--;

  // ── Dead ──
  if (npc.state === 'dead') {
    npc.deathTimer--;
    if (npc.deathTimer <= 0) {
      // Start respawn timer
      npc.respawnTimer = npc.def.respawnTime;
      npc.state = 'patrol'; // will be hidden until respawn
    }
    return result;
  }

  // Respawning
  if (npc.respawnTimer > 0) {
    npc.respawnTimer--;
    if (npc.respawnTimer <= 0) {
      // Respawn at home
      npc.x = npc.homeX;
      npc.y = npc.homeY;
      npc.hp = npc.maxHp;
      npc.vx = 0;
      npc.vy = 0;
      npc.state = 'patrol';
    }
    return result;
  }

  // ── Stunned ──
  if (npc.stunTimer > 0) {
    npc.stunTimer--;
    npc.state = 'stunned';
    npc.vx *= 0.9;
    npc.vy *= 0.9;
    npc.x += npc.vx;
    npc.y += npc.vy;
    return result;
  }

  const distToPlayer = dist(npc.x, npc.y, playerX, playerY);
  const playerAlive = playerHp > 0;

  // ── Attack ──
  if (distToPlayer < npc.def.attackRange && playerAlive) {
    npc.state = 'attack';
    // Face player
    npc.direction = getDirectionToward(npc.x, npc.y, playerX, playerY);

    // Circle strafe slightly
    const strafeAngle = angleBetween(npc.x, npc.y, playerX, playerY) + Math.PI / 2;
    npc.x += Math.cos(strafeAngle) * 0.5;
    npc.y += Math.sin(strafeAngle) * 0.5;

    if (npc.attackCooldown <= 0) {
      const damage = randInt(npc.def.attackDamage[0], npc.def.attackDamage[1]);
      npc.attackCooldown = npc.def.attackCooldown;
      result = { didAttack: true, damage };
    }
    return result;
  }

  // ── Chase ──
  if (distToPlayer < npc.def.aggroRange && playerAlive) {
    npc.state = 'chase';
    const angle = angleBetween(npc.x, npc.y, playerX, playerY);
    npc.direction = getDirectionToward(npc.x, npc.y, playerX, playerY);
    const speed = npc.def.speed;
    npc.vx += (Math.cos(angle) * speed - npc.vx) * 0.08;
    npc.vy += (Math.sin(angle) * speed - npc.vy) * 0.08;
    npc.x += npc.vx;
    npc.y += npc.vy;
    return result;
  }

  // ── Patrol ──
  npc.state = 'patrol';

  if (npc.patrolWaitTimer > 0) {
    npc.patrolWaitTimer--;
    npc.vx *= 0.9;
    npc.vy *= 0.9;
    return result;
  }

  const distToTarget = dist(npc.x, npc.y, npc.patrolTargetX, npc.patrolTargetY);
  if (distToTarget < 8) {
    // Pick new patrol target
    const angle = Math.random() * Math.PI * 2;
    const radius = randRange(20, npc.def.patrolRadius);
    npc.patrolTargetX = npc.homeX + Math.cos(angle) * radius;
    npc.patrolTargetY = npc.homeY + Math.sin(angle) * radius;
    npc.patrolWaitTimer = randInt(60, 180); // pause 1-3 seconds
    return result;
  }

  // Walk toward patrol target
  const angle = angleBetween(npc.x, npc.y, npc.patrolTargetX, npc.patrolTargetY);
  npc.direction = getDirectionToward(npc.x, npc.y, npc.patrolTargetX, npc.patrolTargetY);
  const patrolSpeed = npc.def.speed * 0.5;
  npc.vx += (Math.cos(angle) * patrolSpeed - npc.vx) * 0.05;
  npc.vy += (Math.sin(angle) * patrolSpeed - npc.vy) * 0.05;
  npc.x += npc.vx;
  npc.y += npc.vy;

  return result;
}

// ── Apply damage to NPC ───────────────────────────────────────────────

export function damageNPC(npc: NPC, damage: number, knockX: number, knockY: number, stunFrames: number): boolean {
  npc.hp = Math.max(0, npc.hp - damage);
  npc.hitFlash = 1;
  npc.vx += knockX;
  npc.vy += knockY;
  npc.stunTimer = stunFrames;
  npc.state = 'stunned';

  if (npc.hp <= 0) {
    npc.state = 'dead';
    npc.deathTimer = 60;
    return true; // killed
  }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getDirectionToward(fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  // If both axes have meaningful movement, return diagonal
  if (adx > 0.001 && ady > 0.001 && adx / ady < 2 && ady / adx < 2) {
    if (dy < 0) return dx < 0 ? 'up-left' : 'up-right';
    return dx < 0 ? 'down-left' : 'down-right';
  }
  // Otherwise cardinal
  if (adx >= ady) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}

/** Get the seedKey string for an NPC */
export function npcSeedKey(seed: INounSeed): string {
  return `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;
}

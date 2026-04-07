// ── Multiplayer Client — PartySocket wrapper ─────────────────────────

import PartySocket from 'partysocket';

import type {
  Player,
  RemotePlayer,
  MoveType,
} from '../engine/types';
import { REMOTE_STALE_MS, PARTYKIT_HOST, PLAYER_MAX_HP, GROUND_Y } from '../engine/types';
import { lerp } from '../engine/physics';
import { createForcePush } from '../engine/particles';
import type { CombatState } from '../engine/combat';
import { applyDamageToPlayer, applyHitToRemote } from '../engine/combat';
import type {
  ClientMessage,
  ServerMessage,
  WorldPlayerMessage,
  WorldSyncMessage,
  WorldHitBroadcast,
  WorldForcePushBroadcast,
} from './protocol';

export interface MultiplayerState {
  ws: PartySocket | null;
  remotePlayers: Map<string, RemotePlayer>;
  myId: string;
  playerCount: number;
}

export function createMultiplayerState(): MultiplayerState {
  return {
    ws: null,
    remotePlayers: new Map(),
    myId: '',
    playerCount: 0,
  };
}

export function connectMultiplayer(mp: MultiplayerState): PartySocket {
  const ws = new PartySocket({
    host: PARTYKIT_HOST,
    room: 'nouns-world',
  });

  ws.addEventListener('open', () => {
    mp.myId = ws.id;
  });

  mp.ws = ws;
  return ws;
}

export function setupMessageHandler(
  mp: MultiplayerState,
  player: { current: Player },
  combat: { current: CombatState },
) {
  if (!mp.ws) return;

  mp.ws.addEventListener('message', (evt) => {
    let data: ServerMessage;
    try {
      data = JSON.parse(evt.data);
    } catch {
      return;
    }

    switch (data.type) {
      case 'world:sync': {
        const sync = data as WorldSyncMessage;
        mp.playerCount = sync.count;
        for (const [id, ps] of Object.entries(sync.players)) {
          if (id === mp.myId) continue;
          mp.remotePlayers.set(id, {
            id,
            x: ps.x,
            y: ps.y,
            targetX: ps.x,
            targetY: ps.y,
            direction: ps.direction,
            state: ps.state,
            hp: ps.hp,
            maxHp: PLAYER_MAX_HP,
            nounId: ps.nounId,
            seedKey: ps.seedKey,
            scaleX: ps.scaleX,
            attackType: ps.attackType,
            attackTimer: ps.attackTimer,
            airborneY: ps.airborneY,
            flipRotation: ps.flipRotation,
            isSkating: ps.isSkating ?? false,
            trickName: ps.trickName ?? null,
            hitFlash: 0,
            lastSeen: Date.now(),
          });
        }
        break;
      }

      case 'world:player': {
        const msg = data as WorldPlayerMessage;
        if (msg.id === mp.myId) break;
        const existing = mp.remotePlayers.get(msg.id);
        if (existing) {
          existing.targetX = msg.x;
          existing.targetY = msg.y;
          existing.direction = msg.direction;
          existing.state = msg.state;
          existing.hp = msg.hp;
          existing.seedKey = msg.seedKey;
          existing.nounId = msg.nounId;
          existing.scaleX = msg.scaleX;
          existing.attackType = msg.attackType;
          existing.attackTimer = msg.attackTimer;
          existing.airborneY = msg.airborneY;
          existing.flipRotation = msg.flipRotation;
          existing.isSkating = msg.isSkating ?? false;
          existing.trickName = msg.trickName ?? null;
          (existing as any).weaponEquipped = msg.weaponEquipped ?? null;
          (existing as any).paintColor = msg.paintColor ?? null;
          existing.lastSeen = Date.now();
        } else {
          mp.remotePlayers.set(msg.id, {
            id: msg.id,
            x: msg.x,
            y: msg.y,
            targetX: msg.x,
            targetY: msg.y,
            direction: msg.direction,
            state: msg.state,
            hp: msg.hp,
            maxHp: PLAYER_MAX_HP,
            nounId: msg.nounId,
            seedKey: msg.seedKey,
            scaleX: msg.scaleX,
            attackType: msg.attackType,
            attackTimer: msg.attackTimer,
            airborneY: msg.airborneY,
            flipRotation: msg.flipRotation,
            isSkating: msg.isSkating ?? false,
            trickName: msg.trickName ?? null,
            hitFlash: 0,
            lastSeen: Date.now(),
          });
        }
        break;
      }

      case 'world:join': {
        mp.playerCount = data.count;
        break;
      }

      case 'world:leave': {
        mp.remotePlayers.delete(data.id);
        mp.playerCount = data.count;
        break;
      }

      case 'world:hit': {
        const hit = data as WorldHitBroadcast;
        // If we're the target, take damage
        if (hit.targetId === mp.myId) {
          applyDamageToPlayer(
            player.current,
            hit.damage,
            hit.knockX,
            hit.knockY,
            hit.move,
            combat.current,
          );
        }
        // If someone else is hit, show effects on their remote
        const targetRemote = mp.remotePlayers.get(hit.targetId);
        if (targetRemote) {
          applyHitToRemote(targetRemote, hit.damage, hit.knockX, hit.knockY, hit.move, combat.current);
        }
        break;
      }

      case 'world:force': {
        const fp = data as WorldForcePushBroadcast;
        if (fp.id === mp.myId) break;
        combat.current.forcePushes.push(
          createForcePush(fp.x, fp.y, fp.angle, fp.color, true, fp.id),
        );
        break;
      }

      case 'world:death': {
        const remote = mp.remotePlayers.get(data.id);
        if (remote) remote.state = 'dead';
        break;
      }
    }
  });
}

/** Send position update (call every SEND_INTERVAL frames) */
export function sendPlayerUpdate(mp: MultiplayerState, player: Player) {
  if (!mp.ws || mp.ws.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = {
    type: 'world:move',
    x: player.x,
    y: player.y,
    direction: player.direction,
    state: player.state,
    hp: player.hp,
    nounId: player.nounId,
    seedKey: player.seedKey,
    scaleX: player.scaleX,
    attackType: player.attackType,
    attackTimer: player.attackTimer,
    airborneY: player.airborneY,
    flipRotation: player.flipRotation,
    isSkating: player.isSkating,
    trickName: player.trickName ?? undefined,
    weaponEquipped: (player as any).weaponEquipped ?? null,
    paintColor: (player as any).paintColor ?? null,
  };
  mp.ws.send(JSON.stringify(msg));
}

/** Send attack broadcast */
export function sendAttack(
  mp: MultiplayerState,
  move: MoveType,
  x: number,
  y: number,
  angle: number,
) {
  if (!mp.ws || mp.ws.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = {
    type: 'world:attack',
    moveType: move,
    x,
    y,
    angle,
  };
  mp.ws.send(JSON.stringify(msg));
}

/** Send hit notification */
export function sendHit(
  mp: MultiplayerState,
  targetId: string,
  damage: number,
  knockX: number,
  knockY: number,
  move: MoveType,
  combo: number,
) {
  if (!mp.ws || mp.ws.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = {
    type: 'world:hit',
    targetId,
    damage,
    knockX,
    knockY,
    move,
    combo,
  };
  mp.ws.send(JSON.stringify(msg));
}

/** Send force push */
export function sendForcePush(
  mp: MultiplayerState,
  x: number,
  y: number,
  angle: number,
  color: string,
) {
  if (!mp.ws || mp.ws.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = {
    type: 'world:force',
    x,
    y,
    angle,
    color,
  };
  mp.ws.send(JSON.stringify(msg));
}

/** Interpolate remote players + prune stale ones */
export function tickRemotePlayers(mp: MultiplayerState) {
  const now = Date.now();
  for (const [id, rp] of mp.remotePlayers) {
    // Prune stale
    if (now - rp.lastSeen > REMOTE_STALE_MS) {
      mp.remotePlayers.delete(id);
      continue;
    }
    // Interpolate position
    rp.x = lerp(rp.x, rp.targetX, 0.15);
    rp.y = lerp(rp.y, rp.targetY, 0.15);
    // Decay hit flash
    if (rp.hitFlash > 0) rp.hitFlash = Math.max(0, rp.hitFlash - 0.06);
    // Decay airborne toward ground
    if (rp.airborneY < GROUND_Y) {
      rp.airborneY = lerp(rp.airborneY, GROUND_Y, 0.1);
    }
  }
}

/** Disconnect */
export function disconnectMultiplayer(mp: MultiplayerState) {
  mp.ws?.close();
  mp.ws = null;
  mp.remotePlayers.clear();
}

import type { Party, PartyKitServer, Connection } from "partykit/server";

/**
 * noun.wtf — PartyKit real-time multiplayer server.
 *
 * Handles two game modes via message type prefix:
 *
 * 1. Saber Arena (default, no prefix):
 *    Client → Server: update, force, leaderboard_submit, leaderboard_get
 *    Server → Client: sync, player, force, join, leave, leaderboard
 *
 * 2. Nouns World (world: prefix):
 *    Client → Server: world:move, world:attack, world:hit, world:force, world:wager
 *    Server → Client: world:sync, world:player, world:join, world:leave,
 *                      world:attack, world:hit, world:death, world:force, world:wager
 */

// ── Saber types ───────────────────────────────────────────────────────

interface PlayerState {
  x: number;
  y: number;
  angle: number;
  swinging: boolean;
  color: string;
  name: string;
  lastSeen: number;
}

interface LeaderboardEntry {
  name: string;
  seconds: number;
  score: number;
  wave: number;
  timestamp: number;
}

// ── World types ───────────────────────────────────────────────────────

interface WorldPlayerState {
  x: number;
  y: number;
  direction: string;
  state: string;
  hp: number;
  nounId: number;
  seedKey: string;
  scaleX: number;
  attackType: string | null;
  attackTimer: number;
  airborneY: number;
  flipRotation: number;
  lastSeen: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const STALE_TIMEOUT = 5000;
const MAX_LEADERBOARD = 25;

// ── Room state shape ──────────────────────────────────────────────────

interface RoomState {
  _players?: Record<string, PlayerState>;
  _worldPlayers?: Record<string, WorldPlayerState>;
  _leaderboard: LeaderboardEntry[];
}

function getRoomState(room: Party): RoomState {
  return room as unknown as RoomState;
}

// ── Broadcast helpers ─────────────────────────────────────────────────

function broadcastExcept(room: Party, senderId: string, msg: string) {
  for (const conn of room.getConnections()) {
    if (conn.id !== senderId) {
      conn.send(msg);
    }
  }
}

// ── Server ────────────────────────────────────────────────────────────

export default {
  async onStart(room: Party) {
    const stored = await room.storage.get<LeaderboardEntry[]>("leaderboard");
    const rs = getRoomState(room);
    rs._leaderboard = stored ?? [];
  },

  onConnect(connection: Connection, room: Party) {
    const count = [...room.getConnections()].length;
    const rs = getRoomState(room);

    // Broadcast join to everyone
    room.broadcast(
      JSON.stringify({ type: "join", id: connection.id, count }),
    );
    // Also broadcast as world:join for world clients
    room.broadcast(
      JSON.stringify({ type: "world:join", id: connection.id, count }),
    );

    // Send saber sync
    const players: Record<string, PlayerState> = {};
    const now = Date.now();
    for (const [id, state] of Object.entries(rs._players ?? {})) {
      if (now - state.lastSeen < STALE_TIMEOUT) {
        players[id] = state;
      }
    }
    connection.send(JSON.stringify({ type: "sync", players, count }));

    // Send world sync
    const worldPlayers: Record<string, Omit<WorldPlayerState, "lastSeen">> = {};
    for (const [id, state] of Object.entries(rs._worldPlayers ?? {})) {
      if (now - state.lastSeen < STALE_TIMEOUT) {
        const { lastSeen, ...rest } = state;
        worldPlayers[id] = rest;
      }
    }
    connection.send(
      JSON.stringify({ type: "world:sync", players: worldPlayers, count }),
    );
  },

  async onMessage(message: string, connection: Connection, room: Party) {
    try {
      const data = JSON.parse(message as string);
      const rs = getRoomState(room);

      // ── World messages (world: prefix) ──────────────────────────────

      if (typeof data.type === "string" && data.type.startsWith("world:")) {
        if (!rs._worldPlayers) rs._worldPlayers = {};

        if (data.type === "world:move") {
          rs._worldPlayers[connection.id] = {
            x: data.x ?? 0,
            y: data.y ?? 0,
            direction: data.direction ?? "down",
            state: data.state ?? "idle",
            hp: data.hp ?? 100,
            nounId: data.nounId ?? 0,
            seedKey: data.seedKey ?? "0-0-0-0-0",
            scaleX: data.scaleX ?? 1,
            attackType: data.attackType ?? null,
            attackTimer: data.attackTimer ?? 0,
            airborneY: data.airborneY ?? 0,
            flipRotation: data.flipRotation ?? 0,
            lastSeen: Date.now(),
          };

          const { lastSeen, ...rest } = rs._worldPlayers[connection.id];
          broadcastExcept(
            room,
            connection.id,
            JSON.stringify({
              type: "world:player",
              id: connection.id,
              ...rest,
            }),
          );
        } else if (data.type === "world:attack") {
          broadcastExcept(
            room,
            connection.id,
            JSON.stringify({
              type: "world:attack",
              id: connection.id,
              moveType: data.moveType,
              x: data.x ?? 0,
              y: data.y ?? 0,
              angle: data.angle ?? 0,
            }),
          );
        } else if (data.type === "world:hit") {
          // Broadcast hit to all (including target who needs to take damage)
          room.broadcast(
            JSON.stringify({
              type: "world:hit",
              attackerId: connection.id,
              targetId: data.targetId,
              damage: data.damage ?? 0,
              knockX: data.knockX ?? 0,
              knockY: data.knockY ?? 0,
              move: data.move ?? "punch",
              combo: data.combo ?? 0,
            }),
          );

          // Check for death — update world player state
          const target = rs._worldPlayers?.[data.targetId];
          if (target) {
            target.hp = Math.max(0, target.hp - (data.damage ?? 0));
            if (target.hp <= 0) {
              room.broadcast(
                JSON.stringify({
                  type: "world:death",
                  id: data.targetId,
                  killerId: connection.id,
                }),
              );
            }
          }
        } else if (data.type === "world:force") {
          broadcastExcept(
            room,
            connection.id,
            JSON.stringify({
              type: "world:force",
              id: connection.id,
              x: data.x ?? 0,
              y: data.y ?? 0,
              angle: data.angle ?? 0,
              color: data.color ?? "#4488ff",
            }),
          );
        } else if (data.type === "world:wager") {
          // Broadcast wager events to all
          room.broadcast(
            JSON.stringify({
              type: "world:wager",
              ...data,
              from: connection.id,
            }),
          );

        // ── VOIP signaling ──────────────────────────────────────────

        } else if (data.type === "world:voip:offer") {
          // Forward offer to specific peer
          for (const conn of room.getConnections()) {
            if (conn.id === data.to) {
              conn.send(JSON.stringify({
                type: "world:voip:offer",
                from: connection.id,
                sdp: data.sdp,
              }));
              break;
            }
          }
        } else if (data.type === "world:voip:answer") {
          // Forward answer to specific peer
          for (const conn of room.getConnections()) {
            if (conn.id === data.to) {
              conn.send(JSON.stringify({
                type: "world:voip:answer",
                from: connection.id,
                sdp: data.sdp,
              }));
              break;
            }
          }
        } else if (data.type === "world:voip:ice") {
          // Forward ICE candidate to specific peer
          for (const conn of room.getConnections()) {
            if (conn.id === data.to) {
              conn.send(JSON.stringify({
                type: "world:voip:ice",
                from: connection.id,
                candidate: data.candidate,
              }));
              break;
            }
          }

        // ── Drop party ──────────────────────────────────────────────

        } else if (data.type === "world:dropParty") {
          // Broadcast drop party to all players
          room.broadcast(JSON.stringify(data));
        } else if (data.type === "world:dropClaimed") {
          // Broadcast claim to all
          room.broadcast(JSON.stringify({
            type: "world:dropClaimed",
            dropId: data.dropId,
            claimedBy: connection.id,
          }));

        // ── Settlement crowd meter ──────────────────────────────────

        } else if (data.type === "world:voip:speaking") {
          // Broadcast speaking state to all for crowd meter
          room.broadcast(JSON.stringify({
            type: "world:voip:speaking",
            id: connection.id,
            speaking: data.speaking ?? false,
          }));
        }

        return; // Don't process as saber message
      }

      // ── Saber messages (no prefix) ──────────────────────────────────

      if (data.type === "update") {
        if (!rs._players) rs._players = {};

        rs._players[connection.id] = {
          x: data.x ?? 0,
          y: data.y ?? 0,
          angle: data.angle ?? 0,
          swinging: data.swinging ?? false,
          color: data.color ?? "#00aaff",
          name: data.name ?? "Anon",
          lastSeen: Date.now(),
        };

        broadcastExcept(
          room,
          connection.id,
          JSON.stringify({
            type: "player",
            id: connection.id,
            ...rs._players[connection.id],
          }),
        );
      } else if (data.type === "force") {
        broadcastExcept(
          room,
          connection.id,
          JSON.stringify({
            type: "force",
            id: connection.id,
            x: data.x ?? 0,
            y: data.y ?? 0,
            angle: data.angle ?? 0,
            color: data.color ?? "#00aaff",
          }),
        );
      } else if (data.type === "leaderboard_submit") {
        const entry: LeaderboardEntry = {
          name: (data.name ?? "Anon").substring(0, 42),
          seconds: Math.max(0, Math.floor(data.seconds ?? 0)),
          score: Math.max(0, Math.floor(data.score ?? 0)),
          wave: Math.max(1, Math.floor(data.wave ?? 1)),
          timestamp: Date.now(),
        };

        if (!rs._leaderboard) rs._leaderboard = [];
        rs._leaderboard.push(entry);
        rs._leaderboard.sort((a, b) => b.seconds - a.seconds);
        rs._leaderboard = rs._leaderboard.slice(0, MAX_LEADERBOARD);
        await room.storage.put("leaderboard", rs._leaderboard);

        connection.send(
          JSON.stringify({ type: "leaderboard", entries: rs._leaderboard }),
        );
        room.broadcast(
          JSON.stringify({ type: "leaderboard", entries: rs._leaderboard }),
        );
      } else if (data.type === "leaderboard_get") {
        if (!rs._leaderboard) rs._leaderboard = [];
        connection.send(
          JSON.stringify({ type: "leaderboard", entries: rs._leaderboard }),
        );
      }
    } catch {
      // Ignore malformed messages
    }
  },

  onClose(connection: Connection, room: Party) {
    const rs = getRoomState(room);

    // Clean up saber player
    if (rs._players) {
      delete rs._players[connection.id];
    }

    // Clean up world player
    if (rs._worldPlayers) {
      delete rs._worldPlayers[connection.id];
    }

    const count = [...room.getConnections()].length;
    room.broadcast(
      JSON.stringify({ type: "leave", id: connection.id, count }),
    );
    room.broadcast(
      JSON.stringify({ type: "world:leave", id: connection.id, count }),
    );
  },
} satisfies PartyKitServer;

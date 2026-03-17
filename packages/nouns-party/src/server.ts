import type { Party, PartyKitServer, Connection } from "partykit/server";

/**
 * Saber Arena — PartyKit real-time multiplayer server.
 *
 * Protocol (JSON):
 *
 * Client → Server:
 *   { type: "update", x, y, angle, swinging, color, name }
 *   { type: "force", x, y, angle, color }
 *   { type: "leaderboard_submit", name, seconds, score, wave }
 *   { type: "leaderboard_get" }
 *
 * Server → Client:
 *   { type: "sync", players, count }
 *   { type: "player", id, ...state }
 *   { type: "force", id, x, y, angle, color }
 *   { type: "join", id, count }
 *   { type: "leave", id, count }
 *   { type: "leaderboard", entries }
 */

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

const STALE_TIMEOUT = 5000;
const MAX_LEADERBOARD = 25;

export default {
  async onStart(room: Party) {
    // Load leaderboard from durable storage
    const stored = await room.storage.get<LeaderboardEntry[]>("leaderboard");
    const roomAny = room as unknown as {
      _players?: Record<string, PlayerState>;
      _leaderboard: LeaderboardEntry[];
    };
    roomAny._leaderboard = stored ?? [];
  },

  onConnect(connection: Connection, room: Party) {
    const count = [...room.getConnections()].length;

    room.broadcast(
      JSON.stringify({ type: "join", id: connection.id, count }),
    );

    const players: Record<string, PlayerState> = {};
    const now = Date.now();
    for (const [id, state] of Object.entries(
      (room as unknown as { _players?: Record<string, PlayerState> })._players ?? {},
    )) {
      if (now - state.lastSeen < STALE_TIMEOUT) {
        players[id] = state;
      }
    }
    connection.send(JSON.stringify({ type: "sync", players, count }));
  },

  async onMessage(message: string, connection: Connection, room: Party) {
    try {
      const data = JSON.parse(message as string);
      const roomAny = room as unknown as {
        _players?: Record<string, PlayerState>;
        _leaderboard: LeaderboardEntry[];
      };

      if (data.type === "update") {
        if (!roomAny._players) roomAny._players = {};

        roomAny._players[connection.id] = {
          x: data.x ?? 0,
          y: data.y ?? 0,
          angle: data.angle ?? 0,
          swinging: data.swinging ?? false,
          color: data.color ?? "#00aaff",
          name: data.name ?? "Anon",
          lastSeen: Date.now(),
        };

        const update = JSON.stringify({
          type: "player",
          id: connection.id,
          ...roomAny._players[connection.id],
        });

        for (const conn of room.getConnections()) {
          if (conn.id !== connection.id) {
            conn.send(update);
          }
        }
      } else if (data.type === "force") {
        // Broadcast force push event to all other players
        const forceMsg = JSON.stringify({
          type: "force",
          id: connection.id,
          x: data.x ?? 0,
          y: data.y ?? 0,
          angle: data.angle ?? 0,
          color: data.color ?? "#00aaff",
        });

        for (const conn of room.getConnections()) {
          if (conn.id !== connection.id) {
            conn.send(forceMsg);
          }
        }
      } else if (data.type === "leaderboard_submit") {
        // Add entry to leaderboard
        const entry: LeaderboardEntry = {
          name: (data.name ?? "Anon").substring(0, 42), // max length for eth address
          seconds: Math.max(0, Math.floor(data.seconds ?? 0)),
          score: Math.max(0, Math.floor(data.score ?? 0)),
          wave: Math.max(1, Math.floor(data.wave ?? 1)),
          timestamp: Date.now(),
        };

        if (!roomAny._leaderboard) roomAny._leaderboard = [];
        roomAny._leaderboard.push(entry);
        // Sort by seconds survived descending
        roomAny._leaderboard.sort((a, b) => b.seconds - a.seconds);
        // Keep top N
        roomAny._leaderboard = roomAny._leaderboard.slice(0, MAX_LEADERBOARD);
        // Persist to durable storage
        await room.storage.put("leaderboard", roomAny._leaderboard);

        // Send updated leaderboard back to the submitter
        connection.send(JSON.stringify({
          type: "leaderboard",
          entries: roomAny._leaderboard,
        }));

        // Also broadcast to everyone
        room.broadcast(JSON.stringify({
          type: "leaderboard",
          entries: roomAny._leaderboard,
        }));
      } else if (data.type === "leaderboard_get") {
        if (!roomAny._leaderboard) roomAny._leaderboard = [];
        connection.send(JSON.stringify({
          type: "leaderboard",
          entries: roomAny._leaderboard,
        }));
      }
    } catch {
      // Ignore malformed messages
    }
  },

  onClose(connection: Connection, room: Party) {
    const roomAny = room as unknown as { _players?: Record<string, PlayerState> };
    if (roomAny._players) {
      delete roomAny._players[connection.id];
    }

    const count = [...room.getConnections()].length;
    room.broadcast(
      JSON.stringify({ type: "leave", id: connection.id, count }),
    );
  },
} satisfies PartyKitServer;

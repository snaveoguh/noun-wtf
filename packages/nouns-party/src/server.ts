import type { Party, PartyKitServer, Connection } from "partykit/server";

/**
 * Saber Arena — PartyKit real-time multiplayer server.
 *
 * Each room = one "arena" (we use "main" as the global room).
 * Players send their cursor position + saber state every frame.
 * Server broadcasts to all other connections.
 *
 * Protocol (JSON):
 *
 * Client → Server:
 *   { type: "update", x, y, angle, swinging, color, name }
 *
 * Server → Client:
 *   { type: "sync", players: { [id]: { x, y, angle, swinging, color, name, lastSeen } } }
 *   { type: "join", id, count }
 *   { type: "leave", id, count }
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

// How often to broadcast the full state to all clients (ms)
const BROADCAST_INTERVAL = 50; // 20 fps
// How long before a player is considered disconnected (ms)
const STALE_TIMEOUT = 5000;

export default {
  onConnect(connection: Connection, room: Party) {
    const count = [...room.getConnections()].length;

    // Notify everyone about the new player
    room.broadcast(
      JSON.stringify({ type: "join", id: connection.id, count }),
    );

    // Send the new player the current state
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

  onMessage(message: string, connection: Connection, room: Party) {
    try {
      const data = JSON.parse(message as string);

      if (data.type === "update") {
        // Store player state on the room object
        const roomAny = room as unknown as { _players?: Record<string, PlayerState> };
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

        // Broadcast this player's update to everyone else (low latency)
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
      }
    } catch {
      // Ignore malformed messages
    }
  },

  onClose(connection: Connection, room: Party) {
    // Remove from state
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

import type { Party, PartyKitServer, Connection } from "partykit/server";

/**
 * Saber Arena — PartyKit real-time multiplayer server.
 *
 * Protocol (JSON):
 *
 * Client → Server:
 *   { type: "update", x, y, angle, swinging, color, name }
 *   { type: "force", x, y, angle, color }
 *
 * Server → Client:
 *   { type: "sync", players, count }
 *   { type: "player", id, ...state }
 *   { type: "force", id, x, y, angle, color }
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

const STALE_TIMEOUT = 5000;

export default {
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

  onMessage(message: string, connection: Connection, room: Party) {
    try {
      const data = JSON.parse(message as string);

      if (data.type === "update") {
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

// The slice of a room the game handlers in server.ts use. It's the old
// PartyKit `Party` shape; worker.ts provides it on top of PartyServer (the
// hosted PartyKit platform shut down on 2026-10-23). One object per room,
// kept for the room's lifetime: server.ts hangs live game state off it.

import type { Connection } from 'partyserver';

export type { Connection };

export interface RoomStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface Party {
  readonly id: string;
  readonly storage: RoomStorage;
  readonly env: Record<string, unknown>;
  broadcast(msg: string, without?: string[]): void;
  getConnections(): Iterable<Connection>;
}

// ── noun.wtf multiplayer on Cloudflare (PartyServer) ─────────────────────
//
// The hosted PartyKit platform shut down on 2026-10-23, taking
// noun-wtf-saber.snaveoguh.partykit.dev with it. This runs the same game
// handlers (server.ts, written against PartyKit's `room` object) as a
// PartyServer Durable Object on our own Cloudflare account.
//
// URLs keep PartyKit's shape, so clients only change host:
//   wss://<host>/parties/main/<room>   (binding `Main` → party `main`)
//
// Deploy: `npx wrangler deploy` (see wrangler.jsonc); the NOUN FM admin
// token is a secret: `npx wrangler secret put FM_ADMIN_TOKEN`.

import type { Party } from './room';

import { routePartykitRequest, Server, type Connection } from 'partyserver';

import { handlers } from './server';

interface Env {
  Main: DurableObjectNamespace<Main>;
  FM_ADMIN_TOKEN?: string;
}

interface RoomParts {
  name: () => string;
  storage: () => DurableObjectStorage;
  env: () => Env;
  broadcast: (msg: string, without?: string[]) => void;
  connections: () => Iterable<Connection>;
}

/**
 * The PartyKit-shaped room server.ts expects, on top of a PartyServer.
 * One per room for its whole life: the handlers keep live game state on it.
 */
class RoomAdapter implements Party {
  constructor(private readonly parts: RoomParts) {}

  get id(): string {
    return this.parts.name();
  }

  get env(): Record<string, unknown> {
    return this.parts.env() as unknown as Record<string, unknown>;
  }

  readonly storage = {
    get: <T>(key: string) => this.parts.storage().get<T>(key),
    put: <T>(key: string, value: T) => this.parts.storage().put(key, value),
  };

  broadcast(msg: string, without?: string[]) {
    this.parts.broadcast(msg, without);
  }

  getConnections() {
    return this.parts.connections();
  }
}

export class Main extends Server<Env> {
  private readonly room = new RoomAdapter({
    name: () => this.name,
    storage: () => this.ctx.storage,
    env: () => this.env,
    broadcast: (msg, without) => this.broadcast(msg, without),
    connections: () => this.getConnections(),
  });

  async onStart() {
    await handlers.onStart(this.room);
  }

  onConnect(connection: Connection) {
    handlers.onConnect(connection, this.room);
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    await handlers.onMessage(message, connection, this.room);
  }

  onClose(connection: Connection) {
    handlers.onClose(connection, this.room);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await routePartykitRequest(request, env as unknown as Record<string, unknown>);
    return res ?? new Response('noun.wtf multiplayer', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

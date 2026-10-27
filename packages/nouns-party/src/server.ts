import type { Connection, Party } from './room';

import { BreakRelay } from './breakRelay';
import { FmRelay } from './fmRelay';
import { HideSeekRelay } from './hideseekRelay';
import { HoopsRelay } from './hoopsRelay';
import { PoolRelay } from './poolRelay';
import { WarfareRelay } from './warfareRelay';

/**
 * noun.wtf — real-time multiplayer server (PartyServer on Cloudflare; see
 * worker.ts. Written for PartyKit, whose hosted platform shut down 2026-10-23).
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
 *
 * 3. Noun Hoops (hoops: prefix, world v2): relayed only to the players a
 *    message is for (see hoopsRelay.ts), nothing persisted.
 *
 * 4. Noun Warfare (room `noun-warfare` only, wf: prefix): lobby registry +
 *    host-authoritative match relay (see warfareRelay.ts). That room skips
 *    the saber / world traffic entirely, and other rooms ignore wf:.
 *
 * 5. NOUN FM (world v2 room only, fm: prefix): the ice cream van's radio
 *    station, queue + today's DJ sets (see fmRelay.ts). Persisted under
 *    storage key `fm`; optional admin token in env FM_ADMIN_TOKEN.
 *
 * 6. Noun Breaks (break: prefix, world v2): breakdance battles, relayed only
 *    to the players a message is for (see breakRelay.ts), nothing persisted.
 *
 * 7. Noun Pool (pool: prefix, world v2): 8-ball frames, relayed only to the
 *    players a message is for (see poolRelay.ts), nothing persisted.
 *
 * 8. Noun Hide & Seek (hideseek: prefix, world v2): relayed only to the
 *    players a message is for (see hideseekRelay.ts), nothing persisted.
 */

const WARFARE_ROOM = 'noun-warfare';
const FM_ROOM = 'nouns-world-v2';

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
  _hoops?: HoopsRelay;
  _break?: BreakRelay;
  _pool?: PoolRelay;
  _hideseek?: HideSeekRelay;
  _warfare?: WarfareRelay;
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

/**
 * NOUN FM relays by room id. Module-level, not on the room object: the
 * runtime doesn't promise the same room object on every event, and a relay
 * hung off it was being rebuilt per message (forgetting who said hello).
 */
const fmRelays = new Map<string, Promise<FmRelay>>();

/** The NOUN FM relay for this room, created (and its station loaded) once. */
async function ensureFm(room: Party): Promise<FmRelay> {
  let p = fmRelays.get(room.id);
  if (p === undefined) {
    p = (async () => {
      const token = room.env.FM_ADMIN_TOKEN;
      const fm = new FmRelay({
        conns: () => room.getConnections(),
        adminToken: typeof token === 'string' ? token : undefined,
        save: snap => void room.storage.put('fm', snap).catch(() => undefined),
      });
      try {
        fm.load(await room.storage.get('fm'));
      } catch {
        // a bad stored station just starts empty
      }
      return fm;
    })();
    fmRelays.set(room.id, p);
  }
  return p;
}

// ── Server ────────────────────────────────────────────────────────────

export const handlers = {
  async onStart(room: Party) {
    if (room.id === WARFARE_ROOM) return;
    const stored = await room.storage.get<LeaderboardEntry[]>('leaderboard');
    const rs = getRoomState(room);
    rs._leaderboard = stored ?? [];
    if (room.id === FM_ROOM) await ensureFm(room);
  },

  onConnect(connection: Connection, room: Party) {
    if (room.id === WARFARE_ROOM) {
      const rs = getRoomState(room);
      rs._warfare ??= new WarfareRelay();
      connection.send(JSON.stringify({ type: 'wf:matches', list: rs._warfare.listing() }));
      return;
    }
    const count = [...room.getConnections()].length;
    const rs = getRoomState(room);

    // Broadcast join to everyone
    room.broadcast(JSON.stringify({ type: 'join', id: connection.id, count }));
    // Also broadcast as world:join for world clients
    room.broadcast(JSON.stringify({ type: 'world:join', id: connection.id, count }));

    // Send saber sync
    const players: Record<string, PlayerState> = {};
    const now = Date.now();
    for (const [id, state] of Object.entries(rs._players ?? {})) {
      if (now - state.lastSeen < STALE_TIMEOUT) {
        players[id] = state;
      }
    }
    connection.send(JSON.stringify({ type: 'sync', players, count }));

    // Send world sync
    const worldPlayers: Record<string, Omit<WorldPlayerState, 'lastSeen'>> = {};
    for (const [id, state] of Object.entries(rs._worldPlayers ?? {})) {
      if (now - state.lastSeen < STALE_TIMEOUT) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lastSeen: _ls, ...rest } = state;
        worldPlayers[id] = rest;
      }
    }
    connection.send(JSON.stringify({ type: 'world:sync', players: worldPlayers, count }));
  },

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    connection: Connection,
    room: Party,
  ) {
    // Every game here speaks JSON text
    if (typeof message !== 'string') return;
    if (room.id === WARFARE_ROOM) {
      const rs = getRoomState(room);
      rs._warfare ??= new WarfareRelay();
      rs._warfare.message(message, connection, room.getConnections());
      return;
    }
    try {
      const data = JSON.parse(message as string);
      const rs = getRoomState(room);

      // ── Noun Hoops (hoops: prefix) ──────────────────────────────────
      if (typeof data.type === 'string' && data.type.startsWith('hoops:')) {
        if (message.length > 8192) return;
        rs._hoops ??= new HoopsRelay();
        rs._hoops.handle(data, connection, room.getConnections());
        return;
      }

      // ── Noun Breaks (break: prefix) ─────────────────────────────────
      if (typeof data.type === 'string' && data.type.startsWith('break:')) {
        if (message.length > 16384) return;
        rs._break ??= new BreakRelay();
        rs._break.handle(data, connection, room.getConnections());
        return;
      }

      // ── Noun Pool (pool: prefix) ────────────────────────────────────
      if (typeof data.type === 'string' && data.type.startsWith('pool:')) {
        if (message.length > 8192) return;
        rs._pool ??= new PoolRelay();
        rs._pool.handle(data, connection, room.getConnections());
        return;
      }

      // ── Noun Hide & Seek (hideseek: prefix) ─────────────────────────
      if (typeof data.type === 'string' && data.type.startsWith('hideseek:')) {
        if (message.length > 16384) return;
        rs._hideseek ??= new HideSeekRelay();
        rs._hideseek.handle(data, connection, room.getConnections());
        return;
      }

      // ── NOUN FM (fm: prefix, world v2 room only) ────────────────────
      if (typeof data.type === 'string' && data.type.startsWith('fm:')) {
        if (room.id !== FM_ROOM) return;
        // Set up on first use too: onStart can't be relied on to have run
        // (or to have run on this same room object) before the first message
        const fm = await ensureFm(room);
        fm.handle(data, message.length, connection);
        return;
      }

      // ── World messages (world: prefix) ──────────────────────────────

      if (typeof data.type === 'string' && data.type.startsWith('world:')) {
        if (!rs._worldPlayers) rs._worldPlayers = {};

        if (data.type === 'world:move') {
          rs._worldPlayers[connection.id] = {
            x: data.x ?? 0,
            y: data.y ?? 0,
            direction: data.direction ?? 'down',
            state: data.state ?? 'idle',
            hp: data.hp ?? 100,
            nounId: data.nounId ?? 0,
            seedKey: data.seedKey ?? '0-0-0-0-0',
            scaleX: data.scaleX ?? 1,
            attackType: data.attackType ?? null,
            attackTimer: data.attackTimer ?? 0,
            airborneY: data.airborneY ?? 0,
            flipRotation: data.flipRotation ?? 0,
            lastSeen: Date.now(),
          };

          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { lastSeen: _ls2, ...rest } = rs._worldPlayers[connection.id];
          broadcastExcept(
            room,
            connection.id,
            JSON.stringify({
              type: 'world:player',
              id: connection.id,
              ...rest,
            }),
          );
        } else if (data.type === 'world:attack') {
          broadcastExcept(
            room,
            connection.id,
            JSON.stringify({
              type: 'world:attack',
              id: connection.id,
              moveType: data.moveType,
              x: data.x ?? 0,
              y: data.y ?? 0,
              angle: data.angle ?? 0,
            }),
          );
        } else if (data.type === 'world:hit') {
          // Broadcast hit to all (including target who needs to take damage)
          room.broadcast(
            JSON.stringify({
              type: 'world:hit',
              attackerId: connection.id,
              targetId: data.targetId,
              damage: data.damage ?? 0,
              knockX: data.knockX ?? 0,
              knockY: data.knockY ?? 0,
              move: data.move ?? 'punch',
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
                  type: 'world:death',
                  id: data.targetId,
                  killerId: connection.id,
                }),
              );
            }
          }
        } else if (data.type === 'world:force') {
          broadcastExcept(
            room,
            connection.id,
            JSON.stringify({
              type: 'world:force',
              id: connection.id,
              x: data.x ?? 0,
              y: data.y ?? 0,
              angle: data.angle ?? 0,
              color: data.color ?? '#4488ff',
            }),
          );
        } else if (data.type === 'world:wager') {
          // Broadcast wager events to all
          room.broadcast(
            JSON.stringify({
              type: 'world:wager',
              ...data,
              from: connection.id,
            }),
          );

          // ── VOIP signaling ──────────────────────────────────────────
        } else if (data.type === 'world:voip:offer') {
          // Forward offer to specific peer
          for (const conn of room.getConnections()) {
            if (conn.id === data.to) {
              conn.send(
                JSON.stringify({
                  type: 'world:voip:offer',
                  from: connection.id,
                  sdp: data.sdp,
                }),
              );
              break;
            }
          }
        } else if (data.type === 'world:voip:answer') {
          // Forward answer to specific peer
          for (const conn of room.getConnections()) {
            if (conn.id === data.to) {
              conn.send(
                JSON.stringify({
                  type: 'world:voip:answer',
                  from: connection.id,
                  sdp: data.sdp,
                }),
              );
              break;
            }
          }
        } else if (data.type === 'world:voip:ice') {
          // Forward ICE candidate to specific peer
          for (const conn of room.getConnections()) {
            if (conn.id === data.to) {
              conn.send(
                JSON.stringify({
                  type: 'world:voip:ice',
                  from: connection.id,
                  candidate: data.candidate,
                }),
              );
              break;
            }
          }

          // ── Drop party ──────────────────────────────────────────────
        } else if (data.type === 'world:dropParty') {
          // Broadcast drop party to all players
          room.broadcast(JSON.stringify(data));
        } else if (data.type === 'world:dropClaimed') {
          // Broadcast claim to all
          room.broadcast(
            JSON.stringify({
              type: 'world:dropClaimed',
              dropId: data.dropId,
              claimedBy: connection.id,
            }),
          );

          // ── Settlement crowd meter ──────────────────────────────────

          // ── Graffiti persistence ──────────────────────────────────
        } else if (data.type === 'world:graffiti:save') {
          // Save a graffiti tag to persistent storage
          const wallId = data.wallId as string;
          if (wallId && data.imageData) {
            const key = `graffiti:${wallId}`;
            const existing =
              (await room.storage.get<
                Array<{ imageData: string; playerId: string; timestamp: number }>
              >(key)) ?? [];
            existing.push({
              imageData: data.imageData,
              playerId: connection.id,
              timestamp: Date.now(),
            });
            // Keep last 20 tags per wall
            if (existing.length > 20) existing.splice(0, existing.length - 20);
            await room.storage.put(key, existing);
            // Broadcast to all so everyone sees it live
            room.broadcast(
              JSON.stringify({
                type: 'world:graffiti:tags',
                wallId,
                tags: existing,
              }),
            );
          }
        } else if (data.type === 'world:graffiti:load') {
          // Load all tags for a wall
          const wallId = data.wallId as string;
          if (wallId) {
            const key = `graffiti:${wallId}`;
            const tags =
              (await room.storage.get<
                Array<{ imageData: string; playerId: string; timestamp: number }>
              >(key)) ?? [];
            connection.send(
              JSON.stringify({
                type: 'world:graffiti:tags',
                wallId,
                tags,
              }),
            );
          }
        } else if (data.type === 'world:voip:speaking') {
          // Broadcast speaking state to all for crowd meter
          room.broadcast(
            JSON.stringify({
              type: 'world:voip:speaking',
              id: connection.id,
              speaking: data.speaking ?? false,
            }),
          );
        } else if (data.type === 'world:kd:save') {
          // Persist K/D ratio keyed by wallet address
          const wallet = (data.wallet ?? '').toLowerCase();
          if (wallet) {
            const existing = (await room.storage.get<{ kills: number; deaths: number }>(
              `kd:${wallet}`,
            )) ?? { kills: 0, deaths: 0 };
            existing.kills += data.addKills ?? 0;
            existing.deaths += data.addDeaths ?? 0;
            await room.storage.put(`kd:${wallet}`, existing);
            // Send updated stats back
            connection.send(
              JSON.stringify({
                type: 'world:kd:stats',
                wallet,
                kills: existing.kills,
                deaths: existing.deaths,
              }),
            );
          }
        } else if (data.type === 'world:kd:load') {
          const wallet = (data.wallet ?? '').toLowerCase();
          if (wallet) {
            const stats = (await room.storage.get<{ kills: number; deaths: number }>(
              `kd:${wallet}`,
            )) ?? { kills: 0, deaths: 0 };
            connection.send(
              JSON.stringify({
                type: 'world:kd:stats',
                wallet,
                kills: stats.kills,
                deaths: stats.deaths,
              }),
            );
          }
        } else if (data.type === 'world:voip:transcript') {
          // Broadcast speech-to-text transcript to all players
          room.broadcast(
            JSON.stringify({
              type: 'world:voip:transcript',
              id: connection.id,
              text: data.text ?? '',
            }),
          );
        }

        return; // Don't process as saber message
      }

      // ── Saber messages (no prefix) ──────────────────────────────────

      if (data.type === 'update') {
        if (!rs._players) rs._players = {};

        rs._players[connection.id] = {
          x: data.x ?? 0,
          y: data.y ?? 0,
          angle: data.angle ?? 0,
          swinging: data.swinging ?? false,
          color: data.color ?? '#00aaff',
          name: data.name ?? 'Anon',
          lastSeen: Date.now(),
        };

        broadcastExcept(
          room,
          connection.id,
          JSON.stringify({
            type: 'player',
            id: connection.id,
            ...rs._players[connection.id],
          }),
        );
      } else if (data.type === 'force') {
        broadcastExcept(
          room,
          connection.id,
          JSON.stringify({
            type: 'force',
            id: connection.id,
            x: data.x ?? 0,
            y: data.y ?? 0,
            angle: data.angle ?? 0,
            color: data.color ?? '#00aaff',
          }),
        );
      } else if (data.type === 'leaderboard_submit') {
        const entry: LeaderboardEntry = {
          name: (data.name ?? 'Anon').substring(0, 42),
          seconds: Math.max(0, Math.floor(data.seconds ?? 0)),
          score: Math.max(0, Math.floor(data.score ?? 0)),
          wave: Math.max(1, Math.floor(data.wave ?? 1)),
          timestamp: Date.now(),
        };

        if (!rs._leaderboard) rs._leaderboard = [];
        rs._leaderboard.push(entry);
        rs._leaderboard.sort((a, b) => b.seconds - a.seconds);
        rs._leaderboard = rs._leaderboard.slice(0, MAX_LEADERBOARD);
        await room.storage.put('leaderboard', rs._leaderboard);

        connection.send(JSON.stringify({ type: 'leaderboard', entries: rs._leaderboard }));
        room.broadcast(JSON.stringify({ type: 'leaderboard', entries: rs._leaderboard }));
      } else if (data.type === 'leaderboard_get') {
        if (!rs._leaderboard) rs._leaderboard = [];
        connection.send(JSON.stringify({ type: 'leaderboard', entries: rs._leaderboard }));
      }
    } catch {
      // Ignore malformed messages
    }
  },

  onClose(connection: Connection, room: Party) {
    const rs = getRoomState(room);
    if (room.id === WARFARE_ROOM) {
      rs._warfare?.close(connection.id, room.getConnections());
      return;
    }

    // Clean up saber player
    if (rs._players) {
      delete rs._players[connection.id];
    }

    // Clean up world player
    if (rs._worldPlayers) {
      delete rs._worldPlayers[connection.id];
    }

    rs._hoops?.close(connection.id, room.getConnections());
    rs._break?.close(connection.id, room.getConnections());
    rs._pool?.close(connection.id, room.getConnections());
    rs._hideseek?.close(connection.id, room.getConnections());
    void fmRelays.get(room.id)?.then(fm => fm.close(connection.id));

    const count = [...room.getConnections()].length;
    room.broadcast(JSON.stringify({ type: 'leave', id: connection.id, count }));
    room.broadcast(JSON.stringify({ type: 'world:leave', id: connection.id, count }));
  },
};

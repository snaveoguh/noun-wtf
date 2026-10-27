// ── Who's at a table, challenges, live frames ───────────────────────────
//
// Presence: every couple of seconds a player at a pool table says so
// (`pool:lobby {at: tableKey}`), and a host says what's on (`live`).
// A challenge goes to one player, carries the frame id and the table, and
// is answered yes / no; a yes makes the challenger the host, who sends
// pool:start. Pure (clock passed in) so it's tested on its own.

import type { LiveFrame, PoolMsg, PoolTable } from '../contract';

export const PRESENCE_MS = 7000;
export const INVITE_MS = 25000;

export interface Here {
  id: string;
  name: string;
  seedKey?: string;
  at: string | null;
  t: number;
}

export interface Outgoing {
  to: string;
  name: string;
  gid: string;
  t: number;
  declined?: boolean;
}

export interface Incoming {
  from: string;
  name: string;
  gid: string;
  table?: string;
  place?: PoolTable;
  t: number;
}

export type LobbyResult =
  | { kind: 'accepted'; to: string; name: string; gid: string }
  | { kind: 'declined'; name: string }
  | { kind: 'invite'; from: string; name: string }
  | null;

export interface LobbyDeps {
  myId(): string;
  myName(): string;
  mySeedKey(): string | undefined;
  send(m: PoolMsg): void;
  now(): number;
  /** In a frame already (invites are turned down). */
  busy(): boolean;
}

export class PoolLobby {
  here = new Map<string, Here>();
  live = new Map<string, LiveFrame & { t: number }>();
  outgoing: Outgoing | null = null;
  incoming: Incoming | null = null;
  /** I said yes to this frame: waiting for the host's start. */
  expect: { gid: string; host: string; t: number } | null = null;
  /** Frames I asked to watch. */
  watching: string | null = null;

  constructor(private d: LobbyDeps) {}

  announce(at: string | null, live?: LiveFrame) {
    this.d.send({
      type: 'pool:lobby',
      at,
      name: this.d.myName(),
      seedKey: this.d.mySeedKey(),
      ...(live !== undefined ? { live } : {}),
    });
  }

  challenge(to: string, name: string, table?: PoolTable): string {
    const gid = `p${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;
    this.outgoing = { to, name, gid, t: this.d.now() };
    this.d.send({
      type: 'pool:challenge',
      to,
      gid,
      name: this.d.myName(),
      table: table?.id,
      place: table,
    });
    return gid;
  }

  cancel() {
    this.outgoing = null;
  }

  accept(): Incoming | null {
    const inv = this.incoming;
    if (inv === null) return null;
    this.d.send({ type: 'pool:reply', to: inv.from, gid: inv.gid, ok: true });
    this.expect = { gid: inv.gid, host: inv.from, t: this.d.now() };
    this.incoming = null;
    return inv;
  }

  decline() {
    const inv = this.incoming;
    if (inv === null) return;
    this.d.send({ type: 'pool:reply', to: inv.from, gid: inv.gid, ok: false });
    this.incoming = null;
  }

  watch(gid: string): boolean {
    if (!this.live.has(gid)) return false;
    this.watching = gid;
    this.d.send({ type: 'pool:watch', gid });
    return true;
  }

  /** Is a pool:start for me (as a player I said yes to, or a frame I asked to watch)? */
  wants(m: Extract<PoolMsg, { type: 'pool:start' }>): 'member' | 'spectator' | null {
    const me = this.d.myId();
    if (m.config.players.some(p => p.id === me) && this.expect?.gid === m.config.gid)
      return 'member';
    if (this.watching === m.config.gid) return 'spectator';
    return null;
  }

  onMessage(m: PoolMsg): LobbyResult {
    const now = this.d.now();
    switch (m.type) {
      case 'pool:lobby': {
        if (m.from === undefined || m.from === this.d.myId()) return null;
        if (m.at === null) this.here.delete(m.from);
        else
          this.here.set(m.from, {
            id: m.from,
            name: m.name ?? 'noun',
            seedKey: m.seedKey,
            at: m.at,
            t: now,
          });
        for (const [gid, l] of this.live) if (l.host === m.from) this.live.delete(gid);
        if (m.live !== undefined) this.live.set(m.live.gid, { ...m.live, host: m.from, t: now });
        return null;
      }
      case 'pool:challenge': {
        if (m.from === undefined) return null;
        if (this.d.busy() || this.incoming !== null) {
          this.d.send({ type: 'pool:reply', to: m.from, gid: m.gid, ok: false });
          return null;
        }
        const name = m.name ?? this.here.get(m.from)?.name ?? 'noun';
        this.incoming = { from: m.from, name, gid: m.gid, table: m.table, place: m.place, t: now };
        return { kind: 'invite', from: m.from, name };
      }
      case 'pool:reply': {
        const o = this.outgoing;
        if (o === null || m.gid !== o.gid || m.from !== o.to) return null;
        if (!m.ok) {
          this.outgoing = null;
          return { kind: 'declined', name: o.name };
        }
        this.outgoing = null;
        return { kind: 'accepted', to: o.to, name: o.name, gid: o.gid };
      }
      default:
        return null;
    }
  }

  /** Drop stale presence, live frames and invites. Returns true when something changed. */
  tick(): boolean {
    const now = this.d.now();
    let changed = false;
    for (const [id, h] of this.here)
      if (now - h.t > PRESENCE_MS) {
        this.here.delete(id);
        changed = true;
      }
    for (const [gid, l] of this.live)
      if (now - l.t > PRESENCE_MS) {
        this.live.delete(gid);
        changed = true;
      }
    if (this.incoming !== null && now - this.incoming.t > INVITE_MS) {
      this.incoming = null;
      changed = true;
    }
    if (this.outgoing !== null && now - this.outgoing.t > INVITE_MS) {
      this.outgoing = null;
      changed = true;
    }
    if (this.expect !== null && now - this.expect.t > INVITE_MS) {
      this.expect = null;
      changed = true;
    }
    return changed;
  }
}

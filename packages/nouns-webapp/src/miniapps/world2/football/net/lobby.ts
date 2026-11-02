// ── Football lobbies, challenges, WATCH ──────────────────────────────────
//
// Pure state machine over a FootballTransport (clock passed in), tested on
// its own (lobby.test.ts):
//
//   discovery   every football:lobby heard is kept for LOBBY_TTL_MS (6 s);
//               `open: false` forgets it at once.
//   hosting     host(size) opens a lobby (me on team 0) and broadcasts it
//               every 2 s (and on every change). Joins (football:join to
//               me) add / move / remove players, up to `size` humans a
//               team; setLive(score) keeps it on the list as a live match
//               to WATCH; close() says `open: false`.
//   joining     joinTeam(gid, team) asks that lobby's host; leaveTeam().
//   challenges  challenge(to, size) invites one player (20 s expiry); they
//               accept() / decline() (auto-declined while busy or already
//               invited). A yes makes the challenger the host: they start
//               the match (FootballHost), the accepter expects its start.
//   watch       watch(gid) on a live lobby → football:watch; the host
//               answers with football:start {to: me}.
//   start       a football:start for me (a lobby I joined, a challenge I
//               accepted, a watch I asked for, or `to: me`) comes out as
//               {kind: 'start', role: 'member' | 'watch'}: the mode then
//               builds a FootballClient.

import type { FootballMsg, TeamId, TeamSize } from '../contract';
import type { FootballTransport } from './transport';

export const LOBBY_TTL_MS = 6000;
export const LOBBY_EVERY_MS = 2000;
export const INVITE_MS = 20000;

export interface LobbyPlayer {
  id: string;
  name: string;
  team: TeamId;
}

export interface LobbyInfo {
  gid: string;
  host: string;
  hostName: string;
  size: TeamSize;
  live: boolean;
  score?: [number, number];
  players: LobbyPlayer[];
  /** When it was last heard (ms). */
  t: number;
}

export interface MyLobby {
  gid: string;
  size: TeamSize;
  live: boolean;
  score?: [number, number];
  players: LobbyPlayer[];
}

export interface Invite {
  gid: string;
  /** The other player (from for incoming, to for outgoing). */
  who: string;
  name: string;
  size: TeamSize;
  coop: boolean;
  t: number;
}

export type StartMsg = Extract<FootballMsg, { type: 'football:start' }>;

export type LobbyEvent =
  | { kind: 'lobbies' }
  | { kind: 'joined'; id: string; name: string; team: TeamId }
  | { kind: 'left'; id: string }
  | { kind: 'invite'; invite: Invite }
  | { kind: 'accepted'; invite: Invite }
  | { kind: 'declined'; invite: Invite }
  | { kind: 'expired'; what: 'incoming' | 'outgoing' | 'expect' }
  | { kind: 'start'; role: 'member' | 'watch'; msg: StartMsg };

export interface LobbyDeps {
  transport: FootballTransport;
  /** ms clock. */
  now(): number;
  myName(): string;
  /** In a match already (challenges are turned down). */
  busy?(): boolean;
  /** Every event (also returned from onMessage / tick). */
  onEvent?(e: LobbyEvent): void;
}

const newGid = () => `f${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;

export class FootballLobby {
  /** Lobbies + live matches heard from others. */
  readonly lobbies = new Map<string, LobbyInfo>();
  /** The lobby I host. */
  mine: MyLobby | null = null;
  /** The lobby I joined (as a player). */
  joined: { gid: string; host: string; team: TeamId; t: number } | null = null;
  outgoing: Invite | null = null;
  incoming: Invite | null = null;
  /** I accepted this challenge: waiting for its host's start. */
  expect: { gid: string; host: string; t: number } | null = null;
  /** The match I asked to watch. */
  watching: string | null = null;

  private t: FootballTransport;
  private off: () => void;
  private lastAnnounce = -Infinity;

  constructor(private d: LobbyDeps) {
    this.t = d.transport;
    this.off = this.t.onMessage(m => {
      this.onMessage(m);
    });
  }

  private get me() {
    return this.t.selfId;
  }

  private emit(e: LobbyEvent): LobbyEvent {
    this.d.onEvent?.(e);
    return e;
  }

  // ── Hosting ──

  host(size: TeamSize): string {
    const gid = newGid();
    this.mine = {
      gid,
      size,
      live: false,
      players: [{ id: this.me, name: this.d.myName(), team: 0 }],
    };
    this.announce();
    return gid;
  }

  /** The hosted lobby's match is live (or its score changed). */
  setLive(live: boolean, score?: [number, number]) {
    if (this.mine === null) return;
    this.mine.live = live;
    this.mine.score = score;
    this.announce();
  }

  /** Move a player (me included) to a team in my lobby. */
  setTeam(id: string, team: TeamId): boolean {
    const m = this.mine;
    if (m === null) return false;
    const p = m.players.find(q => q.id === id);
    if (p === undefined || p.team === team) return false;
    if (m.players.filter(q => q.team === team).length >= m.size) return false;
    p.team = team;
    this.announce();
    return true;
  }

  close() {
    if (this.mine === null) return;
    this.announce(false);
    this.mine = null;
  }

  private announce(open = true) {
    const m = this.mine;
    if (m === null) return;
    this.lastAnnounce = this.d.now();
    this.t.send({
      type: 'football:lobby',
      gid: m.gid,
      host: this.me,
      hostName: this.d.myName(),
      size: m.size,
      live: m.live,
      ...(m.score ? { score: m.score } : {}),
      players: m.players.map(p => ({ ...p })),
      open,
    });
  }

  // ── Joining ──

  joinTeam(gid: string, team: TeamId): boolean {
    const l = this.lobbies.get(gid);
    if (l === undefined) return false;
    this.joined = { gid, host: l.host, team, t: this.d.now() };
    this.t.send({
      type: 'football:join',
      gid,
      from: this.me,
      to: l.host,
      name: this.d.myName(),
      team,
    });
    return true;
  }

  leaveTeam() {
    const j = this.joined;
    if (j === null) return;
    this.t.send({
      type: 'football:join',
      gid: j.gid,
      from: this.me,
      to: j.host,
      name: this.d.myName(),
      team: j.team,
      leave: true,
    });
    this.joined = null;
  }

  /** Am I listed in the lobby I joined (the host took me)? */
  get inTeam(): boolean {
    const j = this.joined;
    if (j === null) return false;
    return this.lobbies.get(j.gid)?.players.some(p => p.id === this.me) ?? false;
  }

  // ── Challenges ──

  challenge(to: string, name: string, size: TeamSize, coop = false): string {
    const gid = newGid();
    this.outgoing = { gid, who: to, name, size, coop, t: this.d.now() };
    this.t.send({
      type: 'football:challenge',
      gid,
      from: this.me,
      to,
      size,
      fromName: this.d.myName(),
      ...(coop ? { coop: true } : {}),
    });
    return gid;
  }

  cancel() {
    this.outgoing = null;
  }

  accept(): Invite | null {
    const inv = this.incoming;
    if (inv === null) return null;
    this.t.send({ type: 'football:reply', gid: inv.gid, from: this.me, to: inv.who, accept: true });
    this.expect = { gid: inv.gid, host: inv.who, t: this.d.now() };
    this.incoming = null;
    return inv;
  }

  decline() {
    const inv = this.incoming;
    if (inv === null) return;
    this.t.send({
      type: 'football:reply',
      gid: inv.gid,
      from: this.me,
      to: inv.who,
      accept: false,
    });
    this.incoming = null;
  }

  // ── Watching ──

  watch(gid: string): boolean {
    const l = this.lobbies.get(gid);
    if (l === undefined || !l.live) return false;
    this.watching = gid;
    this.t.send({ type: 'football:watch', gid, from: this.me });
    return true;
  }

  stopWatching() {
    this.watching = null;
  }

  // ── Messages ──

  onMessage(m: FootballMsg): LobbyEvent | null {
    const now = this.d.now();
    switch (m.type) {
      case 'football:lobby': {
        if (m.host === this.me) return null;
        if (!m.open) {
          const had = this.lobbies.delete(m.gid);
          if (this.joined?.gid === m.gid) this.joined = null;
          return had ? this.emit({ kind: 'lobbies' }) : null;
        }
        this.lobbies.set(m.gid, {
          gid: m.gid,
          host: m.host,
          hostName: m.hostName,
          size: m.size,
          live: m.live,
          score: m.score,
          players: m.players.map(p => ({ ...p })),
          t: now,
        });
        return this.emit({ kind: 'lobbies' });
      }
      case 'football:join': {
        const mine = this.mine;
        if (mine === null || m.gid !== mine.gid || m.to !== this.me || m.from === this.me)
          return null;
        const i = mine.players.findIndex(p => p.id === m.from);
        if (m.leave === true) {
          if (i < 0) return null;
          mine.players.splice(i, 1);
          this.announce();
          return this.emit({ kind: 'left', id: m.from });
        }
        // A live match's (re)joins are the FootballHost's business
        if (mine.live) return null;
        const others = mine.players.filter(p => p.team === m.team && p.id !== m.from).length;
        if (others >= mine.size) return null;
        if (i >= 0) {
          mine.players[i].team = m.team;
          mine.players[i].name = m.name;
        } else mine.players.push({ id: m.from, name: m.name, team: m.team });
        this.announce();
        return this.emit({ kind: 'joined', id: m.from, name: m.name, team: m.team });
      }
      case 'football:challenge': {
        if (m.to !== this.me || m.from === this.me) return null;
        if (this.d.busy?.() === true || this.incoming !== null) {
          this.t.send({
            type: 'football:reply',
            gid: m.gid,
            from: this.me,
            to: m.from,
            accept: false,
          });
          return null;
        }
        this.incoming = {
          gid: m.gid,
          who: m.from,
          name: m.fromName,
          size: m.size,
          coop: m.coop === true,
          t: now,
        };
        return this.emit({ kind: 'invite', invite: this.incoming });
      }
      case 'football:reply': {
        const o = this.outgoing;
        if (o === null || m.gid !== o.gid || m.from !== o.who) return null;
        this.outgoing = null;
        return this.emit({ kind: m.accept ? 'accepted' : 'declined', invite: o });
      }
      case 'football:start': {
        if (m.host === this.me) return null;
        const me = this.me;
        const listed = m.config.humans.some(h => h.id === me);
        const mineToo =
          (this.joined?.gid === m.gid && this.joined.host === m.host) ||
          (this.expect?.gid === m.gid && this.expect.host === m.host) ||
          m.to === me;
        if (listed && mineToo) {
          if (this.expect?.gid === m.gid) this.expect = null;
          return this.emit({ kind: 'start', role: 'member', msg: m });
        }
        if (this.watching === m.gid && (m.to === undefined || m.to === me))
          return this.emit({ kind: 'start', role: 'watch', msg: m });
        return null;
      }
      default:
        return null;
    }
  }

  /** Expire stale lobbies / invites and re-announce mine. Returns what changed. */
  tick(): LobbyEvent[] {
    const now = this.d.now();
    const out: LobbyEvent[] = [];
    let gone = false;
    for (const [gid, l] of this.lobbies)
      if (now - l.t > LOBBY_TTL_MS) {
        this.lobbies.delete(gid);
        if (this.joined?.gid === gid) this.joined = null;
        gone = true;
      }
    if (gone) out.push(this.emit({ kind: 'lobbies' }));
    if (this.incoming !== null && now - this.incoming.t > INVITE_MS) {
      this.incoming = null;
      out.push(this.emit({ kind: 'expired', what: 'incoming' }));
    }
    if (this.outgoing !== null && now - this.outgoing.t > INVITE_MS) {
      this.outgoing = null;
      out.push(this.emit({ kind: 'expired', what: 'outgoing' }));
    }
    if (this.expect !== null && now - this.expect.t > INVITE_MS) {
      this.expect = null;
      out.push(this.emit({ kind: 'expired', what: 'expect' }));
    }
    if (this.mine !== null && now - this.lastAnnounce >= LOBBY_EVERY_MS) this.announce();
    return out;
  }

  /** Close my lobby and stop listening. */
  dispose() {
    this.close();
    this.leaveTeam();
    this.off();
  }
}

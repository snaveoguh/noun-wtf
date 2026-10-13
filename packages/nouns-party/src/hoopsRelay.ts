// ── Noun Hoops relay (world v2 room) ────────────────────────────────────
//
// Forwards `hoops:*` messages only to the players they're for; nothing is
// persisted. Games are tracked in memory just to know who's in them:
//
//   hoops:lobby                 → everyone else in the room (court presence)
//   hoops:challenge / reply /
//   join, or anything with `to` → that one player
//   hoops:start                 → registers the game (sender = host, members
//                                 = the humans in config.players) and goes
//                                 to the members (or just `to`)
//   hoops:watch                 → adds a spectator, forwarded to the host
//   hoops:input                 → the game's host only
//   hoops:s / snap / end        → members + spectators (host only); end
//                                 forgets the game (a rematch is a new gid)
//   hoops:leave (or a socket    → members + spectators; a host leaving ends
//   closing)                      the game
//
// Sender ids (`from`, `host`, input `id`) are always rewritten to the real
// connection id. Pure (no partykit imports) so the webapp's tests run it.

export interface RelayConn {
  id: string;
  send(msg: string): void;
}

interface HoopsGame {
  host: string;
  members: Set<string>;
  watchers: Set<string>;
}

const MAX_GAMES = 64;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class HoopsRelay {
  games = new Map<string, HoopsGame>();

  handle(raw: Record<string, unknown>, from: RelayConn, conns: Iterable<RelayConn>) {
    const type = raw.type as string;
    const gid = raw.gid;
    if (!okId(gid)) return;
    const d: Record<string, unknown> = { ...raw };
    const all = [...conns];
    const byId = new Map(all.map(c => [c.id, c]));
    const out = (ids: Iterable<string>, msg: Record<string, unknown>) => {
      const s = JSON.stringify(msg);
      for (const id of ids) if (id !== from.id) byId.get(id)?.send(s);
    };
    const audience = (g: HoopsGame) => new Set([...g.members, ...g.watchers]);
    const g = this.games.get(gid);

    switch (type) {
      case 'hoops:lobby':
        d.host = from.id;
        out(byId.keys(), d);
        return;
      case 'hoops:challenge':
      case 'hoops:reply':
      case 'hoops:join':
        d.from = from.id;
        if (okId(d.to)) out([d.to], d);
        return;
      case 'hoops:start': {
        if (g !== undefined && g.host !== from.id) return;
        d.host = from.id;
        if (okId(d.to)) {
          if (g !== undefined) out([d.to], d);
          return;
        }
        const cfg = d.config as { players?: { id?: unknown; bot?: unknown }[] } | undefined;
        const humans = (cfg?.players ?? [])
          .filter(p => p.bot !== true && okId(p.id) && byId.has(p.id))
          .map(p => p.id as string);
        if (g === undefined && this.games.size >= MAX_GAMES) return;
        const game: HoopsGame = {
          host: from.id,
          members: new Set([from.id, ...humans]),
          watchers: g?.watchers ?? new Set(),
        };
        this.games.set(gid, game);
        out(audience(game), d);
        return;
      }
      case 'hoops:watch':
        if (g === undefined) return;
        d.from = from.id;
        g.watchers.add(from.id);
        out([g.host], d);
        return;
      case 'hoops:input':
        if (g === undefined || !g.members.has(from.id)) return;
        d.id = from.id;
        out([g.host], d);
        return;
      case 'hoops:s':
      case 'hoops:snap':
      case 'hoops:end':
        if (g === undefined || g.host !== from.id) return;
        out(audience(g), d);
        if (type === 'hoops:end') this.games.delete(gid);
        return;
      case 'hoops:leave':
        if (g === undefined) return;
        this.drop(gid, g, from.id, all);
        return;
      default:
        return;
    }
  }

  /** A socket closed: leave every game it was in. */
  close(id: string, conns: Iterable<RelayConn>) {
    const all = [...conns];
    for (const [gid, g] of [...this.games])
      if (g.members.has(id) || g.watchers.has(id)) this.drop(gid, g, id, all);
  }

  private drop(gid: string, g: HoopsGame, id: string, all: RelayConn[]) {
    const wasMember = g.members.has(id);
    g.members.delete(id);
    g.watchers.delete(id);
    if (wasMember) {
      const s = JSON.stringify({ type: 'hoops:leave', gid, id });
      const to = new Set([...g.members, ...g.watchers]);
      for (const c of all) if (to.has(c.id) && c.id !== id) c.send(s);
    }
    if (id === g.host || g.members.size === 0) this.games.delete(gid);
  }
}

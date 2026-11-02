// ── Noun Football relay (world v2 room) ─────────────────────────────────
//
// Forwards `football:*` messages only to the players they're for; nothing
// is persisted. Games are tracked in memory just to know who's in them:
//
//   football:lobby              → everyone else in the room (open lobbies,
//                                 live matches to WATCH); `host` rewritten
//   football:challenge / reply  → that one player (`to`)
//   football:join               → that one player (`to`, the lobby's host)
//   football:start              → registers the game (sender = host,
//                                 members = the host + the humans in
//                                 config.humans who are connected) and goes
//                                 to the members; with `to`: only that
//                                 member / watcher (a late joiner listed in
//                                 config.humans becomes a member then)
//   football:input / ping       → the host only (from members)
//   football:pong               → from the host, to that member / watcher
//   football:s / end            → members + watchers (host only); end
//                                 forgets the game (a rematch is a new gid)
//   football:watch              → adds a watcher, forwarded to the host
//   football:leave (or a        → members + watchers as {gid, id}; the
//   socket closing)               host leaving ends the game
//
// Sender ids (`from`, `host`, input `id`, leave `id`) are always rewritten
// to the real connection id. Pure (no partykit imports) so the webapp's
// tests run it (world2/football/net/footballRelay.test.ts).

export interface RelayConn {
  id: string;
  send(msg: string): void;
}

interface Game {
  host: string;
  /** Everyone listed in config.humans (late joiners may become members). */
  humans: Set<string>;
  members: Set<string>;
  watchers: Set<string>;
}

export const FOOTBALL_MAX_GAMES = 32;
export const FOOTBALL_MAX_WATCHERS = 32;
/** server.ts drops longer messages (a full 11-a-side start is ~5 KB). */
export const FOOTBALL_MAX_BYTES = 16384;

const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class FootballRelay {
  games = new Map<string, Game>();

  handle(raw: Record<string, unknown>, from: RelayConn, conns: Iterable<RelayConn>) {
    const type = raw.type;
    if (typeof type !== 'string') return;
    const d: Record<string, unknown> = { ...raw };
    const all = [...conns];
    const byId = new Map(all.map(c => [c.id, c]));
    const out = (ids: Iterable<string>, msg: Record<string, unknown>) => {
      const s = JSON.stringify(msg);
      for (const id of ids) if (id !== from.id) byId.get(id)?.send(s);
    };
    const audience = (g: Game) => new Set([...g.members, ...g.watchers]);

    switch (type) {
      case 'football:lobby':
        d.host = from.id;
        out(byId.keys(), d);
        return;
      case 'football:challenge':
      case 'football:reply':
      case 'football:join':
        d.from = from.id;
        if (okId(d.to)) out([d.to], d);
        return;
      default:
        break;
    }

    const gid = d.gid;
    if (!okId(gid)) return;
    const g = this.games.get(gid);

    switch (type) {
      case 'football:start': {
        if (g !== undefined && g.host !== from.id) return;
        d.host = from.id;
        if (okId(d.to)) {
          if (g === undefined) return;
          if (g.humans.has(d.to) && byId.has(d.to)) {
            g.members.add(d.to);
            g.watchers.delete(d.to);
          }
          if (audience(g).has(d.to)) out([d.to], d);
          return;
        }
        const cfg = d.config as { humans?: { id?: unknown }[] } | undefined;
        if (!Array.isArray(cfg?.humans)) return;
        const listed = cfg.humans.map(h => h?.id).filter(okId);
        if (g === undefined && this.games.size >= FOOTBALL_MAX_GAMES) return;
        const game: Game = {
          host: from.id,
          humans: new Set(listed),
          members: new Set([from.id, ...listed.filter(id => byId.has(id))]),
          watchers: g?.watchers ?? new Set(),
        };
        for (const id of game.members) game.watchers.delete(id);
        this.games.set(gid, game);
        out(audience(game), d);
        return;
      }
      case 'football:watch':
        if (g === undefined || g.members.has(from.id)) return;
        if (g.watchers.size >= FOOTBALL_MAX_WATCHERS && !g.watchers.has(from.id)) return;
        d.from = from.id;
        g.watchers.add(from.id);
        out([g.host], d);
        return;
      case 'football:input':
        if (g === undefined || !g.members.has(from.id) || from.id === g.host) return;
        d.id = from.id;
        out([g.host], d);
        return;
      case 'football:ping':
        if (g === undefined || from.id === g.host || !audience(g).has(from.id)) return;
        d.from = from.id;
        out([g.host], d);
        return;
      case 'football:pong':
        if (g === undefined || g.host !== from.id || !okId(d.to) || !audience(g).has(d.to)) return;
        out([d.to], d);
        return;
      case 'football:s':
      case 'football:end':
        if (g === undefined || g.host !== from.id) return;
        out(audience(g), d);
        if (type === 'football:end') this.games.delete(gid);
        return;
      case 'football:leave':
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

  private drop(gid: string, g: Game, id: string, all: RelayConn[]) {
    const wasMember = g.members.has(id);
    g.members.delete(id);
    g.watchers.delete(id);
    if (wasMember) {
      const s = JSON.stringify({ type: 'football:leave', gid, id });
      const to = new Set([...g.members, ...g.watchers]);
      for (const c of all) if (to.has(c.id) && c.id !== id) c.send(s);
    }
    if (id === g.host || g.members.size === 0) this.games.delete(gid);
  }
}

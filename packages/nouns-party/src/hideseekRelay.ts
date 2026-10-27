// ── Noun Hide & Seek relay (world v2 room) ──────────────────────────────
//
// Forwards `hideseek:*` messages only to the players they're for; nothing
// is persisted. Games are tracked in memory just to know who's in them:
//
//   hideseek:lobby     → everyone else in the room (open games to JOIN, and
//                        who's hiding right now so every client can hide
//                        their name tags)
//   hideseek:join      → the game's host (the joiner is remembered as asking)
//   hideseek:roster    → registers the game (sender = host) and goes to
//                        everyone who asked to join (in it or turned away)
//   hideseek:start     → members = the host + the humans in config.players
//                        who asked to join and are connected; goes to them
//   hideseek:s / end   → members (host only); end forgets the game
//   hideseek:act       → the host only (from members): tag / whistle / ping
//   hideseek:leave (or → members as {gid, id}; the host leaving ends the
//   a socket closing)    game (they get its id and stop)
//
// Sender ids (`from`, `host`, leave `id`) are always rewritten to the real
// connection id. Pure (no partykit imports) so the webapp's tests run it.

export interface RelayConn {
  id: string;
  send(msg: string): void;
}

interface Game {
  host: string;
  /** Asked to join (and not left). */
  asked: Set<string>;
  /** In the running game (after start), or on the roster (before). */
  members: Set<string>;
}

const MAX_GAMES = 64;
const MAX_ASKED = 32;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class HideSeekRelay {
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

    if (type === 'hideseek:lobby') {
      d.from = from.id;
      out(byId.keys(), d);
      return;
    }

    const gid = d.gid;
    if (!okId(gid)) return;
    const g = this.games.get(gid);
    const humans = (ps: unknown): string[] =>
      Array.isArray(ps)
        ? ps
            .filter(
              p => p !== null && typeof p === 'object' && (p as { cpu?: unknown }).cpu !== true,
            )
            .map(p => (p as { id?: unknown }).id)
            .filter(okId)
        : [];

    switch (type) {
      case 'hideseek:roster': {
        if (g !== undefined && g.host !== from.id) return;
        if (g === undefined && this.games.size >= MAX_GAMES) return;
        d.host = from.id;
        const game: Game = g ?? { host: from.id, asked: new Set(), members: new Set([from.id]) };
        const listed = new Set(humans(d.players));
        game.members = new Set([from.id, ...[...game.asked].filter(id => listed.has(id))]);
        this.games.set(gid, game);
        out(game.asked, d);
        return;
      }
      case 'hideseek:join':
        if (g === undefined || from.id === g.host) return;
        if (!g.asked.has(from.id) && g.asked.size >= MAX_ASKED) return;
        g.asked.add(from.id);
        d.from = from.id;
        out([g.host], d);
        return;
      case 'hideseek:start': {
        if (g === undefined || g.host !== from.id) return;
        d.host = from.id;
        const cfg = d.config as { players?: unknown } | undefined;
        const listed = humans(cfg?.players).filter(id => g.asked.has(id) && byId.has(id));
        g.members = new Set([from.id, ...listed]);
        out(g.members, d);
        return;
      }
      case 'hideseek:s':
      case 'hideseek:end':
        if (g === undefined || g.host !== from.id) return;
        out(g.members, d);
        if (type === 'hideseek:end') this.games.delete(gid);
        return;
      case 'hideseek:act':
        if (g === undefined || from.id === g.host || !g.members.has(from.id)) return;
        d.from = from.id;
        out([g.host], d);
        return;
      case 'hideseek:leave':
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
      if (g.host === id || g.members.has(id) || g.asked.has(id)) this.drop(gid, g, id, all);
  }

  private drop(gid: string, g: Game, id: string, all: RelayConn[]) {
    const was = g.members.has(id) || g.asked.has(id);
    g.members.delete(id);
    g.asked.delete(id);
    if (was) {
      const s = JSON.stringify({ type: 'hideseek:leave', gid, id });
      const to = new Set([...g.members, ...g.asked, g.host]);
      for (const c of all) if (to.has(c.id) && c.id !== id) c.send(s);
    }
    if (id === g.host) this.games.delete(gid);
  }
}

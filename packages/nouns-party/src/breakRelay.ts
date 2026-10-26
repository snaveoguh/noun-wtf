// ── Noun Breaks relay (world v2 room) ───────────────────────────────────
//
// Forwards `break:*` messages (breakdance battles at the plaza cypher) only
// to the players they're for; nothing is persisted. Battles are tracked in
// memory just to know who's in them:
//
//   break:lobby                 → everyone else in the room (cypher presence,
//                                 live battles to WATCH)
//   break:challenge / reply     → that one player (`to`)
//   break:start                 → registers the battle (sender = host,
//                                 members = the humans in config.dancers who
//                                 are connected) and goes to the members; with
//                                 `to`, only to that member / spectator
//   break:watch                 → adds a spectator, forwarded to the host
//   break:input / ping          → the battle's host only (from members;
//                                 pings from spectators too)
//   break:pong                  → from the host to that member / spectator
//   break:s / end               → members + spectators (host only); end
//                                 forgets the battle (a rematch is a new gid)
//   break:leave (or a socket    → members + spectators as {gid, id}; the host
//   closing)                      leaving ends the battle
//
// Sender ids (`from`, `host`, the input's dancer `id`, leave `id`) are always
// rewritten to the real connection id. Pure (no partykit imports) so the
// webapp's tests run it.

export interface RelayConn {
  id: string;
  send(msg: string): void;
}

interface Battle {
  host: string;
  members: Set<string>;
  watchers: Set<string>;
}

const MAX_BATTLES = 64;
const MAX_WATCHERS = 32;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class BreakRelay {
  battles = new Map<string, Battle>();

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
    const audience = (b: Battle) => new Set([...b.members, ...b.watchers]);

    // Presence + challenges need no battle
    switch (type) {
      case 'break:lobby':
        d.from = from.id;
        out(byId.keys(), d);
        return;
      case 'break:challenge':
      case 'break:reply':
        d.from = from.id;
        if (okId(d.to)) out([d.to], d);
        return;
      default:
        break;
    }

    const gid = d.gid ?? (d.config as { gid?: unknown } | undefined)?.gid;
    if (!okId(gid)) return;
    const b = this.battles.get(gid);

    switch (type) {
      case 'break:start': {
        if (b !== undefined && b.host !== from.id) return;
        d.host = from.id;
        if (okId(d.to)) {
          if (b !== undefined && audience(b).has(d.to)) out([d.to], d);
          return;
        }
        const cfg = d.config as { dancers?: { id?: unknown; human?: unknown }[] } | undefined;
        if (!Array.isArray(cfg?.dancers)) return;
        const humans = cfg.dancers
          .filter(p => p?.human === true && okId(p.id) && byId.has(p.id))
          .map(p => p.id as string);
        if (b === undefined && this.battles.size >= MAX_BATTLES) return;
        const battle: Battle = {
          host: from.id,
          members: new Set([from.id, ...humans]),
          watchers: b?.watchers ?? new Set(),
        };
        this.battles.set(gid, battle);
        out(audience(battle), d);
        return;
      }
      case 'break:watch':
        if (b === undefined || b.members.has(from.id)) return;
        if (b.watchers.size >= MAX_WATCHERS && !b.watchers.has(from.id)) return;
        d.from = from.id;
        b.watchers.add(from.id);
        out([b.host], d);
        return;
      case 'break:input': {
        if (b === undefined || !b.members.has(from.id)) return;
        const i = d.i;
        if (i === null || typeof i !== 'object') return;
        d.i = { ...(i as Record<string, unknown>), id: from.id };
        out([b.host], d);
        return;
      }
      case 'break:ping':
        if (b === undefined || !audience(b).has(from.id)) return;
        d.from = from.id;
        out([b.host], d);
        return;
      case 'break:pong':
        if (b === undefined || b.host !== from.id || !okId(d.to) || !audience(b).has(d.to)) return;
        out([d.to], d);
        return;
      case 'break:s':
      case 'break:end':
        if (b === undefined || b.host !== from.id) return;
        out(audience(b), d);
        if (type === 'break:end') this.battles.delete(gid);
        return;
      case 'break:leave':
        if (b === undefined) return;
        this.drop(gid, b, from.id, all);
        return;
      default:
        return;
    }
  }

  /** A socket closed: leave every battle it was in. */
  close(id: string, conns: Iterable<RelayConn>) {
    const all = [...conns];
    for (const [gid, b] of [...this.battles])
      if (b.members.has(id) || b.watchers.has(id)) this.drop(gid, b, id, all);
  }

  private drop(gid: string, b: Battle, id: string, all: RelayConn[]) {
    const wasMember = b.members.has(id);
    b.members.delete(id);
    b.watchers.delete(id);
    if (wasMember) {
      const s = JSON.stringify({ type: 'break:leave', gid, id });
      const to = new Set([...b.members, ...b.watchers]);
      for (const c of all) if (to.has(c.id) && c.id !== id) c.send(s);
    }
    if (id === b.host || b.members.size === 0) this.battles.delete(gid);
  }
}

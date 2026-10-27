// ── Noun Pool relay (world v2 room) ─────────────────────────────────────
//
// Forwards `pool:*` messages (8-ball at the pool tables) only to the players
// they're for; nothing is persisted. Frames are tracked in memory just to
// know who's in them:
//
//   pool:lobby                  → everyone else in the room (who's at which
//                                 table, live frames to WATCH)
//   pool:challenge / reply      → that one player (`to`)
//   pool:start                  → registers the frame (sender = host,
//                                 members = the humans in config.players who
//                                 are connected) and goes to the members;
//                                 with `to`, only to that member / watcher
//   pool:watch                  → adds a spectator, forwarded to the host
//   pool:shot                   → from a player: to the host only (it
//                                 checks it); from the host: the accepted
//                                 shot, to members + spectators
//   pool:aim                    → a member's live aim, to everyone else in
//                                 the frame
//   pool:result / end           → members + spectators (host only); end
//                                 forgets the frame (a rematch is a new gid)
//   pool:leave (or a socket     → members + spectators as {gid, id}; the
//   closing)                      host leaving ends the frame
//
// Sender ids (`from`, `host`, leave `id`) are always rewritten to the real
// connection id. Pure (no partykit imports) so the webapp's tests run it.

export interface RelayConn {
  id: string;
  send(msg: string): void;
}

interface Frame {
  host: string;
  members: Set<string>;
  watchers: Set<string>;
}

const MAX_FRAMES = 64;
const MAX_WATCHERS = 32;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class PoolRelay {
  frames = new Map<string, Frame>();

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
    const audience = (f: Frame) => new Set([...f.members, ...f.watchers]);

    switch (type) {
      case 'pool:lobby':
        d.from = from.id;
        out(byId.keys(), d);
        return;
      case 'pool:challenge':
      case 'pool:reply':
        d.from = from.id;
        if (okId(d.to)) out([d.to], d);
        return;
      default:
        break;
    }

    const gid = d.gid ?? (d.config as { gid?: unknown } | undefined)?.gid;
    if (!okId(gid)) return;
    const f = this.frames.get(gid);

    switch (type) {
      case 'pool:start': {
        if (f !== undefined && f.host !== from.id) return;
        d.host = from.id;
        if (okId(d.to)) {
          if (f !== undefined && audience(f).has(d.to)) out([d.to], d);
          return;
        }
        const cfg = d.config as { players?: { id?: unknown; human?: unknown }[] } | undefined;
        if (!Array.isArray(cfg?.players)) return;
        const humans = cfg.players
          .filter(p => p?.human === true && okId(p.id) && byId.has(p.id))
          .map(p => p.id as string);
        if (f === undefined && this.frames.size >= MAX_FRAMES) return;
        const frame: Frame = {
          host: from.id,
          members: new Set([from.id, ...humans]),
          watchers: f?.watchers ?? new Set(),
        };
        this.frames.set(gid, frame);
        out(audience(frame), d);
        return;
      }
      case 'pool:watch':
        if (f === undefined || f.members.has(from.id)) return;
        if (f.watchers.size >= MAX_WATCHERS && !f.watchers.has(from.id)) return;
        d.from = from.id;
        f.watchers.add(from.id);
        out([f.host], d);
        return;
      case 'pool:shot':
        if (f === undefined || !f.members.has(from.id)) return;
        d.from = from.id;
        if (from.id === f.host) out(audience(f), d);
        else out([f.host], d);
        return;
      case 'pool:aim':
        if (f === undefined || !f.members.has(from.id)) return;
        d.from = from.id;
        out(audience(f), d);
        return;
      case 'pool:result':
      case 'pool:end':
        if (f === undefined || f.host !== from.id) return;
        out(audience(f), d);
        if (type === 'pool:end') this.frames.delete(gid);
        return;
      case 'pool:leave':
        if (f === undefined) return;
        this.drop(gid, f, from.id, all);
        return;
      default:
        return;
    }
  }

  /** A socket closed: leave every frame it was in. */
  close(id: string, conns: Iterable<RelayConn>) {
    const all = [...conns];
    for (const [gid, f] of [...this.frames])
      if (f.members.has(id) || f.watchers.has(id)) this.drop(gid, f, id, all);
  }

  private drop(gid: string, f: Frame, id: string, all: RelayConn[]) {
    const wasMember = f.members.has(id);
    f.members.delete(id);
    f.watchers.delete(id);
    if (wasMember) {
      const s = JSON.stringify({ type: 'pool:leave', gid, id });
      const to = new Set([...f.members, ...f.watchers]);
      for (const c of all) if (to.has(c.id) && c.id !== id) c.send(s);
    }
    if (id === f.host || f.members.size === 0) this.frames.delete(gid);
  }
}

// ── Noun Golf relay (world v2 room) ─────────────────────────────────────
//
// Forwards `golf:*` messages (NOUN LINKS rounds) only to the players
// they're for; nothing is persisted. Same shape as poolRelay.ts:
//
//   golf:lobby                  → everyone else in the room (who's at the
//                                 course, live rounds)
//   golf:invite / reply         → that one player (`to`)
//   golf:start                  → registers the round (sender = host,
//                                 members = the humans in config.players who
//                                 are connected) and goes to the members;
//                                 with `to`, only to that member
//   golf:shot                   → from a player: to the host only; from the
//                                 host: the accepted swing, to the members
//   golf:aim                    → a member's live aim, to the other members
//   golf:result / end           → members (host only); end forgets the round
//   golf:leave (or a socket     → members as {gid, id}; the host leaving
//   closing)                      ends the round
//
// Sender ids (`from`, `host`, leave `id`) are always rewritten to the real
// connection id. Pure (no partykit imports) so the webapp's tests run it.

export interface RelayConn {
  id: string;
  send(msg: string): void;
}

interface Round {
  host: string;
  members: Set<string>;
  watchers: Set<string>;
}

const MAX_ROUNDS = 64;
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export class GolfRelay {
  frames = new Map<string, Round>();

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
    const audience = (f: Round) => new Set([...f.members, ...f.watchers]);

    switch (type) {
      case 'golf:lobby':
        d.from = from.id;
        out(byId.keys(), d);
        return;
      case 'golf:invite':
      case 'golf:reply':
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
      case 'golf:start': {
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
        if (f === undefined && this.frames.size >= MAX_ROUNDS) return;
        const frame: Round = {
          host: from.id,
          members: new Set([from.id, ...humans]),
          watchers: f?.watchers ?? new Set(),
        };
        this.frames.set(gid, frame);
        out(audience(frame), d);
        return;
      }
      case 'golf:shot':
        if (f === undefined || !f.members.has(from.id)) return;
        d.from = from.id;
        if (from.id === f.host) out(audience(f), d);
        else out([f.host], d);
        return;
      case 'golf:aim':
        if (f === undefined || !f.members.has(from.id)) return;
        d.from = from.id;
        out(audience(f), d);
        return;
      case 'golf:result':
      case 'golf:end':
        if (f === undefined || f.host !== from.id) return;
        out(audience(f), d);
        if (type === 'golf:end') this.frames.delete(gid);
        return;
      case 'golf:leave':
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

  private drop(gid: string, f: Round, id: string, all: RelayConn[]) {
    const wasMember = f.members.has(id);
    f.members.delete(id);
    f.watchers.delete(id);
    if (wasMember) {
      const s = JSON.stringify({ type: 'golf:leave', gid, id });
      const to = new Set([...f.members, ...f.watchers]);
      for (const c of all) if (to.has(c.id) && c.id !== id) c.send(s);
    }
    if (id === f.host || f.members.size === 0) this.frames.delete(gid);
  }
}

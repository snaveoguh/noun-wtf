// ── Noun Warfare relay + lobby registry (room `noun-warfare`) ───────────
//
// Matches are host-authoritative: the host's browser runs the sim, this
// room only keeps a registry of open matches and forwards `wf:*` messages
// to the players they're for. Nothing is persisted.
//
//   wf:list                  → wf:matches (public, open matches) to the sender
//   wf:host {gid,pub,mode,…}  → registers a match (sender = host), replies
//                              wf:hosted {gid, code}; browsers get wf:matches
//   wf:meta {gid,humans,…}   → host updates the listing (status / players)
//   wf:join {code|gid,name…} → adds the sender as a member, forwards to the
//                              host (or wf:nojoin to the sender)
//   wf:welcome / wf:reject   → host → that one player (`to`)
//   wf:in                    → the match's host only (`id` = real sender)
//   wf:s / wf:roster / wf:end→ host → every other member; end forgets it
//   wf:leave (or a socket    → members get wf:left {id, host}; a host leaving
//   closing)                   hands the match to the earliest-joined member
//   wf:ping {t}              → wf:pong {t} (latency for the scoreboard)
//
// Sender ids are always rewritten to the real connection id, names are
// clamped, and every connection is rate- and size-limited. Pure (no
// partykit imports) so the webapp's net tests run it in memory.

export interface WfConn {
  id: string;
  send(msg: string): void;
}

export interface WfListing {
  gid: string;
  /** Join code (public matches only; private codes are never listed). */
  code: string;
  host: string;
  mode: string;
  map: string;
  size: number;
  humans: number;
  max: number;
  status: 'waiting' | 'live';
}

interface WfMatch {
  gid: string;
  code: string;
  pub: boolean;
  host: string;
  hostName: string;
  /** Join order (host first). Decides the next host. */
  members: string[];
  mode: string;
  map: string;
  size: number;
  humans: number;
  status: 'waiting' | 'live';
}

const MODES = new Set(['tdm', 'turf', 'elim', 'ffa']);
const MAPS = new Set(['nouncity', 'warehouse']);
const SIZES = new Set([2, 4, 6]);
const MAX_MATCHES = 128;
/** Messages that carry game state from the host. */
const BIG = new Set(['wf:s', 'wf:welcome', 'wf:roster']);
export const WF_MAX_BIG = 24_000;
export const WF_MAX_SMALL = 2_000;
const RATE = 100; // msgs / s sustained
const BURST = 160;
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const okId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[\w.:-]+$/.test(v);

/** Never trust a client's name: printable, short, no markup. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return 'NOUN';
  const s = v
    .replace(/[^\p{L}\p{N} _.\-!?#⌐◨]/gu, '')
    .trim()
    .slice(0, 16);
  return s === '' ? 'NOUN' : s;
}

export class WarfareRelay {
  matches = new Map<string, WfMatch>();
  private codes = new Map<string, string>();
  private buckets = new Map<string, { tokens: number; at: number }>();
  /** Connections that are in a match (everyone else is browsing). */
  private memberOf = new Map<string, string>();

  constructor(
    private now: () => number = () => Date.now(),
    private random: () => number = Math.random,
  ) {}

  /** Size + rate gate. Returns false when the message must be dropped. */
  admit(connId: string, type: string, length: number): boolean {
    if (length > (BIG.has(type) ? WF_MAX_BIG : WF_MAX_SMALL)) return false;
    const t = this.now();
    let b = this.buckets.get(connId);
    if (b === undefined) {
      b = { tokens: BURST, at: t };
      this.buckets.set(connId, b);
    }
    b.tokens = Math.min(BURST, b.tokens + ((t - b.at) / 1000) * RATE);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Entry point: a raw message string from a connection. */
  message(raw: string, from: WfConn, conns: Iterable<WfConn>) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }
    if (d === null || typeof d !== 'object' || typeof d.type !== 'string') return;
    if (!d.type.startsWith('wf:')) return;
    if (!this.admit(from.id, d.type, raw.length)) return;
    this.handle(d, from, conns);
  }

  handle(d: Record<string, unknown>, from: WfConn, conns: Iterable<WfConn>) {
    const all = [...conns];
    const byId = new Map(all.map(c => [c.id, c]));
    const sendTo = (id: string, msg: Record<string, unknown>) =>
      byId.get(id)?.send(JSON.stringify(msg));
    const type = d.type as string;
    const gid = d.gid;
    const m = okId(gid) ? this.matches.get(gid) : undefined;

    switch (type) {
      case 'wf:ping':
        from.send(JSON.stringify({ type: 'wf:pong', t: typeof d.t === 'number' ? d.t : 0 }));
        return;
      case 'wf:list':
        from.send(JSON.stringify({ type: 'wf:matches', list: this.listing() }));
        return;
      case 'wf:host': {
        if (!okId(gid) || this.matches.has(gid)) return;
        if (this.matches.size >= MAX_MATCHES) {
          from.send(JSON.stringify({ type: 'wf:nojoin', reason: 'server full' }));
          return;
        }
        // One match per connection
        this.leaveAll(from.id, all);
        const size = Number(d.size);
        const match: WfMatch = {
          gid,
          code: this.newCode(),
          pub: d.pub === true,
          host: from.id,
          hostName: cleanName(d.name),
          members: [from.id],
          mode: MODES.has(d.mode as string) ? (d.mode as string) : 'tdm',
          map: MAPS.has(d.map as string) ? (d.map as string) : 'nouncity',
          size: SIZES.has(size) ? size : 4,
          humans: 1,
          status: 'waiting',
        };
        this.matches.set(gid, match);
        this.codes.set(match.code, gid);
        this.memberOf.set(from.id, gid);
        from.send(JSON.stringify({ type: 'wf:hosted', gid, code: match.code }));
        this.pushListing(all);
        return;
      }
      case 'wf:meta': {
        if (m === undefined || m.host !== from.id) return;
        const humans = Number(d.humans);
        if (Number.isFinite(humans)) m.humans = Math.max(1, Math.min(m.size * 2, humans | 0));
        if (d.status === 'live' || d.status === 'waiting') m.status = d.status;
        this.pushListing(all);
        return;
      }
      case 'wf:join': {
        const code = typeof d.code === 'string' ? d.code.toUpperCase().slice(0, 8) : '';
        const target =
          code !== ''
            ? this.matches.get(this.codes.get(code) ?? '')
            : (m !== undefined && m.pub
              ? m
              : undefined);
        if (target === undefined) {
          from.send(JSON.stringify({ type: 'wf:nojoin', reason: 'no such match' }));
          return;
        }
        if (target.members.includes(from.id)) return;
        if (target.members.length >= target.size * 2) {
          from.send(JSON.stringify({ type: 'wf:nojoin', reason: 'match is full' }));
          return;
        }
        this.leaveAll(from.id, all);
        target.members.push(from.id);
        this.memberOf.set(from.id, target.gid);
        sendTo(target.host, {
          type: 'wf:join',
          gid: target.gid,
          from: from.id,
          name: cleanName(d.name),
          look: typeof d.look === 'string' ? d.look.slice(0, 40) : '',
          weapons: Array.isArray(d.weapons)
            ? d.weapons.filter(w => typeof w === 'string').slice(0, 8)
            : [],
        });
        return;
      }
      case 'wf:welcome':
      case 'wf:reject': {
        if (m === undefined || m.host !== from.id || !okId(d.to)) return;
        if (!m.members.includes(d.to)) return;
        sendTo(d.to, { ...d, from: from.id });
        if (type === 'wf:reject') this.drop(m, d.to, all, false);
        return;
      }
      case 'wf:in':
        if (m === undefined || !m.members.includes(from.id) || m.host === from.id) return;
        sendTo(m.host, { ...d, id: from.id });
        return;
      case 'wf:s':
      case 'wf:roster':
      case 'wf:end': {
        if (m === undefined || m.host !== from.id) return;
        const s = JSON.stringify(d);
        for (const id of m.members) if (id !== from.id) byId.get(id)?.send(s);
        if (type === 'wf:end') this.forget(m, all);
        return;
      }
      case 'wf:leave':
        if (m === undefined || !m.members.includes(from.id)) return;
        this.drop(m, from.id, all, true);
        return;
      default:
        return;
    }
  }

  /** A socket closed: leave whatever match it was in. */
  close(id: string, conns: Iterable<WfConn>) {
    this.buckets.delete(id);
    this.leaveAll(id, [...conns]);
  }

  listing(): WfListing[] {
    const out: WfListing[] = [];
    for (const m of this.matches.values()) {
      if (!m.pub || m.members.length >= m.size * 2) continue;
      out.push({
        gid: m.gid,
        code: m.code,
        host: m.hostName,
        mode: m.mode,
        map: m.map,
        size: m.size,
        humans: Math.max(m.humans, m.members.length),
        max: m.size * 2,
        status: m.status,
      });
    }
    return out.slice(0, 50);
  }

  private newCode(): string {
    for (let tries = 0; tries < 100; tries++) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_ABC[Math.floor(this.random() * CODE_ABC.length)];
      if (!this.codes.has(c)) return c;
    }
    return `X${Date.now().toString(36).toUpperCase().slice(-6)}`;
  }

  private leaveAll(id: string, all: WfConn[]) {
    const gid = this.memberOf.get(id);
    if (gid === undefined) return;
    const m = this.matches.get(gid);
    if (m !== undefined) this.drop(m, id, all, true);
    this.memberOf.delete(id);
  }

  private drop(m: WfMatch, id: string, all: WfConn[], announce: boolean) {
    const i = m.members.indexOf(id);
    if (i < 0) return;
    m.members.splice(i, 1);
    this.memberOf.delete(id);
    if (m.members.length === 0) {
      this.forget(m, all);
      return;
    }
    if (m.host === id) {
      // Deterministic: the earliest-joined member still here takes over
      m.host = m.members[0];
    }
    m.humans = Math.min(m.humans, m.members.length);
    if (announce) {
      const s = JSON.stringify({ type: 'wf:left', gid: m.gid, id, host: m.host });
      const to = new Set(m.members);
      for (const c of all) if (to.has(c.id)) c.send(s);
    }
    this.pushListing(all);
  }

  private forget(m: WfMatch, all: WfConn[]) {
    this.matches.delete(m.gid);
    this.codes.delete(m.code);
    for (const id of m.members) if (this.memberOf.get(id) === m.gid) this.memberOf.delete(id);
    this.pushListing(all);
  }

  /** Everyone not in a match sees the live list. */
  private pushListing(all: WfConn[]) {
    const s = JSON.stringify({ type: 'wf:matches', list: this.listing() });
    for (const c of all) if (!this.memberOf.has(c.id)) c.send(s);
  }
}

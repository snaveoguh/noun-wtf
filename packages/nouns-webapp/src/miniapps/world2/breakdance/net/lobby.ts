// ── The cypher lobby: who's here, live battles, challenges, crews ────────
//
// Pure (no three.js, no DOM, an injected clock): unit-tested in
// lobby.test.ts. BreakMode owns one and turns its results into battles.
//
//   presence   players at the cypher announce `break:lobby {at}` every 2 s
//              (and leave with at:false); a host announces its live battle
//              (`live`) so anyone can WATCH it. Both expire after 6 s.
//   challenge  the challenger (who becomes the host) picks the humans: one
//              rival for a 1V1, or crewmates + rivals for a CREW battle,
//              and sends each a `break:challenge {gid, crew}`. Replies come
//              back; when everyone has answered (or after 20 s, or START
//              NOW) the battle is built: humans who said yes dance, every
//              other spot is a CPU. A 1V1 whose rival says no (or never
//              answers) doesn't start: it offers the CPU instead.
//   invite     an incoming challenge: ACCEPT / DECLINE within 20 s, or it
//              declines itself. Accepting expects that host's
//              `break:start` (10 s, or "the battle fell through").

import type { BattleConfig, BreakMsg, CrewId, CrewSize, Dancer, TimingWindows } from '../contract';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const SKILL: Record<Difficulty, number> = { easy: 0.3, normal: 0.55, hard: 0.8 };
/** EASY's judging windows (s either side of the beat; the default is 0.045 / 0.09 / 0.14). */
export const EASY_WINDOWS: TimingWindows = { perfect: 0.07, great: 0.13, ok: 0.2 };

export const INVITE_MS = 20_000;
export const PRESENCE_MS = 6_000;
export const EXPECT_MS = 10_000;

/** Battle length per format (the real sim may read these differently). */
export const FORMATS: Record<CrewSize, { rounds: number; turnBars: number; bpm: number }> = {
  1: { rounds: 2, turnBars: 4, bpm: 100 },
  2: { rounds: 1, turnBars: 4, bpm: 100 },
  3: { rounds: 1, turnBars: 3, bpm: 104 },
};

const CPU_NAMES = [
  'Windmill Wendy',
  'B-Boy Noggle',
  'Lil Flare',
  'Toprock Tony',
  'Six Step Sam',
  'Baby Freeze',
  'Headspin Hal',
  'Crabby Kicks',
];

export interface HerePlayer {
  id: string;
  name: string;
  seedKey?: string;
  at: number;
}

export interface LiveBattle {
  gid: string;
  host: string;
  hostName: string;
  crewSize: CrewSize;
  names: string[];
  at: number;
}

export type SlotStatus = 'me' | 'waiting' | 'ok' | 'no' | 'cpu';

export interface Slot {
  id: string;
  name: string;
  crew: CrewId;
  status: SlotStatus;
  seedKey?: string;
}

export interface Outgoing {
  gid: string;
  crewSize: CrewSize;
  difficulty: Difficulty;
  slots: Slot[];
  at: number;
  /** 1V1 only: the rival passed / never answered. */
  failed: null | 'declined' | 'timeout';
}

export interface Incoming {
  gid: string;
  from: string;
  name: string;
  crewSize: CrewSize;
  crew: CrewId;
  at: number;
}

export interface LobbyDeps {
  myId: () => string;
  myName: () => string;
  /** My look (NounSeed) and a remote player's look from their seedKey. */
  mySeed: () => unknown;
  seedOf: (id: string, seedKey?: string) => unknown;
  /** A look for a CPU dancer. */
  cpuSeed: () => unknown;
  send: (m: BreakMsg) => void;
  /** ms clock. */
  now: () => number;
  /** In a battle / countdown: incoming challenges are declined. */
  busy: () => boolean;
}

/** What the lobby wants BreakMode to do. */
export type LobbyResult =
  | { kind: 'go'; config: BattleConfig }
  | { kind: 'fellThrough' }
  | { kind: 'invite' }
  | { kind: 'update' };

export const newGid = () => Math.random().toString(36).slice(2, 10);

export class BreakLobby {
  here = new Map<string, HerePlayer>();
  live = new Map<string, LiveBattle>();
  outgoing: Outgoing | null = null;
  incoming: Incoming | null = null;
  /** A `break:start` from this host is expected (accepted / watching / rematch). */
  expect: { host: string; gid?: string; watch?: boolean; at: number } | null = null;

  constructor(private d: LobbyDeps) {}

  // ── Presence ──

  /** Announce me at (or leaving) the cypher; `live` while hosting a battle. */
  announce(at: boolean, live?: LiveBattle) {
    this.d.send({
      type: 'break:lobby',
      at,
      name: this.d.myName(),
      ...(live ? { live: { gid: live.gid, crewSize: live.crewSize, names: live.names } } : {}),
    });
  }

  /** Expiries: presence, live battles, invites, challenges, expected starts. */
  tick(): LobbyResult[] {
    const now = this.d.now();
    const out: LobbyResult[] = [];
    for (const [id, p] of this.here) if (now - p.at > PRESENCE_MS) this.here.delete(id);
    for (const [gid, l] of this.live) if (now - l.at > PRESENCE_MS) this.live.delete(gid);
    if (this.incoming && now - this.incoming.at > INVITE_MS) {
      this.decline();
      out.push({ kind: 'update' });
    }
    const o = this.outgoing;
    if (o && o.failed === null && now - o.at > INVITE_MS) {
      const r = this.resolve(true);
      if (r) out.push(r);
    }
    if (this.expect && now - this.expect.at > EXPECT_MS) {
      this.expect = null;
      out.push({ kind: 'fellThrough' });
    }
    return out;
  }

  // ── Challenging (I host) ──

  /**
   * Challenge `picks` (humans, each on a crew; I'm on crew 0). For a 1V1,
   * one pick on crew 1. With no picks it's straight to the CPU.
   */
  challenge(
    crewSize: CrewSize,
    picks: { id: string; name: string; crew: CrewId; seedKey?: string }[],
    difficulty: Difficulty,
  ): LobbyResult | null {
    const me = this.d.myId();
    const slots: Slot[] = [{ id: me, name: this.d.myName(), crew: 0, status: 'me' }];
    for (const p of picks) {
      if (p.id === me || slots.some(s => s.id === p.id)) continue;
      if (slots.filter(s => s.crew === p.crew).length >= crewSize) continue;
      slots.push({
        id: p.id,
        name: p.name || 'noun',
        crew: p.crew,
        status: 'waiting',
        seedKey: p.seedKey,
      });
    }
    this.outgoing = {
      gid: newGid(),
      crewSize,
      difficulty,
      slots,
      at: this.d.now(),
      failed: null,
    };
    for (const s of slots)
      if (s.status === 'waiting')
        this.d.send({
          type: 'break:challenge',
          to: s.id,
          crewSize,
          gid: this.outgoing.gid,
          name: this.d.myName(),
          crew: s.crew,
        });
    return this.resolve(false);
  }

  /** Battle the CPU now: no humans. */
  vsCpu(crewSize: CrewSize, difficulty: Difficulty): BattleConfig {
    const r = this.challenge(crewSize, [], difficulty);
    if (r?.kind !== 'go') throw new Error('vsCpu: unreachable');
    return r.config;
  }

  /** START NOW: whoever hasn't answered is a CPU. */
  startNow(): LobbyResult | null {
    return this.resolve(true);
  }

  /** Cancel my challenge (tells anyone who said yes). */
  cancelChallenge() {
    const o = this.outgoing;
    this.outgoing = null;
    if (o === null) return;
    // The battle never starts: their expected start lapses on its own
  }

  /** After a failed 1V1: take the CPU on instead. */
  cpuInstead(): LobbyResult | null {
    const o = this.outgoing;
    if (o === null) return null;
    for (const s of o.slots) if (s.status !== 'me') s.status = 'cpu';
    o.failed = null;
    return this.resolve(true);
  }

  private resolve(force: boolean): LobbyResult | null {
    const o = this.outgoing;
    if (o === null || o.failed !== null) return null;
    const waiting = o.slots.filter(s => s.status === 'waiting');
    if (waiting.length > 0 && !force) return { kind: 'update' };
    for (const s of waiting) s.status = force && o.crewSize === 1 ? 'no' : 'cpu';
    if (o.crewSize === 1 && o.slots.some(s => s.crew === 1 && s.status === 'no')) {
      o.failed = waiting.length > 0 ? 'timeout' : 'declined';
      return { kind: 'update' };
    }
    const config = this.build(o);
    this.outgoing = null;
    return { kind: 'go', config };
  }

  /** The battle: humans who said yes, CPU dancers in every other spot. */
  build(o: Pick<Outgoing, 'gid' | 'crewSize' | 'difficulty' | 'slots'>): BattleConfig {
    const seed = (Math.random() * 2 ** 31) | 0;
    const skill = SKILL[o.difficulty];
    const dancers: Dancer[] = [];
    let cpu = 0;
    for (const crew of [0, 1] as CrewId[]) {
      const humans = o.slots.filter(
        s => s.crew === crew && (s.status === 'me' || s.status === 'ok'),
      );
      for (let k = 0; k < o.crewSize; k++) {
        const h = humans[k];
        if (h !== undefined)
          dancers.push({
            id: h.id,
            name: h.name,
            crew,
            human: true,
            seed: h.status === 'me' ? this.d.mySeed() : this.d.seedOf(h.id, h.seedKey),
          });
        else {
          const n = cpu++;
          dancers.push({
            id: `cpu:${n}`,
            name: CPU_NAMES[(seed + n) % CPU_NAMES.length],
            crew,
            human: false,
            // A little spread so a crew of CPUs isn't three clones
            skill: Math.max(0.05, Math.min(0.95, skill + (((seed >> n) & 7) - 3.5) * 0.02)),
            seed: this.d.cpuSeed(),
          });
        }
      }
    }
    return {
      gid: o.gid,
      seed,
      crewSize: o.crewSize,
      dancers,
      ...FORMATS[o.crewSize],
      chart: 'strict',
      // EASY: a softer CPU and wider timing windows for everyone
      ...(o.difficulty === 'easy' ? { windows: { ...EASY_WINDOWS } } : {}),
    };
  }

  // ── Invited ──

  accept() {
    const inv = this.incoming;
    if (inv === null) return;
    this.d.send({ type: 'break:reply', to: inv.from, ok: true, gid: inv.gid });
    this.expect = { host: inv.from, gid: inv.gid, at: this.d.now() };
    this.incoming = null;
  }

  decline() {
    const inv = this.incoming;
    if (inv === null) return;
    this.d.send({ type: 'break:reply', to: inv.from, ok: false, gid: inv.gid });
    this.incoming = null;
  }

  /** WATCH a live battle: ask its host for the config. */
  watch(gid: string) {
    const l = this.live.get(gid);
    if (!l) return false;
    this.expect = { host: l.host, gid, watch: true, at: this.d.now() };
    this.d.send({ type: 'break:watch', gid });
    return true;
  }

  /** Is this `break:start` one I'm waiting for? */
  wants(m: Extract<BreakMsg, { type: 'break:start' }>): 'member' | 'spectator' | null {
    const ex = this.expect;
    if (!ex || ex.host !== m.host) return null;
    const me = this.d.myId();
    const mine = m.config.dancers.some(x => x.id === me && x.human);
    if (mine && ex.watch !== true) return 'member';
    if (ex.watch === true && ex.gid === m.config.gid && m.to === me) return 'spectator';
    return null;
  }

  // ── Messages ──

  onMessage(m: BreakMsg): LobbyResult | null {
    const now = this.d.now();
    switch (m.type) {
      case 'break:lobby': {
        if (!m.from || m.from === this.d.myId()) return null;
        if (m.at)
          this.here.set(m.from, {
            id: m.from,
            name: m.name || 'noun',
            seedKey: m.seedKey,
            at: now,
          });
        else this.here.delete(m.from);
        for (const [gid, l] of this.live)
          if (l.host === m.from && m.live?.gid !== gid) this.live.delete(gid);
        if (m.live)
          this.live.set(m.live.gid, {
            gid: m.live.gid,
            host: m.from,
            hostName: m.name || 'noun',
            crewSize: m.live.crewSize,
            names: m.live.names,
            at: now,
          });
        return { kind: 'update' };
      }
      case 'break:challenge': {
        if (!m.from || !m.gid) return null;
        if (this.d.busy() || this.incoming !== null || this.outgoing !== null) {
          this.d.send({ type: 'break:reply', to: m.from, ok: false, gid: m.gid });
          return null;
        }
        this.incoming = {
          gid: m.gid,
          from: m.from,
          name: m.name || this.here.get(m.from)?.name || 'noun',
          crewSize: m.crewSize,
          crew: m.crew ?? 1,
          at: now,
        };
        return { kind: 'invite' };
      }
      case 'break:reply': {
        const o = this.outgoing;
        if (!o || !m.from || (m.gid !== undefined && m.gid !== o.gid)) return null;
        const s = o.slots.find(x => x.id === m.from && x.status === 'waiting');
        if (!s) return null;
        s.status = m.ok ? 'ok' : o.crewSize === 1 ? 'no' : 'cpu';
        return this.resolve(false);
      }
      default:
        return null;
    }
  }
}

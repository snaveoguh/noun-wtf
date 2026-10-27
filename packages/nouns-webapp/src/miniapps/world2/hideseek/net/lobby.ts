// ── The hide & seek lobby: open games, joining, the roster ───────────────
//
// Pure (no three.js, no DOM, an injected clock): unit-tested in
// lobby.test.ts. HideSeekMode owns one.
//
//   open games  a host announces `hideseek:lobby {open}` every 2 s (state
//               lobby, then live), and {open: null} when it closes; the
//               menu lists them. They expire after PRESENCE_MS.
//   hiding      a live game's announcement also lists its unfound hiders
//               (`hide`), so every client in the room hides their name
//               tags, players or not (policy.ts). Also expires.
//   hosting     HOST A GAME: the roster starts as me; `hideseek:join` adds
//               the asker (up to the max, CPU fill counted), each change
//               goes out as `hideseek:roster`. START builds the config:
//               the roster plus CPU players up to the fill count.
//   joining     JOIN sends `hideseek:join`; the roster comes back with me on
//               it (joined), or full without me (turned away; a roster
//               without me that isn't full is just ahead of my join). Not
//               on a roster in JOIN_MS: the game fell through.

import type { HsConfig, HsMsg, HsOpenGame, HsPlayer } from '../contract';

import { LIMITS } from '../contract';
import { makeConfig } from '../rules';

export const PRESENCE_MS = 6_000;
export const JOIN_MS = 8_000;

export const CPU_NAMES = [
  'Peeky Pete',
  'Hidey Hal',
  'Sneaky Sue',
  'Lil Lurk',
  'Corner Carl',
  'Shady Sam',
  'Noggle Ninja',
  'Quiet Quinn',
  'Rooftop Rae',
  'Bushy Bo',
  'Tiptoe Tess',
];

export interface LobbyDeps {
  myId(): string;
  myName(): string;
  mySeed(): string;
  nameOf(id: string): string;
  seedOf(id: string): string | undefined;
  cpuSeed(i: number): string;
  send(m: HsMsg): void;
  now(): number;
}

export interface Hosting {
  gid: string;
  players: HsPlayer[];
  /** CPU players to add at START (fill). */
  cpu: number;
  seekers: number;
  rounds: number;
  state: 'lobby' | 'live';
}

export type LobbyResult =
  | { kind: 'roster' }
  | { kind: 'joined'; gid: string; host: string }
  | { kind: 'full'; gid: string }
  | { kind: 'fellThrough' }
  | { kind: 'start'; config: HsConfig; host: string }
  | { kind: 'hostLeft'; gid: string };

export function newGid(now: number, rand: number): string {
  return `hs-${Math.floor(now).toString(36)}-${Math.floor(rand * 1e9).toString(36)}`;
}

export class HideSeekLobby {
  open = new Map<string, HsOpenGame & { at: number }>();
  /** id → the live game they're hiding in, when we last heard. */
  hiding = new Map<string, { gid: string; at: number }>();
  hosting: Hosting | null = null;
  /** I asked to join this game. */
  joining: { gid: string; host: string; at: number } | null = null;
  /** The roster of the game I'm in (host or joined), before it starts. */
  roster: HsPlayer[] = [];

  constructor(private d: LobbyDeps) {}

  // ── Hosting ──

  host(o: { cpu: number; seekers: number; rounds: number; gid: string }): Hosting {
    this.leaveLobby();
    const me: HsPlayer = {
      id: this.d.myId(),
      name: this.d.myName(),
      cpu: false,
      seed: this.d.mySeed(),
    };
    this.hosting = {
      gid: o.gid,
      players: [me],
      cpu: Math.max(0, Math.min(LIMITS.maxPlayers - 1, Math.round(o.cpu))),
      seekers: o.seekers,
      rounds: o.rounds,
      state: 'lobby',
    };
    this.roster = [me];
    this.sendRoster();
    this.announce();
    return this.hosting;
  }

  setFill(cpu: number) {
    const h = this.hosting;
    if (h === null) return;
    h.cpu = Math.max(0, Math.min(LIMITS.maxPlayers - h.players.length, Math.round(cpu)));
    this.sendRoster();
  }

  private sendRoster() {
    const h = this.hosting;
    if (h === null) return;
    this.d.send({ type: 'hideseek:roster', gid: h.gid, players: h.players, cpu: h.cpu });
  }

  /** Room presence: my open / live game (call every ~2 s while hosting), with who's hiding. */
  announce(hide?: string[]) {
    const h = this.hosting;
    if (h === null) return;
    this.d.send({
      type: 'hideseek:lobby',
      open: {
        gid: h.gid,
        host: this.d.myId(),
        hostName: this.d.myName(),
        n: h.players.length + h.cpu,
        max: LIMITS.maxPlayers,
        state: h.state,
        names: h.players.map(p => p.name),
      },
      ...(hide !== undefined ? { hide } : {}),
    });
  }

  /** START (host): the config, and the room told the game's live. */
  start(o: {
    seed: number;
    skill: number;
    hideS?: number;
    seekS?: number;
    first?: string[];
    last?: string[];
  }): HsConfig | null {
    const h = this.hosting;
    if (h === null) return null;
    const players = [...h.players];
    for (let i = 0; players.length < LIMITS.maxPlayers && i < h.cpu; i++)
      players.push({
        id: `cpu:${i}`,
        name: CPU_NAMES[i % CPU_NAMES.length]!,
        cpu: true,
        seed: this.d.cpuSeed(i),
      });
    if (players.length < LIMITS.minPlayers) return null;
    const config = makeConfig({
      gid: h.gid,
      seed: o.seed,
      players,
      seekers: h.seekers,
      rounds: h.rounds,
      skill: o.skill,
      hideS: o.hideS,
      seekS: o.seekS,
      first: o.first,
      last: o.last,
    });
    h.state = 'live';
    this.d.send({ type: 'hideseek:start', gid: h.gid, config });
    this.announce();
    return config;
  }

  /** Close my game (back to nothing): the room hears it's gone. */
  closeHosting() {
    const h = this.hosting;
    if (h === null) return;
    this.d.send({ type: 'hideseek:lobby', open: null });
    this.d.send({ type: 'hideseek:leave', gid: h.gid });
    this.hosting = null;
    this.roster = [];
  }

  // ── Joining ──

  join(gid: string): boolean {
    const g = this.open.get(gid);
    if (g === undefined || g.state !== 'lobby') return false;
    this.leaveLobby();
    this.joining = { gid, host: g.host, at: this.d.now() };
    this.d.send({ type: 'hideseek:join', gid });
    return true;
  }

  /** Leave the game I joined (or asked to), before it starts. */
  leaveLobby() {
    const j = this.joining;
    if (j !== null) this.d.send({ type: 'hideseek:leave', gid: j.gid });
    this.joining = null;
    if (this.hosting === null) this.roster = [];
  }

  /** Hosting, or on a roster: the game I'm about to play. */
  get gid(): string | null {
    return this.hosting?.gid ?? this.joining?.gid ?? null;
  }

  // ── Messages ──

  onMessage(m: HsMsg): LobbyResult | null {
    const now = this.d.now();
    switch (m.type) {
      case 'hideseek:lobby': {
        if (m.from === undefined) return null;
        // Forget what this host said before
        for (const [gid, g] of this.open) if (g.host === m.from) this.open.delete(gid);
        if (m.open) {
          this.open.set(m.open.gid, { ...m.open, host: m.from, at: now });
          for (const [id, h] of this.hiding) if (h.gid === m.open.gid) this.hiding.delete(id);
          for (const id of m.hide ?? []) this.hiding.set(id, { gid: m.open.gid, at: now });
        }
        return null;
      }
      case 'hideseek:join': {
        const h = this.hosting;
        if (h === null || m.gid !== h.gid || m.from === undefined) return null;
        if (h.state !== 'lobby') {
          this.sendRoster();
          return null;
        }
        if (!h.players.some(p => p.id === m.from) && h.players.length < LIMITS.maxPlayers) {
          h.players.push({
            id: m.from,
            name: this.d.nameOf(m.from),
            cpu: false,
            seed: this.d.seedOf(m.from),
          });
          // A real player takes a CPU's place
          h.cpu = Math.min(h.cpu, LIMITS.maxPlayers - h.players.length);
          this.roster = [...h.players];
        }
        this.sendRoster();
        this.announce();
        return { kind: 'roster' };
      }
      case 'hideseek:roster': {
        const j = this.joining;
        if (j === null || m.gid !== j.gid || (m.host !== undefined && m.host !== j.host))
          return null;
        const me = this.d.myId();
        if (!m.players.some(p => p.id === me)) {
          // Not on it yet (my join may still be on its way), unless it's full
          if (m.players.length + m.cpu < LIMITS.maxPlayers && this.roster.length === 0) return null;
          this.joining = null;
          this.roster = [];
          return { kind: 'full', gid: m.gid };
        }
        const first = this.roster.length === 0;
        this.roster = m.players;
        return first ? { kind: 'joined', gid: m.gid, host: j.host } : { kind: 'roster' };
      }
      case 'hideseek:start': {
        const j = this.joining;
        if (j === null || m.gid !== j.gid || m.host !== j.host) return null;
        if (!m.config.players.some(p => p.id === this.d.myId())) return null;
        // Still joined: the host can PLAY AGAIN with the same people
        this.roster = m.config.players.filter(p => !p.cpu);
        return { kind: 'start', config: m.config, host: j.host };
      }
      case 'hideseek:leave': {
        const h = this.hosting;
        if (h !== null && m.gid === h.gid && m.id !== undefined && h.state === 'lobby') {
          const before = h.players.length;
          h.players = h.players.filter(p => p.id !== m.id);
          if (h.players.length !== before) {
            this.roster = [...h.players];
            this.sendRoster();
            this.announce();
            return { kind: 'roster' };
          }
          return null;
        }
        const j = this.joining;
        if (j !== null && m.gid === j.gid && m.id === j.host) {
          this.joining = null;
          this.roster = [];
          return { kind: 'hostLeft', gid: m.gid };
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** Expire old presence; a join that never heard back falls through. */
  tick(): LobbyResult | null {
    const now = this.d.now();
    for (const [gid, g] of this.open) if (now - g.at > PRESENCE_MS) this.open.delete(gid);
    for (const [id, h] of this.hiding) if (now - h.at > PRESENCE_MS) this.hiding.delete(id);
    const j = this.joining;
    if (j !== null && this.roster.length === 0 && now - j.at > JOIN_MS) {
      this.joining = null;
      return { kind: 'fellThrough' };
    }
    if (j !== null && !this.open.has(j.gid) && now - j.at > PRESENCE_MS) {
      this.joining = null;
      this.roster = [];
      return { kind: 'hostLeft', gid: j.gid };
    }
    return null;
  }
}

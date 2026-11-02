// ── Noun Golf: a round in lockstep (host-authoritative) ──────────────────
//
// Like pool's session.ts: only swings travel. Whoever's up sends their
// swing to the host; the host checks it's their turn and the right shot
// number, plays it with the sim, applies the rules and sends everyone the
// accepted swing (so every client flies the same ball straight away) and
// then the resulting round state (rounded, path stripped), which every
// client adopts: if a client's own replay drifted, the next shot starts
// where the host says. The host also plays the CPUs. Solo / offline: you
// are the host and nothing is sent.

import type { GolfConfig, GolfMsg, RoundState, ShotResult, SwingInput } from '../contract';

export type Role = 'host' | 'player';

export interface GolfTransport {
  readonly id: string;
  readonly online: boolean;
  send(m: GolfMsg): void;
}

export interface SessionDeps {
  /** Fly `by`'s swing from where they lie (deterministic). */
  simulate(state: RoundState, by: number, swing: SwingInput): ShotResult;
  /** The rules: the state after that shot. */
  apply(state: RoundState, by: number, result: ShotResult): RoundState;
  /** A CPU's swing (host only). */
  cpu(state: RoundState, by: number): SwingInput;
}

export type SessionEvent =
  /** A swing to show: fly `result` for player `by` (shot `n`). */
  | { kind: 'shot'; by: number; n: number; swing: SwingInput; result: ShotResult }
  /** The round moved on (after a shot, or adopted from the host). */
  | { kind: 'state'; state: RoundState }
  | { kind: 'end'; reason: string };

const r2 = (v: number) => Math.round(v * 1000) / 1000;

/** What goes over the wire: no path, positions to the millimetre. */
export function wireState(s: RoundState): RoundState {
  const cur = s.cur.map(c => ({
    ...c,
    ball: c.ball && { x: r2(c.ball.x), y: r2(c.ball.y), z: r2(c.ball.z) },
  }));
  const last = s.last && {
    ...s.last,
    result: { ...s.last.result, path: [], events: s.last.result.events.slice(0, 24) },
  };
  return { ...s, cur, last };
}

export class GolfSession {
  state: RoundState;
  readonly role: Role;
  onEvent: ((e: SessionEvent) => void) | null = null;
  /** My swing is with the host (waiting for it to come back). */
  waiting = false;
  ended = false;
  private cpuAt = -1;

  constructor(
    readonly config: GolfConfig,
    state: RoundState,
    readonly host: string,
    private t: GolfTransport,
    private deps: SessionDeps,
  ) {
    this.state = state;
    this.role = host === t.id ? 'host' : 'player';
  }

  get gid() {
    return this.config.gid;
  }

  /** Index of my player in the round, or −1. */
  get me(): number {
    return this.config.players.findIndex(
      p => p.id === this.t.id || (p.id === 'me' && !this.t.online),
    );
  }

  get myTurn(): boolean {
    return this.state.phase !== 'over' && this.state.turn === this.me && !this.waiting;
  }

  /** The player up is a CPU (and I'm the host, so it's mine to play). */
  get cpuTurn(): boolean {
    const p = this.config.players[this.state.turn];
    return this.role === 'host' && this.state.phase !== 'over' && p !== undefined && !p.human;
  }

  /** Play my swing. */
  swing(swing: SwingInput) {
    if (!this.myTurn) return;
    if (this.role === 'host') this.accept(this.state.turn, swing);
    else {
      this.waiting = true;
      this.t.send({ type: 'golf:shot', gid: this.gid, n: this.state.n, swing });
    }
  }

  /** Host: the CPU up plays (call once its "thinking" pause is over). */
  playCpu() {
    if (!this.cpuTurn || this.cpuAt === this.state.n) return;
    this.cpuAt = this.state.n;
    const by = this.state.turn;
    this.accept(by, this.deps.cpu(this.state, by));
  }

  private accept(by: number, swing: SwingInput) {
    const n = this.state.n;
    const result = this.deps.simulate(this.state, by, swing);
    const next = this.deps.apply(this.state, by, result);
    if (this.t.online) {
      this.t.send({ type: 'golf:shot', gid: this.gid, n, swing, from: this.t.id });
      this.t.send({ type: 'golf:result', gid: this.gid, n, swing, state: wireState(next) });
    }
    this.onEvent?.({ kind: 'shot', by, n, swing, result });
    this.state = next;
    this.onEvent?.({ kind: 'state', state: next });
  }

  /** Everything golf:* for this round. */
  handle(m: GolfMsg, from?: string) {
    if (this.ended) return;
    switch (m.type) {
      case 'golf:shot': {
        if (m.gid !== this.gid) return;
        if (this.role === 'host') {
          // A player's swing: theirs to play, and the shot we're on
          const by = this.config.players.findIndex(p => p.id === (from ?? m.from));
          if (by < 0 || by !== this.state.turn || m.n !== this.state.n) return;
          this.accept(by, m.swing);
          return;
        }
        // From the host: fly it now (the state follows)
        if (m.n !== this.state.n) return;
        const by = this.state.turn;
        const result = this.deps.simulate(this.state, by, m.swing);
        this.onEvent?.({ kind: 'shot', by, n: m.n, swing: m.swing, result });
        return;
      }
      case 'golf:result': {
        if (m.gid !== this.gid || this.role === 'host') return;
        if (m.n < this.state.n) return;
        this.waiting = false;
        this.state = m.state;
        this.onEvent?.({ kind: 'state', state: m.state });
        return;
      }
      case 'golf:end':
        if (m.gid !== this.gid) return;
        this.ended = true;
        this.onEvent?.({ kind: 'end', reason: m.reason ?? 'round over' });
        return;
      case 'golf:leave': {
        if (m.gid !== this.gid) return;
        if (m.id === this.host) {
          this.ended = true;
          this.onEvent?.({ kind: 'end', reason: 'the host left' });
        }
        return;
      }
      default:
        return;
    }
  }

  /** I'm off. */
  leave() {
    if (this.ended) return;
    this.ended = true;
    if (this.t.online) {
      if (this.role === 'host')
        this.t.send({ type: 'golf:end', gid: this.gid, reason: 'the host left' });
      this.t.send({ type: 'golf:leave', gid: this.gid });
    }
  }
}

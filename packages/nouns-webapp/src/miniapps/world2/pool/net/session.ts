// ── A frame of pool, kept in step across the room ───────────────────────
//
// Sync: deterministic lockstep with the host as referee. Pool is turn
// based and the physics (pool/sim) is bit-deterministic, so nothing but the
// shots ever needs to travel:
//
//   1. The shooter sends `pool:shot {n, input}` to the host and starts
//      playing it out at once (no wait for a round trip).
//   2. The host checks it (their turn, shot n, legal cue ball spot) and
//      echoes it to everyone in the frame; every client plays it out with
//      the same sim, from the same start state, so they all see the same
//      balls roll, at their own frame rate.
//   3. When the host's run settles it judges it (rules) and sends
//      `pool:result {n, input, state}`: the authoritative state, which each
//      client takes once its own playback ends (it already matches; if a
//      message was missed it snaps instead). The host's state is rounded to
//      10 µm before it's used or sent, so the next shot starts identically.
//
// Why not stream ball positions? 16 balls × 60 Hz for several seconds per
// shot is a lot of traffic for nothing, and it would play back late and
// choppy; a shot is 60 bytes. Why still a host? Someone has to decide the
// rules (fouls, ball in hand, the 8) once, and refuse a shot out of turn.
//
// Pure: no DOM, no three.js, no clock (update(dt)), so tests drive it
// through the real relay.

import type {
  FrameState,
  PoolConfig,
  PoolMsg,
  PoolPlayer,
  Seat,
  ShotInput,
  ShotOutcome,
  Vec2,
} from '../contract';

import { think } from '../sim/cpu';
import { TICK, type PhysEvent } from '../sim/physics';
import {
  judge,
  newFrame,
  prepare,
  validInput,
  type Prepared,
  type RuleOptions,
} from '../sim/rules';

import { quantize, writeMsg } from './codec';

export type Role = 'host' | 'client' | 'spectator';

/** Seconds of cue stroke before the ball moves (the view's CueStick STROKE). */
export const STROKE_LEAD = 0.12;

export type SessionEvent =
  | { e: 'shot'; seat: Seat; input: ShotInput; n: number }
  | { e: 'phys'; ev: PhysEvent }
  | { e: 'settled'; state: FrameState; outcome: ShotOutcome | null }
  | { e: 'end'; winner: Seat | null; reason?: string };

export interface SessionOpts {
  config: PoolConfig;
  role: Role;
  /** My connection id (null: a spectator with no seat). */
  me: string | null;
  send(m: PoolMsg): void;
  /** Late joiners: the frame as it stands. */
  state?: FrameState;
  rules?: RuleOptions;
  /** Least time the CPU takes over a shot (s). */
  cpuDelay?: number;
}

interface Playback {
  n: number;
  seat: Seat;
  input: ShotInput;
  from: FrameState;
  prep: Prepared;
  t: number;
  ev: number;
  /** The host's verdict (clients wait for it). */
  result: FrameState | null;
}

export interface AimView {
  dx: number;
  dy: number;
  p: number;
  cue?: Vec2;
}

export class PoolSession {
  readonly config: PoolConfig;
  readonly role: Role;
  readonly me: string | null;
  state: FrameState;
  play: Playback | null = null;
  /** Playback speed (the UI's fast-forward). */
  speed = 1;
  ended: { winner: Seat | null; reason?: string } | null = null;
  hostLeft = false;
  /** The other player's live aim (or the CPU lining up), for the view. */
  remoteAim: AimView | null = null;
  /** Shots the host refused (stats / tests). */
  refused = 0;
  private events: SessionEvent[] = [];
  private send: (m: PoolMsg) => void;
  private rules: RuleOptions;
  private cpu: { gen: Generator<void, ShotInput>; t: number; input: ShotInput | null } | null =
    null;
  private cpuDelay: number;
  private hostId: string;

  constructor(o: SessionOpts) {
    this.config = o.config;
    this.role = o.role;
    this.me = o.me;
    this.send = m => o.send(writeMsg(m));
    this.rules = o.rules ?? {};
    this.cpuDelay = o.cpuDelay ?? 1.1;
    this.hostId = o.role === 'host' ? (o.me ?? 'me') : '';
    this.state = o.state ?? quantize(newFrame(o.config.seed, o.config.breaker));
  }

  /** Clients: whose frame this is (set from pool:start's host). */
  setHost(id: string) {
    this.hostId = id;
  }

  get gid() {
    return this.config.gid;
  }

  get mySeat(): Seat | null {
    if (this.me === null || this.role === 'spectator') return null;
    const i = this.config.players.findIndex(p => p.id === this.me);
    return i === 0 || i === 1 ? i : null;
  }

  get shooter(): PoolPlayer {
    return this.config.players[this.state.turn];
  }

  /** My turn, nothing rolling, frame on. */
  canShoot(): boolean {
    return (
      this.mySeat !== null &&
      this.mySeat === this.state.turn &&
      this.play === null &&
      this.state.phase !== 'over' &&
      this.ended === null &&
      !this.hostLeft
    );
  }

  /** The CPU's turn (host only). */
  get cpuTurn(): boolean {
    return this.role === 'host' && !this.shooter.human && this.state.phase !== 'over';
  }

  drainEvents(): SessionEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Take my shot. */
  shoot(input: ShotInput): boolean {
    if (!this.canShoot() || !validInput(this.state, input)) return false;
    const n = this.state.shots;
    if (this.role === 'host') this.accept(input, n);
    else {
      this.send({ type: 'pool:shot', gid: this.gid, n, input });
      this.begin(input, n);
    }
    return true;
  }

  /** My live aim, for the others (PoolMode throttles it). */
  sendAim(a: AimView) {
    if (this.mySeat === null) return;
    this.send({ type: 'pool:aim', gid: this.gid, dx: a.dx, dy: a.dy, p: a.p, cue: a.cue });
  }

  /** Host: run this shot and tell everyone. */
  private accept(input: ShotInput, n: number) {
    this.send({ type: 'pool:shot', gid: this.gid, n, input });
    this.begin(input, n);
  }

  private begin(input: ShotInput, n: number) {
    const prep = prepare(this.state, input);
    this.play = {
      n,
      seat: this.state.turn,
      input,
      from: this.state,
      prep,
      // The cue's forward stroke plays first; the balls wait for it
      t: -STROKE_LEAD,
      ev: 0,
      result: null,
    };
    this.remoteAim = null;
    this.events.push({ e: 'shot', seat: this.state.turn, input, n });
  }

  onMessage(m: PoolMsg) {
    if ('gid' in m && m.gid !== this.gid) return;
    switch (m.type) {
      case 'pool:shot': {
        if (this.role === 'host') {
          const p = this.shooter;
          if (
            !p.human ||
            m.from !== p.id ||
            m.n !== this.state.shots ||
            this.play !== null ||
            this.state.phase === 'over' ||
            !validInput(this.state, m.input)
          ) {
            this.refused++;
            return;
          }
          this.accept(m.input, m.n);
          return;
        }
        // From the host: the accepted shot (mine is already playing)
        if (m.from !== undefined && m.from !== this.hostId) return;
        if (this.play?.n === m.n) return;
        if (this.play === null && m.n === this.state.shots) this.begin(m.input, m.n);
        return;
      }
      case 'pool:aim':
        if (m.from === this.me) return;
        this.remoteAim = { dx: m.dx, dy: m.dy, p: m.p, cue: m.cue };
        return;
      case 'pool:result': {
        if (this.role === 'host') return;
        if (this.play !== null && this.play.n === m.n) {
          this.play.result = m.state;
          return;
        }
        if (m.n < this.state.shots) return;
        if (this.play !== null && m.n > this.play.n) {
          // Missed the end of the one that's playing: catch up now
          this.play = null;
          this.settle(m.state, m.state.last);
          return;
        }
        // The shot never showed up here: take the verdict as it is
        if (this.play === null) this.settle(m.state, m.state.last);
        return;
      }
      case 'pool:end':
        if (this.ended === null) {
          this.ended = { winner: m.winner, reason: m.reason };
          this.events.push({ e: 'end', winner: m.winner, reason: m.reason });
        }
        return;
      case 'pool:leave': {
        if (this.ended !== null) return;
        const who = m.id;
        if (who === this.hostId && this.role !== 'host') {
          this.hostLeft = true;
          const s = this.mySeat;
          this.finish(s, 'the other player left');
          return;
        }
        const seat = this.config.players.findIndex(p => p.id === who);
        if (this.role === 'host' && (seat === 0 || seat === 1)) {
          const winner: Seat = seat === 0 ? 1 : 0;
          this.send({ type: 'pool:end', gid: this.gid, winner, reason: 'the other player left' });
          this.finish(winner, 'the other player left');
        }
        return;
      }
      default:
        return;
    }
  }

  private finish(winner: Seat | null, reason: string) {
    if (this.ended !== null) return;
    this.ended = { winner, reason };
    this.events.push({ e: 'end', winner, reason });
  }

  /** Leave the frame (a forfeit for a player). */
  leave() {
    if (this.ended === null)
      this.send({ type: 'pool:leave', gid: this.gid, id: this.me ?? undefined });
  }

  update(dt: number) {
    const p = this.play;
    if (p !== null) {
      const run = p.prep.run;
      p.t += dt * this.speed;
      run.advance(p.t + 0.25);
      while (p.ev < run.events.length && run.events[p.ev]!.t <= p.t) {
        this.events.push({ e: 'phys', ev: run.events[p.ev]! });
        p.ev++;
      }
      if (run.done && p.t >= run.t) this.played(p);
    } else if (this.cpuTurn && this.ended === null) this.stepCpu(dt);
  }

  private played(p: Playback) {
    const run = p.prep.run;
    while (p.ev < run.events.length) this.events.push({ e: 'phys', ev: run.events[p.ev++]! });
    if (this.role === 'host') {
      const j = judge(p.from, p.input, run.report, run.balls, this.rules);
      const next = quantize(j.state);
      this.send({ type: 'pool:result', gid: this.gid, n: p.n, input: p.input, state: next });
      this.play = null;
      this.settle(next, j.outcome);
      if (next.phase === 'over') {
        this.send({ type: 'pool:end', gid: this.gid, winner: next.winner, reason: next.reason });
      }
      return;
    }
    if (p.result === null) return; // waiting on the host's verdict
    this.play = null;
    this.settle(p.result, p.result.last);
  }

  private settle(state: FrameState, outcome: ShotOutcome | null) {
    this.state = state;
    this.events.push({ e: 'settled', state, outcome });
    if (state.phase === 'over' && this.ended === null) {
      this.ended = { winner: state.winner, reason: state.reason };
      this.events.push({ e: 'end', winner: state.winner, reason: state.reason });
    }
  }

  private stepCpu(dt: number) {
    const seat = this.state.turn;
    if (this.cpu === null) {
      const skill = this.shooter.skill ?? 0.6;
      this.cpu = {
        gen: think(this.state, seat, skill, {
          ...this.rules,
          seed: this.config.seed + this.state.shots,
        }),
        t: 0,
        input: null,
      };
    }
    const c = this.cpu;
    c.t += dt;
    if (c.input === null) {
      const r = c.gen.next();
      if (r.done === true) c.input = r.value;
    }
    if (c.input !== null) {
      // Line it up for a moment so the view shows the cue settle
      const s = c.input.shot;
      this.remoteAim = { dx: s.dx, dy: s.dy, p: s.power, cue: c.input.cue };
      if (c.t >= this.cpuDelay) {
        this.cpu = null;
        this.accept(c.input, this.state.shots);
      }
    }
  }

  /** Where every ball is right now (playback interpolated); null = off the table. */
  positions(): (Vec2 | null)[] {
    const p = this.play;
    if (p === null) return this.state.balls;
    const fr = p.prep.run.frames;
    const k = Math.max(0, Math.min(p.t / TICK, fr.length - 1));
    const i = Math.max(0, Math.floor(k));
    const a = fr[i]!;
    const b = fr[Math.min(fr.length - 1, i + 1)]!;
    const f = k - i;
    const out: (Vec2 | null)[] = [];
    for (let id = 0; id < 16; id++) {
      if (a[id * 3 + 2] === 0) out.push(null);
      else
        out.push({
          x: a[id * 3]! + (b[id * 3]! - a[id * 3]!) * f,
          y: a[id * 3 + 1]! + (b[id * 3 + 1]! - a[id * 3 + 1]!) * f,
        });
    }
    return out;
  }

  /** The CPU is working out its shot (host). */
  get thinking(): boolean {
    return this.cpu !== null;
  }
}

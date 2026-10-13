// ── HoopsSession: one game's sim + host-authoritative sync ───────────────
//
// No three.js, no DOM: unit-tested over a loopback (sync.test.ts).
//
//   host       runs the sim at SIM_DT with an accumulator, applies remote
//              inputs through a small jitter buffer, broadcasts a quantised
//              snapshot every 3rd step (20 Hz) with the events since the last.
//   client     sends its input at 30 Hz (seq-numbered), renders snapshots
//              ~100 ms in the past (interpolated), and predicts its own
//              baller: a local sim is rebased on each snapshot and the inputs
//              the host hasn't acked yet are replayed on top; the difference
//              from the previous prediction decays away (soft reconcile).
//   spectator  a client with no baller: interpolated snapshots only.

import {
  NO_INPUT,
  SIM_DT,
  type BallerInput,
  type BallerState,
  type GameConfig,
  type HoopsMsg,
  type HoopsSimApi,
  type SimEvent,
  type SimState,
  type TeamId,
} from '../contract';

import { decodeState, encodeState, packEvents, unpackEvents } from './codec';

export type HoopsRole = 'host' | 'client' | 'spectator';

export interface SessionOptions {
  gid: string;
  config: GameConfig;
  role: HoopsRole;
  /** My baller id (null for spectators). */
  me: string | null;
  hostId: string;
  send: (m: HoopsMsg) => void;
  makeSim: (cfg: GameConfig) => HoopsSimApi;
  /** ms clock (tests inject one). */
  now?: () => number;
}

const SNAP_EVERY = 3; // steps → 20 Hz
const INPUT_HZ = 30;
const INTERP_MS = 100;
const MAX_STEPS = 8;
const HISTORY = 180;

interface Snap {
  t: number;
  state: SimState;
}

export interface SessionStats {
  snapsSent: number;
  snapsRecv: number;
  /** Bytes of the last snapshot message (JSON on the wire). */
  snapBytes: number;
  snapBytesMax: number;
  inputsSent: number;
  /** Bytes of the last input message. */
  inputBytes: number;
  /** Last prediction correction (m). */
  correction: number;
}

const seqAfter = (a: number, b: number) => ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;

export class HoopsSession {
  readonly gid: string;
  readonly config: GameConfig;
  readonly role: HoopsRole;
  readonly me: string | null;
  readonly hostId: string;
  /** Host: the game. Client: the prediction sim. Spectator: unused. */
  readonly sim: HoopsSimApi;
  /** Events for the view since it last drained them. */
  events: SimEvent[] = [];
  /** Points per baller id (MVP). */
  points = new Map<string, number>();
  ended: { winner: TeamId; score: [number, number] } | null = null;
  hostLeft = false;
  stats: SessionStats = {
    snapsSent: 0,
    snapsRecv: 0,
    snapBytes: 0,
    snapBytesMax: 0,
    inputsSent: 0,
    inputBytes: 0,
    correction: 0,
  };

  private send: (m: HoopsMsg) => void;
  private now: () => number;
  private acc = 0;
  private stepN = 0;
  private outEvents: SimEvent[] = [];
  /** Host: per human, a jitter buffer of (seq, input). */
  private remote = new Map<
    string,
    { q: { seq: number; input: BallerInput }[]; cur: BallerInput; seq: number; held: number }
  >();
  private gone = new Set<string>();
  /** Client. */
  private snaps: Snap[] = [];
  private seq = 0;
  private sendAcc = 1;
  private sent: BallerInput = { ...NO_INPUT };
  private history: { seq: number; input: BallerInput }[] = [];
  private corr = { x: 0, z: 0 };
  private predicted: BallerState | null = null;
  private latest: SimState | null = null;
  private view: SimState | null = null;

  constructor(o: SessionOptions) {
    this.gid = o.gid;
    this.config = o.config;
    this.role = o.role;
    this.me = o.me;
    this.hostId = o.hostId;
    this.send = o.send;
    this.now = o.now ?? (() => performance.now());
    this.sim = o.makeSim(o.config);
    if (o.role === 'host')
      for (const p of o.config.players)
        if (!p.bot && p.id !== o.me)
          this.remote.set(p.id, { q: [], cur: { ...NO_INPUT }, seq: 0, held: 0 });
  }

  get over() {
    return this.ended !== null || this.hostLeft;
  }

  /** Advance by a frame: `input` is my baller's controls (ignored for spectators). */
  update(dt: number, input: BallerInput) {
    if (this.role === 'host') this.hostUpdate(dt, input);
    else if (this.role === 'client') this.clientUpdate(dt, input);
  }

  // ── Host ──

  private hostUpdate(dt: number, input: BallerInput) {
    if (this.ended !== null) return;
    this.acc = Math.min(this.acc + dt, SIM_DT * MAX_STEPS);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const inputs: Record<string, BallerInput> = {};
      if (this.me !== null) inputs[this.me] = input;
      for (const [id, r] of this.remote) {
        // Each 30 Hz input covers two 60 Hz steps; skip ahead when backed up
        if (r.q.length > 4) r.q.splice(0, r.q.length - 2);
        if (r.q.length > 0 && (r.held >= 2 || r.q.length > 2)) {
          const n = r.q.shift()!;
          r.cur = n.input;
          r.seq = n.seq;
          r.held = 0;
        }
        r.held++;
        inputs[id] = this.gone.has(id) ? NO_INPUT : r.cur;
      }
      const s = this.sim.step(inputs);
      this.take(s.events);
      if (++this.stepN % SNAP_EVERY === 0 || s.phase === 'final') this.broadcast(s);
      if (s.phase === 'final') {
        this.finish(s);
        break;
      }
    }
  }

  private take(evs: SimEvent[]) {
    for (const e of evs) {
      this.events.push(e);
      this.outEvents.push(e);
      if (e.type === 'score') this.points.set(e.id, (this.points.get(e.id) ?? 0) + e.points);
    }
  }

  private broadcast(s: SimState) {
    const acks = this.config.players.map(p => this.remote.get(p.id)?.seq ?? 0);
    const msg: HoopsMsg = {
      type: 'hoops:s',
      gid: this.gid,
      d: encodeState(s, this.config, acks),
      ...(this.outEvents.length > 0 ? { e: packEvents(this.outEvents, this.config) } : {}),
    };
    this.outEvents = [];
    const bytes = JSON.stringify(msg).length;
    this.stats.snapsSent++;
    this.stats.snapBytes = bytes;
    this.stats.snapBytesMax = Math.max(this.stats.snapBytesMax, bytes);
    this.send(msg);
  }

  private finish(s: SimState) {
    const winner: TeamId = s.score[0] > s.score[1] ? 0 : 1;
    this.ended = { winner, score: [s.score[0], s.score[1]] };
    this.send({ type: 'hoops:end', gid: this.gid, winner, score: this.ended.score });
  }

  // ── Client / spectator ──

  private clientUpdate(dt: number, input: BallerInput) {
    if (this.over || this.me === null) return;
    this.sendAcc += dt;
    this.acc = Math.min(this.acc + dt, SIM_DT * MAX_STEPS);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      if (this.sendAcc >= 1 / INPUT_HZ) {
        this.sendAcc = 0;
        this.seq = (this.seq + 1) & 0xffff;
        this.sent = { ...input };
        const m: HoopsMsg = {
          type: 'hoops:input',
          gid: this.gid,
          id: this.me,
          seq: this.seq,
          input: compactInput(this.sent),
        };
        this.stats.inputsSent++;
        this.stats.inputBytes = JSON.stringify(m).length;
        this.send(m);
      }
      if (this.latest === null) continue;
      this.history.push({ seq: this.seq, input: this.sent });
      if (this.history.length > HISTORY) this.history.shift();
      this.predicted = this.predictStep(this.sent);
    }
    const k = Math.exp(-dt * 8);
    this.corr.x *= k;
    this.corr.z *= k;
  }

  private predictStep(input: BallerInput): BallerState | null {
    const s = this.sim.step({ [this.me!]: input });
    return s.players.find(p => p.id === this.me) ?? null;
  }

  /** Rebase the prediction on a fresh snapshot, replaying the unacked inputs. */
  private rebase(state: SimState, ack: number) {
    const before = this.predicted;
    this.sim.load(structuredClone(state));
    this.history = this.history.filter(h => seqAfter(h.seq, ack));
    let me = state.players.find(p => p.id === this.me) ?? null;
    for (const h of this.history) me = this.predictStep(h.input) ?? me;
    this.predicted = me;
    if (before !== null && me !== null) {
      const ex = before.x + this.corr.x - me.x;
      const ez = before.z + this.corr.z - me.z;
      const e = Math.hypot(ex, ez);
      this.stats.correction = e;
      if (e > 3) {
        this.corr.x = 0;
        this.corr.z = 0;
      } else {
        this.corr.x = ex;
        this.corr.z = ez;
      }
    }
  }

  // ── Messages ──

  onMessage(m: HoopsMsg) {
    if (m.gid !== this.gid) return;
    switch (m.type) {
      case 'hoops:input': {
        if (this.role !== 'host') return;
        const r = this.remote.get(m.id);
        if (!r || !seqAfter(m.seq, r.q.length ? r.q[r.q.length - 1].seq : r.seq)) return;
        r.q.push({ seq: m.seq, input: sanitizeInput(m.input) });
        return;
      }
      case 'hoops:s': {
        if (this.role === 'host') return;
        const dec = decodeState(m.d, this.config);
        if (dec === null) return;
        this.stats.snapsRecv++;
        const evs = unpackEvents(m.e, this.config);
        dec.state.events = evs;
        for (const e of evs) {
          this.events.push(e);
          if (e.type === 'score') this.points.set(e.id, (this.points.get(e.id) ?? 0) + e.points);
        }
        if (this.latest !== null && dec.state.tick <= this.latest.tick) return;
        this.latest = dec.state;
        this.snaps.push({ t: this.now(), state: dec.state });
        if (this.snaps.length > 12) this.snaps.shift();
        if (this.role === 'client' && this.me !== null) {
          const i = this.config.players.findIndex(p => p.id === this.me);
          this.rebase(dec.state, dec.acks[i] ?? 0);
        }
        if (dec.state.phase === 'final' && this.ended === null) {
          const [a, b] = dec.state.score;
          this.ended = { winner: a > b ? 0 : 1, score: [a, b] };
        }
        return;
      }
      case 'hoops:end':
        if (this.role !== 'host') this.ended = { winner: m.winner, score: m.score };
        return;
      case 'hoops:leave':
        if (m.id === this.hostId && this.role !== 'host') this.hostLeft = true;
        else this.gone.add(m.id);
        return;
      default:
        return;
    }
  }

  /** Host: my own leaving (forfeit / Esc). */
  leave() {
    this.send({ type: 'hoops:leave', gid: this.gid, id: this.me ?? '' });
  }

  // ── What to draw ──

  /** The state to render this frame (host: the sim; others: interpolated + my prediction). */
  render(): SimState | null {
    if (this.role === 'host') return this.sim.state();
    const sn = this.snaps;
    if (sn.length === 0) return null;
    const t = this.now() - INTERP_MS;
    let a = sn[0];
    let b = sn[sn.length - 1];
    if (t <= a.t) b = a;
    else
      for (let i = 0; i < sn.length - 1; i++)
        if (sn[i].t <= t && sn[i + 1].t >= t) {
          a = sn[i];
          b = sn[i + 1];
          break;
        }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    const out = lerpState(a.state, b.state, k, this.view);
    this.view = out;
    out.events = [];
    const me = this.predicted;
    if (this.role === 'client' && me !== null) {
      const p = out.players.find(q => q.id === this.me);
      if (p) {
        const px = me.x + this.corr.x;
        const pz = me.z + this.corr.z;
        if (out.ball.holder === this.me) {
          out.ball.x += px - p.x;
          out.ball.z += pz - p.z;
        }
        p.x = px;
        p.z = pz;
        p.y = me.y;
        p.yaw = me.yaw;
        p.vx = me.vx;
        p.vz = me.vz;
        p.action = me.action;
        p.actionT = me.actionT;
        p.meter = me.meter;
        p.stamina = me.stamina;
      }
    }
    return out;
  }

  /** Drain the events the view hasn't played yet. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** MVP: most points, then (stub-friendly) the first human. */
  mvp(): { id: string; name: string; points: number } | null {
    let best: { id: string; points: number } | null = null;
    for (const [id, points] of this.points)
      if (!best || points > best.points) best = { id, points };
    if (!best) return null;
    const p = this.config.players.find(q => q.id === best!.id);
    return { id: best.id, name: p?.name ?? 'noun', points: best.points };
  }
}

// ── Helpers ──

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** a → b by k (discrete fields from b). Reuses `out` when it fits. */
export function lerpState(a: SimState, b: SimState, k: number, out: SimState | null): SimState {
  const o: SimState =
    out !== null && out.players.length === b.players.length ? out : structuredClone(b);
  o.tick = b.tick;
  o.time = lerp(a.time, b.time, k);
  o.phase = b.phase;
  o.phaseT = b.phaseT;
  o.score = [b.score[0], b.score[1]];
  o.offense = b.offense;
  o.shotClock = b.shotClock;
  const ba = a.ball;
  const bb = b.ball;
  // A ball that changed hands / state snaps rather than sliding across the court
  const kb = ba.state === bb.state && ba.holder === bb.holder ? k : 1;
  Object.assign(o.ball, bb);
  o.ball.x = lerp(ba.x, bb.x, kb);
  o.ball.y = lerp(ba.y, bb.y, kb);
  o.ball.z = lerp(ba.z, bb.z, kb);
  for (let i = 0; i < b.players.length; i++) {
    const pb = b.players[i];
    const pa = a.players[i]?.id === pb.id ? a.players[i] : pb;
    const p = o.players[i];
    Object.assign(p, pb);
    p.x = lerp(pa.x, pb.x, k);
    p.y = lerp(pa.y, pb.y, k);
    p.z = lerp(pa.z, pb.z, k);
    p.yaw = lerpAngle(pa.yaw, pb.yaw, k);
  }
  return o;
}

/** Clamp what comes off the wire. */
export function sanitizeInput(i: Partial<BallerInput> | undefined): BallerInput {
  const n = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  return {
    moveX: n(i?.moveX),
    moveZ: n(i?.moveZ),
    sprint: i?.sprint === true,
    shoot: i?.shoot === true,
    pass: i?.pass === true,
    passTo: typeof i?.passTo === 'string' ? i.passTo.slice(0, 64) : undefined,
    move: i?.move === true,
    call: i?.call === true,
  };
}

/** Round the stick and drop false buttons (smaller messages). */
function compactInput(i: BallerInput): BallerInput {
  const o: Record<string, unknown> = {
    moveX: Math.round(i.moveX * 100) / 100,
    moveZ: Math.round(i.moveZ * 100) / 100,
  };
  for (const k of ['sprint', 'shoot', 'pass', 'move', 'call'] as const) if (i[k]) o[k] = true;
  if (i.passTo !== undefined) o.passTo = i.passTo;
  return o as unknown as BallerInput;
}

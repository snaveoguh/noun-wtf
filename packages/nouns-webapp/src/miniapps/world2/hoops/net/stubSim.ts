// ── StubSim: a stand-in HoopsSim for building the net layer ─────────────
//
// Not the game: players move, the ball follows the holder, `shoot` scores
// sometimes, passes and steals hand the ball over, and bots chase / drive.
// Deterministic for a seed + input stream (like the real one), so the
// prediction / replay paths in sync.ts get exercised. Swapped for hoops/sim's
// HoopsSim in factory.ts.

import {
  SIM_DT,
  type BallerInput,
  type BallerState,
  type GameConfig,
  type HoopsSimApi,
  type SimEvent,
  type SimState,
  type TeamId,
} from '../contract';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const RUN = 5;
const SPRINT = 7.2;

export class StubSim implements HoopsSimApi {
  private s: SimState;
  private rand: () => number;
  private prev = new Map<string, BallerInput>();
  /** Ball flight (shot / pass): start, end, time left, total. */
  private flight: {
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
    t: number;
    T: number;
    to: string | null;
    make: boolean;
  } | null = null;

  constructor(readonly config: GameConfig) {
    this.rand = rng(config.seed);
    const players: BallerState[] = config.players.map((p, i) => {
      const k = config.players.filter((q, j) => q.team === p.team && j < i).length;
      const side = p.team === 0 ? -1 : 1;
      return {
        id: p.id,
        team: p.team,
        x: (k - (config.size - 1) / 2) * 3,
        y: 0,
        z: config.halfCourt ? side * 2 : side * 4,
        yaw: p.team === 0 ? 0 : Math.PI,
        vx: 0,
        vz: 0,
        action: 'idle',
        actionT: 0,
        hasBall: false,
        onFire: false,
        stamina: 1,
      };
    });
    this.s = {
      tick: 0,
      time: 0,
      phase: 'pregame',
      phaseT: 1,
      score: [0, 0],
      offense: 0,
      shotClock: config.shotClock,
      players,
      ball: {
        x: 0,
        y: 1,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        sx: 0,
        sy: 0,
        sz: 0,
        state: 'dead',
        holder: null,
        shooter: null,
        value: 0,
      },
      events: [],
    };
    this.giveBall(0);
  }

  state(): SimState {
    return this.s;
  }

  load(state: SimState): void {
    this.s = structuredClone(state);
    this.flight = null;
  }

  /** The basket a team attacks (z of the rim). */
  private rimZ(team: TeamId) {
    const c = this.config.court;
    const z = c.length / 2 - c.rimFromBaseline;
    return this.config.halfCourt || team === 0 ? z : -z;
  }

  private giveBall(team: TeamId) {
    const s = this.s;
    s.offense = team;
    const p = s.players.find(q => q.team === team);
    for (const q of s.players) q.hasBall = false;
    if (p) {
      p.hasBall = true;
      s.ball.holder = p.id;
      s.ball.state = 'held';
    }
    s.shotClock = this.config.shotClock;
  }

  step(inputs: Record<string, BallerInput>): SimState {
    const s = this.s;
    const ev: SimEvent[] = [];
    s.events = ev;
    s.tick++;
    s.time += SIM_DT;
    if (s.phase === 'final') return s;
    if (s.phase !== 'live') {
      s.phaseT -= SIM_DT;
      if (s.phaseT <= 0) s.phase = 'live';
    }
    const live = s.phase === 'live';
    const ball = s.ball;
    const holder = s.players.find(p => p.id === ball.holder) ?? null;
    const rimZ = this.rimZ(s.offense);
    for (const p of s.players) {
      const human = this.config.players.find(b => b.id === p.id)?.bot !== true;
      const raw = inputs[p.id];
      const inp: BallerInput = human
        ? (raw ?? {
            moveX: 0,
            moveZ: 0,
            sprint: false,
            shoot: false,
            pass: false,
            move: false,
            call: false,
          })
        : this.bot(p, holder, rimZ);
      const was = this.prev.get(p.id);
      this.prev.set(p.id, { ...inp });
      const len = Math.hypot(inp.moveX, inp.moveZ);
      const sp = live ? (inp.sprint ? SPRINT : RUN) : 0;
      const k = len > 1 ? 1 / len : 1;
      const tvx = inp.moveX * k * sp;
      const tvz = inp.moveZ * k * sp;
      p.vx += (tvx - p.vx) * Math.min(1, SIM_DT * 12);
      p.vz += (tvz - p.vz) * Math.min(1, SIM_DT * 12);
      p.x = Math.max(-13, Math.min(13, p.x + p.vx * SIM_DT));
      p.z = Math.max(-12, Math.min(12, p.z + p.vz * SIM_DT));
      if (Math.hypot(p.vx, p.vz) > 0.3) p.yaw = Math.atan2(p.vx, p.vz);
      p.actionT = (p.actionT + SIM_DT) % 1;
      p.action = p.hasBall ? 'dribble' : Math.hypot(p.vx, p.vz) > 0.5 ? 'run' : 'idle';
      p.stamina = Math.max(0, Math.min(1, p.stamina + (inp.sprint ? -0.2 : 0.1) * SIM_DT));
      if (!live) continue;
      // Shoot on release, pass on press, steal on press (defense)
      if (p.hasBall && was?.shoot === true && !inp.shoot) this.shoot(p, rimZ, ev);
      else if (p.hasBall && inp.pass && was?.pass !== true) this.pass(p, inp.passTo, ev);
      else if (!p.hasBall && inp.move && was?.move !== true && holder && holder.team !== p.team) {
        if (Math.hypot(holder.x - p.x, holder.z - p.z) < 1.6 && this.rand() < 0.35) {
          ev.push({ type: 'steal', id: p.id, from: holder.id });
          holder.hasBall = false;
          p.hasBall = true;
          ball.holder = p.id;
          s.offense = p.team;
          s.shotClock = this.config.shotClock;
        }
      }
      p.meter = p.hasBall && inp.shoot ? Math.min(1, (p.meter ?? 0) + SIM_DT * 1.4) : undefined;
    }
    this.stepBall(ev);
    if (live && ball.state === 'held') {
      s.shotClock -= SIM_DT;
      if (this.config.shotClock > 0 && s.shotClock <= 0) {
        ev.push({ type: 'shotClock', team: s.offense });
        this.giveBall(s.offense === 0 ? 1 : 0);
      }
    }
    return s;
  }

  private bot(p: BallerState, holder: BallerState | null, rimZ: number): BallerInput {
    const inp: BallerInput = {
      moveX: 0,
      moveZ: 0,
      sprint: false,
      shoot: false,
      pass: false,
      move: false,
      call: false,
    };
    const s = this.s;
    let tx = p.x;
    let tz = p.z;
    if (p.hasBall) {
      tx = 0;
      tz = rimZ - Math.sign(rimZ) * 4;
      // Hold the shot for ~0.6 s when in range (release = shoot)
      const prev = this.prev.get(p.id);
      const d = Math.hypot(p.x, p.z - rimZ);
      if (d < 6.5 && s.phase === 'live')
        inp.shoot = !(prev?.shoot === true && (p.meter ?? 0) > 0.8);
    } else if (s.ball.state === 'loose') {
      tx = s.ball.x;
      tz = s.ball.z;
      inp.sprint = true;
    } else if (holder && holder.team !== p.team) {
      tx = holder.x;
      tz = holder.z + Math.sign(rimZ) * 1.2;
      inp.move = this.rand() < 0.02;
    } else {
      const k = this.config.players.findIndex(b => b.id === p.id);
      tx = ((k % 3) - 1) * 5;
      tz = rimZ - Math.sign(rimZ) * (5 + (k % 2) * 2);
    }
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.4) {
      inp.moveX = dx / d;
      inp.moveZ = dz / d;
    }
    const diff = this.config.difficulty ?? 2;
    inp.moveX *= 0.6 + diff * 0.12;
    inp.moveZ *= 0.6 + diff * 0.12;
    return inp;
  }

  private shoot(p: BallerState, rimZ: number, ev: SimEvent[]) {
    const s = this.s;
    const c = this.config.court;
    const d = Math.hypot(p.x, p.z - rimZ);
    const three = d > c.threeRadius;
    const value = this.config.nbaScoring ? (three ? 3 : 2) : three ? 2 : 1;
    const quality = 1 - Math.abs((p.meter ?? 0.5) - 0.86) * 2;
    const make = this.rand() < 0.25 + quality * 0.4 - d * 0.015;
    ev.push({ type: 'shot', id: p.id, value, quality, kind: 'jumper' });
    p.hasBall = false;
    p.meter = undefined;
    p.action = 'jumpshot';
    s.ball.holder = null;
    s.ball.shooter = p.id;
    s.ball.value = value;
    s.ball.state = 'air';
    this.flight = {
      x0: p.x,
      y0: 2.2,
      z0: p.z,
      x1: 0,
      y1: c.rimHeight,
      z1: rimZ,
      t: 0.9,
      T: 0.9,
      to: null,
      make,
    };
  }

  private pass(p: BallerState, to: string | undefined, ev: SimEvent[]) {
    const mates = this.s.players.filter(q => q.team === p.team && q.id !== p.id);
    const target =
      mates.find(q => q.id === to) ??
      mates.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (target === undefined) return;
    ev.push({ type: 'pass', from: p.id, to: target.id });
    p.hasBall = false;
    const b = this.s.ball;
    b.holder = null;
    b.state = 'air';
    b.shooter = null;
    this.flight = {
      x0: p.x,
      y0: 1.3,
      z0: p.z,
      x1: target.x,
      y1: 1.3,
      z1: target.z,
      t: 0.35,
      T: 0.35,
      to: target.id,
      make: false,
    };
  }

  private stepBall(ev: SimEvent[]) {
    const s = this.s;
    const b = s.ball;
    if (b.state === 'held') {
      const h = s.players.find(p => p.id === b.holder);
      if (h) {
        const bounce = Math.abs(Math.sin(s.time * 9));
        b.x = h.x + Math.sin(h.yaw) * 0.45;
        b.z = h.z + Math.cos(h.yaw) * 0.45;
        b.y = 0.15 + bounce * 0.75;
        b.vx = h.vx;
        b.vz = h.vz;
        b.vy = 0;
      }
      return;
    }
    const f = this.flight;
    if (b.state === 'air' && f) {
      f.t -= SIM_DT;
      const k = 1 - Math.max(0, f.t) / f.T;
      b.x = f.x0 + (f.x1 - f.x0) * k;
      b.z = f.z0 + (f.z1 - f.z0) * k;
      b.y = f.y0 + (f.y1 - f.y0) * k + Math.sin(k * Math.PI) * (f.to ? 0.3 : 2.4);
      b.sx = 8;
      if (f.t > 0) return;
      this.flight = null;
      if (f.to !== null) {
        const r = s.players.find(p => p.id === f.to);
        if (r) {
          r.hasBall = true;
          b.holder = r.id;
          b.state = 'held';
        }
        return;
      }
      const shooter = s.players.find(p => p.id === b.shooter);
      if (f.make && shooter) {
        ev.push({ type: 'net' });
        ev.push({
          type: 'score',
          team: shooter.team,
          id: shooter.id,
          points: b.value,
          how: 'swish',
        });
        s.score[shooter.team] += b.value;
        const t = this.config.target;
        const [a, c] = s.score;
        const lead = Math.abs(a - c);
        if (Math.max(a, c) >= t && (!this.config.winBy2 || lead >= 2)) {
          s.phase = 'final';
          const winner: TeamId = a > c ? 0 : 1;
          ev.push({ type: 'final', winner, score: [a, c] });
          b.state = 'dead';
          return;
        }
        s.phase = 'scored';
        s.phaseT = 1;
        // Make-it-take-it off: the other team checks it
        this.giveBall(shooter.team === 0 ? 1 : 0);
        ev.push({ type: 'checkball', team: s.offense });
      } else {
        ev.push({ type: 'rim', strength: 0.6 });
        if (shooter) ev.push({ type: 'miss', id: shooter.id });
        b.state = 'loose';
        b.vx = (this.rand() - 0.5) * 4;
        b.vz = -Math.sign(f.z1) * 3;
        b.vy = 2;
      }
      return;
    }
    if (b.state === 'loose') {
      b.vy -= 9.8 * SIM_DT;
      b.x += b.vx * SIM_DT;
      b.y += b.vy * SIM_DT;
      b.z += b.vz * SIM_DT;
      if (b.y < 0.12) {
        b.y = 0.12;
        b.vy = Math.abs(b.vy) * 0.6;
        b.vx *= 0.8;
        b.vz *= 0.8;
      }
      b.x = Math.max(-13, Math.min(13, b.x));
      b.z = Math.max(-12, Math.min(12, b.z));
      for (const p of s.players) {
        if (Math.hypot(p.x - b.x, p.z - b.z) < 0.8 && b.y < 2) {
          const offensive = p.team === s.offense;
          ev.push({ type: 'rebound', id: p.id, offensive });
          p.hasBall = true;
          b.holder = p.id;
          b.state = 'held';
          s.offense = p.team;
          s.shotClock = this.config.shotClock;
          break;
        }
      }
    }
  }
}

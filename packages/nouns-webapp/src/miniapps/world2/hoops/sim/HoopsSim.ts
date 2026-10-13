// ── Noun Hoops: the game itself ──────────────────────────────────────────
//
// Fixed-step, deterministic arcade basketball. Everything lives in two plain
// JSON blobs: the public SimState (what the view draws) and SimInternal
// (timers, PRNG, bot brains), which rides along in SimState.sim so a
// snapshot resumes bit-exactly.
//
// Step order: inputs (humans from the map, bots think) → phase clock →
// players (actions, then movement) → body collisions → ball (held / flight,
// catches, blocks, scoring) → rules (clock, bounds, clears, watchdogs).

import type { BallBody } from './ball';
import type { Brain, PassInt, PInt, Ratings, ShotInt, ShotKind, SimInternal } from './types';

import {
  type BallerInput,
  type BallerStats,
  type DunkStyle,
  type GameConfig,
  type HoopsSimApi,
  NO_INPUT,
  SHOT_SWEET,
  type ShotRelease,
  SIM_DT,
  type SimState,
  type TeamId,
} from '../contract';

import { GRAVITY, newContacts, resetContacts, stepBall } from './ball';
import { botInput, type BotWorld } from './bots';
import { attackRim, type CourtGeo, inBounds, isThree, makeGeo, rimDist, type Vec3 } from './court';
import { gauss, hashSeed, rand } from './rng';
import { backspin, predict, solveAim } from './shot';

const DT = SIM_DT;

/** Tuning (exported for the bots and tests). */
export const HOOPS = {
  playerRadius: 0.38,
  run: 5.4,
  sprint: 7.4,
  accel: 30,
  decel: 36,
  turnRate: 16,
  /** Seconds for the shot meter to run 0 → 1. */
  meterTime: 0.85,
  perfectWindow: 0.035,
  goodWindow: 0.1,
  /** Pump fake: let go before the meter reaches this. */
  pumpFake: 0.2,
  /** Standing hand reach (feet to fingertips, arms up). */
  reach: 2.45,
  releaseHeight: 2.3,
  pregame: 2.0,
  checkball: 0.9,
  scoredPause: 1.8,
  turnoverPause: 1.4,
  heldLimit: 10,
  looseLimit: 10,
} as const;

const SCRIPTED = new Set(['dunk', 'layup', 'alleyoop']);
const AIR_ACTS = new Set(['block', 'rebound', 'jumpshot']);

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Deep copy of plain JSON data (fast path for our own state). */
export function clonePlain<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clonePlain(v[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in v) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = clonePlain(x);
  }
  return out as T;
}

function piecewise(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}

const JUMPER_BASE: [number, number][] = [
  [0, 0.66],
  [2, 0.6],
  [4.5, 0.5],
  [6.75, 0.42],
  [8, 0.32],
  [10, 0.12],
  [13, 0.03],
];

function emptyStats(): BallerStats {
  return {
    pts: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    reb: 0,
    oreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    dunks: 0,
    tov: 0,
  };
}

function newBrain(): Brain {
  return {
    next: 0,
    react: 0.25,
    intent: 'idle',
    tx: 0,
    tz: 0,
    sprint: false,
    spot: -1,
    jumpAt: -1,
    stealAt: -1,
    shootAt: -1,
    passAt: -1,
    moveAt: -1,
    passTo: '',
    alley: false,
    release: SHOT_SWEET,
    holdShoot: false,
    until: 0,
    nextCut: 3,
    stuckT: 0,
    lx: 0,
    lz: 0,
    sideT: 0,
    side: 1,
    sawShot: '',
    callUntil: 0,
    gap: -1,
  };
}

export class HoopsSim implements HoopsSimApi {
  readonly config: GameConfig;
  readonly geo: CourtGeo;
  private s!: SimState;
  private I!: SimInternal;
  private stats!: Record<string, BallerStats>;
  private readonly idx = new Map<string, number>();
  private readonly contacts = newContacts();
  private readonly world: BotWorld;
  private readonly difficulty: 1 | 2 | 3;

  constructor(config: GameConfig) {
    this.config = config;
    this.geo = makeGeo(config.court);
    this.difficulty = config.difficulty ?? 2;
    config.players.forEach((p, i) => this.idx.set(p.id, i));
    this.reset();
    this.world = {
      sim: this,
      cfg: config,
      geo: this.geo,
      difficulty: this.difficulty,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────

  state(): SimState {
    const out = clonePlain(this.s);
    out.stats = clonePlain(this.stats);
    out.mustClear = this.config.halfCourt && !this.I.cleared;
    out.sim = clonePlain(this.I);
    return out;
  }

  load(state: SimState): void {
    const s = clonePlain(state);
    const raw = s.sim as Partial<SimInternal> | undefined;
    delete s.sim;
    this.stats = s.stats !== undefined ? s.stats : this.freshStats();
    delete s.stats;
    delete s.mustClear;
    this.s = s;
    if (
      raw !== undefined &&
      raw !== null &&
      raw.v === 1 &&
      raw.players?.length === s.players.length
    ) {
      this.I = raw as SimInternal;
    } else {
      // A snapshot without internals: rebuild them around the public state.
      const I = this.freshInternal();
      I.rng = hashSeed(this.config.seed, `load:${s.tick}`);
      I.cleared = state.mustClear !== true;
      I.lastTouch = s.offense;
      I.holdBy = s.ball.holder ?? '';
      I.nextTeam = s.offense;
      for (let i = 0; i < s.players.length; i++) {
        const p = s.players[i];
        const q = I.players[i];
        q.act = p.action;
        q.onFire = p.onFire;
        q.stamina = p.stamina;
        if (p.meter !== undefined) q.meter = p.meter;
      }
      this.I = I;
    }
  }

  /** Advance one fixed step. */
  step(inputs: Record<string, BallerInput>): SimState {
    const s = this.s;
    s.events = [];
    s.tick++;
    if (s.phase !== 'pregame') s.time += DT;
    const n = s.players.length;
    const ins: BallerInput[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.config.players[i];
      ins.push(b.bot ? botInput(this.world, i) : (inputs[b.id] ?? NO_INPUT));
    }
    this.phaseClock();
    for (let i = 0; i < n; i++) this.updatePlayer(i, ins[i]);
    this.collidePlayers();
    this.updateBall();
    if (s.phase === 'live') this.rules();
    this.publish();
    return this.state();
  }

  // ── Read-only helpers (bots, tests) ─────────────────────────────────

  /** Live public state (no copy; don't mutate). */
  get live(): SimState {
    return this.s;
  }

  /** Live internals (no copy; don't mutate). */
  get internal(): SimInternal {
    return this.I;
  }

  get boxScore(): Record<string, BallerStats> {
    return this.stats;
  }

  rand(): number {
    return rand(this.I);
  }

  gauss(): number {
    return gauss(this.I);
  }

  rimOf(team: TeamId): 0 | 1 {
    return attackRim(team, this.config.halfCourt);
  }

  rimPos(team: TeamId): Vec3 {
    return this.geo.rims[this.rimOf(team)];
  }

  distToRim(i: number): number {
    const p = this.s.players[i];
    return rimDist(this.geo, this.rimOf(p.team), p.x, p.z);
  }

  indexOf(id: string): number {
    return this.idx.get(id) ?? -1;
  }

  holderIndex(): number {
    const b = this.s.ball;
    if (b.state !== 'held' || b.holder === null) return -1;
    return this.indexOf(b.holder);
  }

  /** Nearest opponent to player i: [index, distance]. */
  nearestOpp(i: number): [number, number] {
    const p = this.s.players[i];
    let best = -1;
    let bd = 1e9;
    for (let j = 0; j < this.s.players.length; j++) {
      const o = this.s.players[j];
      if (o.team === p.team) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return [best, bd];
  }

  /** Smallest distance from any opponent of `team` to the segment a → b. */
  laneClearance(team: TeamId, ax: number, az: number, bx: number, bz: number, skip = -1): number {
    let best = 1e9;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = Math.max(1e-6, dx * dx + dz * dz);
    for (let j = 0; j < this.s.players.length; j++) {
      const o = this.s.players[j];
      if (o.team === team || j === skip) continue;
      const t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / l2, 0, 1);
      const d = Math.hypot(ax + dx * t - o.x, az + dz * t - o.z);
      if (d < best) best = d;
    }
    return best;
  }

  /** Pass target scoring: best-placed teammate of the holder i (or -1). */
  bestTeammate(i: number): number {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    let best = -1;
    let bs = -1e9;
    for (let j = 0; j < s.players.length; j++) {
      if (j === i) continue;
      const m = s.players[j];
      const mq = this.I.players[j];
      if (m.team !== p.team || mq.act === 'stumble' || SCRIPTED.has(mq.act)) continue;
      let open = 4;
      for (let k = 0; k < s.players.length; k++) {
        const o = s.players[k];
        if (o.team === p.team) continue;
        open = Math.min(open, Math.hypot(o.x - m.x, o.z - m.z));
      }
      const lane = this.laneClearance(p.team, p.x, p.z, m.x, m.z);
      const dRim = this.distToRim(j);
      const dist = Math.hypot(m.x - p.x, m.z - p.z);
      let score = open * 0.8 - (lane < 0.9 ? (0.9 - lane) * 3 : 0) - dRim * 0.12;
      if (mq.calling) score += 2.5;
      if (dist > 12) score -= 1;
      if (dist < 1.5) score -= 2;
      if (this.config.halfCourt && !this.I.cleared && dRim > this.geo.spec.threeRadius)
        score += 1.5;
      // Prefer targets in front of the passer.
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      if (((m.x - p.x) * fx + (m.z - p.z) * fz) / Math.max(1e-6, dist) < -0.3) score -= 0.5;
      if (score > bs) {
        bs = score;
        best = j;
      }
    }
    void q;
    return best;
  }

  /**
   * Expected make chance of a jumper by player i from where he stands, with
   * an average release, normalised by value (1 = an open-ish two's worth).
   * The bots use it for shot selection.
   */
  shotWorth(i: number): number {
    const p = this.s.players[i];
    const q = this.I.players[i];
    const d = this.distToRim(i);
    const three = isThree(this.geo, this.rimOf(p.team), p.x, p.z);
    let prob =
      piecewise(JUMPER_BASE, d) + 0.08 + (q.rate.shooting - 0.6) * 0.3 + (q.onFire ? 0.18 : 0);
    prob *= 1 - 0.5 * this.contest(i);
    return (clamp(prob, 0.02, 0.97) * this.shotValue(three)) / this.shotValue(false);
  }

  /** Is player i in the air / mid scripted move. */
  busy(i: number): boolean {
    return SCRIPTED.has(this.I.players[i].act);
  }

  // ── Setup ────────────────────────────────────────────────────────────

  private freshStats(): Record<string, BallerStats> {
    const st: Record<string, BallerStats> = {};
    for (const p of this.config.players) st[p.id] = emptyStats();
    return st;
  }

  private ratingsFor(i: number, h: { rng: number }): Ratings {
    const b = this.config.players[i];
    const r = b.ratings ?? {};
    const pick = (k: keyof Ratings): number => {
      const v = r[k];
      if (v !== undefined) return clamp(v, 0, 1);
      return b.bot ? 0.4 + 0.45 * rand(h) : 0.6;
    };
    return {
      speed: pick('speed'),
      shooting: pick('shooting'),
      dunking: pick('dunking'),
      defense: pick('defense'),
      passing: pick('passing'),
    };
  }

  private freshInternal(): SimInternal {
    const cfg = this.config;
    const players: PInt[] = cfg.players.map((b, i) => {
      const h = { rng: hashSeed(cfg.seed, `rate:${b.id}`) };
      const rate = this.ratingsFor(i, h);
      const brain = newBrain();
      const d = this.difficulty;
      brain.react = [0.34, 0.24, 0.15][d - 1] + (1 - rate.defense) * 0.08 + 0.05 * rand(h);
      brain.nextCut = 2 + 5 * rand(h);
      return {
        id: b.id,
        rate,
        act: 'idle',
        at: 0,
        dur: 0,
        jt: 0,
        jdur: 0,
        jh: 0,
        jhang: false,
        btn: 0,
        cdMove: 0,
        cdSteal: 0,
        cdCatch: 0,
        cdJump: 0,
        hand: 1,
        drib: 0,
        gather: 0,
        meter: 0,
        streak: 0,
        onFire: false,
        stamina: 1,
        calling: false,
        mx0: 0,
        mz0: 0,
        mx1: 0,
        mz1: 0,
        slamAt: 0,
        slammed: false,
        style: '',
        oopCaught: false,
        sx: 0,
        sz: 0,
        mark: -1,
        brain,
      };
    });
    // Man-to-man marks by roster order.
    const t0: number[] = [];
    const t1: number[] = [];
    cfg.players.forEach((p, i) => (p.team === 0 ? t0 : t1).push(i));
    t0.forEach((i, k) => {
      if (t1.length > 0) players[i].mark = t1[k % t1.length];
    });
    t1.forEach((i, k) => {
      if (t0.length > 0) players[i].mark = t0[k % t0.length];
    });
    const seeded = { rng: hashSeed(cfg.seed, 'hoops') };
    for (let k = 0; k < 4; k++) rand(seeded);
    return {
      v: 1,
      rng: seeded.rng,
      cleared: true,
      lastTouch: 0,
      heldT: 0,
      holdBy: '',
      looseT: 0,
      stuckBallT: 0,
      pass: null,
      shot: null,
      assistFrom: '',
      assistT: -99,
      nextTeam: 0,
      players,
    };
  }

  private reset(): void {
    const cfg = this.config;
    this.I = this.freshInternal();
    this.stats = this.freshStats();
    const r = cfg.court.ballRadius;
    this.s = {
      tick: 0,
      time: 0,
      phase: 'pregame',
      phaseT: HOOPS.pregame,
      score: [0, 0],
      offense: 0,
      shotClock: cfg.shotClock,
      players: cfg.players.map(b => ({
        id: b.id,
        team: b.team,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        vx: 0,
        vz: 0,
        action: 'idle',
        actionT: 0,
        hasBall: false,
        onFire: false,
        stamina: 1,
      })),
      ball: {
        x: 0,
        y: r,
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
    const first: TeamId = rand(this.I) < 0.5 ? 0 : 1;
    this.s.offense = first;
    this.I.nextTeam = first;
    this.placeForCheck(first, true);
    this.publish();
  }

  // ── Phases ───────────────────────────────────────────────────────────

  private phaseClock(): void {
    const s = this.s;
    if (s.phase === 'live') return;
    s.phaseT = Math.max(0, s.phaseT - DT);
    if (s.phaseT > 0) return;
    if (s.phase === 'pregame' || s.phase === 'scored' || s.phase === 'turnover') {
      this.enterCheck(this.I.nextTeam);
    } else if (s.phase === 'checkball') {
      s.phase = 'live';
    }
  }

  /** The baller who checks the ball for `team`: a human if there is one, else the best passer. */
  private checker(team: TeamId): number {
    let best = -1;
    let bs = -1;
    for (let i = 0; i < this.s.players.length; i++) {
      if (this.s.players[i].team !== team) continue;
      const human = !this.config.players[i].bot;
      const sc = (human ? 10 : 0) + this.I.players[i].rate.passing;
      if (sc > bs) {
        bs = sc;
        best = i;
      }
    }
    return best;
  }

  /** Check-ball spots (x, z, yaw) for everyone, offense `team` checking. */
  private spots(team: TeamId): { x: number; z: number; yaw: number }[] {
    const s = this.s;
    const geo = this.geo;
    const a = this.rimOf(team);
    const rim = geo.rims[a];
    const sg = geo.sign[a];
    const out = s.players.map(() => ({ x: 0, z: 0, yaw: 0 }));
    const chk = this.checker(team);
    const off: number[] = chk >= 0 ? [chk] : [];
    s.players.forEach((p, i) => {
      if (p.team === team && i !== chk) off.push(i);
    });
    const half: [number, number][] = [
      [0, 8.0],
      [-5.6, 4.6],
      [5.6, 4.6],
      [-7.1, 0.9],
      [7.1, 0.9],
    ];
    const full: [number, number][] = [
      [0, -6.5],
      [-5, -2],
      [5, -2],
      [-6, 2.5],
      [6, 2.5],
    ];
    off.forEach((i, k) => {
      let x: number;
      let z: number;
      if (this.config.halfCourt) {
        const [dx, dOut] = half[k % half.length];
        x = rim.x + dx;
        z = rim.z - sg * dOut;
      } else {
        const [dx, dz] = full[k % full.length];
        x = dx;
        z = sg * dz;
      }
      out[i] = { x, z, yaw: Math.atan2(rim.x - x, rim.z - z) };
    });
    s.players.forEach((p, i) => {
      if (p.team === team) return;
      const m = this.I.players[i].mark;
      const man = m >= 0 ? out[m] : { x: rim.x, z: rim.z - sg * 3, yaw: 0 };
      const dx = rim.x - man.x;
      const dz = rim.z - man.z;
      const l = Math.max(1e-6, Math.hypot(dx, dz));
      const gap = this.config.halfCourt ? (m === chk ? 1.5 : 1.4) : 3.2;
      const x = man.x + (dx / l) * gap;
      const z = man.z + (dz / l) * gap;
      out[i] = { x, z, yaw: Math.atan2(man.x - x, man.z - z) };
    });
    return out;
  }

  /** Put everyone on their check spots (snap) and give the checker the ball. */
  private placeForCheck(team: TeamId, snap: boolean): void {
    const s = this.s;
    const sp = this.spots(team);
    s.players.forEach((p, i) => {
      const q = this.I.players[i];
      if (snap) {
        p.x = sp[i].x;
        p.z = sp[i].z;
      }
      p.yaw = sp[i].yaw;
      p.vx = 0;
      p.vz = 0;
      p.y = 0;
      q.act = 'idle';
      q.at = 0;
      q.dur = 0;
      q.jdur = 0;
      q.jt = 0;
      q.meter = 0;
      q.gather = 0;
      q.slammed = false;
      q.style = '';
      q.btn = 0;
      q.sx = sp[i].x;
      q.sz = sp[i].z;
      q.brain.next = s.time + q.brain.react;
      q.brain.jumpAt = -1;
      q.brain.stealAt = -1;
      q.brain.shootAt = -1;
      q.brain.passAt = -1;
      q.brain.moveAt = -1;
      q.brain.intent = 'idle';
    });
    const chk = this.checker(team);
    const b = s.ball;
    if (chk >= 0) {
      b.state = 'held';
      b.holder = s.players[chk].id;
      this.I.holdBy = b.holder;
    }
    b.shooter = null;
    b.value = 0;
    this.I.shot = null;
    this.I.pass = null;
    this.I.heldT = 0;
    this.I.looseT = 0;
    this.I.lastTouch = team;
    this.I.assistFrom = '';
    s.offense = team;
  }

  private enterCheck(team: TeamId): void {
    const s = this.s;
    s.phase = 'checkball';
    s.phaseT = HOOPS.checkball;
    s.shotClock = this.config.shotClock;
    this.I.cleared = true;
    this.placeForCheck(team, true);
    s.events.push({ type: 'checkball', team });
  }

  /** Dead ball: pause, then the other side checks. */
  private enterPause(phase: 'scored' | 'turnover', nextTeam: TeamId): void {
    const s = this.s;
    s.phase = phase;
    s.phaseT = phase === 'scored' ? HOOPS.scoredPause : HOOPS.turnoverPause;
    this.I.nextTeam = nextTeam;
    const b = s.ball;
    if (b.state === 'held') {
      const h = this.holderIndex();
      if (h >= 0) {
        b.vx = s.players[h].vx * 0.4;
        b.vz = s.players[h].vz * 0.4;
        b.vy = 0;
      }
    }
    b.state = 'dead';
    b.holder = null;
    b.shooter = null;
    b.value = 0;
    this.I.pass = null;
    if (this.I.shot !== null) this.I.shot.live = false;
    const sp = this.spots(nextTeam);
    s.players.forEach((_p, i) => {
      const q = this.I.players[i];
      q.sx = sp[i].x;
      q.sz = sp[i].z;
      q.meter = 0;
      if (q.act === 'gather') q.act = 'idle';
    });
  }

  private turnover(loser: TeamId): void {
    if (this.s.phase !== 'live') return;
    const id = this.I.holdBy;
    if (id !== '') {
      const st = this.stats[id];
      if (st !== undefined && this.s.players[this.indexOf(id)]?.team === loser) st.tov++;
    }
    this.enterPause('turnover', loser === 0 ? 1 : 0);
  }

  private changePossession(team: TeamId): void {
    const s = this.s;
    if (s.offense === team) return;
    s.offense = team;
    this.I.cleared = !this.config.halfCourt;
    s.shotClock = this.config.shotClock;
    this.I.assistFrom = '';
  }

  // ── Players ──────────────────────────────────────────────────────────

  private updatePlayer(i: number, input: BallerInput): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    q.cdMove = Math.max(0, q.cdMove - DT);
    q.cdSteal = Math.max(0, q.cdSteal - DT);
    q.cdCatch = Math.max(0, q.cdCatch - DT);
    q.cdJump = Math.max(0, q.cdJump - DT);
    q.at += DT;
    const lvl = (input.shoot ? 1 : 0) | (input.pass ? 2 : 0) | (input.move ? 4 : 0);
    const press = lvl & ~q.btn;
    q.btn = lvl;
    q.calling = input.call;

    if (s.phase !== 'live') {
      this.pauseMove(i);
      this.jumpTick(i);
      this.faceTick(i);
      return;
    }

    const holding = s.ball.state === 'held' && s.ball.holder === p.id;
    const shootPress = (press & 1) !== 0;
    const passPress = (press & 2) !== 0;
    const movePress = (press & 4) !== 0;

    if (SCRIPTED.has(q.act)) {
      this.scripted(i);
    } else {
      if (q.dur > 0 && q.at >= q.dur && !AIR_ACTS.has(q.act) && q.act !== 'gather') {
        q.act = 'idle';
        q.dur = 0;
      }
      if (holding) {
        if (q.act === 'gather') {
          this.gatherTick(i, input, passPress);
        } else if (q.act !== 'stumble' && q.act !== 'pass' && q.act !== 'jumpshot') {
          if (passPress) {
            if (input.shoot) this.alleyOop(i);
            else this.pass(i, input.passTo);
          } else if (shootPress) {
            if (input.pass) this.alleyOop(i);
            else this.startShot(i);
          } else if (movePress && q.cdMove <= 0) {
            this.ballMove(i);
          }
        }
      } else if (q.act !== 'stumble') {
        if (q.act === 'gather') {
          // Lost the ball mid-gather.
          q.act = 'idle';
          q.meter = 0;
          this.landFrom(i);
        }
        const grounded = p.y < 0.02 && q.jdur === 0;
        if (shootPress && grounded && q.cdJump <= 0) this.jump(i);
        if (movePress && q.cdSteal <= 0 && p.team !== s.offense) this.stealAttempt(i);
        if (passPress && p.team !== s.offense) this.switchMark(i);
      }
      this.move(i, input, holding);
    }
    this.jumpTick(i);
    this.faceTick(i);
  }

  /** Scored / turnover / pregame: everyone jogs to their check spot. */
  private pauseMove(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    if (s.phase === 'checkball') {
      p.vx = 0;
      p.vz = 0;
      return;
    }
    if (s.phase === 'final') {
      p.vx *= 0.9;
      p.vz *= 0.9;
      p.x += p.vx * DT;
      p.z += p.vz * DT;
      return;
    }
    if (q.act === 'stumble' || SCRIPTED.has(q.act)) {
      if (SCRIPTED.has(q.act)) this.scripted(i);
      else if (q.at >= q.dur) q.act = 'idle';
      if (q.act === 'stumble') {
        p.vx *= 0.9;
        p.vz *= 0.9;
        p.x += p.vx * DT;
        p.z += p.vz * DT;
        return;
      }
      if (SCRIPTED.has(q.act)) return;
    }
    if (q.act !== 'celebrate' && q.act !== 'dejected' && q.dur > 0 && q.at >= q.dur) {
      q.act = 'idle';
      q.dur = 0;
    }
    const dx = q.sx - p.x;
    const dz = q.sz - p.z;
    const d = Math.hypot(dx, dz);
    const vmax = d > 0.15 ? Math.min(HOOPS.run, d * 3) : 0;
    const tx = d > 1e-6 ? (dx / d) * vmax : 0;
    const tz = d > 1e-6 ? (dz / d) * vmax : 0;
    this.accelerate(p, tx, tz, HOOPS.accel);
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    q.stamina = Math.min(1, q.stamina + 0.25 * DT);
  }

  private accelerate(p: { vx: number; vz: number }, tx: number, tz: number, accel: number): void {
    let ax = tx - p.vx;
    let az = tz - p.vz;
    const l = Math.hypot(ax, az);
    let a = accel;
    if (tx * p.vx + tz * p.vz < 0) a *= 1.5;
    const m = a * DT;
    if (l > m) {
      ax *= m / l;
      az *= m / l;
    }
    p.vx += ax;
    p.vz += az;
  }

  private move(i: number, input: BallerInput, holding: boolean): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const airborne = p.y > 0.05 || q.jdur > 0;
    if (airborne && q.jt >= 0) {
      // No control in the air: carry momentum.
      p.vx *= 0.995;
      p.vz *= 0.995;
    } else {
      let mx = input.moveX;
      let mz = input.moveZ;
      const mag = Math.hypot(mx, mz);
      if (mag > 1) {
        mx /= mag;
        mz /= mag;
      }
      let f = 1;
      if (q.act === 'gather' || q.act === 'jumpshot') f = 0;
      else if (q.act === 'pass') f = 0.6;
      else if (q.act === 'steal') f = 0.55;
      else if (q.act === 'stumble') f = 0.18;
      else if (q.act === 'crossover' || q.act === 'spin') f = 1.18;
      const sprint = input.sprint && q.stamina > 0.04 && mag > 0.1;
      const vmax =
        (sprint ? HOOPS.sprint : HOOPS.run) *
        (0.86 + 0.28 * q.rate.speed) *
        (holding ? 0.93 : 1) *
        (q.onFire ? 1.06 : 1) *
        f;
      const accel = mag > 0.05 && f > 0 ? HOOPS.accel : HOOPS.decel;
      this.accelerate(p, mx * vmax, mz * vmax, accel);
      const sp = Math.hypot(p.vx, p.vz);
      if (sprint && sp > 2) q.stamina = Math.max(0, q.stamina - 0.2 * DT * (q.onFire ? 0.5 : 1));
      else q.stamina = Math.min(1, q.stamina + (sp < 1 ? 0.18 : 0.1) * DT);
      if (
        !SCRIPTED.has(q.act) &&
        !AIR_ACTS.has(q.act) &&
        q.act !== 'gather' &&
        (q.dur === 0 || q.at >= q.dur)
      ) {
        q.dur = 0;
        if (holding) q.act = 'dribble';
        else if (p.team !== s.offense && sp < 3.5 && s.ball.state === 'held') q.act = 'defend';
        else q.act = sp > 0.4 ? 'run' : 'idle';
      }
    }
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    if (!holding) {
      const g = this.geo;
      p.x = clamp(p.x, -g.halfW - 0.8, g.halfW + 0.8);
      p.z = clamp(p.z, this.config.halfCourt ? -1.5 : -g.halfL - 0.8, g.halfL + 0.8);
    }
  }

  private jumpTick(i: number): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    if (q.act === 'gather') return;
    if (q.jdur <= 0) {
      if (p.y > 0) p.y = Math.max(0, p.y - 6 * DT);
      if (AIR_ACTS.has(q.act) && q.at >= q.dur && p.y === 0) {
        q.act = 'idle';
        q.dur = 0;
      }
      return;
    }
    q.jt += DT;
    if (q.jt < 0) {
      p.y = 0;
      return;
    }
    const t = q.jt / q.jdur;
    if (t >= 1) {
      p.y = 0;
      q.jdur = 0;
      q.jt = 0;
      if (AIR_ACTS.has(q.act)) {
        q.act = 'idle';
        q.dur = 0;
      }
      return;
    }
    const u = 2 * t - 1;
    p.y = q.jh * (q.jhang ? 1 - Math.abs(u * u * u) : 1 - u * u);
  }

  private faceTick(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    let target: number | null = null;
    const rim = this.rimPos(p.team);
    const sp = Math.hypot(p.vx, p.vz);
    const holding = s.ball.holder === p.id;
    if (SCRIPTED.has(q.act) || q.act === 'gather' || q.act === 'jumpshot') {
      target = Math.atan2(rim.x - p.x, rim.z - p.z);
    } else if (q.act === 'celebrate' || q.act === 'dejected') {
      target = null;
    } else if (holding && sp < 0.8) {
      target = Math.atan2(rim.x - p.x, rim.z - p.z);
    } else if (p.team !== s.offense && sp < 3.5 && s.phase === 'live') {
      // Defenders auto-face their man (or the ball handler they're on).
      const h = this.holderIndex();
      let m = q.mark;
      if (h >= 0 && s.players[h].team !== p.team) {
        const hp = s.players[h];
        if (Math.hypot(hp.x - p.x, hp.z - p.z) < 2.5) m = h;
      }
      if (m >= 0) {
        const o = s.players[m];
        target = Math.atan2(o.x - p.x, o.z - p.z);
      }
    } else if (sp > 0.4) {
      target = Math.atan2(p.vx, p.vz);
    }
    if (target === null) return;
    const d = wrapAngle(target - p.yaw);
    const m = HOOPS.turnRate * DT;
    p.yaw = wrapAngle(p.yaw + clamp(d, -m, m));
  }

  private collidePlayers(): void {
    const ps = this.s.players;
    const n = ps.length;
    const R2 = HOOPS.playerRadius * 2;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const a = ps[i];
        if (a.y > 0.35 || this.busy(i)) continue;
        for (let j = i + 1; j < n; j++) {
          const b = ps[j];
          if (b.y > 0.35 || this.busy(j)) continue;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          if (d >= R2) continue;
          if (d < 1e-6) {
            dx = 1;
            dz = 0;
            d = 1e-6;
          }
          const nx = dx / d;
          const nz = dz / d;
          const push = (R2 - d) / 2;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
          if (pass === 0) {
            const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
            if (vn < 0) {
              a.vx += nx * vn * 0.5;
              a.vz += nz * vn * 0.5;
              b.vx -= nx * vn * 0.5;
              b.vz -= nz * vn * 0.5;
            }
          }
        }
      }
    }
  }

  // ── Offense actions ──────────────────────────────────────────────────

  private setAct(i: number, act: PInt['act'], dur: number): void {
    const q = this.I.players[i];
    q.act = act;
    q.at = 0;
    q.dur = dur;
  }

  private dirToRim(i: number): [number, number, number] {
    const p = this.s.players[i];
    const rim = this.rimPos(p.team);
    const dx = rim.x - p.x;
    const dz = rim.z - p.z;
    const d = Math.max(1e-6, Math.hypot(dx, dz));
    return [dx / d, dz / d, d];
  }

  private shotValue(three: boolean): number {
    if (this.config.nbaScoring) return three ? 3 : 2;
    return three ? 2 : 1;
  }

  /** How contested a shot by player i is right now (0 open … 1 smothered). */
  contest(i: number): number {
    const s = this.s;
    const p = s.players[i];
    const [ux, uz] = this.dirToRim(i);
    let c = 0;
    for (let j = 0; j < s.players.length; j++) {
      const o = s.players[j];
      if (o.team === p.team) continue;
      const oq = this.I.players[j];
      if (oq.act === 'stumble') continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.1) continue;
      let cj = clamp((2.1 - d) / 1.4, 0, 1);
      if ((dx * ux + dz * uz) / Math.max(1e-6, d) < -0.3) cj *= 0.5;
      if (o.y > 0.15 || oq.act === 'block') cj *= 1.3;
      cj *= 0.8 + 0.4 * oq.rate.defense;
      c = Math.max(c, cj);
    }
    return clamp(c, 0, 1);
  }

  private startShot(i: number): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    const [ux, uz, d] = this.dirToRim(i);
    const sp = Math.hypot(p.vx, p.vz);
    const toward = sp > 1e-6 ? (p.vx * ux + p.vz * uz) / sp : 0;
    const dunkR = 1.2 + 3.0 * q.rate.dunking + (q.onFire ? 1.2 : 0);
    const canDunk = q.rate.dunking >= 0.3 || q.onFire;
    if (canDunk && sp > 3 && toward > 0.55 && d < dunkR && d > 0.6) {
      this.startDunk(i);
    } else if (d < 1.7 && (q.rate.dunking >= 0.55 || q.onFire)) {
      this.startDunk(i);
    } else if (d < 2.3 || (d < 4.3 && sp > 2.6 && toward > 0.45)) {
      this.startLayup(i);
    } else {
      this.setAct(i, 'gather', 0);
      q.gather = 0;
      q.meter = 0;
      q.jdur = 0;
      q.jh = 0.45 + 0.25 * q.rate.speed;
    }
  }

  private gatherTick(i: number, input: BallerInput, passPress: boolean): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    q.gather += DT;
    q.meter = Math.min(1, q.meter + DT / HOOPS.meterTime);
    const m = q.meter;
    const k = clamp((m - 0.15) / (SHOT_SWEET - 0.15), 0, 1);
    p.y =
      m <= SHOT_SWEET
        ? q.jh * Math.sin((Math.PI / 2) * k)
        : q.jh * (1 - 0.5 * ((m - SHOT_SWEET) / (1 - SHOT_SWEET)) ** 2);
    if (passPress) {
      q.meter = 0;
      if (q.gather < 0.2 && input.shoot) this.alleyOop(i);
      else this.pass(i, input.passTo);
      this.landFrom(i);
      return;
    }
    if (!input.shoot) {
      if (m < HOOPS.pumpFake) {
        // Pump fake.
        q.act = 'idle';
        q.dur = 0;
        q.meter = 0;
        p.y = 0;
        return;
      }
      this.releaseJumper(i);
    } else if (m >= 1) {
      this.releaseJumper(i);
    }
  }

  /** From the current height, fall back down (jump shot follow-through). */
  private landFrom(i: number): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    if (p.y <= 0.02) {
      p.y = 0;
      q.jdur = 0;
      return;
    }
    q.jh = p.y;
    q.jdur = 2 * Math.sqrt((2 * p.y) / 12);
    q.jt = q.jdur / 2;
    q.jhang = false;
  }

  private releaseJumper(i: number): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    const [ux, uz, d] = this.dirToRim(i);
    const err = q.meter - SHOT_SWEET;
    const aerr = Math.abs(err);
    let release: ShotRelease;
    if (aerr <= HOOPS.perfectWindow) release = 'perfect';
    else if (aerr <= HOOPS.goodWindow) release = 'good';
    else release = err < 0 ? 'early' : 'late';
    const tq =
      aerr <= HOOPS.perfectWindow ? 1 : clamp(1 - (aerr - HOOPS.perfectWindow) / 0.25, 0, 1);
    const contest = this.contest(i);
    const rimIdx = this.rimOf(p.team);
    const three = isThree(this.geo, rimIdx, p.x, p.z);
    let prob = piecewise(JUMPER_BASE, d);
    if (aerr <= HOOPS.perfectWindow) prob += 0.3;
    else if (aerr <= HOOPS.goodWindow)
      prob += 0.12 * (1 - (aerr - HOOPS.perfectWindow) / (HOOPS.goodWindow - HOOPS.perfectWindow));
    else prob -= Math.min(0.35, (aerr - HOOPS.goodWindow) * 4);
    prob += (q.rate.shooting - 0.6) * 0.3 + (q.onFire ? 0.18 : 0);
    prob *= 1 - 0.5 * contest;
    prob = clamp(prob, 0.02, 0.97);
    const green = release === 'perfect' && contest < 0.15 && d <= this.geo.spec.threeRadius + 1.5;
    if (green) prob = 1;
    const from: Vec3 = { x: p.x + ux * 0.25, y: p.y + HOOPS.releaseHeight, z: p.z + uz * 0.25 };
    const elev = d < 3 ? 1.0 : 0.92 - Math.min(0.12, (d - 3) * 0.015);
    // Off the glass from the wings at mid range, sometimes.
    const side = Math.abs(Math.atan2(ux, uz * this.geo.sign[rimIdx]));
    const bank = !green && d > 2.2 && d < 5 && side > 0.45 && side < 1.15 && this.rand() < 0.35;
    q.meter = 0;
    this.setAct(i, 'jumpshot', 0.5);
    this.landFrom(i);
    this.launchShot(i, from, prob, elev, bank, 'jumper', this.shotValue(three), three, green);
    this.s.events.push({
      type: 'shot',
      id: p.id,
      value: this.shotValue(three),
      quality: tq,
      kind: 'jumper',
      release,
      three,
    });
  }

  /**
   * Put the ball in the air toward the rim. The make / miss is rolled from
   * `prob`, then an aim error is picked to match and checked against the
   * real physics, so makes rattle in or swish and misses clank for real.
   */
  private launchShot(
    i: number,
    from: Vec3,
    prob: number,
    elev: number,
    bank: boolean,
    kind: ShotKind,
    value: number,
    three: boolean,
    green: boolean,
  ): void {
    const s = this.s;
    const p = s.players[i];
    const rimIdx = this.rimOf(p.team);
    const rim = this.geo.rims[rimIdx];
    const dx = rim.x - from.x;
    const dz = rim.z - from.z;
    const l = Math.max(1e-6, Math.hypot(dx, dz));
    const ax = dx / l;
    const az = dz / l;
    const make = green || this.rand() < prob;
    const spin = backspin(dx, dz);
    let v: Vec3 | null = null;
    const aim = (along: number, lat: number): Vec3 => ({
      x: rim.x + ax * along + az * lat,
      y: rim.y,
      z: rim.z + az * along - ax * lat,
    });
    // Solve the dead-centre shot once, then warm-start the offset aims from it.
    const centre = solveAim(this.geo, from, aim(0, 0), elev, bank, rimIdx);
    const near = (along: number, lat: number): Vec3 =>
      solveAim(this.geo, from, aim(along, lat), elev, bank, rimIdx, centre.aim, 3).v;
    const tryAim = (along: number, lat: number, wantMake: boolean): Vec3 | null => {
      const vv = near(along, lat);
      const pr = predict(this.geo, from, vv, spin, rimIdx);
      return pr.made === wantMake ? vv : null;
    };
    if (make) {
      if (green) {
        v = centre.v;
      } else {
        for (let k = 0; k < 2 && v === null; k++) {
          const rattle = this.rand() < 0.35;
          const r = rattle ? 0.09 + 0.06 * this.rand() : 0.07 * this.rand();
          const th = this.rand() * Math.PI * 2;
          v = tryAim(Math.cos(th) * r, Math.sin(th) * r, true);
        }
        if (v === null) v = centre.v;
      }
    } else {
      for (let k = 0; k < 3 && v === null; k++) {
        const r = 0.15 + 0.2 * this.rand();
        const th = this.rand() * Math.PI * 2;
        // Misses mostly go long / short (front and back iron).
        const along = Math.cos(th) * r * 1.2;
        const lat = Math.sin(th) * r * 0.7;
        v = tryAim(along, lat, false);
      }
      if (v === null) v = near(0.5, 0.1);
    }
    const b = s.ball;
    b.x = from.x;
    b.y = from.y;
    b.z = from.z;
    b.vx = v.x;
    b.vy = v.y;
    b.vz = v.z;
    b.sx = spin.x;
    b.sy = spin.y;
    b.sz = spin.z;
    b.state = 'air';
    b.holder = null;
    b.shooter = p.id;
    b.value = value;
    this.I.lastTouch = p.team;
    this.I.pass = null;
    this.beginShot(i, kind, value, three);
  }

  private beginShot(i: number, kind: ShotKind, value: number, three: boolean): ShotInt {
    const p = this.s.players[i];
    const q = this.I.players[i];
    q.cdCatch = Math.max(q.cdCatch, 0.4);
    const assist =
      this.I.assistFrom !== '' && this.I.assistFrom !== p.id && this.s.time - this.I.assistT < 4
        ? this.I.assistFrom
        : '';
    const st = this.stats[p.id];
    st.fga++;
    if (three) st.tpa++;
    const shot: ShotInt = {
      by: p.id,
      team: p.team,
      value,
      kind,
      rim: this.rimOf(p.team),
      touchedRim: false,
      touchedBoard: false,
      t: 0,
      live: true,
      rolled: [],
      unclear: this.config.halfCourt && !this.I.cleared,
      three,
      assist,
    };
    this.I.shot = shot;
    return shot;
  }

  private startLayup(i: number): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    const [ux, uz, d] = this.dirToRim(i);
    const rim = this.rimPos(p.team);
    this.setAct(i, 'layup', 0.72);
    q.slamAt = 0.55;
    q.slammed = false;
    q.mx0 = p.x;
    q.mz0 = p.z;
    const glide = Math.min(2.4, Math.max(0, d - 1.0));
    q.mx1 = p.x + ux * glide;
    q.mz1 = p.z + uz * glide;
    void rim;
    q.jdur = 0.72;
    q.jt = 0;
    q.jh = 0.55 + 0.25 * q.rate.dunking;
    q.jhang = false;
  }

  private startDunk(i: number): void {
    const p = this.s.players[i];
    const q = this.I.players[i];
    const [ux, uz, d] = this.dirToRim(i);
    const rim = this.rimPos(p.team);
    const rimIdx = this.rimOf(p.team);
    const sp = Math.hypot(p.vx, p.vz);
    const side = Math.abs(Math.atan2(ux, uz * this.geo.sign[rimIdx]));
    let style: DunkStyle;
    if (side > 1.1) style = 'reverse';
    else if ((q.onFire || q.rate.dunking > 0.75) && d > 3.2 && this.rand() < 0.5) style = '360';
    else if (sp > 5.5 && d > 3) style = this.rand() < 0.5 ? 'windmill' : 'tomahawk';
    else if (sp > 4) style = 'tomahawk';
    else style = 'two-hand';
    const dur = { 'two-hand': 0.75, tomahawk: 0.9, reverse: 0.95, windmill: 1.05, '360': 1.15 }[
      style
    ];
    this.setAct(i, 'dunk', dur);
    q.style = style;
    q.slamAt = 0.66;
    q.slammed = false;
    q.mx0 = p.x;
    q.mz0 = p.z;
    q.mx1 = rim.x - ux * 0.42;
    q.mz1 = rim.z - uz * 0.42;
    q.jdur = dur;
    q.jt = 0;
    q.jh =
      0.95 +
      0.6 * q.rate.dunking +
      (q.onFire ? 0.35 : 0) +
      (style === '360' || style === 'windmill' ? 0.2 : 0);
    q.jhang = true;
    const value = this.shotValue(false);
    this.beginShot(i, 'dunk', value, false);
    this.s.events.push({
      type: 'shot',
      id: p.id,
      value,
      quality: 1,
      kind: 'dunk',
      style,
      three: false,
    });
  }

  /** Scripted glide for layups, dunks and alley-oops. */
  private scripted(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const t = q.dur > 0 ? q.at / q.dur : 1;
    const k = clamp(t / Math.max(0.05, q.slamAt), 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    const nx = lerp(q.mx0, q.mx1, e);
    const nz = lerp(q.mz0, q.mz1, e);
    p.vx = (nx - p.x) / DT;
    p.vz = (nz - p.z) / DT;
    p.x = nx;
    p.z = nz;
    if (t >= 1) {
      p.vx = 0;
      p.vz = 0;
    }
    if (!q.slammed && t >= q.slamAt && s.phase === 'live') {
      q.slammed = true;
      if (q.act === 'layup') this.releaseLayup(i);
      else if (q.act === 'dunk') this.slam(i, 'dunk');
      else if (q.act === 'alleyoop') this.oopArrive(i);
    }
    if (t >= 1) {
      q.act = 'idle';
      q.dur = 0;
      q.style = '';
    }
  }

  /** Opponents in the air near the rim who could swat a finish by i. */
  private rimBlocker(i: number, radius: number, ballY: number): number {
    const s = this.s;
    const p = s.players[i];
    let best = -1;
    let bd = radius;
    for (let j = 0; j < s.players.length; j++) {
      const o = s.players[j];
      if (o.team === p.team || o.y < 0.25) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      // Has to be up at the ball and between the finisher and the rim.
      const rim = this.rimPos(p.team);
      const front = (o.x - p.x) * (rim.x - p.x) + (o.z - p.z) * (rim.z - p.z) > -0.2;
      if (d < bd && front && o.y + HOOPS.reach + 0.25 >= ballY) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  private swat(blocker: number, shooter: number): void {
    const s = this.s;
    const o = s.players[blocker];
    const p = s.players[shooter];
    const b = s.ball;
    let dx = b.x - o.x;
    let dz = b.z - o.z;
    const l = Math.max(1e-6, Math.hypot(dx, dz));
    dx /= l;
    dz /= l;
    b.vx = dx * 4.5 + this.gauss() * 0.8;
    b.vz = dz * 4.5 + this.gauss() * 0.8;
    b.vy = 1.5 + this.rand() * 1.5;
    b.state = 'loose';
    b.holder = null;
    b.shooter = null;
    b.value = 0;
    if (this.I.shot !== null) this.I.shot.live = false;
    this.I.lastTouch = o.team;
    this.stats[o.id].blk++;
    s.events.push({ type: 'block', id: o.id, on: p.id });
    s.events.push({ type: 'miss', id: p.id });
  }

  private releaseLayup(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const [ux, uz, d] = this.dirToRim(i);
    const rimIdx = this.rimOf(p.team);
    // Release from the hand, never from under the ring: right at the rim
    // the finish becomes a soft flip from just outside it.
    const rim = this.rimPos(p.team);
    const rd = clamp(d - 0.3, 0.55, 1.6);
    const from: Vec3 = {
      x: rim.x - ux * rd,
      y: Math.max(p.y + HOOPS.releaseHeight + 0.15, rim.y + (rd < 0.8 ? 0.25 : 0)),
      z: rim.z - uz * rd,
    };
    const contest = this.contest(i);
    const three = false;
    const value = this.shotValue(three);
    // Hand the ball to the release point, then maybe get swatted.
    const b = s.ball;
    b.x = from.x;
    b.y = from.y;
    b.z = from.z;
    this.beginShot(i, 'layup', value, three);
    const blk = this.rimBlocker(i, 1.2, from.y);
    if (blk >= 0 && this.rand() < (0.12 + 0.25 * this.I.players[blk].rate.defense) * contest) {
      s.events.push({ type: 'shot', id: p.id, value, quality: 1 - contest, kind: 'layup', three });
      this.swat(blk, i);
      return;
    }
    const side = Math.abs(Math.atan2(ux, uz * this.geo.sign[rimIdx]));
    const bank = side > 0.45 && rd > 0.95 && side < 1.3;
    const prob = clamp(
      0.8 +
        (q.rate.shooting - 0.6) * 0.2 +
        (q.rate.dunking - 0.5) * 0.1 +
        (q.onFire ? 0.15 : 0) -
        0.3 * contest,
      0.1,
      0.96,
    );
    this.launchShot(
      i,
      from,
      prob,
      bank ? 1.0 : rd < 0.95 ? 1.2 : 1.08,
      bank,
      'layup',
      value,
      three,
      false,
    );
    s.events.push({ type: 'shot', id: p.id, value, quality: 1 - contest, kind: 'layup', three });
  }

  private slam(i: number, kind: 'dunk' | 'alleyoop'): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const [ux, uz] = this.dirToRim(i);
    const rim = this.rimPos(p.team);
    const b = s.ball;
    const style: DunkStyle = q.style === '' ? 'two-hand' : q.style;
    b.x = p.x + ux * 0.3;
    b.y = p.y + HOOPS.reach;
    b.z = p.z + uz * 0.3;
    const blk = this.rimBlocker(i, 1.1, rim.y);
    if (
      blk >= 0 &&
      this.rand() < 0.08 + 0.2 * this.I.players[blk].rate.defense - 0.1 * q.rate.dunking
    ) {
      this.swat(blk, i);
      s.events.push({ type: 'slam', id: p.id, style, made: false });
      return;
    }
    const contest = this.contest(i);
    const make =
      this.rand() <
      clamp(0.95 + 0.04 * q.rate.dunking + (q.onFire ? 0.05 : 0) - 0.15 * contest, 0.6, 0.995);
    const R = this.geo.spec.rimRadius;
    if (make) {
      b.x = rim.x - ux * 0.05;
      b.y = rim.y + 0.3;
      b.z = rim.z - uz * 0.05;
      b.vx = ux * 0.3;
      b.vy = -6.5;
      b.vz = uz * 0.3;
    } else {
      // Clanked off the front iron.
      b.x = rim.x - ux * (R + 0.1);
      b.y = rim.y + 0.25;
      b.z = rim.z - uz * (R + 0.1);
      b.vx = ux * 1.2 + this.gauss() * 0.4;
      b.vy = -5.5;
      b.vz = uz * 1.2 + this.gauss() * 0.4;
    }
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
    b.state = 'air';
    b.holder = null;
    b.shooter = p.id;
    b.value = this.I.shot?.value ?? this.shotValue(false);
    q.cdCatch = 0.8;
    this.I.lastTouch = p.team;
    s.events.push({ type: 'slam', id: p.id, style, made: make });
    s.events.push({ type: 'rim', strength: 7 });
    void kind;
  }

  private alleyOop(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const rim = this.rimPos(p.team);
    let best = -1;
    let bd = 1e9;
    for (let j = 0; j < s.players.length; j++) {
      if (j === i) continue;
      const m = s.players[j];
      const mq = this.I.players[j];
      if (m.team !== p.team || mq.act === 'stumble' || SCRIPTED.has(mq.act) || m.y > 0.05) continue;
      const [ux, uz, d] = this.dirToRim(j);
      const toward = m.vx * ux + m.vz * uz;
      if (d < 6.5 && (toward > 1.5 || d < 3.2) && d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best < 0) {
      this.pass(i, undefined);
      return;
    }
    const r = s.players[best];
    const rq = this.I.players[best];
    const [ux, uz] = this.dirToRim(best);
    const cx = rim.x - ux * 0.5;
    const cz = rim.z - uz * 0.5;
    const cy = rim.y + 0.35;
    const fx = p.x + Math.sin(p.yaw) * 0.3;
    const fy = p.y + 1.6;
    const fz = p.z + Math.cos(p.yaw) * 0.3;
    const t = clamp(Math.hypot(cx - fx, cz - fz) / 10, 0.6, 1.1);
    // Receiver: glide in, rise to meet it at time t, slam.
    this.setAct(best, 'alleyoop', t + 0.5);
    rq.slamAt = t / (t + 0.5);
    rq.slammed = false;
    rq.oopCaught = false;
    rq.mx0 = r.x;
    rq.mz0 = r.z;
    rq.mx1 = cx;
    rq.mz1 = cz;
    rq.style = this.rand() < 0.5 ? 'two-hand' : rq.rate.dunking > 0.7 ? 'windmill' : 'tomahawk';
    const ts = Math.max(0, t - 0.5);
    rq.jt = -ts;
    rq.jdur = t + 0.5 - ts;
    rq.jhang = true;
    rq.jh = Math.max(0.6, cy - HOOPS.reach + 0.05);
    // The lob.
    const good =
      this.rand() < clamp(0.8 + 0.15 * q.rate.passing - 0.2 * this.contest(i), 0.4, 0.97);
    let tx = cx;
    let tz = cz;
    if (!good) {
      const th = this.rand() * Math.PI * 2;
      tx += Math.cos(th) * 1.4;
      tz += Math.sin(th) * 1.4;
    }
    const b = s.ball;
    b.x = fx;
    b.y = fy;
    b.z = fz;
    b.vx = (tx - fx) / t;
    b.vz = (tz - fz) / t;
    b.vy = (cy - fy + 0.5 * GRAVITY * t * t) / t;
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
    b.state = 'air';
    b.holder = null;
    b.shooter = null;
    b.value = 0;
    this.I.pass = { from: p.id, to: r.id, alley: true, t: 0, dur: t, rolled: [] };
    this.I.lastTouch = p.team;
    this.setAct(i, 'pass', 0.3);
    q.cdCatch = 0.5;
    s.events.push({ type: 'pass', from: p.id, to: r.id });
  }

  /** Alley-oop receiver at the top of the jump: catch and slam, or whiff. */
  private oopArrive(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const b = s.ball;
    const hx = p.x;
    const hy = p.y + HOOPS.reach;
    const hz = p.z;
    const pass = this.I.pass;
    if (b.state === 'held' || pass === null || pass.to !== p.id) return;
    if (Math.hypot(b.x - hx, b.y - hy, b.z - hz) > 1.1) return;
    const passer = pass.from;
    this.I.pass = null;
    this.I.assistFrom = passer;
    this.I.assistT = s.time;
    this.I.players[i].oopCaught = true;
    const value = this.shotValue(false);
    this.beginShot(i, 'alleyoop', value, false);
    const style =
      this.I.players[i].style === '' ? 'two-hand' : (this.I.players[i].style as DunkStyle);
    s.events.push({
      type: 'shot',
      id: p.id,
      value,
      quality: 1,
      kind: 'alleyoop',
      style,
      three: false,
    });
    this.slam(i, 'alleyoop');
  }

  private pass(i: number, passTo: string | undefined): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    let j = passTo !== undefined ? this.indexOf(passTo) : -1;
    if (j === i || (j >= 0 && s.players[j].team !== p.team)) j = -1;
    if (j < 0) j = this.bestTeammate(i);
    if (j < 0) return;
    const r = s.players[j];
    const fx = p.x;
    const fy = p.y + 1.35;
    const fz = p.z;
    let d = Math.hypot(r.x - fx, r.z - fz);
    let t = d / 14 + 0.08;
    let ax = r.x + r.vx * t;
    let az = r.z + r.vz * t;
    const g = this.geo;
    ax = clamp(ax, -g.halfW + 0.5, g.halfW - 0.5);
    az = clamp(az, this.config.halfCourt ? 0.5 : -g.halfL + 0.5, g.halfL - 0.5);
    d = Math.hypot(ax - fx, az - fz);
    t = d / 14 + 0.08;
    // Lob it over a defender in the lane.
    if (this.laneClearance(p.team, fx, fz, ax, az) < 0.8) t *= 1.5;
    const ty = r.y + 1.25;
    const b = s.ball;
    b.x = fx + Math.sin(p.yaw) * 0.3;
    b.y = fy;
    b.z = fz + Math.cos(p.yaw) * 0.3;
    b.vx = (ax - b.x) / t;
    b.vz = (az - b.z) / t;
    b.vy = (ty - fy + 0.5 * GRAVITY * t * t) / t;
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
    b.state = 'air';
    b.holder = null;
    b.shooter = null;
    b.value = 0;
    this.I.pass = { from: p.id, to: r.id, alley: false, t: 0, dur: t, rolled: [] };
    this.I.lastTouch = p.team;
    this.setAct(i, 'pass', 0.25);
    q.cdCatch = 0.35;
    p.yaw = Math.atan2(ax - fx, az - fz);
    s.events.push({ type: 'pass', from: p.id, to: r.id });
  }

  /** Crossover / spin move with the ball; might break a defender's ankles. */
  private ballMove(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const [ux, uz] = this.dirToRim(i);
    const sp = Math.hypot(p.vx, p.vz);
    const toward = sp > 1e-6 ? (p.vx * ux + p.vz * uz) / sp : 0;
    const spin = sp > 3.8 && toward > 0.3;
    this.setAct(i, spin ? 'spin' : 'crossover', spin ? 0.48 : 0.3);
    q.cdMove = 0.75;
    q.hand = -q.hand;
    const [oj, od] = this.nearestOpp(i);
    const rx = -Math.cos(p.yaw) * q.hand;
    const rz = Math.sin(p.yaw) * q.hand;
    if (spin) {
      // Spin off the defender toward the rim.
      let side = 1;
      if (oj >= 0) {
        const o = s.players[oj];
        side = (o.x - p.x) * uz - (o.z - p.z) * ux > 0 ? -1 : 1;
      }
      let dx = ux + uz * side * 0.7;
      let dz = uz - ux * side * 0.7;
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      const v = Math.max(sp, 5.5);
      p.vx = dx * v;
      p.vz = dz * v;
    } else {
      p.vx += rx * 3.4;
      p.vz += rz * 3.4;
    }
    let ankles = false;
    if (oj >= 0 && od < 2.2) {
      const o = s.players[oj];
      const oq = this.I.players[oj];
      const front = (o.x - p.x) * ux + (o.z - p.z) * uz > 0;
      if (front && oq.act !== 'stumble' && o.y < 0.05) {
        const nx = (p.x - o.x) / Math.max(1e-6, od);
        const nz = (p.z - o.z) / Math.max(1e-6, od);
        const closing = o.vx * nx + o.vz * nz > 0.9 || oq.act === 'steal';
        let pa = closing ? 0.5 : 0.1;
        pa += (q.rate.passing - oq.rate.defense) * 0.35 + (q.onFire ? 0.1 : 0);
        if (this.rand() < clamp(pa, 0.03, 0.8)) {
          ankles = true;
          this.setAct(oj, 'stumble', 1.15);
          o.vx *= 0.2;
          o.vz *= 0.2;
        }
      }
    }
    s.events.push({ type: 'crossover', id: p.id, ankles });
  }

  // ── Defense actions ──────────────────────────────────────────────────

  private jump(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const looseBall =
      s.ball.state === 'loose' ||
      (this.I.shot !== null && !this.I.shot.live) ||
      this.I.shot?.touchedRim === true;
    this.setAct(i, looseBall ? 'rebound' : 'block', 0.62);
    q.jdur = 0.62;
    q.jt = 0;
    q.jh = 0.65 + 0.35 * q.rate.defense + (looseBall ? 0.1 * q.rate.dunking : 0);
    q.jhang = false;
    q.cdJump = 0.75;
    p.vx *= 0.6;
    p.vz *= 0.6;
  }

  /**
   * Defense "pass": switch. Take the opponent nearest to you; the teammate
   * who had him picks up your old man (bots follow their marks).
   */
  private switchMark(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const [o] = this.nearestOpp(i);
    if (o < 0 || o === q.mark) return;
    for (let j = 0; j < s.players.length; j++) {
      if (j === i || s.players[j].team !== p.team) continue;
      const mj = this.I.players[j];
      if (mj.mark === o) {
        mj.mark = q.mark;
        break;
      }
    }
    q.mark = o;
  }

  private stealAttempt(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    this.setAct(i, 'steal', 0.32);
    q.cdSteal = 0.9;
    const h = this.holderIndex();
    if (h < 0) return;
    const H = s.players[h];
    const hq = this.I.players[h];
    if (H.team === p.team || SCRIPTED.has(hq.act)) return;
    const dx = H.x - p.x;
    const dz = H.z - p.z;
    const d = Math.hypot(dx, dz);
    const facing = d > 1e-6 ? (Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz) / d : 1;
    const behind = d > 1e-6 && (Math.sin(H.yaw) * -dx + Math.cos(H.yaw) * -dz) / d < -0.2;
    if (d < 1.45 && facing > 0.35) {
      const b = s.ball;
      const nearSide = (b.x - H.x) * -dx + (b.z - H.z) * -dz > 0;
      let ps =
        0.08 + 0.3 * q.rate.defense - 0.12 * (hq.rate.passing - 0.5) + (nearSide ? 0.12 : -0.06);
      if (hq.act === 'crossover') ps += 0.08;
      if (hq.act === 'gather') ps += 0.12;
      if (this.rand() < clamp(ps, 0.03, 0.5)) {
        this.stats[p.id].stl++;
        this.stats[H.id].tov++;
        s.events.push({ type: 'steal', id: p.id, from: H.id });
        if (hq.act === 'gather') {
          hq.act = 'idle';
          hq.meter = 0;
          this.landFrom(h);
        }
        if (this.rand() < 0.6) {
          this.giveBall(i);
        } else {
          b.state = 'loose';
          b.holder = null;
          b.vx = (-dx / Math.max(1e-6, d)) * 2.5;
          b.vz = (-dz / Math.max(1e-6, d)) * 2.5;
          b.vy = 2;
          this.I.lastTouch = p.team;
          hq.cdCatch = 0.4;
        }
        return;
      }
    }
    if (this.rand() < (behind ? 0.45 : 0.18)) this.setAct(i, 'stumble', 0.45);
  }

  // ── Ball ─────────────────────────────────────────────────────────────

  private giveBall(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const b = s.ball;
    b.state = 'held';
    b.holder = p.id;
    b.shooter = null;
    b.value = 0;
    this.I.lastTouch = p.team;
    this.I.holdBy = p.id;
    this.I.heldT = 0;
    this.I.pass = null;
    this.I.looseT = 0;
    this.I.players[i].drib = 0;
    if (s.phase === 'live') this.changePossession(p.team);
  }

  private heldBallPos(i: number): void {
    const s = this.s;
    const p = s.players[i];
    const q = this.I.players[i];
    const b = s.ball;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const rx = -Math.cos(p.yaw);
    const rz = Math.sin(p.yaw);
    const r = this.geo.spec.ballRadius;
    let x: number;
    let y: number;
    let z: number;
    if (q.act === 'gather') {
      x = p.x + fx * 0.2;
      z = p.z + fz * 0.2;
      y = p.y + 1.5 + 0.8 * q.meter;
    } else if (SCRIPTED.has(q.act)) {
      x = p.x + fx * 0.3;
      z = p.z + fz * 0.3;
      y = p.y + 2.1;
    } else if (s.phase !== 'live' || q.act === 'stumble') {
      x = p.x + fx * 0.35;
      z = p.z + fz * 0.35;
      y = p.y + 1.2;
    } else {
      const sp = Math.hypot(p.vx, p.vz);
      const period = 0.52 - 0.14 * Math.min(1, sp / 7);
      const prev = q.drib;
      q.drib = (q.drib + DT / period) % 1;
      if (prev < 0.5 && q.drib >= 0.5) s.events.push({ type: 'dribble', id: p.id });
      let lat = q.hand * 0.38;
      let fwd = 0.3;
      if (q.act === 'crossover')
        lat = lerp(-q.hand, q.hand, clamp(q.at / Math.max(0.01, q.dur), 0, 1)) * 0.38;
      if (q.act === 'spin') {
        const a = (q.at / Math.max(0.01, q.dur)) * Math.PI * 2;
        lat = Math.cos(a) * 0.38 * q.hand;
        fwd = Math.sin(a) * 0.3 + 0.1;
      }
      x = p.x + fx * fwd + rx * lat;
      z = p.z + fz * fwd + rz * lat;
      y = r + (1.05 - r) * (1 - Math.sin(Math.PI * q.drib));
    }
    if (Math.hypot(x - b.x, y - b.y, z - b.z) < 0.6) {
      b.vx = (x - b.x) / DT;
      b.vy = (y - b.y) / DT;
      b.vz = (z - b.z) / DT;
    } else {
      // Just caught / handed over: don't report the teleport as speed.
      b.vx = p.vx;
      b.vy = 0;
      b.vz = p.vz;
    }
    b.x = x;
    b.y = y;
    b.z = z;
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
  }

  private updateBall(): void {
    const s = this.s;
    const I = this.I;
    const b = s.ball;
    if (b.state === 'held') {
      const h = this.holderIndex();
      if (h >= 0) {
        this.heldBallPos(h);
        if (I.holdBy !== b.holder) {
          I.holdBy = b.holder ?? '';
          I.heldT = 0;
        }
        I.heldT += DT;
        I.lastTouch = s.players[h].team;
        return;
      }
      b.state = 'loose';
      b.holder = null;
    }
    const c = this.contacts;
    resetContacts(c);
    const prevVy = b.vy;
    stepBall(b as BallBody, DT, this.geo, c);
    if (c.rim > 0.4) s.events.push({ type: 'rim', strength: c.rim });
    if (c.board > 0.4) s.events.push({ type: 'backboard', strength: c.board });
    if (c.floor > 0.6) s.events.push({ type: 'bounce', strength: c.floor });
    void prevVy;
    if (s.phase !== 'live') return;

    const shot = I.shot;
    const rimH = this.geo.spec.rimHeight;
    if (shot !== null && shot.live) {
      shot.t += DT;
      if (c.rim > 0) {
        shot.touchedRim = true;
        s.shotClock = this.config.shotClock;
      }
      if (c.board > 0) shot.touchedBoard = true;
      if (c.through === shot.rim) {
        this.score(shot, false);
        return;
      }
      if (c.floor > 0 || (b.vy < 0 && b.y < rimH - 0.5)) {
        shot.live = false;
        b.shooter = null;
        b.value = 0;
        s.events.push({ type: 'miss', id: shot.by });
      }
      if (shot.live) this.blocksAndGoaltends(shot);
      if (!shot.live || shot.touchedRim || shot.touchedBoard) {
        if (b.state === 'air') b.state = 'loose';
      }
    } else if (b.state === 'air' && I.pass === null) {
      b.state = 'loose';
    }

    const pass = I.pass;
    if (pass !== null) {
      pass.t += DT;
      if (c.floor > 0 || pass.t > pass.dur + 1.2) {
        I.pass = null;
        b.state = 'loose';
      } else {
        this.interceptions(pass);
      }
    }
    if (s.phase !== 'live') return;
    const caught = (b.state === 'loose' || b.state === 'air') && this.catches();
    if (s.phase !== 'live') return;
    // Out of bounds: a loose ball landing outside the lines.
    if (!caught && c.floor > 0 && !inBounds(this.geo, this.config.halfCourt, b.x, b.z)) {
      const loser = I.lastTouch;
      s.events.push({ type: 'outOfBounds', team: loser });
      this.turnover(loser);
    }
  }

  private blocksAndGoaltends(shot: ShotInt): void {
    const s = this.s;
    const b = s.ball;
    const rim = this.geo.rims[shot.rim];
    const shooter = this.indexOf(shot.by);
    // Slams resolve at the rim (see slam()); nothing to block or goaltend.
    if (shot.kind === 'dunk' || shot.kind === 'alleyoop') return;
    for (let j = 0; j < s.players.length; j++) {
      const o = s.players[j];
      if (o.team === shot.team || o.y < 0.15) continue;
      if (shot.rolled.includes(o.id)) continue;
      const d = Math.hypot(b.x - o.x, b.y - (o.y + HOOPS.reach + 0.1), b.z - o.z);
      if (d > 0.55) continue;
      const up = b.vy > 0 && shot.t < 0.6;
      if (!up && (d > 0.3 || o.y < 0.3)) continue;
      shot.rolled.push(o.id);
      if (up) {
        if (this.rand() < 0.45 + 0.4 * this.I.players[j].rate.defense) {
          this.swat(j, shooter);
          return;
        }
      } else if (
        b.vy < 0 &&
        b.y > rim.y + 0.05 &&
        !shot.touchedRim &&
        Math.hypot(b.x - rim.x, b.z - rim.z) < 0.7
      ) {
        s.events.push({ type: 'goaltend', id: o.id, team: o.team });
        this.score(shot, true);
        return;
      }
    }
  }

  private interceptions(pass: PassInt): void {
    const s = this.s;
    const b = s.ball;
    const fromIdx = this.indexOf(pass.from);
    const team = fromIdx >= 0 ? s.players[fromIdx].team : s.offense;
    for (let j = 0; j < s.players.length; j++) {
      const o = s.players[j];
      if (o.team === team || pass.rolled.includes(o.id)) continue;
      const oq = this.I.players[j];
      if (oq.act === 'stumble') continue;
      const d = Math.hypot(b.x - o.x, b.z - o.z);
      if (d > 0.7 || b.y > o.y + HOOPS.reach + 0.1 || b.y < 0.3) continue;
      pass.rolled.push(o.id);
      // Out of the passer's hands it's hard to jump; a lurker reading it isn't.
      const early = pass.t < 0.15 ? 0.35 : 1;
      const pi =
        (0.08 + 0.25 * oq.rate.defense + (oq.act === 'steal' ? 0.25 : 0) + (o.y > 0.2 ? 0.1 : 0)) *
        early;
      if (this.rand() < pi) {
        this.stats[o.id].stl++;
        if (fromIdx >= 0) this.stats[pass.from].tov++;
        s.events.push({ type: 'steal', id: o.id, from: pass.from });
        this.giveBall(j);
        return;
      }
    }
  }

  private catches(): boolean {
    const s = this.s;
    const I = this.I;
    const b = s.ball;
    const shot = I.shot;
    const rimH = this.geo.spec.rimHeight;
    if (
      shot !== null &&
      shot.live &&
      !shot.touchedRim &&
      !shot.touchedBoard &&
      (b.vy > 0 || b.y > rimH - 0.3)
    )
      return false;
    for (const rim of this.geo.rims) {
      if (Math.hypot(b.x - rim.x, b.z - rim.z) < this.geo.spec.rimRadius + 0.35 && b.y > rimH - 0.3)
        return false;
    }
    const pass = I.pass;
    const passer = pass !== null ? this.indexOf(pass.from) : -1;
    const passTeam = passer >= 0 ? s.players[passer].team : s.offense;
    let best = -1;
    let bs = 1e9;
    for (let j = 0; j < s.players.length; j++) {
      const p = s.players[j];
      const q = this.I.players[j];
      if (q.cdCatch > 0 || q.act === 'stumble' || SCRIPTED.has(q.act)) continue;
      const isTarget = pass !== null && pass.to === p.id;
      // Opponents only get a pass in flight by intercepting it (see interceptions()).
      if (pass !== null && p.team !== passTeam) continue;
      const jumping = p.y > 0.15;
      const top = p.y + (jumping ? 2.75 : 2.35);
      if (b.y > top) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      const rad = 0.6 + (isTarget ? 0.35 : 0) + (q.act === 'rebound' ? 0.2 : 0);
      if (d > rad) continue;
      const sc = d - (isTarget ? 0.3 : 0) - (jumping ? 0.15 : 0);
      if (sc < bs) {
        bs = sc;
        best = j;
      }
    }
    if (best < 0) return false;
    const p = s.players[best];
    if (pass !== null) {
      const fi = this.indexOf(pass.from);
      if (fi >= 0 && s.players[fi].team === p.team && pass.from !== p.id) {
        I.assistFrom = pass.from;
        I.assistT = s.time;
      }
      I.pass = null;
    }
    if (shot !== null) {
      if (shot.live) {
        shot.live = false;
        s.events.push({ type: 'miss', id: shot.by });
      }
      const off = p.team === shot.team;
      this.stats[p.id].reb++;
      if (off) this.stats[p.id].oreb++;
      s.events.push({ type: 'rebound', id: p.id, offensive: off });
      I.shot = null;
    }
    this.setAct(best, 'catch', 0.2);
    this.giveBall(best);
    return true;
  }

  private score(shot: ShotInt, goaltend: boolean): void {
    const s = this.s;
    const I = this.I;
    const b = s.ball;
    shot.live = false;
    b.state = 'dead';
    b.holder = null;
    b.shooter = null;
    b.value = 0;
    const other: TeamId = shot.team === 0 ? 1 : 0;
    if (shot.unclear) {
      s.events.push({ type: 'violation', team: shot.team, kind: 'clear' });
      const st = this.stats[shot.by];
      if (st !== undefined) st.tov++;
      this.enterPause('turnover', other);
      return;
    }
    s.score[shot.team] += shot.value;
    const st = this.stats[shot.by];
    st.pts += shot.value;
    st.fgm++;
    if (shot.three) st.tpm++;
    if (shot.kind === 'dunk' || shot.kind === 'alleyoop') st.dunks++;
    if (shot.assist !== '' && this.stats[shot.assist] !== undefined) this.stats[shot.assist].ast++;
    let how: 'swish' | 'rim' | 'bank' | 'dunk' | 'layup' | 'alleyoop';
    if (shot.kind === 'dunk') how = 'dunk';
    else if (shot.kind === 'alleyoop') how = 'alleyoop';
    else if (goaltend) how = 'rim';
    else if (shot.touchedBoard) how = 'bank';
    else if (shot.kind === 'layup') how = 'layup';
    else how = shot.touchedRim ? 'rim' : 'swish';
    s.events.push({ type: 'score', team: shot.team, id: shot.by, points: shot.value, how });
    if (!goaltend) s.events.push({ type: 'net' });
    // On fire: three straight by one player; the other team scoring ends it.
    for (let j = 0; j < s.players.length; j++) {
      const p = s.players[j];
      const q = I.players[j];
      if (p.team === other) {
        q.streak = 0;
        if (q.onFire) {
          q.onFire = false;
          s.events.push({ type: 'fireOut', id: p.id });
        }
      } else if (p.id === shot.by) {
        q.streak++;
        if (q.streak >= 3 && !q.onFire) {
          q.onFire = true;
          s.events.push({ type: 'onFire', id: p.id });
        }
      }
    }
    const [a, c] = [s.score[shot.team], s.score[other]];
    if (a >= this.config.target && (!this.config.winBy2 || a - c >= 2)) {
      s.phase = 'final';
      s.phaseT = 0;
      I.pass = null;
      s.events.push({ type: 'final', winner: shot.team, score: [s.score[0], s.score[1]] });
      s.players.forEach((p, j) => {
        const q = I.players[j];
        q.act = p.team === shot.team ? 'celebrate' : 'dejected';
        q.at = 0;
        q.dur = 0;
        q.meter = 0;
      });
      return;
    }
    // Loser's ball.
    this.enterPause('scored', other);
  }

  // ── Rules ────────────────────────────────────────────────────────────

  private rules(): void {
    const s = this.s;
    const I = this.I;
    const cfg = this.config;
    const b = s.ball;
    const shotUp = I.shot !== null && I.shot.live;
    if (cfg.shotClock > 0 && !shotUp) {
      s.shotClock = Math.max(0, s.shotClock - DT);
      if (s.shotClock <= 0) {
        s.events.push({ type: 'shotClock', team: s.offense });
        this.turnover(s.offense);
        return;
      }
    }
    const h = this.holderIndex();
    if (h >= 0) {
      const p = s.players[h];
      if (!this.busy(h) && p.y < 0.05 && !inBounds(this.geo, cfg.halfCourt, p.x, p.z, 0.05)) {
        s.events.push({ type: 'outOfBounds', team: p.team });
        this.turnover(p.team);
        return;
      }
      if (cfg.halfCourt && !I.cleared && p.team === s.offense) {
        if (this.distToRim(h) > this.geo.spec.threeRadius + 0.25) {
          I.cleared = true;
          s.events.push({ type: 'cleared', team: p.team });
        }
      }
      // Stall watchdog (only without a shot clock; the clock handles it otherwise).
      if (cfg.shotClock <= 0 && I.heldT > HOOPS.heldLimit) {
        s.events.push({ type: 'violation', team: p.team, kind: 'held' });
        this.turnover(p.team);
        return;
      }
      I.looseT = 0;
    } else if (b.state === 'loose') {
      I.looseT += DT;
      if (I.looseT > HOOPS.looseLimit) {
        s.events.push({ type: 'violation', team: I.lastTouch, kind: 'held' });
        this.turnover(I.lastTouch);
        return;
      }
    }
    // A ball wedged on the rim / board: knock it free.
    if (b.state !== 'held' && b.y > 1.5 && Math.hypot(b.vx, b.vy, b.vz) < 0.3) {
      I.stuckBallT += DT;
      if (I.stuckBallT > 0.8) {
        I.stuckBallT = 0;
        b.vx = (this.rand() - 0.5) * 1.5;
        b.vy = 1;
        b.vz = b.z > 0 ? -1.2 : 1.2;
      }
    } else {
      I.stuckBallT = 0;
    }
  }

  // ── Publish ──────────────────────────────────────────────────────────

  private publish(): void {
    const s = this.s;
    const b = s.ball;
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      const q = this.I.players[i];
      p.action = q.act;
      p.actionT = q.dur > 0 ? clamp(q.at / q.dur, 0, 1) : 0;
      p.hasBall = b.state === 'held' && b.holder === p.id;
      p.onFire = q.onFire;
      p.stamina = q.stamina;
      if (q.act === 'gather') p.meter = q.meter;
      else delete p.meter;
      if ((q.act === 'dunk' || q.act === 'alleyoop') && q.style !== '') p.dunkStyle = q.style;
      else delete p.dunkStyle;
    }
  }
}

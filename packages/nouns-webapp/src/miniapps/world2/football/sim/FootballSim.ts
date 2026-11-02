// ── Noun Football: the match itself ─────────────────────────────────────
//
// Fixed-step (SIM_DT), deterministic football. Everything lives in two
// plain JSON blobs: the public SimState (what the view draws, the net
// syncs) and `Internal` (timers, the PRNG, human pads, AI brains), which
// rides along in SimState.sim so load(state()) resumes bit-exactly.
//
// Step order:
//   1. phase clock (restarts, celebrations, half time, the shootout)
//   2. humans: switching, power bars, kicks on release, tackles, movement
//   3. the CPU (ai.ts thinks at 10 Hz, steers every step; keeper.ts)
//   4. footballers: timed actions, acceleration / turning, bodies apart
//   5. the ball: at someone's feet, in a keeper's hands, or free (ball.ts)
//      with touches, first touches, headers, tackles and saves
//   6. the laws (rules.ts): out of play, goals, offside, fouls + cards,
//      the clock, periods, extra time, penalties

import type { BallCtx, BallHits } from './ball';

import {
  type Action,
  type BallState,
  type FootballEvent,
  type FootballSimApi,
  type Footballer,
  type MatchConfig,
  type PadInput,
  type Period,
  type PlayerState,
  type Ratings,
  type Restart,
  type RestartKind,
  SIM_DT,
  type SimState,
  type TeamId,
  type TeamStats,
} from '../contract';

import { aiThink, aiSteer, type Brain, newBrain } from './ai';
import { BALL, lobVelocity, newHits, predictBall, rollSpeedFor, stepBall } from './ball';
import { keeperStep, type KeeperBrain, newKeeperBrain } from './keeper';
import { aimKick, goalPoint } from './kicks';
import { gauss, hashSeed, rand } from './rng';
import { cardFor, offsideSet, restartSpots, secondLastLine } from './rules';
import { formationSlots, type Slot } from './setup';

const DT = SIM_DT;

/** Tuning (exported for the AI, keeper and tests). */
export const FB = {
  bodyR: 0.42,
  /** Speeds (m/s) before the pace multiplier (0.86 … 1.14). */
  jog: 3.4,
  run: 5.6,
  sprint: 7.9,
  jockey: 2.6,
  accel: 9,
  decel: 15,
  /** Ball at the feet: how far ahead (m), and dribbling's speed cost. */
  touchNear: 0.42,
  touchPerSpeed: 0.07,
  dribbleSlow: 0.92,
  /** Reach for a ball at the feet / a first touch (m). */
  reach: 0.75,
  /** Header contact band (feet height + this) and reach. */
  headLo: 1.25,
  headHi: 2.35,
  headReach: 0.75,
  /** Seconds a button press waits for the ball (first-time passes / shots). */
  buffer: 0.45,
  /** Power bar: seconds of hold for full power. */
  chargeFull: 0.95,
  /** Wind-up before contact (s). */
  windPass: 0.1,
  windShot: 0.18,
  tackleT: 0.42,
  slideT: 0.85,
  fallenT: 1.3,
  /** Restart setup time (s) before the taker may go. */
  setup: 1.6,
  goalPause: 4.5,
  halftimePause: 4,
  /** The CPU's taker thinks this long at a restart. */
  cpuTake: 0.9,
  /** A human taker who never kicks: auto pass after this (s). */
  humanTakeMax: 12,
  staminaSprint: 0.035,
  staminaBack: 0.02,
} as const;

/** Per-footballer internals. */
export interface PInt {
  /** Seconds left in the current timed action (kick wind-up, tackle, slide, fallen …). */
  act: number;
  actLen: number;
  kick: KickPlan | null;
  /** Can't touch the ball (just kicked it / lost it). */
  noTouch: number;
  cd: number;
  jumpV: number;
  /** Slide / dive direction. */
  sx: number;
  sz: number;
  /** Desired move this step (unit-ish) and gait. */
  mx: number;
  mz: number;
  gait: 0 | 1 | 2 | 3;
  /** Facing override (jockey: face the ball). */
  face: number | null;
  /** Tackle / slide already resolved this action. */
  hit: boolean;
  /** Free ball header wanted (buffered). */
  head: number;
  headKind: 'pass' | 'shot' | 'lob';
  headAim: number;
}

export type KickKind = 'pass' | 'through' | 'lob' | 'shot';

export interface KickPlan {
  kind: KickKind | 'clear' | 'throw' | 'gkthrow' | 'gkkick';
  power: number;
  /** Aim direction (pitch space) or a target footballer. */
  ax: number;
  az: number;
  to: string | null;
  finesse: boolean;
  /** Seconds until contact. */
  at: number;
  /** From a restart (offside doesn't apply to some). */
  restart: RestartKind | null;
}

/** Per-human internals. */
export interface HInt {
  id: string;
  team: TeamId;
  player: string | null;
  prev: PadInput;
  hold: { btn: KickKind; t: number } | null;
  /** Buffered press waiting for the ball. */
  buf: { btn: KickKind; t: number; power: number; ax: number; az: number; finesse: boolean } | null;
  switchCd: number;
  pad: PadInput;
}

export interface Internal {
  rng: number;
  ball: BallCtx;
  p: Record<string, PInt>;
  h: Record<string, HInt>;
  brains: Record<string, Brain>;
  keepers: Record<string, KeeperBrain>;
  /** Players in an offside position at the last kick (ids). */
  offside: string[];
  /** Intended receiver of the ball in flight. */
  receiver: string | null;
  passFrom: string | null;
  /** Last kick: its team, kind and whether it was a restart kick nobody else has touched yet. */
  kickTeam: TeamId | null;
  kickKind: string | null;
  restartKick: RestartKind | null;
  /** Last two distinct touchers (for assists). */
  touch1: string | null;
  touch2: string | null;
  /** Restart wait: seconds the taker has been ready. */
  ready: number;
  ai: number;
  /** Stoppage time accumulating this period (s of match time). */
  stoppage: number;
  /** Penalty shootout kick order per team, and kicks taken. */
  pens: [string[], string[]] | null;
  /** Shootout: the current kick has been struck; time since. */
  penT: number;
  penStruck: boolean;
  /** Kick-off team for the first half. */
  firstKick: TeamId;
  /** A pending decision on a held ball (keeper). */
  outT: number;
  /** Goal kick / restart taker placement done. */
  placed: boolean;
}

const PERIOD_START: Record<Period, number> = {
  1: 0,
  2: 45 * 60,
  3: 90 * 60,
  4: 105 * 60,
  5: 120 * 60,
};
const PERIOD_LEN: Record<Period, number> = { 1: 45 * 60, 2: 45 * 60, 3: 15 * 60, 4: 15 * 60, 5: 0 };

const newStats = (): TeamStats => ({
  shots: 0,
  onTarget: 0,
  poss: 0,
  passes: 0,
  passesDone: 0,
  tackles: 0,
  fouls: 0,
  corners: 0,
  offsides: 0,
  yellows: 0,
  reds: 0,
  saves: 0,
});

const DEFAULT_R: Ratings = {
  pace: 0.7,
  shooting: 0.7,
  passing: 0.7,
  dribbling: 0.7,
  defending: 0.7,
  physical: 0.7,
  keeping: 0.3,
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

const newPInt = (): PInt => ({
  act: 0,
  actLen: 0,
  kick: null,
  noTouch: 0,
  cd: 0,
  jumpV: 0,
  sx: 0,
  sz: 0,
  mx: 0,
  mz: 0,
  gait: 0,
  face: null,
  hit: false,
  head: 0,
  headKind: 'pass',
  headAim: 0,
});

export class FootballSim implements FootballSimApi {
  readonly config: MatchConfig;
  s!: SimState;
  i!: Internal;
  /** Footballer config by id. */
  readonly roster = new Map<string, Footballer>();
  readonly ratings = new Map<string, Ratings>();
  /** Formation slots per team, in roster order. */
  readonly slots: [Slot[], Slot[]];
  /** Index of each player in its team's slots. */
  readonly slotOf = new Map<string, number>();
  private hits: BallHits = newHits();
  /** Ball prediction cache for this step (AI + keepers share it). */
  pred: { x: number; y: number; z: number; t: number }[] = [];
  private predTick = -1;

  constructor(config: MatchConfig) {
    this.config = config;
    this.slots = [formationSlots(config.formations[0]), formationSlots(config.formations[1])];
    const idx = [0, 0];
    for (const f of config.players) {
      this.roster.set(f.id, f);
      this.ratings.set(f.id, { ...DEFAULT_R, ...(f.ratings ?? {}) });
      this.slotOf.set(f.id, idx[f.team]++);
    }
    this.reset();
  }

  // ── Setup ─────────────────────────────────────────────────────────────

  private reset() {
    const cfg = this.config;
    const firstKick: TeamId = cfg.firstKick ?? ((hashSeed(cfg.seed, 'kick') & 1) as TeamId);
    const players: PlayerState[] = cfg.players.map(f => ({
      id: f.id,
      team: f.team,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vz: 0,
      yaw: 0,
      action: 'idle' as Action,
      actionT: 0,
      stamina: 1,
      yellow: 0,
      human: null,
    }));
    this.s = {
      tick: 0,
      time: 0,
      period: 1,
      clock: 0,
      added: 0,
      phase: 'pregame',
      phaseT: 2.5,
      score: [0, 0],
      poss: firstKick,
      attackPlusZ: 0,
      restart: null,
      players,
      ball: {
        x: 0,
        y: cfg.pitch.ballRadius,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        wx: 0,
        wy: 0,
        wz: 0,
        mode: 'dead',
        owner: null,
        lastTouch: null,
      },
      shootout: null,
      goals: [],
      stats: [newStats(), newStats()],
      charge: {},
      events: [],
    };
    const p: Record<string, PInt> = {};
    const brains: Record<string, Brain> = {};
    const keepers: Record<string, KeeperBrain> = {};
    for (const f of cfg.players) {
      p[f.id] = newPInt();
      if (f.role === 'GK') keepers[f.id] = newKeeperBrain();
      else brains[f.id] = newBrain();
    }
    const h: Record<string, HInt> = {};
    for (const hu of cfg.humans)
      h[hu.id] = {
        id: hu.id,
        team: hu.team,
        player: null,
        prev: { ...NO_PAD_FULL },
        hold: null,
        buf: null,
        switchCd: 0,
        pad: { ...NO_PAD_FULL },
      };
    this.i = {
      rng: hashSeed(cfg.seed, 'match'),
      ball: { inGoal: 0 },
      p,
      h,
      brains,
      keepers,
      offside: [],
      receiver: null,
      passFrom: null,
      kickTeam: null,
      kickKind: null,
      restartKick: null,
      touch1: null,
      touch2: null,
      ready: 0,
      ai: 0,
      stoppage: 0,
      pens: null,
      penT: 0,
      penStruck: false,
      firstKick,
      outT: 0,
      placed: false,
    };
    // Walk out: line up near the tunnel side, then the kick-off sets positions
    this.setRestart({ kind: 'kickoff', team: firstKick, x: 0, z: 0, taker: null }, false);
    this.s.phase = 'pregame';
    this.s.phaseT = 2.5;
    for (const pl of this.s.players) {
      const spot = this.restartTarget(pl);
      pl.x = spot.x * 0.6 + (pl.team === 0 ? -1 : 1) * 2;
      pl.z = spot.z * 0.6;
      pl.yaw = this.dir(pl.team) > 0 ? 0 : Math.PI;
    }
    this.assignHumans(true);
  }

  // ── Helpers (used by ai.ts / keeper.ts / rules.ts too) ────────────────

  get pitch() {
    return this.config.pitch;
  }

  /** +1 if `team` attacks +z this period. */
  dir(team: TeamId): number {
    return this.s.attackPlusZ === team ? 1 : -1;
  }

  /** Progress along the attack (−1 own goal line … +1 theirs). */
  vOf(team: TeamId, z: number): number {
    return (z * this.dir(team)) / (this.pitch.length / 2);
  }

  player(id: string | null): PlayerState | undefined {
    if (id === null) return undefined;
    return this.s.players.find(q => q.id === id);
  }

  rnd(): number {
    return rand(this.i);
  }

  gauss(): number {
    return gauss(this.i);
  }

  isGK(id: string): boolean {
    return this.roster.get(id)?.role === 'GK';
  }

  /** Is (x, z) inside the penalty area `team` defends? */
  inOwnBox(team: TeamId, x: number, z: number, margin = 0): boolean {
    const p = this.pitch;
    const own = -this.dir(team) * (p.length / 2);
    return Math.abs(x) <= p.boxWidth / 2 + margin && Math.abs(z - own) <= p.boxDepth + margin;
  }

  /** Who has the ball at their feet / in their hands. */
  get owner(): PlayerState | undefined {
    return this.player(this.s.ball.owner);
  }

  active(pl: PlayerState): boolean {
    return pl.off !== true;
  }

  /** Controlled by a human right now? */
  humanOf(id: string): HInt | undefined {
    for (const h of Object.values(this.i.h)) if (h.player === id) return h;
    return undefined;
  }

  difficultyOf(team: TeamId): number {
    return this.config.difficulty[team];
  }

  /** Ball prediction (0.1 s steps, 3 s), cached per step. */
  predict() {
    if (this.predTick !== this.s.tick) {
      this.predTick = this.s.tick;
      predictBall(this.s.ball, this.pitch, this.i.ball, 3, 0.1, this.pred);
    }
    return this.pred;
  }

  push(e: FootballEvent) {
    this.s.events.push(e);
  }

  // ── The API ───────────────────────────────────────────────────────────

  state(): SimState {
    const out = JSON.parse(JSON.stringify(this.s)) as SimState;
    out.sim = JSON.parse(JSON.stringify(this.i));
    return out;
  }

  load(state: SimState) {
    const st = JSON.parse(JSON.stringify(state)) as SimState;
    const internal = st.sim as Internal | undefined;
    delete st.sim;
    this.s = st;
    if (internal !== undefined) this.i = internal;
    this.predTick = -1;
  }

  step(inputs: Record<string, PadInput>): SimState {
    const s = this.s;
    s.events = [];
    s.tick++;
    s.time += DT;
    for (const [id, pad] of Object.entries(inputs)) {
      const h = this.i.h[id];
      if (h !== undefined) h.pad = pad;
    }
    this.phases();
    this.humans();
    this.cpu();
    this.movePlayers();
    this.ballStep();
    this.laws();
    this.clock();
    this.publishCharge();
    return this.snapshot();
  }

  /** The public state as plain data (no internals), cheap enough every step. */
  snapshot(): SimState {
    const s = this.s;
    return {
      ...s,
      players: s.players.map(p => ({ ...p })),
      ball: { ...s.ball },
      restart: s.restart ? { ...s.restart } : null,
      score: [s.score[0], s.score[1]],
      stats: [{ ...s.stats[0] }, { ...s.stats[1] }],
      goals: s.goals.slice(),
      shootout: s.shootout
        ? {
            kicks: [s.shootout.kicks[0].slice(), s.shootout.kicks[1].slice()],
            next: s.shootout.next,
          }
        : null,
      charge: { ...s.charge },
      events: s.events,
    };
  }

  // ── 1. Phases ─────────────────────────────────────────────────────────

  private phases() {
    const s = this.s;
    if (s.phase === 'final') return;
    if (
      s.phase === 'pregame' ||
      s.phase === 'goal' ||
      s.phase === 'halftime' ||
      s.phase === 'fulltime'
    ) {
      s.phaseT -= DT;
      if (s.phaseT > 0) return;
      if (s.phase === 'fulltime') return this.afterFulltime();
      if (s.phase === 'halftime') return this.startPeriod((s.period + 1) as Period);
      // pregame / goal: on to the kick-off already set
      s.phase = s.restart?.kind === 'kickoff' ? 'kickoff' : 'restart';
      s.phaseT = FB.setup;
      this.i.placed = false;
      this.i.ready = 0;
      return;
    }
    if (s.phase === 'kickoff' || s.phase === 'restart' || s.phase === 'shootout') {
      s.phaseT -= DT;
      if (s.phase === 'shootout') this.shootoutStep();
    }
  }

  private afterFulltime() {
    const s = this.s;
    const level = s.score[0] === s.score[1];
    if (this.config.knockout && level && (s.period === 2 || s.period === 4)) {
      if (s.period === 2) return this.startPeriod(3);
      return this.startShootout();
    }
    this.finish();
  }

  private finish() {
    const s = this.s;
    s.phase = 'final';
    s.phaseT = 0;
    s.ball.mode = 'dead';
    s.ball.owner = null;
    let winner: TeamId | null = s.score[0] > s.score[1] ? 0 : s.score[1] > s.score[0] ? 1 : null;
    let pens: [number, number] | undefined;
    if (s.shootout) {
      pens = [
        s.shootout.kicks[0].filter(Boolean).length,
        s.shootout.kicks[1].filter(Boolean).length,
      ];
      winner = pens[0] > pens[1] ? 0 : 1;
    }
    for (const pl of s.players) {
      if (pl.off === true) continue;
      pl.action = winner === null ? 'idle' : pl.team === winner ? 'celebrate' : 'dejected';
      pl.actionT = 0;
    }
    this.push({ type: 'final', winner, score: [s.score[0], s.score[1]], pens });
  }

  private startPeriod(period: Period) {
    const s = this.s;
    s.period = period;
    s.clock = PERIOD_START[period];
    s.added = 0;
    this.i.stoppage = 0;
    // Ends swap every period; kick-off alternates (first-half kicker kicks off 3rd too)
    const first = this.i.firstKick;
    const kicker: TeamId = period === 2 || period === 4 ? ((1 - first) as TeamId) : first;
    s.attackPlusZ = period === 2 || period === 4 ? 1 : 0;
    this.push({ type: 'period', period });
    this.setRestart({ kind: 'kickoff', team: kicker, x: 0, z: 0, taker: null });
    this.teleportToRestart();
  }

  // ── Restarts ──────────────────────────────────────────────────────────

  /** Stop play for a restart (whistle). */
  setRestart(r: Restart, whistle = true) {
    const s = this.s;
    s.restart = r;
    s.phase = r.kind === 'kickoff' ? 'kickoff' : 'restart';
    s.phaseT = FB.setup;
    s.ball.mode = 'dead';
    s.ball.owner = null;
    s.ball.vx = s.ball.vy = s.ball.vz = 0;
    s.ball.wx = s.ball.wy = s.ball.wz = 0;
    this.i.ball.inGoal = 0;
    this.i.receiver = null;
    this.i.offside = [];
    this.i.ready = 0;
    this.i.placed = false;
    for (const pl of s.players) {
      const pi = this.i.p[pl.id];
      pi.kick = null;
      pi.head = 0;
      if (pl.action !== 'fallen' || pi.act <= 0) {
        if (pl.action !== 'celebrate' && pl.action !== 'dejected') pl.action = 'idle';
      }
    }
    for (const h of Object.values(this.i.h)) {
      h.hold = null;
      h.buf = null;
    }
    r.taker = this.pickTaker(r);
    if (whistle) this.push({ type: 'whistle', kind: 'short' });
    this.push({ type: 'restart', restart: { ...r } });
    // Humans take their own set pieces (not goal kicks: the keeper's AI)
    this.assignHumans(true);
  }

  private pickTaker(r: Restart): string | null {
    const team = this.s.players.filter(q => q.team === r.team && q.off !== true);
    if (team.length === 0) return null;
    if (r.kind === 'goal_kick') return team.find(q => this.isGK(q.id))?.id ?? team[0].id;
    if (r.kind === 'penalty') {
      // best shooter
      const of = team.filter(q => !this.isGK(q.id));
      of.sort((a, b) => this.ratings.get(b.id)!.shooting - this.ratings.get(a.id)!.shooting);
      // a human on that team takes it with their player
      const hu = Object.values(this.i.h).find(h => h.team === r.team);
      if (hu?.player && of.some(q => q.id === hu.player)) return hu.player;
      return of[0]?.id ?? team[0].id;
    }
    if (r.kind === 'kickoff') {
      const fw = team.filter(q => this.roster.get(q.id)!.role === 'FW');
      return (fw[fw.length - 1] ?? team[team.length - 1]).id;
    }
    // nearest outfielder to the spot
    let best: PlayerState | null = null;
    let bd = 1e9;
    for (const q of team) {
      if (this.isGK(q.id) && r.kind !== 'free_kick') continue;
      if (this.isGK(q.id) && !this.inOwnBox(q.team, r.x, r.z, 6)) continue;
      const d = Math.hypot(q.x - r.x, q.z - r.z);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return (best ?? team[0]).id;
  }

  /** Where `pl` should stand for the current restart. */
  restartTarget(pl: PlayerState): { x: number; z: number } {
    return restartSpots(this, pl);
  }

  private teleportToRestart() {
    for (const pl of this.s.players) {
      if (pl.off === true) continue;
      const t = this.restartTarget(pl);
      pl.x = t.x;
      pl.z = t.z;
      pl.vx = pl.vz = 0;
      pl.y = 0;
      this.faceRestart(pl);
    }
    this.placeBall();
    this.i.placed = true;
  }

  private faceRestart(pl: PlayerState) {
    const b = this.s.ball;
    const r = this.s.restart;
    if (r && r.taker === pl.id) {
      // face the way they'll play it
      if (r.kind === 'throw_in') pl.yaw = Math.atan2(-Math.sign(r.x), 0);
      else pl.yaw = this.dir(pl.team) > 0 ? 0 : Math.PI;
      return;
    }
    pl.yaw = Math.atan2(b.x - pl.x, b.z - pl.z);
  }

  private placeBall() {
    const r = this.s.restart;
    const b = this.s.ball;
    if (!r) return;
    b.x = r.x;
    b.z = r.z;
    b.y = this.pitch.ballRadius;
    b.vx = b.vy = b.vz = 0;
    b.wx = b.wy = b.wz = 0;
    if (r.kind === 'throw_in' && r.taker) {
      b.mode = 'held';
      b.owner = r.taker;
      b.y = 2.1;
    } else {
      b.mode = 'dead';
      b.owner = null;
    }
  }

  /** Is the restart ready for its taker to play it? */
  private restartReady(): boolean {
    const s = this.s;
    if (s.phaseT > 0) return false;
    const r = s.restart;
    if (!r || !r.taker) return false;
    const t = this.player(r.taker);
    if (!t) return false;
    return Math.hypot(t.x - this.restartTarget(t).x, t.z - this.restartTarget(t).z) < 0.6;
  }

  /** The taker struck it: play on. */
  private restartTaken(kind: RestartKind) {
    const s = this.s;
    s.phase = 'live';
    s.phaseT = 0;
    this.i.restartKick = kind;
    s.restart = null;
  }

  // ── Humans ────────────────────────────────────────────────────────────

  /**
   * Give each human a footballer: their team's taker at their set pieces,
   * otherwise keep theirs (or the nearest outfielder to the ball).
   */
  assignHumans(force: boolean) {
    const s = this.s;
    const r = s.restart;
    const taken = new Set<string>();
    const hs = Object.values(this.i.h);
    for (const h of hs) {
      let want = h.player;
      if (
        r &&
        r.taker &&
        r.team === h.team &&
        !this.isGK(r.taker) &&
        force &&
        !taken.has(r.taker)
      ) {
        // The first human on the team takes it (co-op: the others keep theirs)
        if (
          !hs.some(o => o !== h && o.team === h.team && o.player === r.taker) &&
          hs.filter(o => o.team === h.team)[0] === h
        )
          want = r.taker;
      }
      const cur = want ? this.player(want) : undefined;
      if (!cur || cur.off === true || this.isGK(cur.id) || taken.has(cur.id))
        want = this.nearestToBall(h.team, taken)?.id ?? null;
      if (want) taken.add(want);
      this.setHuman(h, want);
    }
  }

  private setHuman(h: HInt, id: string | null) {
    if (h.player === id) {
      if (id) {
        const pl = this.player(id);
        if (pl) pl.human = h.id;
      }
      return;
    }
    if (h.player) {
      const old = this.player(h.player);
      if (old && old.human === h.id) old.human = null;
    }
    h.player = id;
    h.buf = null;
    if (id) {
      const pl = this.player(id);
      if (pl) pl.human = h.id;
      this.push({ type: 'switch', human: h.id, to: id });
    }
  }

  nearestToBall(team: TeamId, exclude?: Set<string>): PlayerState | undefined {
    const b = this.s.ball;
    let best: PlayerState | undefined;
    let bd = 1e9;
    for (const q of this.s.players) {
      if (q.team !== team || q.off === true || this.isGK(q.id) || exclude?.has(q.id) === true)
        continue;
      const d = Math.hypot(q.x - b.x, q.z - b.z);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  private humans() {
    const s = this.s;
    for (const h of Object.values(this.i.h)) {
      const pad = h.pad;
      const prev = h.prev;
      h.switchCd = Math.max(0, h.switchCd - DT);
      const myTeamHasBall = this.owner?.team === h.team;
      // Switching (LB, or a right-stick flick out of possession)
      const flick = Math.hypot(pad.rx, pad.rz) > 0.7 && Math.hypot(prev.rx, prev.rz) <= 0.7;
      if ((pad.switchP && !prev.switchP) || (flick && !myTeamHasBall)) {
        if (h.switchCd <= 0 && !(this.owner && this.owner.id === h.player)) {
          this.manualSwitch(h, flick && !(pad.switchP && !prev.switchP) ? pad : null);
          h.switchCd = 0.18;
        }
      }
      this.autoSwitch(h);
      const pl = this.player(h.player);
      h.prev = { ...pad };
      if (!pl || pl.off === true) continue;
      const pi = this.i.p[pl.id];
      // Movement
      const m = Math.hypot(pad.mx, pad.mz);
      const k = m > 1 ? 1 / m : 1;
      pi.mx = pad.mx * k;
      pi.mz = pad.mz * k;
      pi.gait = m < 0.15 ? 0 : pad.sprint ? 3 : m < 0.55 ? 1 : 2;
      pi.face = null;
      if (pad.jockey && !myTeamHasBall) {
        pi.gait = Math.min(pi.gait, 1) as 0 | 1;
        const b = s.ball;
        pi.face = Math.atan2(b.x - pl.x, b.z - pl.z);
      }
      // Assisted receive: no stick while the ball's coming to you
      if (m < 0.15 && this.i.receiver === pl.id && s.ball.mode === 'free') {
        const t = this.interceptPoint(pl);
        if (t) {
          const dx = t.x - pl.x;
          const dz = t.z - pl.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.4) {
            pi.mx = dx / d;
            pi.mz = dz / d;
            pi.gait = d > 4 ? 2 : 1;
          }
        }
      }
      // Skill move: right stick flick with the ball
      if (flick && s.ball.owner === pl.id && pi.act <= 0 && pi.cd <= 0) {
        const d = Math.hypot(pad.rx, pad.rz);
        this.startAction(pl, 'skill', 0.45);
        pi.sx = pad.rx / d;
        pi.sz = pad.rz / d;
        pl.actionDir =
          Math.round(
            ((Math.atan2(pi.sx, pi.sz) - pl.yaw + 8 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2),
          ) % 4;
        pi.cd = 1;
      }
      // Buttons
      const attackBtn = this.kickButtons(h, pl, pad, prev);
      if (!attackBtn) this.defendButtons(h, pl, pad, prev);
    }
  }

  private manualSwitch(h: HInt, dirPad: PadInput | null) {
    const cur = this.player(h.player);
    const taken = new Set(
      Object.values(this.i.h)
        .filter(o => o !== h && o.player !== null)
        .map(o => o.player!),
    );
    if (cur) taken.add(cur.id);
    let pick: PlayerState | undefined;
    if (dirPad && cur) {
      const d = Math.hypot(dirPad.rx, dirPad.rz);
      const ux = dirPad.rx / d;
      const uz = dirPad.rz / d;
      let best = -1e9;
      for (const q of this.s.players) {
        if (q.team !== h.team || q.off === true || this.isGK(q.id) || taken.has(q.id)) continue;
        const dx = q.x - cur.x;
        const dz = q.z - cur.z;
        const dd = Math.hypot(dx, dz) || 1;
        const sc = (dx * ux + dz * uz) / dd - dd / 60;
        if (sc > best) {
          best = sc;
          pick = q;
        }
      }
    } else pick = this.nearestToBall(h.team, taken);
    if (pick) this.setHuman(h, pick.id);
  }

  /** Assisted switching: to the carrier when your team wins it, to the nearest when theirs does. */
  private autoSwitch(h: HInt) {
    if (h.switchCd > 0) return;
    const o = this.owner;
    const s = this.s;
    if (s.phase !== 'live') return;
    const others = new Set(
      Object.values(this.i.h)
        .filter(q => q !== h && q.player !== null)
        .map(q => q.player!),
    );
    if (o && o.team === h.team && o.id !== h.player && !this.isGK(o.id) && !others.has(o.id)) {
      // Co-op: only the human nearest the new carrier takes it
      const mates = Object.values(this.i.h).filter(q => q.team === h.team);
      let nearest = h;
      let nd = 1e9;
      for (const q of mates) {
        const qp = this.player(q.player);
        const d = qp ? Math.hypot(qp.x - o.x, qp.z - o.z) : 1e8;
        if (d < nd) {
          nd = d;
          nearest = q;
        }
      }
      if (nearest === h || this.i.passFrom === h.player) {
        this.setHuman(h, o.id);
        h.switchCd = 0.3;
      }
      return;
    }
    // Ball coming to one of ours: switch to the receiver
    const rc = this.i.receiver;
    if (rc && rc !== h.player && !others.has(rc) && this.i.passFrom === h.player) {
      const rp = this.player(rc);
      if (rp && rp.team === h.team && !this.isGK(rc)) {
        this.setHuman(h, rc);
        h.switchCd = 0.3;
        return;
      }
    }
    // Defending: if we're far from the ball, take whoever is nearest
    const theirs = o ? o.team !== h.team : false;
    const me = this.player(h.player);
    if (theirs && me) {
      const b = s.ball;
      const near = this.nearestToBall(h.team, others);
      if (near && near.id !== me.id) {
        const dm = Math.hypot(me.x - b.x, me.z - b.z);
        const dn = Math.hypot(near.x - b.x, near.z - b.z);
        if (dm > 14 && dn < dm - 6) {
          this.setHuman(h, near.id);
          h.switchCd = 1.2;
        }
      }
    }
  }

  /** Charging / releasing kicks. Returns true if a kick button is in use. */
  private kickButtons(h: HInt, pl: PlayerState, pad: PadInput, prev: PadInput): boolean {
    const s = this.s;
    const pi = this.i.p[pl.id];
    const b = s.ball;
    const mine = b.owner === pl.id;
    const r = s.restart;
    const myRestart =
      r !== null &&
      r.taker === pl.id &&
      (s.phase === 'restart' || s.phase === 'kickoff' || s.phase === 'shootout');
    const near = b.mode === 'free' && Math.hypot(b.x - pl.x, b.z - pl.z) < 6;
    const teamHas =
      this.owner?.team === pl.team ||
      (b.mode === 'free' && b.lastTouch !== null && this.player(b.lastTouch)?.team === pl.team);
    const attacking = mine || myRestart || teamHas || near;
    const btns: [KickKind, boolean, boolean][] = [
      ['pass', pad.pass, prev.pass],
      ['shot', pad.shoot, prev.shoot],
      ['lob', pad.lob, prev.lob],
      ['through', pad.through, prev.through],
    ];
    // Buffered presses run out
    if (h.buf) {
      h.buf.t -= DT;
      if (h.buf.t <= 0) h.buf = null;
    }
    if (!attacking && !h.hold) return false;
    for (const [btn, now, was] of btns) {
      if (now && !was && !h.hold) {
        // Defending presses go to defendButtons
        if (!attacking) return false;
        h.hold = { btn, t: 0 };
      }
    }
    if (h.hold) {
      const held = btns.find(q => q[0] === h.hold!.btn)!;
      h.hold.t += DT;
      if (!held[1]) {
        // Released: kick
        const power = clamp(h.hold.t / FB.chargeFull, 0.12, 1);
        const m = Math.hypot(pad.mx, pad.mz);
        const ax = m > 0.25 ? pad.mx / m : Math.sin(pl.yaw);
        const az = m > 0.25 ? pad.mz / m : Math.cos(pl.yaw);
        const kind = h.hold.btn;
        h.hold = null;
        if (myRestart && this.restartReady()) {
          this.humanRestartKick(pl, kind, power, ax, az, pad.finesse);
        } else if (mine || this.atFeet(pl)) {
          this.startKick(pl, {
            kind,
            power,
            ax,
            az,
            to: null,
            finesse: pad.finesse,
            at: 0,
            restart: null,
          });
        } else {
          // First time: wait for the ball (or a header / volley if it's in the air nearby)
          h.buf = { btn: kind, t: FB.buffer, power, ax, az, finesse: pad.finesse };
          pi.head = FB.buffer;
          pi.headKind = kind === 'shot' ? 'shot' : kind === 'lob' ? 'lob' : 'pass';
          pi.headAim = Math.atan2(ax, az);
        }
      }
      return true;
    }
    // A buffered first-time kick fires the moment the ball arrives
    if (h.buf && this.atFeet(pl) && pi.act <= 0) {
      const bf = h.buf;
      h.buf = null;
      this.startKick(pl, {
        kind: bf.btn,
        power: bf.power,
        ax: bf.ax,
        az: bf.az,
        to: null,
        finesse: bf.finesse,
        at: 0,
        restart: null,
      });
      return true;
    }
    return attacking && (pad.pass || pad.shoot || pad.lob || pad.through);
  }

  private defendButtons(_h: HInt, pl: PlayerState, pad: PadInput, prev: PadInput) {
    const pi = this.i.p[pl.id];
    if (this.s.phase !== 'live' || pi.act > 0) return;
    if (pad.pass && !prev.pass) this.tryTackle(pl, false);
    else if (pad.shoot && !prev.shoot) this.tryTackle(pl, true);
    // Second man press (X held) and keeper rush (Y held) steer the AI
    const brainsTeam = this.s.players.filter(
      q => q.team === pl.team && q.off !== true && q.id !== pl.id,
    );
    for (const q of brainsTeam) {
      const br = this.i.brains[q.id];
      if (br !== undefined) br.pressCall = pad.lob ? 0.3 : Math.max(0, br.pressCall - DT);
      const kb = this.i.keepers[q.id];
      if (kb !== undefined) kb.rush = pad.through ? 0.3 : Math.max(0, kb.rush - DT);
    }
  }

  private humanRestartKick(
    pl: PlayerState,
    kind: KickKind,
    power: number,
    ax: number,
    az: number,
    finesse: boolean,
  ) {
    const r = this.s.restart!;
    if (r.kind === 'throw_in') {
      this.startKick(pl, {
        kind: 'throw',
        power: kind === 'lob' ? Math.max(0.6, power) : power * 0.7,
        ax,
        az,
        to: null,
        finesse: false,
        at: 0,
        restart: 'throw_in',
      });
      return;
    }
    if (r.kind === 'kickoff' && kind === 'shot') kind = 'pass';
    this.startKick(pl, { kind, power, ax, az, to: null, finesse, at: 0, restart: r.kind });
  }

  private publishCharge() {
    const out: SimState['charge'] = {};
    for (const h of Object.values(this.i.h))
      if (h.hold)
        out[h.id] = {
          power: clamp(h.hold.t / FB.chargeFull, 0, 1),
          kind: h.hold.btn === 'shot' ? 'shot' : h.hold.btn,
        };
    this.s.charge = out;
  }

  // ── 3. The CPU ────────────────────────────────────────────────────────

  private cpu() {
    const s = this.s;
    this.i.ai -= DT;
    const think = this.i.ai <= 0;
    if (think) this.i.ai = 0.1;
    for (const pl of s.players) {
      if (pl.off === true) continue;
      if (this.isGK(pl.id)) {
        keeperStep(this, pl, this.i.keepers[pl.id]);
        continue;
      }
      if (pl.human) continue;
      const br = this.i.brains[pl.id];
      if (think) aiThink(this, pl, br);
      aiSteer(this, pl, br);
    }
    // Restart takers that are CPU-controlled
    this.cpuRestart();
  }

  private cpuRestart() {
    const s = this.s;
    const r = s.restart;
    if (!r || !r.taker || (s.phase !== 'restart' && s.phase !== 'kickoff')) return;
    const t = this.player(r.taker);
    if (!t) return;
    const humanTaker = !!t.human;
    if (!this.restartReady()) {
      // Setup over: snap stragglers into place so a restart never stalls
      if (s.phaseT < -2.5 && !this.i.placed) this.teleportToRestart();
      return;
    }
    if (!this.i.placed) {
      this.placeBall();
      this.i.placed = true;
    }
    this.i.ready += DT;
    if (humanTaker) {
      if (this.i.ready < FB.humanTakeMax) return;
    } else if (this.i.ready < FB.cpuTake + (r.kind === 'penalty' ? 0.6 : 0)) return;
    if (this.i.p[t.id].kick) return;
    const plan = this.cpuRestartPlan(t, r);
    this.startKick(t, plan);
  }

  /** What a CPU taker does with a set piece. */
  cpuRestartPlan(t: PlayerState, r: Restart): KickPlan {
    const dir = this.dir(t.team);
    const p = this.pitch;
    const base = { finesse: false, at: 0, restart: r.kind } as const;
    const goalZ = (dir * p.length) / 2;
    if (r.kind === 'penalty') {
      const side = this.rnd() < 0.5 ? -1 : 1;
      return {
        ...base,
        kind: 'shot',
        power: 0.72 + this.rnd() * 0.2,
        ax: side * (0.5 + this.rnd() * 0.4),
        az: this.rnd() * 0.6,
        to: null,
      };
    }
    if (r.kind === 'corner') {
      const tgt = this.bestTarget(t, 'lob', true);
      return { ...base, kind: 'lob', power: 0.6, ax: 0, az: dir, to: tgt?.id ?? null };
    }
    if (r.kind === 'free_kick' && r.direct !== false) {
      const d = Math.hypot(t.x, goalZ - t.z);
      if (d < 30 && Math.abs(t.x) < 22) {
        return {
          ...base,
          kind: 'shot',
          power: 0.75,
          ax: (this.rnd() < 0.5 ? -1 : 1) * 0.7,
          az: 0.75,
          to: null,
          finesse: true,
        };
      }
    }
    if (r.kind === 'goal_kick') {
      const long = this.rnd() < 0.6 + this.config.tactics![t.team].direct * 0.3;
      const tgt = this.bestTarget(t, long ? 'lob' : 'pass', long);
      return {
        ...base,
        kind: long ? 'lob' : 'pass',
        power: long ? 0.9 : 0.5,
        ax: 0,
        az: dir,
        to: tgt?.id ?? null,
      };
    }
    if (r.kind === 'throw_in') {
      const tgt = this.bestTarget(t, 'pass', false);
      return { ...base, kind: 'throw', power: 0.5, ax: 0, az: dir, to: tgt?.id ?? null };
    }
    const tgt = this.bestTarget(t, 'pass', false);
    return { ...base, kind: 'pass', power: 0.4, ax: 0, az: dir, to: tgt?.id ?? null };
  }

  /** The teammate a CPU (or an assisted human) would pick for this kick. */
  bestTarget(
    from: PlayerState,
    kind: KickKind,
    forward: boolean,
    ax?: number,
    az?: number,
  ): PlayerState | undefined {
    let best: PlayerState | undefined;
    let bs = -1e9;
    const dir = this.dir(from.team);
    const hasDir = ax !== undefined && az !== undefined;
    for (const q of this.s.players) {
      if (q.team !== from.team || q.id === from.id || q.off === true) continue;
      if (this.isGK(q.id) && kind !== 'pass') continue;
      const dx = q.x + q.vx * 0.5 - from.x;
      const dz = q.z + q.vz * 0.5 - from.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 3) continue;
      let sc = 0;
      if (hasDir) {
        const c = (dx * ax! + dz * az!) / d;
        if (c < Math.cos(0.75)) continue;
        sc += c * 3 - d / 45;
      } else {
        const prog = (dz * dir) / 30;
        sc += (forward ? prog * 1.4 : prog * 0.6) - Math.abs(d - (kind === 'lob' ? 30 : 14)) / 25;
      }
      // Free of opponents?
      let space = 20;
      for (const o of this.s.players) {
        if (o.team === from.team || o.off === true) continue;
        space = Math.min(space, Math.hypot(o.x - q.x, o.z - q.z));
        // lane: distance from the pass line (ground passes only)
        if (kind === 'pass' || kind === 'through') {
          const t = clamp(((o.x - from.x) * dx + (o.z - from.z) * dz) / (d * d), 0, 1);
          const lx = from.x + dx * t - o.x;
          const lz = from.z + dz * t - o.z;
          const lane = Math.hypot(lx, lz);
          const w = 1.4 + t * 1.2;
          if (lane < w && t > 0 && t < 0.97) sc -= (w - lane) * 1.6;
        }
      }
      sc += Math.min(space, 8) / 8 - (space < 2.5 ? 1.2 : 0);
      if (sc > bs) {
        bs = sc;
        best = q;
      }
    }
    return best;
  }

  // ── Actions ───────────────────────────────────────────────────────────

  startAction(pl: PlayerState, a: Action, len: number) {
    const pi = this.i.p[pl.id];
    pl.action = a;
    pl.actionT = 0;
    pi.act = len;
    pi.actLen = len;
    pi.hit = false;
  }

  /** Is the ball at this player's feet (owned, or free and close and low)? */
  atFeet(pl: PlayerState): boolean {
    const b = this.s.ball;
    if (b.owner === pl.id && b.mode === 'free') return true;
    if (b.mode !== 'free' || b.owner !== null) return false;
    return Math.hypot(b.x - pl.x, b.z - pl.z) < FB.reach + 0.25 && b.y < 0.7;
  }

  /** Begin a kick: wind-up now, contact `at` seconds later (kickNow). */
  startKick(pl: PlayerState, plan: KickPlan) {
    const pi = this.i.p[pl.id];
    if (pi.act > 0 && pl.action !== 'jockey' && pl.action !== 'shield') return;
    const shot = plan.kind === 'shot';
    const wind =
      plan.kind === 'throw' || plan.kind === 'gkthrow' ? 0.35 : shot ? FB.windShot : FB.windPass;
    plan.at = wind;
    pi.kick = plan;
    const b = this.s.ball;
    const volley = b.y > 0.35 && b.owner !== pl.id;
    const a: Action =
      plan.kind === 'throw'
        ? 'throw_in'
        : plan.kind === 'gkthrow'
          ? 'gk_throw'
          : plan.kind === 'gkkick'
            ? 'gk_kick'
            : shot
              ? volley
                ? 'volley'
                : 'shoot'
              : plan.kind === 'lob'
                ? 'lob'
                : 'pass';
    this.startAction(pl, a, wind + 0.3);
  }

  /** Contact: the ball leaves the boot. */
  private kickNow(pl: PlayerState, plan: KickPlan) {
    const s = this.s;
    const b = s.ball;
    const pi = this.i.p[pl.id];
    const r = this.ratings.get(pl.id)!;
    const p = this.pitch;
    // Out of reach by now (tackled, or it ran away): air kick
    const reachOk =
      b.owner === pl.id ||
      plan.restart !== null ||
      plan.kind === 'gkthrow' ||
      plan.kind === 'gkkick' ||
      Math.hypot(b.x - pl.x, b.z - pl.z) < FB.reach + 0.45;
    if (!reachOk || (b.mode === 'held' && b.owner !== pl.id)) return;
    const fromRestart = plan.restart;
    if (fromRestart !== null) {
      // only legal when the restart is still on
      if (s.phase === 'restart' || s.phase === 'kickoff') this.restartTaken(fromRestart);
      else if (s.phase !== 'shootout') return;
    }
    const pressure = this.pressureOn(pl);
    const dir = this.dir(pl.team);
    let kind: string = plan.kind;
    b.mode = 'free';
    b.owner = null;
    if (plan.kind === 'throw' || plan.kind === 'gkthrow') b.y = 2.0;
    // Thrown from on the line (the hands are over it; the ball's still in)
    if (plan.kind === 'throw') b.x = clamp(b.x, -(p.width / 2 - 0.15), p.width / 2 - 0.15);
    else if (b.y < p.ballRadius) b.y = p.ballRadius;
    let launch: { vx: number; vy: number; vz: number; wx: number; wy: number; wz: number };
    const to = plan.to ? this.player(plan.to) : this.pickAssisted(pl, plan);
    const human = !!pl.human;
    // Accuracy noise (radians) from the rating, pressure, power and body shape
    const facing = Math.abs(wrapAngle(Math.atan2(plan.ax, plan.az) - pl.yaw));
    const skill = plan.kind === 'shot' ? r.shooting : r.passing;
    const cpuBias = human ? 1 : 1.25 - 0.12 * this.difficultyOf(pl.team);
    const sigma =
      ((1 - skill) * 0.07 + pressure * 0.035 + facing * 0.02 + (plan.power > 0.9 ? 0.03 : 0)) *
      cpuBias;
    const err = this.gauss() * sigma;
    this.i.receiver = null;
    this.i.passFrom = pl.id;
    if (plan.kind === 'shot') {
      // Aim on the goal: placement from the stick across the goal
      const s2 = dir;
      let ax: number;
      let ay: number;
      if (plan.restart === 'penalty' || !human) {
        ax = clamp(plan.ax, -1, 1);
        ay = clamp(plan.az, 0, 1);
      } else {
        // Stick across the goal mouth decides the corner; no stick: across the keeper
        const across = plan.ax;
        const m = Math.abs(across);
        ax =
          m > 0.25
            ? Math.sign(across) * (0.45 + 0.5 * Math.min(1, m))
            : -Math.sign(pl.x || 1) * 0.55;
        ay = clamp(0.1 + plan.power * 0.75, 0, 1.2);
      }
      const tgt = goalPoint(p, s2, ax, ay);
      // over-hit balls rise, under pressure they drift
      tgt.y +=
        (plan.power > 0.85 ? (plan.power - 0.85) * 6 : 0) + Math.abs(this.gauss()) * sigma * 6;
      const speed =
        (plan.finesse ? 15 : 17) +
        plan.power * (plan.finesse ? 9 : 17) * (0.75 + 0.35 * r.shooting);
      const curl = plan.finesse
        ? -Math.sign(tgt.x - pl.x) * dir * (28 + 18 * plan.power)
        : this.gauss() * 6;
      // finesse: aim wider, let it bend back
      const tx = tgt.x + (plan.finesse ? Math.sign(tgt.x - pl.x) * 0.9 : 0);
      launch = aimKick(p, b.x, b.y, b.z, tx, tgt.y, tgt.z, speed, curl, plan.finesse ? 0 : 8);
      rotate(launch, err);
      kind = pl.action === 'volley' ? 'volley' : 'shot';
      s.stats[pl.team].shots++;
      const dist = Math.hypot(pl.x - tgt.x, pl.z - tgt.z);
      this.push({
        type: 'chance',
        team: pl.team,
        quality: clamp(1.2 - dist / 25 - pressure * 0.3, 0, 1),
      });
    } else if (plan.kind === 'throw' || plan.kind === 'gkthrow') {
      const tx = to ? to.x + to.vx * 0.6 : b.x + plan.ax * (10 + plan.power * 18);
      const tz = to ? to.z + to.vz * 0.6 : b.z + plan.az * (10 + plan.power * 18);
      const d = Math.hypot(tx - b.x, tz - b.z);
      const v = lobVelocity(b.x, b.y, b.z, tx, tz, plan.kind === 'gkthrow' ? 0.5 : 1.2 + d * 0.05, {
        vx: 0,
        vy: 0,
        vz: 0,
      });
      launch = { ...v, wx: 0, wy: 0, wz: 0 };
      rotate(launch, err * 0.5);
      if (to) this.i.receiver = to.id;
      kind = 'restart';
    } else if (plan.kind === 'lob' || plan.kind === 'gkkick') {
      let tx: number;
      let tz: number;
      if (to) {
        const lead = 1.1;
        tx = to.x + to.vx * lead;
        tz = to.z + to.vz * lead;
        this.i.receiver = to.id;
      } else {
        const d = 14 + plan.power * 38;
        tx = b.x + plan.ax * d;
        tz = b.z + plan.az * d;
      }
      tx = clamp(tx, -p.width / 2 + 1, p.width / 2 - 1);
      tz = clamp(tz, -p.length / 2 + 1, p.length / 2 - 1);
      const d = Math.hypot(tx - b.x, tz - b.z);
      const apex = plan.kind === 'gkkick' ? 8 + d * 0.12 : 2.2 + d * 0.13;
      const v = lobVelocity(b.x, b.y, b.z, tx, tz, apex, { vx: 0, vy: 0, vz: 0 });
      // a little backspin so it sits up
      const sp = Math.hypot(v.vx, v.vz) || 1;
      launch = { ...v, wx: (-v.vz / sp) * 12, wy: this.gauss() * 4, wz: (v.vx / sp) * 12 };
      rotate(launch, err);
      kind = plan.kind === 'gkkick' ? 'clear' : 'lob';
    } else {
      // Ground pass / through ball
      let tx: number;
      let tz: number;
      let arrive = 5.5 + plan.power * 8;
      if (to) {
        this.i.receiver = to.id;
        const rv = this.ratings.get(to.id)!;
        if (plan.kind === 'through') {
          // into space ahead of their run
          const run = 4 + plan.power * 11;
          const vlen = Math.hypot(to.vx, to.vz);
          const ux = vlen > 1 ? to.vx / vlen : 0;
          const uz = vlen > 1 ? to.vz / vlen : dir;
          tx = to.x + (ux * 0.5 + 0) * run;
          tz = to.z + (uz * 0.5 + dir * 0.5) * run;
          arrive = 2.5;
          void rv;
        } else {
          // lead the receiver by the time the pass takes
          tx = to.x;
          tz = to.z;
          for (let k = 0; k < 2; k++) {
            const d = Math.hypot(tx - b.x, tz - b.z);
            const v0 = rollSpeedFor(d, arrive);
            const T = d / ((v0 + arrive) / 2);
            tx = to.x + to.vx * T * 0.8;
            tz = to.z + to.vz * T * 0.8;
          }
        }
      } else {
        const d = 8 + plan.power * 32;
        tx = b.x + plan.ax * d;
        tz = b.z + plan.az * d;
        arrive = 1.5;
      }
      const d = Math.hypot(tx - b.x, tz - b.z);
      let v0 = rollSpeedFor(d, arrive);
      // the power bar still matters: soft taps under-hit, hard ones zip
      if (human && to) v0 *= 0.85 + plan.power * 0.35;
      v0 = clamp(v0, 5, 30);
      const ux = (tx - b.x) / (d || 1);
      const uz = (tz - b.z) / (d || 1);
      launch = {
        vx: ux * v0,
        vy: 0,
        vz: uz * v0,
        wx: uz * (v0 / p.ballRadius),
        wy: 0,
        wz: -ux * (v0 / p.ballRadius),
      };
      if (plan.finesse) launch.wy = (this.rnd() - 0.5) * 20;
      rotate(launch, err);
      kind = plan.kind === 'through' ? 'through' : 'pass';
    }
    b.vx = launch.vx;
    b.vy = launch.vy;
    b.vz = launch.vz;
    b.wx = launch.wx;
    b.wy = launch.wy;
    b.wz = launch.wz;
    b.lastTouch = pl.id;
    this.touched(pl, true);
    pi.noTouch = 0.22;
    if (kind === 'pass' || kind === 'through' || kind === 'lob') s.stats[pl.team].passes++;
    this.i.kickTeam = pl.team;
    this.i.kickKind = kind;
    // Offside is judged at the moment the ball is played (not from these restarts)
    const exempt =
      fromRestart === 'throw_in' || fromRestart === 'goal_kick' || fromRestart === 'corner';
    this.i.offside = this.config.offside && !exempt ? offsideSet(this, pl) : [];
    const ek: 'pass' | 'through' | 'lob' | 'shot' | 'volley' | 'clear' | 'restart' =
      kind === 'shot' ||
      kind === 'volley' ||
      kind === 'pass' ||
      kind === 'through' ||
      kind === 'lob' ||
      kind === 'clear'
        ? kind
        : 'restart';
    this.push({
      type: 'kick',
      id: pl.id,
      kind: fromRestart && ek !== 'shot' ? 'restart' : ek,
      power: plan.power,
    });
  }

  /** Assisted target for a human's pass in the stick direction. */
  private pickAssisted(pl: PlayerState, plan: KickPlan): PlayerState | undefined {
    if (plan.kind === 'shot') return undefined;
    if (!pl.human) return undefined;
    const kind = plan.kind === 'through' ? 'through' : plan.kind === 'lob' ? 'lob' : 'pass';
    return this.bestTarget(pl, kind, false, plan.ax, plan.az);
  }

  /** 0 (all the time in the world) … 1 (an opponent's on top of you). */
  pressureOn(pl: PlayerState): number {
    let d = 99;
    for (const o of this.s.players) {
      if (o.team === pl.team || o.off === true) continue;
      d = Math.min(d, Math.hypot(o.x - pl.x, o.z - pl.z));
    }
    return clamp(1 - (d - 0.8) / 4, 0, 1);
  }

  /** Bookkeeping when `pl` touches the ball. */
  touched(pl: PlayerState, kick = false) {
    const s = this.s;
    const i = this.i;
    // Offside: a player in an offside position touching it from the last kick
    if (!kick && i.offside.includes(pl.id) && i.kickTeam === pl.team && s.phase === 'live') {
      i.offside = [];
      s.stats[pl.team].offsides++;
      this.push({ type: 'offside', id: pl.id, x: pl.x, z: pl.z });
      this.setRestart({
        kind: 'free_kick',
        team: (1 - pl.team) as TeamId,
        x: pl.x,
        z: pl.z,
        taker: null,
        direct: false,
      });
      return false;
    }
    if (!kick) {
      // a completed pass
      if (
        i.kickTeam === pl.team &&
        (i.kickKind === 'pass' || i.kickKind === 'through' || i.kickKind === 'lob') &&
        i.passFrom !== pl.id
      )
        s.stats[pl.team].passesDone++;
      i.offside = [];
      i.kickKind = null;
      i.receiver = null;
      // a throw-in / goal kick touched by someone else can now score
      if (i.restartKick && s.ball.lastTouch !== pl.id) i.restartKick = null;
    }
    if (i.touch1 !== pl.id) {
      i.touch2 = i.touch1;
      i.touch1 = pl.id;
    }
    s.ball.lastTouch = pl.id;
    s.poss = pl.team;
    return true;
  }

  // ── Tackles ───────────────────────────────────────────────────────────

  /** A tackle (standing or slide) by `pl`, if it makes sense. */
  tryTackle(pl: PlayerState, slide: boolean) {
    const pi = this.i.p[pl.id];
    if (pi.act > 0 || pi.cd > 0 || this.isGK(pl.id)) return;
    const b = this.s.ball;
    if (slide) {
      this.startAction(pl, 'slide', FB.slideT);
      let dx = Math.sin(pl.yaw);
      let dz = Math.cos(pl.yaw);
      const sp = Math.hypot(pl.vx, pl.vz);
      if (sp > 1) {
        dx = pl.vx / sp;
        dz = pl.vz / sp;
      }
      pi.sx = dx;
      pi.sz = dz;
      const v = Math.max(sp, 6.5);
      pl.vx = dx * v;
      pl.vz = dz * v;
      pi.cd = 1.2;
    } else {
      this.startAction(pl, 'tackle', FB.tackleT);
      // lunge at the ball
      const dx = b.x - pl.x;
      const dz = b.z - pl.z;
      const d = Math.hypot(dx, dz) || 1;
      pl.yaw = Math.atan2(dx, dz);
      pl.vx += (dx / d) * 2.5;
      pl.vz += (dz / d) * 2.5;
      pi.cd = 0.6;
    }
  }

  /** Resolve an in-progress tackle against the ball / its carrier. */
  private tackleContact(pl: PlayerState) {
    const s = this.s;
    const pi = this.i.p[pl.id];
    if (pi.hit) return;
    const slide = pl.action === 'slide';
    const t = 1 - pi.act / pi.actLen;
    if (slide ? t < 0.08 || t > 0.7 : t < 0.25 || t > 0.8) return;
    const b = s.ball;
    // the tackling foot
    const fx = pl.x + Math.sin(pl.yaw) * (slide ? 0.9 : 0.75);
    const fz = pl.z + Math.cos(pl.yaw) * (slide ? 0.9 : 0.75);
    const carrier = this.owner && this.owner.team !== pl.team ? this.owner : undefined;
    const ballD = Math.hypot(b.x - fx, b.z - fz);
    const footReach = slide ? 0.85 : 0.8;
    const ballFirst = ballD < footReach && b.y < 0.6 && b.mode === 'free';
    // Body contact with an opponent (the trip)
    let victim: PlayerState | undefined;
    for (const o of s.players) {
      if (o.team === pl.team || o.off === true || o.action === 'fallen') continue;
      if (Math.hypot(o.x - fx, o.z - fz) < (slide ? 0.75 : 0.6)) {
        victim = o;
        break;
      }
    }
    if (!ballFirst && !victim) return;
    pi.hit = true;
    const r = this.ratings.get(pl.id)!;
    if (ballFirst) {
      let win = slide ? 0.8 : 0.5 + r.defending * 0.4;
      if (carrier) {
        const cr = this.ratings.get(carrier.id)!;
        const cpi = this.i.p[carrier.id];
        win -= cr.dribbling * 0.35;
        if (carrier.action === 'skill' && cpi.act > 0) win -= 0.3;
        if (carrier.action === 'shield') win -= 0.25;
        // from behind: you go through the man
        const behind = Math.cos(wrapAngle(carrier.yaw - pl.yaw)) > 0.5;
        if (behind) win -= 0.2;
        if (pl.human) win += 0.12;
        else win += 0.04 * (this.difficultyOf(pl.team) - 2);
      }
      if (this.rnd() < win) {
        const loser = carrier;
        b.owner = null;
        b.mode = 'free';
        if (slide) {
          b.vx = pi.sx * 7 + (this.rnd() - 0.5) * 4;
          b.vz = pi.sz * 7 + (this.rnd() - 0.5) * 4;
          b.vy = 0.5;
        } else if (this.rnd() < 0.55) {
          // poked to his feet: his ball
          b.owner = pl.id;
          this.touched(pl);
        } else {
          const a = pl.yaw + (this.rnd() - 0.5) * 1.6;
          b.vx = Math.sin(a) * 4;
          b.vz = Math.cos(a) * 4;
        }
        b.lastTouch = pl.id;
        if (b.owner !== pl.id) this.touched(pl);
        if (loser) {
          this.i.p[loser.id].noTouch = 0.45;
          s.stats[pl.team].tackles++;
          this.push({ type: 'tackle', id: pl.id, on: loser.id, won: true, slide });
          // a slide that took the ball can still take the man after: a fall, no foul
          if (slide && victim === loser) this.knockDown(loser);
        }
        return;
      }
      if (carrier) this.push({ type: 'tackle', id: pl.id, on: carrier.id, won: false, slide });
      if (!victim) return;
    }
    // Got the man, not the ball: a foul if it's clumsy (from behind, or a slide)
    if (victim) {
      const behind = Math.cos(wrapAngle(victim.yaw - pl.yaw)) > 0.5;
      const pFoul = (slide ? 0.55 : 0.12) + (behind ? 0.4 : 0) + (1 - r.defending) * 0.15;
      if (this.rnd() < pFoul) this.foulOn(pl, victim, slide);
      else {
        // a shove: both stumble on
        victim.vx *= 0.6;
        victim.vz *= 0.6;
        if (carrier) this.push({ type: 'tackle', id: pl.id, on: carrier.id, won: false, slide });
      }
    }
  }

  knockDown(pl: PlayerState) {
    this.startAction(pl, 'fallen', FB.fallenT);
    pl.vx *= 0.3;
    pl.vz *= 0.3;
    if (this.s.ball.owner === pl.id) {
      const b = this.s.ball;
      b.owner = null;
      b.mode = 'free';
      b.vx = pl.vx + Math.sin(pl.yaw) * 2;
      b.vz = pl.vz + Math.cos(pl.yaw) * 2;
    }
  }

  private foulOn(pl: PlayerState, victim: PlayerState, slide: boolean) {
    const s = this.s;
    this.knockDown(victim);
    if (!this.config.fouls || s.phase !== 'live') return;
    const team = victim.team;
    s.stats[pl.team].fouls++;
    const pen = this.inOwnBox(pl.team, victim.x, victim.z);
    this.push({ type: 'foul', id: pl.id, on: victim.id, x: victim.x, z: victim.z, penalty: pen });
    const card = cardFor(this, pl, victim, slide);
    if (card) this.book(pl, card);
    const p = this.pitch;
    if (pen) {
      const z = (this.dir(team) * p.length) / 2 - this.dir(team) * p.penaltySpot;
      this.setRestart({ kind: 'penalty', team, x: 0, z, taker: null });
    } else {
      const x = clamp(victim.x, -p.width / 2 + 0.5, p.width / 2 - 0.5);
      const z = clamp(victim.z, -p.length / 2 + 0.5, p.length / 2 - 0.5);
      this.setRestart({ kind: 'free_kick', team, x, z, taker: null, direct: true });
    }
  }

  book(pl: PlayerState, color: 'yellow' | 'red') {
    const s = this.s;
    let c = color;
    if (c === 'yellow') {
      pl.yellow++;
      s.stats[pl.team].yellows++;
      if (pl.yellow >= 2) {
        this.push({ type: 'card', id: pl.id, color: 'yellow' });
        c = 'red';
      }
    }
    this.push({ type: 'card', id: pl.id, color: c });
    if (c === 'red') {
      s.stats[pl.team].reds++;
      pl.off = true;
      pl.action = 'dejected';
      pl.x = this.pitch.width / 2 + 5;
      pl.z = 0;
      pl.vx = pl.vz = 0;
      if (s.ball.owner === pl.id) s.ball.owner = null;
      const h = this.humanOf(pl.id);
      if (h) this.setHuman(h, this.nearestToBall(h.team)?.id ?? null);
    }
    this.i.stoppage += 30;
  }

  // ── 4. Movement ───────────────────────────────────────────────────────

  private movePlayers() {
    const s = this.s;
    const live = s.phase === 'live';
    for (const pl of s.players) {
      if (pl.off === true) continue;
      const pi = this.i.p[pl.id];
      const r = this.ratings.get(pl.id)!;
      pi.noTouch = Math.max(0, pi.noTouch - DT);
      pi.cd = Math.max(0, pi.cd - DT);
      pi.head = Math.max(0, pi.head - DT);
      // Timed actions
      if (pi.act > 0) {
        pi.act -= DT;
        pl.actionT = clamp(1 - pi.act / pi.actLen, 0, 1);
        if (pi.kick) {
          pi.kick.at -= DT;
          if (pi.kick.at <= 0) {
            const k = pi.kick;
            pi.kick = null;
            this.kickNow(pl, k);
          }
        }
        if (pl.action === 'tackle' || pl.action === 'slide') this.tackleContact(pl);
        if (pi.act <= 0) {
          if (pl.action === 'slide') this.startAction(pl, 'fallen', 0.45);
          else {
            pl.action = 'idle';
            pi.act = 0;
          }
        }
      }
      // Jumps (headers)
      if (pl.y > 0 || pi.jumpV > 0) {
        pl.y += pi.jumpV * DT;
        pi.jumpV -= 9.81 * DT;
        if (pl.y <= 0) {
          pl.y = 0;
          pi.jumpV = 0;
        }
      }
      const locked =
        pl.action === 'fallen' ||
        pl.action === 'slide' ||
        pl.action === 'gk_dive' ||
        (pl.action === 'celebrate' && !live);
      const kicking = pi.kick !== null || pl.action === 'tackle';
      // Desired velocity
      let tx = 0;
      let tz = 0;
      if (!locked) {
        const pace = 0.86 + 0.28 * r.pace;
        const tired = pl.stamina < 0.25 ? 0.85 : 1;
        const sp =
          pi.gait === 0 ? 0 : pi.gait === 1 ? FB.jog : pi.gait === 2 ? FB.run : FB.sprint * tired;
        let top = sp * pace;
        if (s.ball.owner === pl.id) top *= FB.dribbleSlow * (0.92 + 0.12 * r.dribbling);
        if (pl.action === 'jockey' || pi.face !== null) top = Math.min(top, FB.jockey * pace);
        if (kicking) top *= 0.45;
        if (pl.action === 'skill') {
          top = 6.5;
          tx = pi.sx * top;
          tz = pi.sz * top;
        } else {
          tx = pi.mx * top;
          tz = pi.mz * top;
        }
      }
      // Accelerate toward it (turning at speed is slower)
      if (pl.action === 'slide') {
        const k = Math.exp(-2.2 * DT);
        pl.vx *= k;
        pl.vz *= k;
      } else if (locked) {
        const k = Math.exp(-6 * DT);
        pl.vx *= k;
        pl.vz *= k;
      } else {
        const dvx = tx - pl.vx;
        const dvz = tz - pl.vz;
        const dv = Math.hypot(dvx, dvz);
        const speeding =
          tx * pl.vx + tz * pl.vz > 0 && Math.hypot(tx, tz) > Math.hypot(pl.vx, pl.vz);
        const a = (speeding ? FB.accel * (0.85 + 0.3 * r.physical) : FB.decel) * DT;
        if (dv > a) {
          pl.vx += (dvx / dv) * a;
          pl.vz += (dvz / dv) * a;
        } else {
          pl.vx = tx;
          pl.vz = tz;
        }
      }
      pl.x += pl.vx * DT;
      pl.z += pl.vz * DT;
      // Facing
      const speed = Math.hypot(pl.vx, pl.vz);
      let want = pl.yaw;
      if (pi.face !== null) want = pi.face;
      else if (pi.kick) want = Math.atan2(pi.kick.ax, pi.kick.az);
      else if (speed > 0.6 && pl.action !== 'slide') want = Math.atan2(pl.vx, pl.vz);
      else if (!locked && s.ball.owner !== pl.id && pl.action !== 'gk_hold') {
        const b = s.ball;
        if (Math.hypot(b.x - pl.x, b.z - pl.z) > 0.5) want = Math.atan2(b.x - pl.x, b.z - pl.z);
      }
      if (!locked || pl.action === 'celebrate') {
        const turn = (14 - Math.min(9, speed * 1.1)) * DT;
        const d = wrapAngle(want - pl.yaw);
        pl.yaw = wrapAngle(pl.yaw + clamp(d, -turn, turn));
      }
      // Gait as an action for the view
      if (
        pi.act <= 0 &&
        !locked &&
        pl.action !== 'celebrate' &&
        pl.action !== 'dejected' &&
        !this.isGK(pl.id)
      ) {
        pl.action =
          s.ball.owner === pl.id
            ? pl.human && this.i.h[pl.human].pad.jockey
              ? 'shield'
              : 'dribble'
            : pi.face !== null
              ? 'jockey'
              : speed < 0.4
                ? 'idle'
                : speed < 4
                  ? 'jog'
                  : speed < 6.6
                    ? 'run'
                    : 'sprint';
      }
      // Stamina
      if (pi.gait === 3 && speed > 5)
        pl.stamina = Math.max(0, pl.stamina - FB.staminaSprint * DT * (1.2 - r.physical * 0.4));
      else pl.stamina = Math.min(1, pl.stamina + FB.staminaBack * DT * (speed < 3 ? 1.5 : 0.6));
      // Keep on the grass
      const hx = this.pitch.width / 2 + 5;
      const hz = this.pitch.length / 2 + 4;
      pl.x = clamp(pl.x, -hx, hx);
      pl.z = clamp(pl.z, -hz, hz);
    }
    this.separate();
  }

  /** Bodies don't overlap (a cheap pairwise push). */
  private separate() {
    const ps = this.s.players;
    const R = FB.bodyR * 2;
    for (let a = 0; a < ps.length; a++) {
      const p = ps[a];
      if (p.off === true) continue;
      for (let c = a + 1; c < ps.length; c++) {
        const q = ps[c];
        if (q.off === true) continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || d2 < 1e-8) continue;
        if (
          p.action === 'fallen' ||
          q.action === 'fallen' ||
          p.action === 'slide' ||
          q.action === 'slide'
        )
          continue;
        const d = Math.sqrt(d2);
        const push = (R - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        // The stronger man holds his ground (shielding)
        const rp = this.ratings.get(p.id)!.physical;
        const rq = this.ratings.get(q.id)!.physical;
        const wp = rq / (rp + rq);
        p.x -= ux * push * 2 * wp;
        p.z -= uz * push * 2 * wp;
        q.x += ux * push * 2 * (1 - wp);
        q.z += uz * push * 2 * (1 - wp);
      }
    }
  }

  // ── 5. The ball ───────────────────────────────────────────────────────

  private ballStep() {
    const s = this.s;
    const b = s.ball;
    const p = this.pitch;
    if (b.mode === 'held') {
      const h = this.player(b.owner);
      if (!h) {
        b.mode = 'free';
        b.owner = null;
      } else {
        const gk = this.isGK(h.id);
        b.x = h.x + Math.sin(h.yaw) * (gk ? 0.35 : 0.05);
        b.z = h.z + Math.cos(h.yaw) * (gk ? 0.35 : 0.05);
        b.y = gk ? 1.1 + h.y : 2.1;
        b.vx = h.vx;
        b.vz = h.vz;
        b.vy = 0;
        b.wx = b.wy = b.wz = 0;
        if (gk) s.poss = h.team;
        return;
      }
    }
    if (b.mode === 'dead') {
      // A ball that's gone out keeps rolling to the boards (looks right on TV)
      if (Math.hypot(b.vx, b.vy, b.vz) > 0.01 || b.y > p.ballRadius + 0.01) {
        stepBall(b, p, this.i.ball, DT, (this.hits = newHits()));
        this.ballEvents();
      }
      return;
    }
    const o = this.owner;
    if (o) {
      this.dribble(o);
      s.stats[o.team].poss++;
      return;
    }
    // Free ball
    this.hits = newHits();
    stepBall(b, p, this.i.ball, DT, this.hits);
    this.ballEvents();
    this.contacts();
  }

  private ballEvents() {
    const h = this.hits;
    if (h.bounce > 2) this.push({ type: 'bounce', strength: clamp(h.bounce / 12, 0, 1) });
    if (h.post > 1)
      this.push({ type: 'woodwork', part: 'post', strength: clamp(h.post / 25, 0, 1) });
    if (h.bar > 1) this.push({ type: 'woodwork', part: 'bar', strength: clamp(h.bar / 25, 0, 1) });
    if (h.net > 1.5) this.push({ type: 'net', strength: clamp(h.net / 25, 0, 1) });
  }

  /** The ball at a player's feet: knocked ahead as they run. */
  private dribble(o: PlayerState) {
    const b = this.s.ball;
    const pi = this.i.p[o.id];
    const r = this.ratings.get(o.id)!;
    const sp = Math.hypot(o.vx, o.vz);
    const fx = sp > 0.5 ? o.vx / sp : Math.sin(o.yaw);
    const fz = sp > 0.5 ? o.vz / sp : Math.cos(o.yaw);
    const close = o.human ? this.i.h[o.human].pad.jockey : false;
    const sprintKnock = pi.gait === 3 ? 0.55 * (1.1 - r.dribbling) : 0;
    const d = close ? 0.36 : FB.touchNear + sp * FB.touchPerSpeed + sprintKnock;
    const tx = o.x + fx * d;
    const tz = o.z + fz * d;
    // The ball lags a sharp turn (it has to be dragged round)
    const k = 1 - Math.exp(-(close ? 22 : 9 + r.dribbling * 8) * DT);
    const nx = b.x + (tx - b.x) * k;
    const nz = b.z + (tz - b.z) * k;
    b.vx = (nx - b.x) / DT;
    b.vz = (nz - b.z) / DT;
    b.x = nx;
    b.z = nz;
    b.y = this.pitch.ballRadius;
    b.vy = 0;
    b.wz = -b.vx / this.pitch.ballRadius;
    b.wx = b.vz / this.pitch.ballRadius;
    b.wy = 0;
    // Lose it if it's somehow got away (pushed off it)
    if (Math.hypot(b.x - o.x, b.z - o.z) > 2.2) {
      b.owner = null;
      pi.noTouch = 0.3;
    }
  }

  /** Free ball against the footballers: first touches, headers, deflections. */
  private contacts() {
    const s = this.s;
    const b = s.ball;
    const p = this.pitch;
    let best: PlayerState | undefined;
    let bd = 1e9;
    for (const pl of s.players) {
      if (pl.off === true) continue;
      const pi = this.i.p[pl.id];
      if (pi.noTouch > 0 || pl.action === 'fallen') continue;
      if (this.isGK(pl.id)) continue; // keeper.ts handles its hands
      const dx = b.x - pl.x;
      const dz = b.z - pl.z;
      const d = Math.hypot(dx, dz);
      const rel = b.y - pl.y;
      // Headers (the CPU only goes up for a ball dropping on it or driven at it;
      // a slow, looping one it chests down instead)
      const bsp = Math.hypot(b.vx, b.vz);
      const expecting =
        this.i.receiver === pl.id &&
        this.pressureOn(pl) < 0.55 &&
        !this.inOwnBox((1 - pl.team) as TeamId, b.x, b.z, 2);
      const cpuHead = !pl.human && (b.vy < -1 || bsp > 11) && !(bsp < 8 && rel < 1.7) && !expecting;
      if (rel > FB.headLo && rel < FB.headHi && d < FB.headReach && (pi.head > 0 || cpuHead)) {
        if (this.header(pl)) return;
        continue;
      }
      if (rel > 1.75) continue;
      const reach = pl.action === 'slide' ? 1 : FB.reach;
      if (d < reach && d < bd) {
        bd = d;
        best = pl;
      }
    }
    if (!best) return;
    const pl = best;
    const pi = this.i.p[pl.id];
    const r = this.ratings.get(pl.id)!;
    // A tackler gets it via tackleContact; a slider just knocks it on
    if (pl.action === 'slide') {
      b.vx = pi.sx * 6 + b.vx * 0.2;
      b.vz = pi.sz * 6 + b.vz * 0.2;
      b.vy = 0.4;
      if (this.touched(pl)) b.lastTouch = pl.id;
      pi.noTouch = 0.3;
      return;
    }
    // A pending kick (first time) takes it as it comes
    if (pi.kick) return;
    const relSp = Math.hypot(b.vx - pl.vx, b.vz - pl.vz);
    const high = b.y > 0.55;
    let q =
      0.55 +
      r.dribbling * 0.45 -
      relSp / 34 -
      (high ? 0.22 : 0) +
      (this.i.receiver === pl.id ? 0.12 : 0) -
      this.rnd() * 0.3;
    if (pl.human) q += 0.1;
    if (q > 0.08) {
      // Controlled: it's his ball
      if (!this.touched(pl)) return;
      b.owner = pl.id;
      b.vy = 0;
      b.y = p.ballRadius;
      if (high || relSp > 12) this.startAction(pl, 'trap', 0.3);
      this.push({ type: 'touch', id: pl.id, quality: clamp(q, 0, 1) });
    } else {
      // Heavy touch: it bounces off him
      if (!this.touched(pl)) return;
      const nx = (b.x - pl.x) / (Math.hypot(b.x - pl.x, b.z - pl.z) || 1);
      const nz = (b.z - pl.z) / (Math.hypot(b.x - pl.x, b.z - pl.z) || 1);
      const k = 0.35 + this.rnd() * 0.25;
      const vn = b.vx * nx + b.vz * nz;
      b.vx = (b.vx - 2 * Math.min(0, vn) * nx) * k + pl.vx * 0.5;
      b.vz = (b.vz - 2 * Math.min(0, vn) * nz) * k + pl.vz * 0.5;
      b.vy = Math.abs(b.vy) * 0.3 + (high ? 1 : 0.2);
      pi.noTouch = 0.25;
      this.push({ type: 'touch', id: pl.id, quality: 0 });
    }
  }

  /** A header: on goal near their box, clear near ours, else to a teammate. */
  private header(pl: PlayerState): boolean {
    const s = this.s;
    const b = s.ball;
    const pi = this.i.p[pl.id];
    const r = this.ratings.get(pl.id)!;
    const p = this.pitch;
    if (!this.touched(pl)) return true;
    const dir = this.dir(pl.team);
    const goalZ = (dir * p.length) / 2;
    const dGoal = Math.hypot(b.x, goalZ - b.z);
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    let launch: { vx: number; vy: number; vz: number };
    const wantShot = pl.human
      ? pi.headKind === 'shot' || (pi.headKind === 'pass' && dGoal < 14)
      : dGoal < 18;
    const ownBox = this.inOwnBox(pl.team, b.x, b.z, 4);
    this.startAction(pl, 'header', 0.45);
    pi.jumpV = Math.max(pi.jumpV, 2.2);
    pl.y = Math.max(pl.y, 0.05);
    if (wantShot && !ownBox) {
      const ax = (this.rnd() - 0.5) * 1.6;
      const tgt = goalPoint(p, dir, ax, 0.15 + this.rnd() * 0.5);
      const v = 10 + r.shooting * 8 + sp * 0.15;
      const dx = tgt.x - b.x;
      const dz = tgt.z - b.z;
      const d = Math.hypot(dx, dz) || 1;
      const T = d / v;
      launch = { vx: (dx / d) * v, vz: (dz / d) * v, vy: (tgt.y - b.y) / T + 0.5 * 9.81 * T };
      s.stats[pl.team].shots++;
      this.push({ type: 'chance', team: pl.team, quality: clamp(1 - dGoal / 16, 0, 1) });
    } else if (ownBox || (!pl.human && this.vOf(pl.team, b.z) < -0.35)) {
      // Clear it: away and high
      const a = Math.atan2(b.x * 0.3, dir) + (this.rnd() - 0.5) * 0.8;
      const v = 11 + r.physical * 5;
      launch = { vx: Math.sin(a) * v, vz: Math.cos(a) * v, vy: 5.5 };
    } else {
      const aimYaw = pl.human ? pi.headAim : Math.atan2(0, dir);
      const to =
        this.bestTarget(pl, 'pass', true, Math.sin(aimYaw), Math.cos(aimYaw)) ??
        this.bestTarget(pl, 'pass', true);
      if (to) {
        const v = lobVelocity(b.x, b.y, b.z, to.x, to.z, 1.2, { vx: 0, vy: 0, vz: 0 });
        launch = v;
        this.i.receiver = to.id;
      } else launch = { vx: Math.sin(aimYaw) * 9, vz: Math.cos(aimYaw) * 9, vy: 3 };
    }
    const err = this.gauss() * (1 - r.shooting) * 0.12;
    const l = { ...launch, wx: 0, wy: 0, wz: 0 };
    rotate(l, err);
    b.vx = l.vx;
    b.vy = l.vy;
    b.vz = l.vz;
    b.wx = b.wy = b.wz = 0;
    b.lastTouch = pl.id;
    pi.noTouch = 0.3;
    pi.head = 0;
    this.i.passFrom = pl.id;
    this.i.kickTeam = pl.team;
    this.i.kickKind = 'pass';
    this.i.offside = this.config.offside ? offsideSet(this, pl) : [];
    this.push({ type: 'header', id: pl.id, power: clamp(sp / 25, 0, 1) });
    return true;
  }

  /** Where `pl` meets the moving ball soonest (null if it's out of reach). */
  interceptPoint(pl: PlayerState): { x: number; z: number; t: number } | null {
    const pred = this.predict();
    const r = this.ratings.get(pl.id)!;
    const top = FB.sprint * (0.86 + 0.28 * r.pace);
    for (const q of pred) {
      if (q.y > 2.2) continue;
      const d = Math.hypot(q.x - pl.x, q.z - pl.z) - FB.reach;
      if (d <= top * q.t * 0.85 + 0.2) return { x: q.x, z: q.z, t: q.t };
    }
    const last = pred.length > 0 ? pred[pred.length - 1] : null;
    return last !== null
      ? { x: last.x, z: last.z, t: 3 + Math.hypot(last.x - pl.x, last.z - pl.z) / top }
      : null;
  }

  // ── 6. The laws ───────────────────────────────────────────────────────

  private laws() {
    const s = this.s;
    const b = s.ball;
    const p = this.pitch;
    if (s.phase !== 'live' && s.phase !== 'shootout') return;
    if (b.mode !== 'free') return;
    const half = p.length / 2;
    const r = p.ballRadius;
    // Goal: wholly over the line, between the posts, under the bar
    if (Math.abs(b.z) > half + r && Math.abs(b.x) < p.goalWidth / 2 && b.y < p.goalHeight) {
      const end = Math.sign(b.z);
      const scoring: TeamId = this.s.attackPlusZ === 0 ? (end > 0 ? 0 : 1) : end > 0 ? 1 : 0;
      if (s.phase === 'shootout') return this.shootoutResult(true);
      // Straight in from a throw-in / an indirect free kick doesn't count
      if (this.i.restartKick === 'throw_in') return this.outOfPlay(end, scoring);
      return this.goal(scoring);
    }
    if (s.phase === 'shootout') return;
    // Over the touchline
    if (Math.abs(b.x) > p.width / 2 + r) {
      const last = this.player(b.lastTouch);
      const team: TeamId = last ? ((1 - last.team) as TeamId) : 0;
      const x = Math.sign(b.x) * (p.width / 2);
      const z = clamp(b.z, -half + 1, half - 1);
      this.push({ type: 'out', kind: 'throw_in', team });
      this.setRestart({ kind: 'throw_in', team, x, z, taker: null });
      return;
    }
    // Over the goal line (not a goal)
    if (Math.abs(b.z) > half + r) {
      const end = Math.sign(b.z);
      const attacking: TeamId = this.s.attackPlusZ === 0 ? (end > 0 ? 0 : 1) : end > 0 ? 1 : 0;
      this.outOfPlay(end, attacking);
    }
  }

  /** Out over the goal line at `end`: corner or goal kick. */
  private outOfPlay(end: number, attacking: TeamId) {
    const s = this.s;
    const b = s.ball;
    const p = this.pitch;
    const half = p.length / 2;
    const last = this.player(b.lastTouch);
    const defending = (1 - attacking) as TeamId;
    if (last && last.team === defending) {
      const x = Math.sign(b.x || 1) * (p.width / 2 - 0.4);
      s.stats[attacking].corners++;
      this.push({ type: 'out', kind: 'corner', team: attacking });
      this.setRestart({ kind: 'corner', team: attacking, x, z: end * (half - 0.4), taker: null });
    } else {
      const x = Math.sign(b.x || 1) * (p.sixWidth / 2 - 1);
      this.push({ type: 'out', kind: 'goal_kick', team: defending });
      this.setRestart({
        kind: 'goal_kick',
        team: defending,
        x,
        z: end * (half - p.sixDepth + 0.5),
        taker: null,
      });
    }
  }

  private goal(team: TeamId) {
    const s = this.s;
    const last = this.player(s.ball.lastTouch);
    const own = last ? last.team !== team : false;
    const scorer = last?.id ?? '';
    const t2 = this.player(this.i.touch2);
    const assist = !own && t2 && t2.team === team && t2.id !== scorer ? t2.id : null;
    s.score[team]++;
    s.stats[team].onTarget++;
    const minute = Math.floor(s.clock / 60) + 1;
    s.goals.push({
      team,
      scorer,
      assist,
      minute,
      ownGoal: own,
      penalty: this.i.kickKind === 'shot' && this.i.restartKick === 'penalty',
    });
    this.push({ type: 'goal', team, scorer, assist, ownGoal: own });
    this.push({ type: 'whistle', kind: 'short' });
    s.phase = 'goal';
    s.phaseT = FB.goalPause;
    s.ball.mode = 'dead';
    s.ball.owner = null;
    this.i.stoppage += 40;
    for (const pl of s.players) {
      if (pl.off === true) continue;
      const pi = this.i.p[pl.id];
      pi.kick = null;
      if (pl.team === team && !this.isGK(pl.id)) {
        pl.action = 'celebrate';
        pl.actionT = 0;
        pl.actionDir = Math.floor(this.rnd() * 4);
        pi.act = FB.goalPause;
        pi.actLen = FB.goalPause;
      } else if (pl.team !== team && this.rnd() < 0.6) {
        pl.action = 'dejected';
        pi.act = FB.goalPause;
        pi.actLen = FB.goalPause;
      }
    }
    // Kick-off to the team that conceded (set now, taken after the celebration)
    const r: Restart = { kind: 'kickoff', team: (1 - team) as TeamId, x: 0, z: 0, taker: null };
    s.restart = r;
    r.taker = this.pickTaker(r);
    this.i.receiver = null;
    this.i.offside = [];
  }

  // ── Clock + periods ───────────────────────────────────────────────────

  private clock() {
    const s = this.s;
    if (
      s.phase === 'final' ||
      s.phase === 'pregame' ||
      s.phase === 'halftime' ||
      s.phase === 'fulltime' ||
      s.phase === 'shootout'
    )
      return;
    const rate = (45 * 60) / this.config.halfSeconds;
    s.clock += DT * rate;
    const end = PERIOD_START[s.period] + PERIOD_LEN[s.period];
    if (s.added === 0 && s.clock >= end) {
      // Stoppage time: a minute or so plus what the period lost
      const base = s.period <= 2 ? 60 : 30;
      s.added = Math.round((base + this.i.stoppage + this.rnd() * 60) / 60) * 60;
      if (s.period > 2) s.added = Math.min(s.added, 120);
      s.added = clamp(s.added, 60, 300);
    }
    if (s.added > 0 && s.clock >= end + s.added) {
      // Don't blow up mid-attack: wait for the ball to be out of the box or a dead ball (40 s max)
      const b = s.ball;
      const p = this.pitch;
      const danger = Math.abs(b.z) > p.length / 2 - p.boxDepth - 4 && b.mode === 'free';
      if (danger && s.clock < end + s.added + 40 * rate && s.phase === 'live') return;
      this.endPeriod();
    }
  }

  private endPeriod() {
    const s = this.s;
    this.push({ type: 'whistle', kind: s.period === 1 || s.period === 3 ? 'long' : 'end' });
    s.ball.mode = 'dead';
    s.ball.owner = null;
    s.ball.vx = s.ball.vy = s.ball.vz = 0;
    s.restart = null;
    for (const pl of s.players) {
      const pi = this.i.p[pl.id];
      pi.kick = null;
      if (pl.off !== true) pl.action = 'idle';
    }
    if (s.period === 1 || s.period === 3) {
      s.phase = 'halftime';
      s.phaseT = FB.halftimePause;
    } else {
      s.phase = 'fulltime';
      s.phaseT = 3;
    }
  }

  // ── Penalty shootout ──────────────────────────────────────────────────

  private startShootout() {
    const s = this.s;
    s.period = 5;
    s.added = 0;
    s.shootout = { kicks: [[], []], next: this.i.firstKick };
    const order = (team: TeamId) =>
      s.players
        .filter(q => q.team === team && q.off !== true && !this.isGK(q.id))
        .sort((a, b) => this.ratings.get(b.id)!.shooting - this.ratings.get(a.id)!.shooting)
        .map(q => q.id);
    this.i.pens = [order(0), order(1)];
    // Everyone shoots at the same end (+z for team 0's frame)
    s.attackPlusZ = 0;
    this.push({ type: 'period', period: 5 });
    this.nextPenalty();
  }

  private nextPenalty() {
    const s = this.s;
    const so = s.shootout!;
    const team = so.next;
    const order = this.i.pens![team];
    const n = so.kicks[team].length;
    const taker = order[n % Math.max(1, order.length)] ?? null;
    const p = this.pitch;
    // Shootout at the +z end for both: attackPlusZ flips so `dir(team)` = +1
    s.attackPlusZ = team;
    const z = p.length / 2 - p.penaltySpot;
    s.restart = { kind: 'penalty', team, x: 0, z, taker };
    s.phase = 'shootout';
    s.phaseT = FB.setup + 0.6;
    this.i.penStruck = false;
    this.i.penT = 0;
    this.i.ready = 0;
    this.i.placed = false;
    this.teleportToRestart();
    // the human of that team takes it
    for (const h of Object.values(this.i.h)) {
      if (h.team === team && taker) this.setHuman(h, taker);
    }
    this.push({ type: 'restart', restart: { ...s.restart } });
  }

  private shootoutStep() {
    const s = this.s;
    const r = s.restart;
    const i = this.i;
    if (!i.penStruck) {
      if (!r || !r.taker) return;
      const t = this.player(r.taker)!;
      if (s.ball.mode === 'free' && s.ball.lastTouch === t.id) {
        i.penStruck = true;
        i.penT = 0;
        return;
      }
      if (s.phaseT > 0) return;
      i.ready += DT;
      const human = !!t.human;
      if (this.i.p[t.id].kick) return;
      if ((human && i.ready > FB.humanTakeMax) || (!human && i.ready > FB.cpuTake + 0.6)) {
        this.startKick(t, this.cpuRestartPlan(t, r));
      }
      return;
    }
    i.penT += DT;
    const b = s.ball;
    const stopped = Math.hypot(b.vx, b.vz) < 0.8 && i.penT > 0.8;
    const p = this.pitch;
    const past = b.z > p.length / 2 + p.ballRadius;
    const held = b.mode === 'held';
    if (past || stopped || held || i.penT > 3) this.shootoutResult(false);
  }

  private shootoutResult(scored: boolean) {
    const s = this.s;
    const so = s.shootout!;
    const team = so.next;
    const id = s.restart?.taker ?? '';
    so.kicks[team].push(scored);
    this.push({ type: 'shootout', team, id, scored });
    if (scored) this.push({ type: 'net', strength: 0.6 });
    // Decided?
    const k0 = so.kicks[0];
    const k1 = so.kicks[1];
    const g0 = k0.filter(Boolean).length;
    const g1 = k1.filter(Boolean).length;
    const n0 = k0.length;
    const n1 = k1.length;
    let done = false;
    if (n0 <= 5 && n1 <= 5 && !(n0 === 5 && n1 === 5)) {
      const left0 = 5 - n0;
      const left1 = 5 - n1;
      if (g0 + left0 < g1 || g1 + left1 < g0) done = true;
    } else if (n0 === n1 && g0 !== g1) done = true;
    if (n0 === 5 && n1 === 5 && g0 !== g1) done = true;
    s.ball.mode = 'dead';
    s.ball.owner = null;
    if (done) {
      this.finish();
      return;
    }
    so.next = (1 - team) as TeamId;
    this.nextPenalty();
  }

  /** Keeper.ts: the keeper caught / saved it. */
  saved(gk: PlayerState, caught: boolean) {
    const s = this.s;
    s.stats[gk.team].saves++;
    const shooter = this.player(s.ball.lastTouch);
    if (shooter && shooter.team !== gk.team) s.stats[shooter.team].onTarget++;
    this.push({ type: 'save', id: gk.id, caught });
    this.touched(gk);
  }
}

const NO_PAD_FULL: PadInput = {
  mx: 0,
  mz: 0,
  sprint: false,
  pass: false,
  shoot: false,
  lob: false,
  through: false,
  switchP: false,
  finesse: false,
  jockey: false,
  rx: 0,
  rz: 0,
};

/** Turn a launch's horizontal velocity (and its spin axis) by `a` radians. */
function rotate(l: { vx: number; vz: number; wx?: number; wz?: number }, a: number) {
  if (a === 0) return;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const vx = l.vx * c + l.vz * s;
  const vz = -l.vx * s + l.vz * c;
  l.vx = vx;
  l.vz = vz;
  if (l.wx !== undefined && l.wz !== undefined) {
    const wx = l.wx * c + l.wz * s;
    const wz = -l.wx * s + l.wz * c;
    l.wx = wx;
    l.wz = wz;
  }
}

export { BALL, clamp, wrapAngle, secondLastLine };
export type { BallState };

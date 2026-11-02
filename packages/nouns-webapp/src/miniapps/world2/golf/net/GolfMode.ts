// ── Noun Golf mode: `game.golf` (GolfApi), the round and the Game.ts hook ─
//
// Everything between "you walked up to the 1st tee" and "card signed":
//
//   arrive()      `/world?play=golf`, the map's TEE OFF: on foot by the 1st
//                 tee of NOUN LINKS, the menu open;
//   the menu      SOLO / VS CPU (1–3, four skills) / WITH players near you,
//                 which holes (all 19, front 9, back 9, the 19th), wind;
//   address       your Noun at the ball with a club: aim (A/D, ←/→, drag,
//                 the stick), club (W/S, ↑/↓, the bag), the three-press
//                 swing meter (SPACE / the SWING button / gamepad A);
//   flight        the ball flown by the sim, a follow camera that hands over
//                 to one at the landing; the call (BIRDIE, IN THE WATER…);
//   between       solo: NEXT SHOT walks you there, or WALK / DRIVE lets you
//                 go yourself (a buggy's yours to take); back at the ball, E
//                 (or the PLAY SHOT button) addresses it. With others every
//                 shot follows on (the camera goes to whoever's up);
//   the card      after each hole, the scorecard; at the end, the totals,
//                 a local best per set of holes and respect for a win.
//
// Game.ts calls `idle(dt)` every normal frame and hands the whole frame to
// `step(dt)` while `active` (the skater's physics and camera wait, the
// mountain keeps streaming round the ball).

import type { Game } from '../../Game';
import type { RespectApi } from '../../interiors/contract';
import type {
  ClubId,
  GolfApi,
  GolfConfig,
  GolfMsg,
  GolfPlayer,
  Lie,
  RoundState,
  ShotResult,
  SwingInput,
  V3,
} from '../contract';

import * as THREE from 'three';

import { seedKey } from '../../character/NounAppearance';
import { toWorld } from '../course/site';
import { golfCourse, golfCourseBuilt, type GolfCourse } from '../course/surface';
import { BallView } from '../play/BallView';
import { Golfer, PUTT, SWING, swingAngle } from '../play/Golfer';
import {
  type HoleInfo,
  CLUBS,
  applyShot,
  ballOf,
  clubOrder,
  cpuThink,
  currentHole,
  hashString,
  holeInfoFrom,
  launchOf,
  meterAt,
  meterIdle,
  meterPress,
  mulberry32,
  newRound,
  nextHole,
  scoreName,
  simulateShot,
  suggestClub,
  toPar,
  totals,
  winners,
  type MeterState,
  type MeterView,
} from '../sim';

import { GolfSession, type GolfTransport, type SessionEvent } from './session';
import { bumpLife, readBest, saveBest, type GolfBest } from './store';

export type GolfPhase = 'idle' | 'menu' | 'address' | 'flight' | 'watch' | 'card' | 'results';
export type Opponents = 0 | 1 | 2 | 3;
export type Skill = 'easy' | 'club' | 'pro' | 'tour';
export type HoleSet = 'all' | 'front' | 'back' | 'nineteen';

export const SKILL: Record<Skill, number> = { easy: 0.35, club: 0.6, pro: 0.82, tour: 0.96 };
const CPU_NAMES = ['NOUNDER', 'LIL NOUN', 'PROP HOUSE', 'THE TREASURY'];
export const SETS: Record<HoleSet, number[]> = {
  all: Array.from({ length: 19 }, (_, i) => i + 1),
  front: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  back: [10, 11, 12, 13, 14, 15, 16, 17, 18],
  nineteen: [19],
};

/** Respect for winning a match (the rules clamp custom to ±10 and rate-limit it). */
const WIN_RESPECT = { cpu: 4, human: 8 } as const;

export interface GolfUiState {
  phase: GolfPhase;
  /** Near the course's tee / starter with no round: offer PLAY GOLF. */
  offer: boolean;
  /** Between shots, close enough to the ball: offer PLAY SHOT. */
  atBall: boolean;
  online: boolean;
  near: { id: string; name: string }[];
  incoming: { from: string; name: string } | null;
  opponents: Opponents;
  skill: Skill;
  set: HoleSet;
  wind: number;
  // ── In a round ──
  players: { name: string; human: boolean; me: boolean }[];
  turn: number;
  myTurn: boolean;
  hole: { n: number; par: number; name: string; length: number } | null;
  /** Per player: strokes this hole, total, to par. */
  scores: { now: number; total: number; toPar: number; holed: boolean }[];
  card: (number | null)[][];
  pars: number[];
  holes: number[];
  club: ClubId;
  aimDeg: number;
  lie: Lie;
  toPin: number;
  /** Rough carry of the club as chosen (m), wind speed (m/s) and its bearing relative to the aim (rad). */
  carry: number;
  windSpeed: number;
  windRel: number;
  meter: MeterView;
  putting: boolean;
  line: string;
  call: { text: string; at: number; big: boolean } | null;
  thinking: boolean;
  best: GolfBest | null;
  results: null | {
    totals: number[];
    toPar: number[];
    winner: string;
    won: boolean | null;
    newBest: boolean;
    respect: number | null;
  };
  view: 'behind' | 'target' | 'top';
  /** Esc mid-round: QUIT? */
  quitAsk: boolean;
}

function offlineFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('offline') === '1';
}

class NetGolf implements GolfTransport {
  onMessage: ((m: GolfMsg) => void) | null = null;
  constructor(
    private game: Game,
    private offline: boolean,
  ) {
    game.net.onGolf = raw => {
      const m = readGolf(raw);
      if (m !== null) this.onMessage?.(m);
    };
  }
  get id() {
    return this.offline ? 'me' : this.game.net.myId || 'me';
  }
  get online() {
    return !this.offline && this.game.net.connected;
  }
  send(m: GolfMsg) {
    if (this.online) this.game.net.sendGolf(m);
  }
}

const okStr = (v: unknown, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;
const okNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** A light check of what arrives (the relay already rewrote the ids). */
export function readGolf(raw: Record<string, unknown>): GolfMsg | null {
  const t = raw.type;
  if (typeof t !== 'string' || !t.startsWith('golf:')) return null;
  switch (t) {
    case 'golf:shot': {
      const s = raw.swing as Record<string, unknown> | undefined;
      if (!okStr(raw.gid) || !okNum(raw.n) || s === undefined) return null;
      if (!okStr(s.club, 4) || !okNum(s.aim) || !okNum(s.power) || !okNum(s.accuracy)) return null;
      if (!((s.club as string) in CLUBS)) return null;
      return raw as unknown as GolfMsg;
    }
    case 'golf:start':
    case 'golf:result': {
      const c = (raw.config ?? (raw.state as { config?: unknown } | undefined)?.config) as
        | { players?: unknown; holes?: unknown }
        | undefined;
      if (
        t === 'golf:start' &&
        (c === undefined || !Array.isArray(c.players) || !Array.isArray(c.holes))
      )
        return null;
      return raw as unknown as GolfMsg;
    }
    default:
      return raw as unknown as GolfMsg;
  }
}

const viewYaw = (dx: number, dz: number) => Math.atan2(dx, dz);
const flat = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.z - b.z);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

interface Flight {
  by: number;
  result: ShotResult;
  swing: SwingInput;
  /** Seconds since the swing started; the ball leaves at `impact`. */
  t: number;
  impact: number;
  putt: boolean;
  from: V3;
  /** Next state, applied when the ball's at rest. */
  next: RoundState | null;
  done: boolean;
  callAt: number;
}

export class GolfMode implements GolfApi {
  phase: GolfPhase = 'idle';
  ui: GolfUiState;
  session: GolfSession | null = null;
  private course_: GolfCourse | null = null;
  private infos: HoleInfo[] = [];
  private transport: NetGolf;
  private listeners = new Set<() => void>();
  private ball: BallView | null = null;
  private golfer: Golfer | null = null;
  private meter: MeterState = meterIdle();
  private clock = 0;
  private aim = 0;
  private club: ClubId = 'D';
  private flight: Flight | null = null;
  private cpuGen: Generator<void, SwingInput, void> | null = null;
  private cpuWait = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  /** Free between shots (walking / driving to the ball). */
  private roaming = false;
  private guideDirty = true;
  private guideT = 0;
  private emitT = 0;
  private lobbyT = 0;
  private keys = new Set<string>();
  readonly focus = new THREE.Vector3();
  readonly focusVel = new THREE.Vector3();
  private warmed = false;

  constructor(private game: Game) {
    this.transport = new NetGolf(game, offlineFlag());
    this.transport.onMessage = m => this.onMsg(m);
    this.ui = {
      phase: 'idle',
      offer: false,
      atBall: false,
      online: false,
      near: [],
      incoming: null,
      opponents: 0,
      skill: 'club',
      set: 'all',
      wind: 0.5,
      players: [],
      turn: 0,
      myTurn: false,
      hole: null,
      scores: [],
      card: [],
      pars: [],
      holes: [],
      club: 'D',
      aimDeg: 0,
      lie: 'tee',
      toPin: 0,
      carry: 0,
      windSpeed: 0,
      windRel: 0,
      meter: meterAt(meterIdle(), 0),
      putting: false,
      line: '',
      call: null,
      thinking: false,
      best: null,
      results: null,
      view: 'behind',
      quitAsk: false,
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey, true);
      window.addEventListener('keyup', this.onKeyUp, true);
    }
  }

  // ── GolfApi ────────────────────────────────────────────────────────────

  get active(): boolean {
    return this.phase !== 'idle';
  }

  get round(): RoundState | null {
    return this.session?.state ?? null;
  }

  get course(): GolfCourse {
    if (this.course_ === null) {
      // Built by the terrain already once anyone's near; else build it now
      this.course_ = golfCourse();
      this.infos = this.course_.layout.holes.map(h => ({
        ...holeInfoFrom(h, this.course_!),
      }));
    }
    return this.course_;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.ui = { ...this.ui, phase: this.phase };
    for (const l of this.listeners) l();
  }

  /** Map pin for the full map. */
  mapPoint(): { x: number; z: number; name: string; icon: string; found: boolean } {
    // From the site frame alone: building the course just to draw a pin would be a hitch
    const p = toWorld(1500, 120, { x: 0, z: 0 });
    return { x: p.x, z: p.z, name: 'NOUN LINKS (golf)', icon: '⛳', found: true };
  }

  arrive(): boolean {
    const g = this.game;
    if (g.me === null || this.phase !== 'idle') return false;
    if (g.cars.inCar) return false;
    const s = this.course.layout.spawn;
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard();
    p.mode = 'foot';
    p.spawn(new THREE.Vector3(s.x, s.y + 0.2, s.z), s.yaw);
    g.cam.snap(p);
    this.openMenu();
    return true;
  }

  openMenu() {
    if (this.session !== null) return;
    this.ui.best = readBest('noun-links', SETS[this.ui.set]);
    this.phase = 'menu';
    this.ui.offer = false;
    this.emit();
  }

  closeMenu() {
    if (this.phase !== 'menu') return;
    this.phase = 'idle';
    this.emit();
  }

  setOption(o: Partial<Pick<GolfUiState, 'opponents' | 'skill' | 'set' | 'wind'>>) {
    Object.assign(this.ui, o);
    if (o.set !== undefined) this.ui.best = readBest('noun-links', SETS[o.set]);
    this.emit();
  }

  leave() {
    if (this.session !== null) this.session.leave();
    this.endRound();
  }

  // ── Starting ───────────────────────────────────────────────────────────

  /** Start a round with the menu's options (+ invited players who said yes). */
  start(humans: GolfPlayer[] = []) {
    const g = this.game;
    const me = this.transport.id;
    const seed = (Math.random() * 2 ** 31) | 0;
    const players: GolfPlayer[] = [
      {
        id: me,
        name: (g.name || 'you').toUpperCase().slice(0, 14),
        human: true,
        seedKey: seedKey(g.seed),
      },
      ...humans,
    ];
    for (let i = 0; i < this.ui.opponents && players.length < 4; i++)
      players.push({
        id: `cpu:${i + 1}`,
        name: CPU_NAMES[i],
        human: false,
        skill: SKILL[this.ui.skill],
      });
    const config: GolfConfig = {
      gid: `golf-${seed.toString(36)}`,
      seed,
      players,
      holes: SETS[this.ui.set],
      wind: this.ui.wind,
    };
    this.begin(config, me, null);
    if (this.transport.online && humans.length > 0)
      this.transport.send({ type: 'golf:start', config });
  }

  private begin(config: GolfConfig, host: string, state: RoundState | null) {
    void this.course;
    const s = state ?? newRound(config, this.infos);
    this.session = new GolfSession(config, s, host, this.transport, {
      simulate: (st, by, sw) => this.simulate(st, by, sw),
      apply: (st, by, r) => this.applyRules(st, by, r),
      cpu: (st, by) => {
        // (only reached if a CPU swing wasn't thought through over frames)
        const gen = this.cpuThinkFor(st, by);
        for (;;) {
          const n = gen.next();
          if (n.done === true) return n.value;
        }
      },
    });
    this.session.onEvent = e => this.onSession(e);
    this.ensureView();
    this.ui.results = null;
    this.ui.players = config.players.map(p => ({
      name: p.name,
      human: p.human,
      me: p.id === this.transport.id,
    }));
    this.ui.holes = config.holes;
    this.ui.pars = config.holes.map(n => this.infos[n - 1].par);
    this.roaming = false;
    this.toTee();
  }

  private cpuThinkFor(st: RoundState, by: number) {
    const info = this.info(st);
    const p = st.config.players[by];
    const rng = mulberry32(hashString(`${st.config.gid}:${st.n}`));
    return cpuThink(this.course, st, by, info, rng, p.skill ?? 0.6);
  }

  private info(st: RoundState): HoleInfo {
    return currentHole(st, this.infos) ?? this.infos[0];
  }

  // ── The sim seam ───────────────────────────────────────────────────────

  private simulate(st: RoundState, by: number, swing: SwingInput): ShotResult {
    const info = this.info(st);
    const from = ballOf(st, by, info);
    const lie: Lie = st.cur[by].ball !== null ? st.cur[by].lie : 'tee';
    const normal = this.course.normal(from.x, from.z, { x: 0, y: 1, z: 0 });
    const launch = launchOf(swing, lie, normal);
    return simulateShot(this.course, from, lie, launch, st.wind, info.pin, {
      seed: st.n + st.config.seed,
    });
  }

  private applyRules(st: RoundState, by: number, r: ShotResult): RoundState {
    return applyShot(st, by, r, this.info(st));
  }

  // ── Session events ─────────────────────────────────────────────────────

  private onSession(e: SessionEvent) {
    const s = this.session;
    if (s === null) return;
    if (e.kind === 'shot') {
      const info = this.info(s.state);
      const from = ballOf(s.state, e.by, info);
      const putt = e.swing.club === 'P';
      this.flight = {
        by: e.by,
        result: e.result,
        swing: e.swing,
        t: 0,
        impact: putt ? PUTT.IMPACT : SWING.IMPACT,
        putt,
        from,
        next: null,
        done: false,
        callAt: 0,
      };
      this.meter = meterIdle();
      this.ball?.hideGuides();
      this.ball?.clearTrail();
      // The shooter at their ball
      this.placeGolfer(from, e.swing.aim);
      this.phase = 'flight';
      this.camInit = false;
      this.emit();
      return;
    }
    if (e.kind === 'state') {
      if (this.flight !== null && !this.flight.done) this.flight.next = e.state;
      else this.afterState(e.state);
      return;
    }
    if (e.kind === 'end') {
      this.call(e.reason.toUpperCase(), false);
      this.finish(true);
    }
  }

  /** The round moved on: next shot, the card, or the end. */
  private afterState(st: RoundState) {
    const s = this.session;
    if (s === null) return;
    const info = this.info(st);
    // Hole finished: everyone holed / picked up
    if (st.phase === 'holed') {
      this.phase = 'card';
      this.ui.line = `HOLE ${info.n} DONE`;
      this.refresh();
      this.emit();
      return;
    }
    if (st.phase === 'over') {
      this.finish(false);
      return;
    }
    this.nextTurn();
  }

  /** Card read: on to the next hole (host decides; clients follow the state). */
  continueCard() {
    const s = this.session;
    if (s === null || this.phase !== 'card') return;
    if (s.role === 'host') {
      const next = nextHole(s.state, this.infos);
      s.state = next;
      if (
        this.transport.online &&
        s.config.players.some(p => p.human && p.id !== this.transport.id)
      )
        this.transport.send({
          type: 'golf:result',
          gid: s.gid,
          n: next.n,
          swing: { club: 'P', aim: 0, power: 0, accuracy: 0 },
          state: next,
        });
      if (next.phase === 'over') {
        this.finish(false);
        return;
      }
    }
    this.toTee();
  }

  private toTee() {
    const s = this.session;
    if (s === null) return;
    const info = this.info(s.state);
    const g = this.game;
    // Stand by the tee
    const t = info.teeSpot;
    const yaw = viewYaw(info.pin.x - t.x, info.pin.z - t.z);
    g.player.spawn(
      new THREE.Vector3(
        t.x - Math.sin(yaw) * 3 + Math.cos(yaw) * 2.5,
        t.y + 0.2,
        t.z - Math.cos(yaw) * 3 - Math.sin(yaw) * 2.5,
      ),
      yaw,
    );
    this.nextTurn();
  }

  private nextTurn() {
    const s = this.session;
    if (s === null) return;
    const st = s.state;
    const info = this.info(st);
    const by = st.turn;
    const from = ballOf(st, by, info);
    this.refresh();
    if (s.myTurn) {
      // Solo, after the tee: let them walk / drive if they want
      const solo = st.config.players.filter(p => p.human).length === 1;
      const onTee = st.cur[by].ball === null;
      if (solo && !onTee && this.roaming) {
        this.phase = 'idle';
        this.emit();
        return;
      }
      this.address(from);
      return;
    }
    // Someone else: watch their ball (and think for a CPU)
    this.phase = 'watch';
    this.cpuGen = s.cpuTurn ? this.cpuThinkFor(st, by) : null;
    this.cpuWait = 0.9;
    this.ui.thinking = s.cpuTurn;
    this.placeGolfer(from, viewYaw(info.pin.x - from.x, info.pin.z - from.z));
    this.ball?.setBall(from, 10);
    this.camInit = false;
    this.emit();
  }

  private address(from: V3) {
    const s = this.session!;
    const st = s.state;
    const info = this.info(st);
    const lie: Lie = st.cur[st.turn].ball !== null ? st.cur[st.turn].lie : 'tee';
    const d = flat(from, info.pin);
    this.club = lie === 'green' ? 'P' : suggestClub(d, lie);
    this.aim = this.defaultAim(from, info, this.club);
    this.meter = meterIdle();
    this.phase = 'address';
    this.camInit = false;
    this.guideDirty = true;
    this.placeGolfer(from, this.aim);
    this.ball?.showBall(true);
    this.ball?.setBall(from, 4);
    this.ball?.clearTrail();
    this.refresh();
    this.emit();
  }

  /** At the pin, or down the hole's line at the club's carry if the pin's out of reach. */
  private defaultAim(from: V3, info: HoleInfo, club: ClubId): number {
    const d = flat(from, info.pin);
    const carry = CLUBS[club].carry;
    if (club === 'P' || d <= carry * 1.05 || info.line === undefined)
      return viewYaw(info.pin.x - from.x, info.pin.z - from.z);
    // The point on the line `carry` m away from the ball
    const line = info.line;
    let best = info.pin as { x: number; z: number };
    let bestErr = Infinity;
    for (let i = 1; i < line.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const x = line[i - 1].x + (line[i].x - line[i - 1].x) * (k / 20);
        const z = line[i - 1].z + (line[i].z - line[i - 1].z) * (k / 20);
        const err = Math.abs(Math.hypot(x - from.x, z - from.z) - carry);
        const ahead = Math.hypot(x - info.pin.x, z - info.pin.z) < d;
        if (ahead && err < bestErr) {
          bestErr = err;
          best = { x, z };
        }
      }
    }
    return viewYaw(best.x - from.x, best.z - from.z);
  }

  // ── Player actions (UI + keys) ─────────────────────────────────────────

  /** SPACE / the SWING button / gamepad A: the three-press meter. */
  press() {
    const s = this.session;
    if (s === null || this.phase !== 'address' || !s.myTurn) return;
    this.meter = meterPress(this.meter, this.clock);
    const v = meterAt(this.meter, this.clock);
    if (v.phase === 'done' && v.result !== null) this.fire(v.result.power, v.result.accuracy);
    this.emit();
  }

  private fire(power: number, accuracy: number) {
    const s = this.session;
    if (s === null) return;
    const swing: SwingInput = { club: this.club, aim: this.aim, power, accuracy };
    this.roaming = false;
    s.swing(swing);
  }

  turnAim(d: number) {
    if (this.phase !== 'address') return;
    this.aim += d;
    this.guideDirty = true;
  }

  stepClub(d: number) {
    if (this.phase !== 'address' || this.meter.phase !== 'idle') return;
    const i = clubOrder.indexOf(this.club);
    const n = THREE.MathUtils.clamp(i + d, 0, clubOrder.length - 1);
    this.club = clubOrder[n];
    this.guideDirty = true;
    this.refresh();
    this.emit();
  }

  setClub(c: ClubId) {
    if (this.phase !== 'address' || this.meter.phase !== 'idle') return;
    this.club = c;
    this.guideDirty = true;
    this.refresh();
    this.emit();
  }

  cycleView() {
    const order: GolfUiState['view'][] = ['behind', 'target', 'top'];
    this.ui.view = order[(order.indexOf(this.ui.view) + 1) % order.length];
    this.camInit = false;
    this.emit();
  }

  /** After my shot (solo): walk or drive to it myself. */
  roam() {
    const s = this.session;
    if (s === null) return;
    this.roaming = true;
    this.golfer?.hide();
    this.phase = 'idle';
    this.restoreCamera();
    this.emit();
  }

  /** Back at the ball (or the NEXT SHOT button): address it. */
  playShot() {
    const s = this.session;
    if (s === null || !s.myTurn) return;
    this.roaming = false;
    const from = ballOf(s.state, s.state.turn, this.info(s.state));
    this.address(from);
  }

  /** Give up the hole (max strokes) — not offered with others. */
  skip() {
    this.call('PICKED UP', false);
  }

  // ── Frames ─────────────────────────────────────────────────────────────

  /** Every normal frame (not active). */
  idle(dt: number) {
    this.clock += dt;
    const g = this.game;
    const p = g.player.pos;
    // Cheap: nowhere near the course, nothing to do
    const near = this.course_ !== null || golfCourseBuilt();
    if (!near && this.session === null) return;
    const L = this.course.layout;
    const nearCourse =
      p.x > L.bounds.x0 && p.x < L.bounds.x1 && p.z > L.bounds.z0 && p.z < L.bounds.z1;
    // Buggies park while anyone's on the property
    this.syncBuggies(nearCourse);
    let offer = false;
    let atBall = false;
    if (this.session === null && nearCourse && !g.cars.inCar) {
      const s = L.spawn;
      offer = Math.hypot(p.x - s.x, p.z - s.z) < 14;
    }
    if (this.session !== null && this.roaming) {
      const st = this.session.state;
      const b = st.cur[st.turn]?.ball;
      if (b) atBall = Math.hypot(p.x - b.x, p.z - b.z) < (g.cars.inCar ? 14 : 6);
      this.ball?.setBall(
        b ?? this.info(st).teeSpot,
        g.gfx.camera.position.distanceTo(_v.set(b?.x ?? 0, b?.y ?? 0, b?.z ?? 0)),
      );
    }
    if (offer !== this.ui.offer || atBall !== this.ui.atBall) {
      this.ui.offer = offer;
      this.ui.atBall = atBall;
      this.emit();
    }
    this.lobbyTick(dt, nearCourse);
  }

  private buggiesOn = false;
  private syncBuggies(on: boolean) {
    if (on === this.buggiesOn) return;
    this.buggiesOn = on;
    const cars = this.game.cars as unknown as {
      parkBuggies?: (g: string, s: unknown[]) => void;
      clearBuggies?: (g: string) => void;
    };
    if (on) cars.parkBuggies?.('golf', this.course.layout.buggies);
    else cars.clearBuggies?.('golf');
  }

  /** While active: owns the frame. */
  step(dt: number) {
    this.clock += dt;
    const s = this.session;
    this.readHeld(dt);
    switch (this.phase) {
      case 'menu':
        this.focus.copy(this.game.player.pos);
        this.idleGolfer(dt);
        this.orbitMenu(dt);
        break;
      case 'address':
        this.stepAddress(dt);
        break;
      case 'flight':
        this.stepFlight(dt);
        break;
      case 'watch':
        this.stepWatch(dt);
        break;
      case 'card':
      case 'results':
        this.idleGolfer(dt);
        break;
      default:
        break;
    }
    void s;
    this.emitT -= dt;
    if (this.emitT <= 0 && (this.phase === 'address' || this.phase === 'flight')) {
      this.emitT = 0.05;
      this.ui.meter = meterAt(this.meter, this.clock);
      this.emit();
    }
  }

  private stepAddress(dt: number) {
    const s = this.session!;
    const st = s.state;
    const info = this.info(st);
    const from = ballOf(st, st.turn, info);
    this.focus.set(from.x, from.y, from.z);
    this.focusVel.set(0, 0, 0);
    // Meter timeouts (overswing auto-lock, the missed third press)
    const v = meterAt(this.meter, this.clock);
    if (v.phase === 'done' && v.result !== null && this.meter.phase !== 'idle') {
      this.meter = meterIdle();
      this.fire(v.result.power, v.result.accuracy);
      return;
    }
    this.placeGolfer(from, this.aim);
    const putt = this.club === 'P';
    this.poseGolfer(dt, putt ? -0.05 - v.fill * 0.5 : -v.fill * 1.8, putt);
    this.guideT -= dt;
    if (this.guideDirty && this.guideT <= 0) {
      this.guideDirty = false;
      this.guideT = 0.12;
      this.updateGuide(from, info);
      this.refresh();
      this.emit();
    }
    this.ball?.setBall(
      from,
      this.game.gfx.camera.position.distanceTo(_v.set(from.x, from.y, from.z)),
    );
    this.aimCamera(dt, from, info);
  }

  private updateGuide(from: V3, info: HoleInfo) {
    const b = this.ball;
    if (b === null) return;
    const lie = this.ui.lie;
    const C = this.course;
    if (this.club === 'P') {
      // Straight putt line to the hole's distance, slope dots round the hole
      const d = Math.min(30, flat(from, info.pin) * 1.05);
      const pts: V3[] = [];
      for (let i = 1; i <= 24; i++) {
        const k = (d * i) / 24;
        const x = from.x + Math.sin(this.aim) * k;
        const z = from.z + Math.cos(this.aim) * k;
        pts.push({ x, y: C.height(x, z), z });
      }
      b.setGuide(pts, false);
      b.setCup(info.pin);
      const dots: { x: number; y: number; z: number; dx: number; dz: number; g: number }[] = [];
      const n = { x: 0, y: 1, z: 0 };
      const mx = (from.x + info.pin.x) / 2;
      const mz = (from.z + info.pin.z) / 2;
      const R = Math.min(16, flat(from, info.pin) / 2 + 4);
      for (let i = -6; i <= 6; i++)
        for (let k = -6; k <= 6; k++) {
          const x = mx + (i / 6) * R;
          const z = mz + (k / 6) * R;
          const l = C.lie(x, z);
          if (l !== 'green' && l !== 'fringe') continue;
          C.normal(x, z, n);
          const gr = Math.hypot(n.x, n.z) / n.y;
          dots.push({ x, y: C.height(x, z), z, dx: n.x, dz: n.z, g: gr });
        }
      b.setSlope(dots);
      return;
    }
    // A still-air preview of a full, pure strike
    const normal = C.normal(from.x, from.z, { x: 0, y: 1, z: 0 });
    const launch = launchOf({ club: this.club, aim: this.aim, power: 1, accuracy: 0 }, lie, normal);
    const r = simulateShot(C, from, lie, launch, { x: 0, z: 0 }, info.pin, {
      noPath: false,
      maxTime: 12,
    });
    // Dots along the flight's ground track to the first landing
    const land = r.events.find(
      e => e.kind === 'land' || e.kind === 'water' || e.kind === 'ob' || e.kind === 'tree',
    );
    const at = land?.at ?? r.rest;
    const pts: V3[] = [];
    const d = flat(from, at);
    for (let i = 1; i <= 30; i++) {
      const k = (d * i) / 30;
      const x = from.x + ((at.x - from.x) * k) / Math.max(1, d);
      const z = from.z + ((at.z - from.z) * k) / Math.max(1, d);
      pts.push({ x, y: C.height(x, z), z });
    }
    b.setGuide(pts, true, Math.max(1.5, d * 0.03));
    b.setCup(null);
    b.setSlope([]);
    this.ui.carry = Math.round(r.carry);
  }

  private stepFlight(dt: number) {
    const f = this.flight;
    if (f === null) return;
    const fast = this.keys.has('Space') || this.keys.has('fast') ? 3 : 1;
    f.t += dt * (f.t > f.impact ? fast : 1);
    // The swing
    const sw = swingAngle(f.t, f.swing.power, f.putt);
    if (f.by === this.session?.me) this.poseGolfer(dt, sw, f.putt);
    else this.poseGolfer(dt, sw, f.putt);
    const tt = f.t - f.impact;
    const path = f.result.path;
    let pos: V3 = f.from;
    if (tt > 0 && path.length > 0) {
      const k = Math.min(path.length - 1, tt * 30);
      const i = Math.floor(k);
      const a = path[i];
      const b = path[Math.min(path.length - 1, i + 1)];
      const u = k - i;
      pos = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
      this.ball?.setTrail(path, i, pos);
      if (k >= path.length - 1 && !f.done) {
        f.done = true;
        f.callAt = this.clock;
        this.callShot(f);
      }
    }
    if (f.done) pos = f.result.rest;
    this.ball?.showBall(!f.result.holed || !f.done);
    this.ball?.setBall(pos, this.game.gfx.camera.position.distanceTo(_v.set(pos.x, pos.y, pos.z)));
    this.focusVel
      .set(pos.x - this.focus.x, pos.y - this.focus.y, pos.z - this.focus.z)
      .divideScalar(Math.max(dt, 1e-3));
    this.focus.set(pos.x, pos.y, pos.z);
    this.flightCamera(dt, f, pos, tt);
    // A beat to read the call, then on
    if (f.done && this.clock - f.callAt > (f.result.holed ? 2.6 : 1.6)) {
      this.flight = null;
      const s = this.session;
      if (s === null) return;
      const next = f.next ?? s.state;
      const solo = s.config.players.filter(p => p.human).length === 1;
      const mine = f.by === s.me;
      if (
        solo &&
        mine &&
        next.phase === 'play' &&
        next.turn === s.me &&
        !next.cur[s.me].holed &&
        this.ui.view !== 'top'
      ) {
        // Solo: they choose NEXT SHOT or WALK / DRIVE (the UI shows both)
        this.phase = 'watch';
        this.awaitChoice = true;
        this.refresh();
        this.emit();
        return;
      }
      this.afterState(next);
    }
  }

  /** Solo, the ball's at rest: the UI offers NEXT SHOT / WALK. */
  awaitChoice = false;

  nextShot() {
    if (!this.awaitChoice) return;
    this.awaitChoice = false;
    this.afterState(this.session!.state);
  }

  walk() {
    if (!this.awaitChoice) return;
    this.awaitChoice = false;
    const s = this.session!;
    // Stand beside the ball where it lies, then let go
    const b = s.state.cur[s.me].ball;
    if (b) {
      const info = this.info(s.state);
      const yaw = viewYaw(info.pin.x - b.x, info.pin.z - b.z);
      this.game.player.spawn(
        new THREE.Vector3(b.x - Math.cos(yaw) * 1.4, b.y + 0.2, b.z + Math.sin(yaw) * 1.4),
        yaw,
      );
    }
    this.roam();
  }

  private stepWatch(dt: number) {
    const s = this.session;
    if (s === null) return;
    const st = s.state;
    const info = this.info(st);
    const from = ballOf(st, st.turn, info);
    this.focus.set(from.x, from.y, from.z);
    this.idleGolfer(dt);
    this.aimCamera(dt, from, info);
    if (this.awaitChoice) return;
    // A CPU thinks over frames, then plays after a short beat
    if (this.cpuGen !== null) {
      const t0 = performance.now();
      while (performance.now() - t0 < 4) {
        const n = this.cpuGen.next();
        if (n.done === true) {
          const swing = n.value;
          this.cpuGen = null;
          this.pendingCpu = swing;
          break;
        }
      }
    }
    this.cpuWait -= dt;
    if (this.pendingCpu !== null && this.cpuWait <= 0) {
      const swing = this.pendingCpu;
      this.pendingCpu = null;
      this.ui.thinking = false;
      // Fly the swing we thought of (the session plays it as the host)
      const deps = (s as unknown as { deps: { cpu: () => SwingInput } }).deps;
      const orig = deps.cpu;
      deps.cpu = () => swing;
      s.playCpu();
      deps.cpu = orig;
    }
  }

  private pendingCpu: SwingInput | null = null;

  // ── The golfer ─────────────────────────────────────────────────────────

  private placeGolfer(ball: V3, aim: number) {
    const me = this.game.me;
    if (me === null) return;
    const s = this.session;
    const mine = s === null || s.state.turn === s.me || this.phase === 'menu';
    this.golfer?.bind(mine ? me : null);
    if (!mine) {
      this.golfer?.hide();
      return;
    }
    // Side-on, target on the left: face = aim + 90°
    const face = aim + Math.PI / 2;
    const club = this.club === 'P' || this.flight?.putt === true;
    const back = club ? 0.62 : 0.85;
    const x = ball.x - Math.sin(face) * back;
    const z = ball.z - Math.cos(face) * back;
    const p = this.game.player;
    if (p.mode === 'board') p.toggleBoard();
    p.mode = 'foot';
    p.pos.set(x, this.course.height(x, z), z);
    p.vel.set(0, 0, 0);
    p.footYaw = face;
    me.root.position.copy(p.pos);
    me.root.quaternion.setFromAxisAngle(_w.set(0, 1, 0), face);
    me.board.visible = false;
  }

  private poseGolfer(dt: number, theta: number, putt: boolean) {
    const me = this.game.me;
    if (me === null || this.golfer === null) return;
    const s = this.session;
    if (s !== null && s.state.turn !== s.me && this.flight?.by !== s.me) return;
    me.play({ clip: 'idle', fade: 0.2 });
    me.update(dt, { lean: 0, travelled: 0 });
    this.golfer.pose(theta, putt ? 0.85 : clubLength(this.flight?.swing.club ?? this.club), putt);
  }

  private idleGolfer(dt: number) {
    const me = this.game.me;
    if (me === null) return;
    me.play({ clip: 'idle', fade: 0.2 });
    me.update(dt, { lean: 0, travelled: 0 });
  }

  // ── Cameras ────────────────────────────────────────────────────────────

  private setCam(dt: number, pos: THREE.Vector3, look: THREE.Vector3, k = 5) {
    const cam = this.game.gfx.camera;
    if (!this.camInit) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.camInit = true;
    } else {
      const a = 1 - Math.exp(-k * dt);
      this.camPos.lerp(pos, a);
      this.camLook.lerp(look, a);
    }
    // Never under the ground
    const gy = this.course.height(this.camPos.x, this.camPos.z) + 0.6;
    if (this.camPos.y < gy) this.camPos.y = gy;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  private aimCamera(dt: number, from: V3, info: HoleInfo) {
    const aim = this.aim;
    const fx = Math.sin(aim);
    const fz = Math.cos(aim);
    const putt = this.club === 'P';
    const view = this.ui.view;
    if (view === 'top') {
      const d = Math.min(260, flat(from, info.pin));
      const cx = from.x + fx * d * 0.5;
      const cz = from.z + fz * d * 0.5;
      this.setCam(
        dt,
        _v.set(cx - fx * 5, from.y + Math.max(40, d * 0.9), cz - fz * 5),
        _w.set(cx, from.y, cz),
        4,
      );
      return;
    }
    if (view === 'target') {
      const t = this.ball?.ringAt() ?? info.pin;
      this.setCam(
        dt,
        _v.set(t.x + fx * 25, t.y + 14, t.z + fz * 25),
        _w.set(from.x, from.y, from.z),
        4,
      );
      return;
    }
    const back = putt ? 3.4 : 5.6;
    const up = putt ? 1.7 : 2.6;
    const ahead = putt ? Math.min(12, flat(from, info.pin)) : 40;
    // Off to the side away from the golfer, so their head isn't in the way
    const sx = Math.sin(aim + Math.PI / 2) * (putt ? 1.1 : 1.6);
    const sz = Math.cos(aim + Math.PI / 2) * (putt ? 1.1 : 1.6);
    this.setCam(
      dt,
      _v.set(from.x - fx * back + sx, from.y + up, from.z - fz * back + sz),
      _w.set(from.x + fx * ahead, from.y + (putt ? 0 : 3), from.z + fz * ahead),
      8,
    );
  }

  private flightCamera(dt: number, f: Flight, pos: V3, tt: number) {
    const r = f.result;
    const fx = Math.sin(f.swing.aim);
    const fz = Math.cos(f.swing.aim);
    if (f.putt || tt < 0) {
      const back = f.putt ? 3.2 : 5.2;
      this.setCam(
        dt,
        _v.set(f.from.x - fx * back, f.from.y + (f.putt ? 1.5 : 2.1), f.from.z - fz * back),
        _w.set(pos.x, pos.y, pos.z),
        6,
      );
      return;
    }
    const total = r.path.length / 30;
    if (tt < Math.min(2.2, total * 0.45)) {
      // Chase: behind and above the ball
      this.setCam(
        dt,
        _v.set(pos.x - fx * 9, pos.y + 4, pos.z - fz * 9),
        _w.set(pos.x + fx * 20, pos.y, pos.z + fz * 20),
        3,
      );
      return;
    }
    // At the landing: off to the side of where it ends up, looking at the ball
    const rest = r.rest;
    const side = 18;
    this.setCam(
      dt,
      _v.set(rest.x + fz * side - fx * 8, rest.y + 7, rest.z - fx * side - fz * 8),
      _w.set(pos.x, pos.y, pos.z),
      2.2,
    );
  }

  private orbitMenu(dt: number) {
    const p = this.game.player.pos;
    const a = this.clock * 0.08;
    this.setCam(
      dt,
      _v.set(p.x + Math.sin(a) * 9, p.y + 3.2, p.z + Math.cos(a) * 9),
      _w.set(p.x, p.y + 1.2, p.z),
      2,
    );
  }

  private restoreCamera() {
    this.game.cam.snap(this.game.player);
    this.camInit = false;
  }

  // ── Calls, the card, the end ───────────────────────────────────────────

  private callShot(f: Flight) {
    const s = this.session;
    if (s === null) return;
    const next = f.next ?? s.state;
    const last = next.last;
    const text = last?.call ?? (f.result.holed ? 'IN THE HOLE' : '');
    const big = f.result.holed;
    if (text) this.call(text, big);
    if (f.by === s.me && f.result.holed) {
      const info = this.info(s.state);
      const strokes = next.cur[f.by]?.strokes ?? 0;
      const name = scoreName(strokes, info.par);
      if (strokes === 1) bumpLife({ holesInOne: 1 });
      else if (name === 'BIRDIE') bumpLife({ birdies: 1 });
      else if (name === 'EAGLE' || name === 'ALBATROSS') bumpLife({ eagles: 1 });
    }
  }

  private call(text: string, big: boolean) {
    this.ui.call = { text, at: performance.now(), big };
    this.emit();
  }

  private finish(aborted: boolean) {
    const s = this.session;
    if (s === null) return;
    const st = s.state;
    const tot = totals(st);
    const tp = toPar(st, this.infos);
    const win = winners(st);
    const me = s.me;
    let newBest = false;
    let respect: number | null = null;
    const complete = !aborted && st.card.every(row => row.every(v => v !== null));
    if (complete && me >= 0) {
      bumpLife({ rounds: 1 });
      newBest = saveBest('noun-links', st.config.holes, {
        strokes: tot[me],
        par: this.ui.pars.reduce((a, b) => a + b, 0),
        card: st.card[me].map(v => v ?? 0),
        at: Date.now(),
        name: st.config.players[me].name,
      });
      const others = st.config.players.length > 1;
      if (others && win.length === 1 && win[0] === me) {
        const humans = st.config.players.some((p, i) => i !== me && p.human);
        const amount = humans ? WIN_RESPECT.human : WIN_RESPECT.cpu;
        const r = (this.game as Game & { respect?: RespectApi }).respect;
        respect = r?.add({ kind: 'custom', label: 'won at golf', amount }) ?? null;
      }
    }
    this.ui.results = {
      totals: tot,
      toPar: tp,
      winner: win.map(i => st.config.players[i].name).join(' & '),
      won: st.config.players.length > 1 ? win.includes(me) : null,
      newBest,
      respect,
    };
    this.ui.best = readBest('noun-links', st.config.holes);
    this.phase = 'results';
    this.refresh();
    this.emit();
  }

  /** Close the results / quit: back to walking round the course. */
  endRound() {
    const s = this.session;
    if (s !== null && !s.ended) s.leave();
    this.session = null;
    this.flight = null;
    this.cpuGen = null;
    this.awaitChoice = false;
    this.roaming = false;
    this.golfer?.hide();
    this.ball?.hideGuides();
    this.ball?.clearTrail();
    this.ball?.showBall(false);
    this.phase = 'idle';
    this.restoreCamera();
    this.emit();
  }

  // ── HUD state ──────────────────────────────────────────────────────────

  private refresh() {
    const s = this.session;
    if (s === null) return;
    const st = s.state;
    const info = this.info(st);
    const hole = this.course.layout.holes[info.n - 1];
    const by = st.turn;
    const from = ballOf(st, by, info);
    const lie: Lie = st.cur[by]?.ball ? st.cur[by].lie : 'tee';
    this.ui.turn = by;
    this.ui.myTurn = s.myTurn;
    this.ui.hole = { n: info.n, par: info.par, name: hole.name, length: Math.round(hole.length) };
    const tot = totals(st);
    const tp = toPar(st, this.infos);
    this.ui.scores = st.cur.map((c, i) => ({
      now: c.strokes,
      total: tot[i],
      toPar: tp[i],
      holed: c.holed,
    }));
    this.ui.card = st.card;
    this.ui.club = this.club;
    this.ui.aimDeg = Math.round(THREE.MathUtils.radToDeg(this.aim));
    this.ui.lie = lie;
    this.ui.toPin = Math.round(flat(from, info.pin) * 10) / 10;
    this.ui.putting = this.club === 'P';
    const w = st.wind;
    this.ui.windSpeed = Math.round(Math.hypot(w.x, w.z) * 10) / 10;
    this.ui.windRel = Math.atan2(w.x, w.z) - this.aim;
    if (this.club !== 'P' && this.phase !== 'address') this.ui.carry = CLUBS[this.club].carry;
    const p = st.config.players[by];
    this.ui.line = s.myTurn ? `YOUR SHOT · ${lie.toUpperCase()}` : `${p?.name ?? ''} TO PLAY`;
  }

  // ── Keys / touch drag ──────────────────────────────────────────────────

  private onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    if (this.game.paused) return;
    // Between shots: E at the ball (unless a car's right there to get into)
    if (this.phase === 'idle') {
      if (e.code !== 'KeyE') return;
      const nearCar = this.game.cars.nearestTakeable?.() ?? null;
      if (this.ui.atBall && nearCar === null && !this.game.cars.inCar) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!e.repeat) this.playShot();
      } else if (this.ui.offer && nearCar === null && !this.game.cars.inCar) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!e.repeat) this.openMenu();
      }
      return;
    }
    // While active every key is ours
    e.stopImmediatePropagation();
    if (e.code !== 'F5' && e.code !== 'F12') e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        if (this.phase === 'address') this.press();
        else if (this.awaitChoice) this.nextShot();
        else if (this.phase === 'card') this.continueCard();
        break;
      case 'KeyW':
      case 'ArrowUp':
        this.stepClub(-1);
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.stepClub(1);
        break;
      case 'KeyC':
      case 'Tab':
        this.cycleView();
        break;
      case 'KeyB':
        if (this.awaitChoice) this.walk();
        break;
      case 'Enter':
        if (this.phase === 'card') this.continueCard();
        else if (this.awaitChoice) this.nextShot();
        break;
      case 'Escape':
        if (this.phase === 'menu') this.closeMenu();
        else if (this.phase === 'results') this.endRound();
        else this.ui.quitAsk = !this.ui.quitAsk;
        this.emit();
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private readHeld(dt: number) {
    if (this.phase !== 'address' || this.meter.phase !== 'idle') return;
    const fine =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.club === 'P' ? 0.25 : 1;
    let d = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) d -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) d += 1;
    // Gamepad: left stick turns, A swings, bumpers change club
    const gp =
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads()[0]
        : null;
    if (gp !== null) {
      const x = gp.axes[0] ?? 0;
      if (Math.abs(x) > 0.18) d += x;
      const a = gp.buttons[0]?.pressed === true;
      if (a && !this.padA) this.press();
      this.padA = a;
      const lb = gp.buttons[4]?.pressed === true;
      const rb = gp.buttons[5]?.pressed === true;
      if (lb && !this.padLB) this.stepClub(-1);
      if (rb && !this.padRB) this.stepClub(1);
      this.padLB = lb;
      this.padRB = rb;
    }
    if (d !== 0) this.turnAim(d * dt * 0.9 * fine);
  }

  private padA = false;
  private padLB = false;
  private padRB = false;

  /** Touch / mouse drag on the aim strip (px since the last call). */
  dragAim(dxPx: number) {
    this.turnAim(dxPx * (this.club === 'P' ? 0.0012 : 0.004));
  }

  /** Hold the fast-forward (touch). */
  setFast(on: boolean) {
    if (on) this.keys.add('fast');
    else this.keys.delete('fast');
  }

  // ── Lobby (players near you on the course) ─────────────────────────────

  private lobbyTick(dt: number, nearCourse: boolean) {
    this.lobbyT -= dt;
    if (this.lobbyT > 0) return;
    this.lobbyT = 1;
    const g = this.game;
    const online = this.transport.online;
    const near: { id: string; name: string }[] = [];
    if (online && nearCourse)
      for (const [id, r] of g.remotes) {
        const q = r.character.root.position;
        if (q.distanceTo(g.player.pos) < 80)
          near.push({ id, name: g.net.players.get(id)?.name || 'noun' });
      }
    if (online !== this.ui.online || near.length !== this.ui.near.length) {
      this.ui.online = online;
      this.ui.near = near;
      this.emit();
    }
  }

  /** Invite someone near you (their client shows ACCEPT). */
  invite(id: string) {
    const gid = `golf-inv-${(Math.random() * 1e9) | 0}`;
    this.pendingInvite = { id, gid };
    this.transport.send({ type: 'golf:invite', to: id, gid, name: this.game.name || 'noun' });
    this.call('INVITE SENT', false);
  }

  private pendingInvite: { id: string; gid: string } | null = null;

  acceptInvite() {
    const inc = this.ui.incoming;
    if (inc === null) return;
    this.transport.send({ type: 'golf:reply', to: inc.from, gid: this.incomingGid, ok: true });
    this.ui.incoming = null;
    this.call('WAITING FOR THE HOST TO TEE OFF', false);
  }

  declineInvite() {
    const inc = this.ui.incoming;
    if (inc === null) return;
    this.transport.send({ type: 'golf:reply', to: inc.from, gid: this.incomingGid, ok: false });
    this.ui.incoming = null;
    this.emit();
  }

  private incomingGid = '';

  private onMsg(m: GolfMsg) {
    const from = 'from' in m ? m.from : undefined;
    switch (m.type) {
      case 'golf:invite':
        if (this.session !== null) return;
        this.incomingGid = m.gid;
        this.ui.incoming = { from: m.from ?? '', name: m.name ?? 'noun' };
        this.emit();
        return;
      case 'golf:reply': {
        const inv = this.pendingInvite;
        if (inv === null || m.from !== inv.id) return;
        this.pendingInvite = null;
        if (!m.ok) {
          this.call('INVITE DECLINED', false);
          return;
        }
        const r = this.game.net.players.get(inv.id);
        this.start([
          { id: inv.id, name: (r?.name || 'noun').toUpperCase().slice(0, 14), human: true },
        ]);
        return;
      }
      case 'golf:start': {
        if (this.session !== null || m.host === undefined) return;
        if (!m.config.players.some(p => p.id === this.transport.id)) return;
        this.arriveQuiet();
        this.begin(m.config, m.host, m.state ?? null);
        return;
      }
      default:
        this.session?.handle(m, from);
    }
  }

  private arriveQuiet() {
    const g = this.game;
    if (g.cars.inCar) return;
    const s = this.course.layout.spawn;
    if (g.player.pos.distanceTo(_v.set(s.x, s.y, s.z)) > 300) {
      g.player.spawn(new THREE.Vector3(s.x, s.y + 0.2, s.z), s.yaw);
      g.cam.snap(g.player);
    }
  }

  // ── Views (built on the first round, warmed so nothing links mid-shot) ─

  private ensureView() {
    const g = this.game;
    if (this.ball === null) this.ball = new BallView(g.gfx.scene);
    if (this.golfer === null) this.golfer = new Golfer(g.gfx.scene);
    if (!this.warmed) {
      this.warmed = true;
      const objs = [...this.ball.meshes, ...this.golfer.meshes];
      for (const o of objs) o.visible = true;
      try {
        g.gfx.asDrawn(() => g.gfx.renderer.compile(g.gfx.scene, g.gfx.camera));
      } catch {
        // compile is a nicety
      }
      this.ball.hideGuides();
      this.golfer.hide();
    }
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
    }
    this.session?.leave();
    this.ball?.dispose();
    this.golfer?.dispose();
  }
}

/** Club length (m) for the pose. */
function clubLength(c: ClubId): number {
  if (c === 'D') return 1.12;
  if (c === '3W' || c === '5W') return 1.06;
  if (c === 'P') return 0.85;
  return 0.95;
}

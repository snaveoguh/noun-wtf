// ── Noun Breaks: the battle itself ──────────────────────────────────────
//
// Deterministic for a config + input stream. Everything happens at a
// logical time on the battle clock, and step() works through those in
// order (ties: beat, segment, turn prep, input, expiry, turn close, card),
// so how the clock is chopped into steps never changes the outcome:
//
//   beat     a beat ticks (`beat` event)
//   segment  the phase changes (intro / turn / between / judging / final / done)
//   prep     a beat before a turn: the dancer up gets their plan (the CPU
//            plans its run and queues its key presses; humans get the
//            coach's plan, which feeds the HUD prompts)
//   input    a key press, judged against the beat grid and fed to the
//            move recogniser (see recognise.ts), and marked on the rhythm
//            lane (SimState.lane) when it's a note of the plan
//   expiry   an attempt's next key never came: the attempt ends. Expiries
//            wait LATE_SLACK past the window so a remote player's key that's
//            a little late over the network still counts.
//   close    the turn is scored (four categories, see scoring.ts)
//   card     after the round's last turn: the judges vote
//
// What things cost:
//   - an off-beat key, a key that fits nothing, or a move abandoned midway
//     is a miss: the combo resets; three in a row is a crash. A move that
//     lands with a slip (see recognise.ts) scores less and resets the combo.
//   - bailing out of a power move or freeze two keys in, or landing a move
//     that the previous one can't flow into (windmill from standing,
//     toprock straight out of a flare: you need a transition) is a crash.
//
// The coach's plan (a human's prompts) is a rhythm-game chart: it stays put
// when a note is missed (the miss scrolls past, the rest is where it was),
// and is only redrawn, from a beat and a half ahead so it scrolls in, when
// the dancer lands or commits to a different move than planned, crashes, or
// is left somewhere the next planned move can't flow from. All of that
// happens at agenda times, so the lane is as deterministic as the rest.

import type {
  BattleConfig,
  BattleSim,
  BattleSimFactory,
  BreakInput,
  BreakKey,
  CrewId,
  DancerPose,
  HitGrade,
  JudgeCard,
  LaneNote,
  MoveId,
  SimEvent,
  SimState,
  TimingWindows,
} from '../contract';

import { DEFAULT_WINDOWS } from '../contract';

import {
  beatAt,
  buildSchedule,
  type Clock,
  isDownbeat,
  makeClock,
  type Schedule,
  type Segment,
  timeOf,
  type TurnSlot,
} from './clock';
import { canFlow, type FlowFrom, keyBeat, MOVES } from './moves';
import { coachOpts, cpuInputs, cpuOpts, planTurn, type PlannedMove } from './planner';
import {
  advance,
  type Attempt,
  type Candidate,
  committedFamily,
  expire,
  leading,
  nextDeadline,
  progress,
  startAttempt,
  timingFactor,
} from './recognise';
import { hashSeed, type RngHolder } from './rng';
import {
  decideWinner,
  lastBeatFreeze,
  novelty,
  roundCard,
  type TurnRecord,
  turnCategories,
} from './scoring';

/** Seconds an expiry waits past the timing window for late network input. */
export const LATE_SLACK = 0.15;
/** Points lost on a crash. */
export const CRASH_COST = 8;
/** Prompts shown ahead on the beat track. */
export const PROMPT_COUNT = 8;
/** Rhythm lane: beats kept behind now (misses scroll past) and shown ahead. */
export const LANE_BACK = 1.5;
export const LANE_AHEAD = 8;
const LANE_MAX = 40;
/** A redrawn plan starts at least this many beats ahead, so it scrolls in. */
export const REPLAN_LEAD = 1.5;

const KEYS = new Set<BreakKey>(['up', 'down', 'left', 'right', 'a', 'b']);

type ItemKind = 'beat' | 'seg' | 'prep' | 'close' | 'card';
const PRI: Record<ItemKind | 'input' | 'expiry', number> = {
  beat: 0,
  seg: 1,
  prep: 2,
  input: 3,
  expiry: 4,
  close: 5,
  card: 6,
};

interface Item {
  key: number;
  kind: ItemKind;
  n: number;
}

/** A planned move; `cut` hides its notes from that beat on (redrawn after). */
type LaneMove = PlannedMove & { cut?: number };

interface TurnRt {
  slot: TurnSlot;
  human: boolean;
  closed: boolean;
  att: Attempt | null;
  prev: FlowFrom;
  lastEnd: number | null;
  last: { move: MoveId; start: number } | null;
  combo: number;
  consecMiss: number;
  crashed: boolean;
  inTurn: MoveId[];
  rec: TurnRecord;
  plan: LaneMove[];
  /** Lane marks: the grade each planned note got (by beat), for SimState.lane. */
  marks: Map<number, { key: BreakKey; g: HitGrade; off?: number }>;
  /** This turn's presses (for EARLY / LATE on the lane). */
  taps: { t: number; key: BreakKey }[];
  /** CPU: how hard it's answering back this turn, and whether it just slipped up. */
  answer: number;
  failed: boolean;
}

function windowsOf(w: TimingWindows | undefined): TimingWindows {
  const ok = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d;
  const src = w ?? DEFAULT_WINDOWS;
  const perfect = ok(src.perfect, DEFAULT_WINDOWS.perfect);
  const great = Math.max(perfect, ok(src.great, DEFAULT_WINDOWS.great));
  const okW = Math.max(great, ok(src.ok, DEFAULT_WINDOWS.ok));
  return { perfect, great, ok: okW };
}

function inputOrder(a: BreakInput, b: BreakInput): number {
  if (a.t !== b.t) return a.t - b.t;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export class BreakBattle implements BattleSim {
  readonly config: BattleConfig;
  readonly clock: Clock;
  readonly windows: TimingWindows;
  readonly schedule: Schedule;

  private now = 0;
  private rng: RngHolder;
  private items: Item[] = [];
  private itemAt = 0;
  private pending: BreakInput[] = [];
  private rts: (TurnRt | undefined)[] = [];
  private seg: Segment;
  private phaseRound = 0;
  private curTurn: number | null = null;
  private lastTurn: number | null = null;
  private history = new Map<string, Map<MoveId, number>>();
  private seen = new Set<MoveId>();
  private cards: JudgeCard[] = [];
  private totals: [number, number] = [0, 0];
  private points: [number, number] = [0, 0];
  private winner: CrewId | 'tie' | undefined;
  private grades = new Map<string, { g: HitGrade; at: number }>();
  private prompts: { key: BreakKey; beat: number }[] = [];
  private promptsFor: string | null = null;
  private known: Set<string>;
  private skills = new Map<string, number>();
  /** Battle time of the agenda entry being handled. */
  private evT = 0;
  private lane: LaneNote[] | null = null;
  private forming: SimState['forming'] | null = null;

  constructor(config: BattleConfig) {
    this.config = config;
    this.clock = makeClock(config.bpm);
    this.windows = windowsOf(config.windows);
    this.schedule = buildSchedule(config);
    this.rng = { rng: hashSeed(config.seed | 0, `break:${config.gid}`) };
    this.known = new Set(config.dancers.map(d => d.id));
    for (const d of config.dancers) {
      const s = typeof d.skill === 'number' && Number.isFinite(d.skill) ? d.skill : 0.5;
      this.skills.set(d.id, Math.min(1, Math.max(0, s)));
    }
    this.seg = this.schedule.segments[0];
    this.buildItems();
  }

  private buildItems(): void {
    const c = this.clock;
    const s = this.schedule;
    const items: Item[] = [];
    for (let b = -4; b < s.doneAt; b++) items.push({ key: timeOf(c, b), kind: 'beat', n: b });
    s.segments.forEach((g, i) => items.push({ key: timeOf(c, g.from), kind: 'seg', n: i }));
    for (const t of s.turns) {
      items.push({ key: timeOf(c, t.from - 1), kind: 'prep', n: t.idx });
      items.push({ key: timeOf(c, t.to) + this.windows.ok + LATE_SLACK, kind: 'close', n: t.idx });
    }
    s.segments.forEach(g => {
      if (g.phase === 'judging') {
        items.push({
          key: timeOf(c, g.from) + this.windows.ok + LATE_SLACK,
          kind: 'card',
          n: g.round,
        });
      }
    });
    items.sort((a, b) => a.key - b.key || PRI[a.kind] - PRI[b.kind] || a.n - b.n);
    this.items = items;
  }

  // ── BattleSim ─────────────────────────────────────────────────────────

  input(i: BreakInput): void {
    if (
      typeof i !== 'object' ||
      i === null ||
      !this.known.has(i.id) ||
      !KEYS.has(i.key) ||
      !Number.isFinite(i.t)
    )
      return;
    const human = this.config.dancers.find(d => d.id === i.id)?.human;
    if (human !== true) return; // CPU dancers make their own moves
    this.enqueue({ id: i.id, key: i.key, t: i.t });
  }

  step(dt: number): SimEvent[] {
    const out: SimEvent[] = [];
    if (Number.isFinite(dt) && dt > 0) this.now += dt;
    this.run(out);
    this.updatePrompts();
    return out;
  }

  state(): SimState {
    const beat = beatAt(this.clock, this.now);
    const cur = this.curTurn !== null ? this.rts[this.curTurn] : undefined;
    const shown = cur ?? (this.lastTurn !== null ? this.rts[this.lastTurn] : undefined);
    const s: SimState = {
      gid: this.config.gid,
      phase: this.seg.phase,
      t: this.now,
      beat,
      round: this.phaseRound,
      turn: cur ? { id: cur.slot.id, from: cur.slot.from, to: cur.slot.to } : null,
      poses: this.config.dancers.map(d => this.pose(d.id, beat)),
      turnScore: shown ? shown.rec.score : 0,
      combo: shown ? shown.combo : 0,
      prompts: this.prompts.map(p => ({ ...p })),
      totals: [this.totals[0], this.totals[1]],
      cards: this.cards.map(c => ({
        votes: [...c.votes],
        technique: [...c.technique] as [number, number],
        musicality: [...c.musicality] as [number, number],
        originality: [...c.originality] as [number, number],
        power: [...c.power] as [number, number],
      })),
    };
    if (this.promptsFor) s.promptsFor = this.promptsFor;
    if (this.lane) s.lane = this.lane.map(n => ({ ...n }));
    if (this.forming) s.forming = { ...this.forming };
    if (this.winner !== undefined) s.winner = this.winner;
    return s;
  }

  // ── Introspection (tests, harness) ────────────────────────────────────

  /** Every turn's record so far (scores, landed moves, categories). */
  records(): TurnRecord[] {
    return this.rts.filter((r): r is TurnRt => !!r).map(r => r.rec);
  }

  /** Battle points (category sums over the rounds), the winner's tie-break. */
  battlePoints(): [number, number] {
    return [this.points[0], this.points[1]];
  }

  // ── The agenda ────────────────────────────────────────────────────────

  private enqueue(i: BreakInput): void {
    const p = this.pending;
    let lo = 0;
    let hi = p.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inputOrder(p[mid], i) <= 0) lo = mid + 1;
      else hi = mid;
    }
    p.splice(lo, 0, i);
  }

  private nextExpiry(): { key: number; rt: TurnRt } | null {
    let best: { key: number; rt: TurnRt } | null = null;
    for (const rt of this.rts) {
      if (!rt || rt.closed || !rt.att) continue;
      const key = nextDeadline(rt.att, this.clock, this.windows) + LATE_SLACK;
      if (!best || key < best.key) best = { key, rt };
    }
    return best;
  }

  private run(out: SimEvent[]): void {
    const before = (k: number, p: number, bk: number, bp: number) => k < bk || (k === bk && p < bp);
    for (let guard = 0; guard < 1_000_000; guard++) {
      let which: 'item' | 'input' | 'expiry' | null = null;
      let key = Infinity;
      let pri = Infinity;
      const item = this.items[this.itemAt] as Item | undefined;
      if (item !== undefined && item.key <= this.now) {
        which = 'item';
        key = item.key;
        pri = PRI[item.kind];
      }
      const inp = this.pending[0] as BreakInput | undefined;
      if (inp !== undefined && inp.t <= this.now && before(inp.t, PRI.input, key, pri)) {
        which = 'input';
        key = inp.t;
        pri = PRI.input;
      }
      const ex = this.nextExpiry();
      if (ex && ex.key <= this.now && before(ex.key, PRI.expiry, key, pri)) {
        which = 'expiry';
        key = ex.key;
      }
      if (which === null) return;
      if (which === 'input') this.onInput(this.pending.shift() as BreakInput, out);
      else if (which === 'expiry' && ex) this.onExpiry(ex.rt, ex.key - LATE_SLACK, out);
      else if (item !== undefined) {
        this.itemAt++;
        this.onItem(item, out);
      }
    }
  }

  private onItem(it: Item, out: SimEvent[]): void {
    this.evT = it.key;
    switch (it.kind) {
      case 'beat': {
        if (this.winner === undefined)
          out.push({ e: 'beat', beat: it.n, downbeat: isDownbeat(it.n) });
        const cur = this.curTurn !== null ? this.rts[this.curTurn] : undefined;
        if (cur) this.reconcile(cur, it.key);
        return;
      }
      case 'seg':
        return this.onSegment(this.schedule.segments[it.n], out);
      case 'prep':
        return this.prep(this.schedule.turns[it.n]);
      case 'close':
        return this.close(it.n);
      case 'card':
        return this.card(it.n, out);
    }
  }

  private onSegment(g: Segment, out: SimEvent[]): void {
    this.seg = g;
    this.phaseRound = g.round;
    if (g.phase === 'turn' && g.turn !== undefined) {
      this.curTurn = g.turn;
      this.lastTurn = g.turn;
      const slot = this.schedule.turns[g.turn];
      out.push({ e: 'turn', id: slot.id, round: slot.round });
    } else {
      this.curTurn = null;
    }
    if (g.phase === 'done') {
      this.winner = decideWinner(this.totals, this.points);
      out.push({ e: 'end', winner: this.winner, totals: [this.totals[0], this.totals[1]] });
    }
  }

  // ── Turns ─────────────────────────────────────────────────────────────

  private prep(slot: TurnSlot): void {
    const dancer = this.config.dancers.find(d => d.id === slot.id);
    const human = dancer?.human === true;
    const rt: TurnRt = {
      slot,
      human,
      closed: false,
      att: null,
      prev: null,
      lastEnd: null,
      last: null,
      combo: 0,
      consecMiss: 0,
      crashed: false,
      inTurn: [],
      rec: {
        id: slot.id,
        crew: slot.crew,
        round: slot.round,
        from: slot.from,
        to: slot.to,
        landed: [],
        misses: 0,
        crashes: 0,
        score: 0,
        maxCombo: 0,
      },
      plan: [],
      marks: new Map(),
      taps: [],
      answer: 0,
      failed: false,
    };
    this.rts[slot.idx] = rt;
    const used = this.history.get(slot.id);
    if (human) {
      rt.plan = planTurn(slot.from, slot.to, null, coachOpts(used, this.seen));
      return;
    }
    const skill = this.skills.get(slot.id) ?? 0.5;
    rt.answer = this.answerFor(slot.crew);
    rt.plan = planTurn(
      slot.from,
      slot.to,
      null,
      cpuOpts(skill, rt.answer, this.rng, used, this.seen),
    );
    for (const i of cpuInputs(rt.plan, slot.id, skill, this.clock, this.windows, this.rng))
      this.enqueue(i);
  }

  /**
   * A CPU dancer that just missed or crashed regroups like a person would:
   * drops the rest of what it meant to do and plans the rest of its turn
   * from where it actually is, starting on the next beat it can make.
   */
  private cpuRecover(rt: TurnRt, t: number): void {
    rt.failed = false;
    if (rt.human || rt.closed) return;
    const id = rt.slot.id;
    this.pending = this.pending.filter(i => i.id !== id || i.t <= t);
    // whatever the stray key started is dropped too (no extra penalty)
    rt.att = null;
    const from = Math.ceil(beatAt(this.clock, t) + 0.3);
    rt.plan = rt.plan
      .filter(p => p.start < from)
      .map(p => ({ ...p, cut: Math.min(p.cut ?? Infinity, from) }));
    if (from >= rt.slot.to) return;
    const skill = this.skills.get(id) ?? 0.5;
    const used = new Map(this.history.get(id) ?? []);
    for (const m of rt.inTurn) used.set(m, (used.get(m) ?? 0) + 1);
    const plan = planTurn(
      from,
      rt.slot.to,
      rt.prev,
      cpuOpts(skill, rt.answer, this.rng, used, this.seen),
    );
    rt.plan.push(...plan);
    for (const i of cpuInputs(plan, id, skill, this.clock, this.windows, this.rng))
      if (i.t > t) this.enqueue(i);
  }

  /** How much power the other crew threw in its last turn (0..1). */
  private answerFor(crew: CrewId): number {
    for (let i = this.rts.length - 1; i >= 0; i--) {
      const r = this.rts[i];
      if (r && r.closed && r.slot.crew !== crew) return (r.rec.cats?.power ?? 0) / 10;
    }
    return 0;
  }

  private turnFor(i: BreakInput): TurnRt | null {
    const w = this.windows.ok + 1e-9;
    for (const rt of this.rts) {
      if (!rt || rt.closed || rt.slot.id !== i.id) continue;
      if (i.t >= timeOf(this.clock, rt.slot.from) - w && i.t <= timeOf(this.clock, rt.slot.to) + w)
        return rt;
    }
    return null;
  }

  private onInput(i: BreakInput, out: SimEvent[]): void {
    this.evT = i.t;
    const rt = this.turnFor(i);
    if (!rt) return;
    this.judgeInput(rt, i, out);
    if (rt.failed) this.cpuRecover(rt, i.t);
    this.reconcile(rt, i.t);
  }

  private judgeInput(rt: TurnRt, i: BreakInput, out: SimEvent[]): void {
    const beat = beatAt(this.clock, i.t);
    rt.taps.push({ t: i.t, key: i.key });
    if (rt.taps.length > 64) rt.taps.shift();
    if (rt.att && !expire(rt.att, i.t, this.clock, this.windows)) this.abandon(rt, out);
    if (rt.att) {
      const att = rt.att;
      const r = advance(att, i.key, beat, this.clock, this.windows);
      if (r.grade) {
        this.hit(rt, r.grade, i, out);
        if (r.done) this.land(rt, att, r.done, out);
        this.markAll(rt, att);
        return;
      }
      this.abandon(rt, out);
    }
    if (this.deadNote(rt, i)) {
      // Following the chart through a move that already broke: that note
      // can't land anything, and it mustn't start some other move either
      this.hit(rt, 'miss', i, out);
      return;
    }
    const s = startAttempt(i.key, beat, this.clock, this.windows, rt.slot.to);
    this.hit(rt, s.grade, i, out);
    if (!s.attempt) {
      this.miss(rt, out);
      return;
    }
    rt.att = s.attempt;
    rt.crashed = false;
    this.markAll(rt, s.attempt);
  }

  private hit(rt: TurnRt, grade: HitGrade, i: BreakInput, out: SimEvent[]): void {
    this.grades.set(rt.slot.id, { g: grade, at: i.t });
    out.push({ e: 'hit', id: rt.slot.id, grade, key: i.key });
  }

  private onExpiry(rt: TurnRt, t: number, out: SimEvent[]): void {
    if (!rt.att) return;
    this.evT = t + LATE_SLACK;
    if (!expire(rt.att, t + 1e-9, this.clock, this.windows)) this.abandon(rt, out);
    if (rt.failed) this.cpuRecover(rt, t + LATE_SLACK);
    this.reconcile(rt, t + LATE_SLACK);
  }

  /** The plan's move starting on `start` (the live one, not a cut-off leftover). */
  private plannedAt(rt: TurnRt, start: number): LaneMove | null {
    for (let k = rt.plan.length - 1; k >= 0; k--) {
      const p = rt.plan[k];
      if (p.start === start && p.cut === undefined) return p;
    }
    return null;
  }

  private planned(rt: TurnRt, start: number): MoveId | null {
    return this.plannedAt(rt, start)?.move ?? null;
  }

  /** Is the attempt `att` still the plan's move (the one starting where it did)? */
  private onPlan(rt: TurnRt, att: Attempt): boolean {
    const pm = this.plannedAt(rt, att.start);
    return pm !== null && att.cands.some(c => c.move === pm.move);
  }

  // ── The rhythm lane ───────────────────────────────────────────────────

  /**
   * A human's key on a note that's dead on the lane: the rest of a planned
   * move that already broke, or what was left of a plan a crash redrew.
   */
  private deadNote(rt: TurnRt, i: BreakInput): boolean {
    if (!rt.human || rt.att) return false;
    const ok = this.windows.ok;
    for (const pm of rt.plan) {
      const cut = pm.cut !== undefined;
      if (!cut && timeOf(this.clock, pm.start) + ok >= i.t) continue;
      const m = MOVES[pm.move];
      for (let k = cut ? 0 : 1; k < m.pattern.length; k++) {
        const b = pm.start + keyBeat(m, k);
        if (b >= (pm.cut ?? Infinity) - 1e-9) break;
        if (m.pattern[k] !== i.key || Math.abs(timeOf(this.clock, b) - i.t) > ok) continue;
        if (!rt.marks.has(b)) return true;
      }
    }
    return false;
  }

  /** Mark the planned notes the attempt has judged so far (grades from the recogniser). */
  private markAll(rt: TurnRt, att: Attempt): void {
    const pm = this.plannedAt(rt, att.start);
    if (!pm) return;
    const c = att.cands.find(x => x.move === pm.move);
    if (!c) return;
    const m = MOVES[pm.move];
    for (let k = 0; k < c.grades.length; k++) {
      const beat = att.start + keyBeat(m, k);
      const key = m.pattern[k];
      const had = rt.marks.get(beat);
      if (had && had.key === key && had.g === c.grades[k]) continue;
      const at = timeOf(this.clock, beat);
      let off: number | undefined;
      for (const tp of rt.taps)
        if (tp.key === key && Math.abs(tp.t - at) <= this.windows.ok + 1e-9)
          if (off === undefined || Math.abs(tp.t - at) < Math.abs(off)) off = tp.t - at;
      rt.marks.set(
        beat,
        off === undefined ? { key, g: c.grades[k] } : { key, g: c.grades[k], off },
      );
    }
  }

  /**
   * Redraw a human's plan: keep what's behind (so misses keep scrolling
   * past), put `cur` (the move they're actually doing) in, and plan the
   * rest from REPLAN_LEAD beats ahead at the earliest.
   */
  private replan(rt: TurnRt, t: number, cur: PlannedMove | null): void {
    if (!rt.human || rt.closed) return;
    const b = beatAt(this.clock, t);
    let from = Math.max(rt.slot.from, Math.ceil(b + REPLAN_LEAD - 1e-9));
    if (cur) from = Math.max(from, cur.start + MOVES[cur.move].beats);
    if (rt.lastEnd !== null) from = Math.max(from, rt.lastEnd);
    const cutoff = cur ? cur.start : from;
    const kept = rt.plan
      .filter(p => p.start < cutoff)
      .map(p => ({ ...p, cut: Math.min(p.cut ?? Infinity, cutoff) }));
    const prev: FlowFrom = cur ? cur.move : rt.prev;
    const next = from < rt.slot.to ? this.coachPlan(rt, from, prev) : [];
    rt.plan = [...kept, ...(cur ? [{ move: cur.move, start: cur.start }] : []), ...next];
  }

  /**
   * After each input / expiry / beat of a human's turn: is the plan still
   * one they can follow from where they are? A stray key waits (it may
   * come to nothing); committing two keys into a different move, or the
   * next planned move not flowing from the last one landed, redraws it.
   */
  private reconcile(rt: TurnRt, t: number): void {
    if (!rt.human || rt.closed) return;
    const att = rt.att;
    if (att) {
      if (this.onPlan(rt, att) || progress(att) < 2) return;
      const lead = leading(att, rt.prev, null);
      if (!lead) return;
      this.replan(rt, t, { move: lead.move, start: att.start });
      this.markAll(rt, att);
      return;
    }
    const b = beatAt(this.clock, t);
    const okB = this.windows.ok / this.clock.spb;
    const after = rt.lastEnd ?? -Infinity;
    const next = rt.plan.find(
      p => p.cut === undefined && p.start >= after - 1e-9 && p.start + okB >= b,
    );
    if (next) {
      if (!canFlow(rt.prev, MOVES[next.move])) this.replan(rt, t, null);
      return;
    }
    if (Math.ceil(b + REPLAN_LEAD - 1e-9) < rt.slot.to && rt.plan.every(p => p.start < b))
      this.replan(rt, t, null);
  }

  /** An attempt ended without a move. */
  private abandon(rt: TurnRt, out: SimEvent[]): void {
    const att = rt.att;
    rt.att = null;
    if (!att) return;
    const lead = leading(att, rt.prev, this.planned(rt, att.start));
    if (lead && committedFamily(att)) {
      out.push({ e: 'move', id: rt.slot.id, move: lead.move, landed: false, points: 0 });
      this.crash(rt, out);
      return;
    }
    this.miss(rt, out);
  }

  private miss(rt: TurnRt, out: SimEvent[]): void {
    rt.rec.misses++;
    rt.combo = 0;
    rt.consecMiss++;
    rt.failed = true;
    if (rt.consecMiss >= 3) this.crash(rt, out);
  }

  private crash(rt: TurnRt, out: SimEvent[]): void {
    rt.rec.crashes++;
    rt.rec.score = Math.max(0, rt.rec.score - CRASH_COST);
    rt.combo = 0;
    rt.consecMiss = 0;
    rt.prev = 'any';
    rt.crashed = true;
    rt.failed = true;
    rt.last = null;
    out.push({ e: 'crash', id: rt.slot.id });
    // Picked themselves up: a fresh plan from a beat and a half ahead
    this.replan(rt, this.evT, null);
  }

  private land(rt: TurnRt, att: Attempt, c: Candidate, out: SimEvent[]): void {
    rt.att = null;
    const m = MOVES[c.move];
    const id = rt.slot.id;
    if (!canFlow(rt.prev, m)) {
      out.push({ e: 'move', id, move: m.id, landed: false, points: 0 });
      this.crash(rt, out);
      return;
    }
    const offPlan = this.planned(rt, att.start) !== m.id;
    if (rt.lastEnd !== null && att.start > rt.lastEnd + 2) rt.combo = 0;
    if (c.slips > 0) {
      // landed, but scrappy: the slips are misses and the combo starts over
      rt.rec.misses += c.slips;
      rt.combo = 0;
    }
    rt.combo++;
    rt.rec.maxCombo = Math.max(rt.rec.maxCombo, rt.combo);
    const n = novelty(m.id, rt.inTurn, this.ownMoves(id), this.seen);
    const landed = { move: m.id, start: att.start, grades: c.grades, novelty: n, points: 0 };
    const finale = lastBeatFreeze(landed, rt.slot.to);
    const comboMult = 1 + 0.1 * Math.min(10, rt.combo - 1);
    const pts = Math.round(
      m.points * timingFactor(c.grades) * comboMult * (0.4 + 0.6 * n) * (finale ? 1.5 : 1),
    );
    landed.points = pts;
    rt.rec.landed.push(landed);
    rt.rec.score += pts;
    rt.inTurn.push(m.id);
    rt.prev = m.id;
    rt.lastEnd = att.start + m.beats;
    rt.last = { move: m.id, start: att.start };
    rt.consecMiss = 0;
    rt.crashed = false;
    // Landed something else than planned: the plan carries on from there
    if (offPlan) this.replan(rt, this.evT, { move: m.id, start: att.start });
    out.push({ e: 'move', id, move: m.id, landed: true, points: pts });
    if (rt.combo >= 2) out.push({ e: 'combo', id, combo: rt.combo });
    if (m.family === 'freeze') {
      const holdBeat = att.start + keyBeat(m, m.pattern.length - 1);
      const hold = c.grades[c.grades.length - 1];
      const onBeat = finale || (isDownbeat(holdBeat) && (hold === 'perfect' || hold === 'great'));
      out.push({ e: 'freeze', id, move: m.id, onBeat });
    }
  }

  private ownMoves(id: string): ReadonlySet<MoveId> | undefined {
    const h = this.history.get(id);
    return h ? new Set(h.keys()) : undefined;
  }

  private close(idx: number): void {
    const rt = this.rts[idx];
    if (!rt || rt.closed) return;
    rt.att = null;
    rt.closed = true;
    rt.rec.cats = turnCategories(rt.rec);
    let h = this.history.get(rt.slot.id);
    if (!h) this.history.set(rt.slot.id, (h = new Map()));
    for (const l of rt.rec.landed) {
      if (MOVES[l.move].family === 'transition') continue;
      h.set(l.move, (h.get(l.move) ?? 0) + 1);
      this.seen.add(l.move);
    }
  }

  private card(round: number, out: SimEvent[]): void {
    const recs = this.rts.filter((r): r is TurnRt => !!r && r.slot.round === round).map(r => r.rec);
    const { card, points } = roundCard(recs, this.rng);
    this.cards.push(card);
    for (const v of card.votes) this.totals[v]++;
    this.points[0] += points[0];
    this.points[1] += points[1];
    out.push({ e: 'card', round, card });
  }

  // ── What the view reads ───────────────────────────────────────────────

  private pose(id: string, beat: number): DancerPose {
    const cur = this.curTurn !== null ? this.rts[this.curTurn] : undefined;
    const p: DancerPose = { id, move: null, moveT: 0, centre: !!cur && cur.slot.id === id };
    const g = this.grades.get(id);
    if (g) {
      p.lastGrade = g.g;
      p.lastAt = g.at;
    }
    if (!cur || cur.slot.id !== id) return p;
    if (cur.crashed) p.crashed = true;
    if (cur.att) {
      const lead = leading(cur.att, cur.prev, this.planned(cur, cur.att.start));
      if (lead) {
        const m = MOVES[lead.move];
        p.move = m.id;
        p.moveT = Math.min(1, Math.max(0, (beat - cur.att.start) / m.beats));
      }
    } else if (cur.last) {
      const m = MOVES[cur.last.move];
      const t = (beat - cur.last.start) / m.beats;
      if (t < 1) {
        p.move = m.id;
        p.moveT = Math.min(1, Math.max(0, t));
      }
    }
    return p;
  }

  /** The turn the HUD should prompt: the one on now, or the next one coming up. */
  private promptTurn(): TurnRt | null {
    if (this.curTurn !== null) return this.rts[this.curTurn] ?? null;
    if (this.winner !== undefined) return null;
    for (const rt of this.rts) if (rt && !rt.closed && rt.slot.idx !== this.lastTurn) return rt;
    return null;
  }

  /**
   * The lane, the prompts and the move forming, read off the plan (which
   * only the agenda changes) at the current time: a planned note is judged
   * when its key is (marks), a miss once its window has gone by, and dead
   * when its move broke before it came.
   */
  private updatePrompts(): void {
    const rt = this.promptTurn();
    this.forming = this.formingOf();
    if (!rt) {
      this.prompts = [];
      this.promptsFor = null;
      this.lane = null;
      return;
    }
    const now = this.now;
    const beat = beatAt(this.clock, now);
    const okB = this.windows.ok / this.clock.spb;
    const lo = beat - LANE_BACK;
    const hi = beat + LANE_AHEAD;
    const lane: LaneNote[] = [];
    const prompts: { key: BreakKey; beat: number }[] = [];
    for (const pm of rt.plan) {
      const m = MOVES[pm.move];
      if (pm.start + m.beats < lo) continue;
      const alive =
        pm.cut === undefined &&
        rt.att !== null &&
        rt.att.start === pm.start &&
        rt.att.cands.some(c => c.move === pm.move);
      const begun = timeOf(this.clock, pm.start) + this.windows.ok < now;
      for (let i = 0; i < m.pattern.length; i++) {
        const b = pm.start + keyBeat(m, i);
        if (pm.cut !== undefined && b >= pm.cut - 1e-9) break;
        const key = m.pattern[i];
        const n: LaneNote = {
          key,
          beat: b,
          id: `${rt.slot.idx}.${pm.start}.${pm.move}.${i}`,
          move: pm.move,
          i,
          n: m.pattern.length,
        };
        const mk = rt.marks.get(b);
        if (mk && mk.key === key) {
          n.grade = mk.g;
          if (mk.off !== undefined) n.off = mk.off;
        } else if (timeOf(this.clock, b) + this.windows.ok < now) n.grade = 'miss';
        else if (pm.cut !== undefined || (begun && !alive)) n.dead = true;
        else if (b >= beat - okB && prompts.length < PROMPT_COUNT) prompts.push({ key, beat: b });
        if (b >= lo && b <= hi && lane.length < LANE_MAX) lane.push(n);
      }
    }
    this.prompts = prompts;
    this.promptsFor = rt.slot.id;
    this.lane = lane;
  }

  /** The move the dancer up is putting together (or just landed). */
  private formingOf(): SimState['forming'] | null {
    const cur = this.curTurn !== null ? this.rts[this.curTurn] : undefined;
    if (!cur) return null;
    const id = cur.slot.id;
    if (cur.att) {
      const lead = leading(cur.att, cur.prev, this.planned(cur, cur.att.start));
      if (!lead) return null;
      const m = MOVES[lead.move];
      return { id, move: m.id, got: lead.grades.length, of: m.pattern.length };
    }
    if (cur.last) {
      const m = MOVES[cur.last.move];
      if (beatAt(this.clock, this.now) < cur.last.start + m.beats + 0.5)
        return { id, move: m.id, got: m.pattern.length, of: m.pattern.length, landed: true };
    }
    return null;
  }

  private coachPlan(rt: TurnRt, from: number, prev: FlowFrom): LaneMove[] {
    const used = new Map(this.history.get(rt.slot.id) ?? []);
    for (const m of rt.inTurn) used.set(m, (used.get(m) ?? 0) + 1);
    return planTurn(from, rt.slot.to, prev, coachOpts(used, this.seen));
  }
}

export const createBattleSim: BattleSimFactory = config => new BreakBattle(config);

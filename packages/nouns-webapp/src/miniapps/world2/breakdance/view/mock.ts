// ── Mock battle (develop / test the view without breakdance/sim) ────────
//
// A small deterministic BattleSim: an 8-beat intro, then rounds of turns
// alternating crews, each turn a scripted routine (toprock → drop →
// footwork → power → freeze → get up) so every move shows up across the
// turns. CPU dancers hit their prompts with a skill-weighted spread of
// grades; a human dancer's inputs are judged against the prompts. A
// scripted crash, the judges' cards after each round and a winner at the
// end. `hold(move)` pins the dancer up on one move (screenshots).

import type {
  BattleConfig,
  BattlePhase,
  BattleSim,
  BreakInput,
  BreakKey,
  CrewId,
  CrewSize,
  DancerPose,
  HitGrade,
  JudgeCard,
  MoveId,
  SimEvent,
  SimState,
} from '../contract';

import { DEFAULT_WINDOWS } from '../contract';

import { moveFamily, VIEW_MOVES } from './moves';

type Step = [MoveId, number];

/** Five routines, 16 beats each; together they use every move. */
export const ROUTINES: Step[][] = [
  [
    ['indian_step', 4],
    ['drop', 1],
    ['six_step', 3],
    ['windmill', 4],
    ['baby_freeze', 2],
    ['get_up', 2],
  ],
  [
    ['salsa_rock', 2],
    ['cross_step', 2],
    ['spin_down', 2],
    ['three_step', 2],
    ['flare', 4],
    ['chair_freeze', 2],
    ['get_up', 2],
  ],
  [
    ['kick_step', 3],
    ['drop', 1],
    ['cc', 2],
    ['kick_out', 2],
    ['headspin', 4],
    ['headstand', 2],
    ['get_up', 2],
  ],
  [
    ['indian_step', 2],
    ['spin_down', 2],
    ['six_step', 3],
    ['swipe', 2],
    ['airflare', 3],
    ['hollowback', 2],
    ['get_up', 2],
  ],
  [
    ['cross_step', 2],
    ['drop', 1],
    ['pretzel', 3],
    ['turtle', 4],
    ['backspin', 2],
    ['airchair', 2],
    ['get_up', 2],
  ],
];

export interface MockOptions {
  crewSize?: CrewSize;
  rounds?: number;
  bpm?: number;
  turnBars?: number;
  /** A human dancer's id (crew 0, first), or null for an all-CPU battle. */
  human?: string | null;
  seed?: number;
  /** Turn index (0-based, over the whole battle) whose power move bails. */
  crashTurn?: number;
}

export function mockConfig(o: MockOptions = {}): BattleConfig {
  const k = o.crewSize ?? 1;
  const names = [
    ['b-noun', 'lil spinz', 'crt kid'],
    ['headspin hank', 'noggle nate', 'freeze frame'],
  ];
  const dancers = [];
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < k; i++) {
      const human = c === 0 && i === 0 && o.human !== null;
      dancers.push({
        id: human ? (o.human ?? 'me') : `cpu:${c}${i}`,
        name: human ? 'you' : names[c][i],
        crew: c as CrewId,
        human,
        skill: 0.55 + 0.12 * i + 0.1 * c,
      });
    }
  return {
    gid: `mock-${o.seed ?? 7}`,
    seed: o.seed ?? 7,
    crewSize: k,
    dancers,
    rounds: o.rounds ?? 2,
    turnBars: o.turnBars ?? 4,
    bpm: o.bpm ?? 104,
    windows: DEFAULT_WINDOWS,
  };
}

interface Segment {
  phase: BattlePhase;
  from: number;
  to: number;
  round: number;
  dancer?: string;
  turn?: number;
}

interface Prompt {
  key: BreakKey;
  beat: number;
  judged: boolean;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATTERNS: Record<string, { keys: BreakKey[]; step: number }> = {
  toprock: { keys: ['left', 'right'], step: 1 },
  footwork: { keys: ['down', 'left', 'down', 'right'], step: 0.5 },
  power: { keys: ['a', 'right', 'down', 'left'], step: 1 },
  freeze: { keys: ['b'], step: 99 },
  transition: { keys: ['down'], step: 99 },
};

const INTRO = 8;

export class MockBattle implements BattleSim {
  readonly config: BattleConfig;
  private t = 0;
  private segs: Segment[] = [];
  private rand: () => number;
  private crashTurn: number;
  private prompts: Prompt[] = [];
  private pending: SimEvent[] = [];
  private inputs: BreakInput[] = [];
  private routine: { move: MoveId; from: number; n: number }[] = [];
  private seg: Segment | null = null;
  private combo = 0;
  private turnScore = 0;
  private roundScore: [number, number] = [0, 0];
  private totals: [number, number] = [0, 0];
  private cards: JudgeCard[] = [];
  private winner: CrewId | 'tie' | undefined;
  private lastBeat = -INTRO - 1;
  private crashed = false;
  private lastGrade: { id: string; grade: HitGrade; at: number } | null = null;
  private moveMiss = 0;
  private held: { move: MoveId; start: number } | null = null;

  constructor(o: MockOptions = {}) {
    this.config = mockConfig(o);
    this.rand = rng(this.config.seed);
    this.crashTurn = o.crashTurn ?? 3;
    // Turn order: crews alternate, dancers in order
    const c = this.config;
    const order: string[] = [];
    for (let i = 0; i < c.crewSize; i++)
      for (let crew = 0; crew < 2; crew++) {
        const d = c.dancers.filter(x => x.crew === crew)[i];
        if (d !== undefined) order.push(d.id);
      }
    const turnLen = c.turnBars * 4;
    let b = 0;
    let turn = 0;
    this.segs.push({ phase: 'intro', from: -INTRO, to: 0, round: 0 });
    for (let r = 0; r < c.rounds; r++) {
      order.forEach((id, i) => {
        this.segs.push({
          phase: 'turn',
          from: b,
          to: b + turnLen,
          round: r,
          dancer: id,
          turn: turn++,
        });
        b += turnLen;
        if (i < order.length - 1) {
          this.segs.push({ phase: 'between', from: b, to: b + 4, round: r });
          b += 4;
        }
      });
      this.segs.push({ phase: 'judging', from: b, to: b + 8, round: r });
      b += 8;
    }
    this.segs.push({ phase: 'final', from: b, to: b + 4, round: c.rounds - 1 });
    b += 4;
    this.segs.push({ phase: 'done', from: b, to: Infinity, round: c.rounds - 1 });
  }

  get spb() {
    return 60 / this.config.bpm;
  }

  get beat() {
    return this.t / this.spb - INTRO;
  }

  /** Battle length in seconds (to the 'done' phase). */
  get duration() {
    const done = this.segs[this.segs.length - 1];
    return (done.from + INTRO) * this.spb;
  }

  /** Start time (s) of every segment, e.g. for seeking to a turn. */
  get timeline() {
    return this.segs.map(s => ({ ...s, t: (s.from + INTRO) * this.spb }));
  }

  /** Pin the dancer up (or the first dancer) on one move, looping. null = back to the script. */
  hold(move: MoveId | null) {
    this.held = move === null ? null : { move, start: Math.ceil(this.beat) };
  }

  input(i: BreakInput) {
    this.inputs.push(i);
  }

  step(dt: number): SimEvent[] {
    this.t += Math.max(0, dt);
    const beat = this.beat;
    const ev: SimEvent[] = this.pending;
    this.pending = [];
    // Beats
    for (let b = Math.floor(this.lastBeat) + 1; b <= Math.floor(beat); b++)
      ev.push({ e: 'beat', beat: b, downbeat: ((b % 4) + 4) % 4 === 0 });
    const seg =
      this.segs.find(s => beat >= s.from && beat < s.to) ?? this.segs[this.segs.length - 1];
    if (seg !== this.seg) this.enter(seg, ev);
    if (seg.phase === 'turn' && seg.dancer !== undefined) this.turnStep(seg, beat, ev);
    this.lastBeat = beat;
    return ev;
  }

  private dancer(id: string) {
    return this.config.dancers.find(d => d.id === id)!;
  }

  private enter(seg: Segment, ev: SimEvent[]) {
    const prev = this.seg;
    this.seg = seg;
    if (prev?.phase === 'turn' && prev.dancer !== undefined) {
      // The turn's last move lands as the turn ends
      const last = this.routine[this.routine.length - 1];
      if (last !== undefined) this.land(prev.dancer, last.move, ev);
      const crew = this.dancer(prev.dancer).crew;
      this.totals[crew] += this.turnScore;
      this.roundScore[crew] += this.turnScore;
    }
    if (seg.phase === 'turn' && seg.dancer !== undefined) {
      this.combo = 0;
      this.turnScore = 0;
      this.crashed = false;
      this.moveMiss = 0;
      ev.push({ e: 'turn', id: seg.dancer, round: seg.round });
      const r = ROUTINES[(seg.turn ?? 0) % ROUTINES.length];
      this.routine = [];
      let b = seg.from;
      const len = seg.to - seg.from;
      let i = 0;
      while (b < seg.from + len) {
        const [move, n] = r[i % r.length];
        const nn = Math.min(n, seg.from + len - b);
        this.routine.push({ move, from: b, n: nn });
        b += nn;
        i++;
      }
      this.prompts = [];
      for (const m of this.routine) {
        const fam = moveFamily(m.move) ?? 'toprock';
        const p = PATTERNS[fam];
        let j = 0;
        for (let x = 0; x < m.n - 1e-6; x += p.step, j++) {
          const key: BreakKey = m.move === 'get_up' ? 'up' : p.keys[j % p.keys.length];
          this.prompts.push({ key, beat: m.from + x, judged: false });
        }
      }
    }
    if (seg.phase === 'judging') {
      const card = this.makeCard();
      this.cards.push(card);
      ev.push({ e: 'card', round: seg.round, card });
      this.roundScore = [0, 0];
    }
    if (seg.phase === 'final') {
      const votes: [number, number] = [0, 0];
      for (const c of this.cards) {
        const v = c.votes.filter(x => x === 0).length;
        if (v >= 2) votes[0]++;
        else votes[1]++;
      }
      this.winner =
        votes[0] > votes[1]
          ? 0
          : votes[1] > votes[0]
            ? 1
            : this.totals[0] >= this.totals[1]
              ? 0
              : 1;
      ev.push({ e: 'end', winner: this.winner, totals: [...this.totals] as [number, number] });
    }
  }

  private makeCard(): JudgeCard {
    const [a, b] = this.roundScore;
    const lead: CrewId = a >= b ? 0 : 1;
    const votes: CrewId[] = [0, 1, 2].map(() =>
      this.rand() < 0.72 ? lead : ((1 - lead) as CrewId),
    );
    const cat = (): [number, number] => {
      const hi = 7 + Math.floor(this.rand() * 4);
      const lo = 4 + Math.floor(this.rand() * 4);
      return lead === 0 ? [hi, lo] : [lo, hi];
    };
    return { votes, technique: cat(), musicality: cat(), originality: cat(), power: cat() };
  }

  private current(beat: number) {
    for (let i = this.routine.length - 1; i >= 0; i--)
      if (beat >= this.routine[i].from) return { i, m: this.routine[i] };
    return null;
  }

  private turnStep(seg: Segment, beat: number, ev: SimEvent[]) {
    const id = seg.dancer!;
    const d = this.dancer(id);
    const cur = this.current(beat);
    const prevCur = this.current(this.lastBeat);
    // Move boundaries: land the last one, start the next
    if (cur !== null && (prevCur === null || prevCur.i !== cur.i)) {
      if (prevCur !== null && prevCur.i !== cur.i) this.land(id, prevCur.m.move, ev);
      this.moveMiss = 0;
      this.crashed = false;
      if (moveFamily(cur.m.move) === 'freeze')
        ev.push({ e: 'freeze', id, move: cur.m.move, onBeat: true });
    }
    // Scripted bail: this turn's power move goes wrong halfway
    if (
      seg.turn === this.crashTurn &&
      cur !== null &&
      moveFamily(cur.m.move) === 'power' &&
      !this.crashed &&
      beat - cur.m.from > cur.m.n * 0.5
    ) {
      this.crashed = true;
      this.combo = 0;
      ev.push({ e: 'crash', id });
    }
    // Judge prompts
    const spb = this.spb;
    const w = this.config.windows ?? DEFAULT_WINDOWS;
    if (d.human) {
      for (const inp of this.inputs.filter(x => x.id === id)) {
        const ib = inp.t / spb - INTRO;
        let best: Prompt | null = null;
        for (const p of this.prompts)
          if (
            !p.judged &&
            Math.abs(p.beat - ib) * spb <= w.ok &&
            (best === null || Math.abs(p.beat - ib) < Math.abs(best.beat - ib))
          )
            best = p;
        if (best === null) continue;
        best.judged = true;
        const err = Math.abs(best.beat - ib) * spb;
        const grade: HitGrade =
          inp.key !== best.key
            ? 'miss'
            : err <= w.perfect
              ? 'perfect'
              : err <= w.great
                ? 'great'
                : 'ok';
        this.grade(id, grade, best.key, ev);
      }
      this.inputs = [];
      for (const p of this.prompts)
        if (!p.judged && (beat - p.beat) * spb > w.ok) {
          p.judged = true;
          this.grade(id, 'miss', p.key, ev);
        }
    } else {
      for (const p of this.prompts) {
        if (p.judged || p.beat > beat) continue;
        p.judged = true;
        const r = this.rand();
        const sk = d.skill ?? 0.6;
        const grade: HitGrade = this.crashed
          ? 'miss'
          : r < 0.35 + sk * 0.3
            ? 'perfect'
            : r < 0.7 + sk * 0.15
              ? 'great'
              : r < 0.94
                ? 'ok'
                : 'miss';
        this.grade(id, grade, p.key, ev);
      }
    }
  }

  private grade(id: string, grade: HitGrade, key: BreakKey, ev: SimEvent[]) {
    ev.push({ e: 'hit', id, grade, key });
    this.lastGrade = { id, grade, at: this.t };
    if (grade === 'miss') {
      this.combo = 0;
      this.moveMiss++;
      return;
    }
    this.combo++;
    const base = grade === 'perfect' ? 30 : grade === 'great' ? 20 : 10;
    this.turnScore += Math.round(base * (1 + this.combo / 20));
    if (this.combo % 10 === 0) ev.push({ e: 'combo', id, combo: this.combo });
  }

  private land(id: string, move: MoveId, ev: SimEvent[]) {
    const fam = moveFamily(move);
    const pts =
      fam === 'power'
        ? 150
        : fam === 'freeze'
          ? 120
          : fam === 'footwork'
            ? 80
            : fam === 'toprock'
              ? 50
              : 20;
    const landed = !this.crashed;
    if (landed) this.turnScore += pts;
    ev.push({ e: 'move', id, move, landed, points: landed ? pts : 0 });
  }

  state(): SimState {
    const beat = this.beat;
    const seg = this.seg ?? this.segs[0];
    const c = this.config;
    const up = seg.phase === 'turn' ? (seg.dancer ?? null) : null;
    const cur = up !== null ? this.current(beat) : null;
    const poses: DancerPose[] = c.dancers.map(d => {
      const isUp = d.id === up;
      const p: DancerPose = { id: d.id, move: null, moveT: 0, centre: isUp };
      if (isUp && cur !== null) {
        p.move = cur.m.move;
        p.moveBeats = cur.m.n;
        p.moveT = Math.min(1, (beat - cur.m.from) / cur.m.n);
        p.crashed = this.crashed;
      }
      if (this.lastGrade !== null && this.lastGrade.id === d.id) {
        p.lastGrade = this.lastGrade.grade;
        p.lastAt = this.lastGrade.at;
      }
      return p;
    });
    let phase = seg.phase;
    let turn = up !== null ? { id: up, from: seg.from, to: seg.to } : null;
    if (this.held !== null) {
      // Pinned: the first dancer (or the one up) loops the held move in the middle
      const id = up ?? c.dancers[0].id;
      const n = VIEW_MOVES[this.held.move]?.beats ?? 4;
      const b = beat - this.held.start;
      for (const p of poses) {
        const me = p.id === id;
        p.centre = me;
        p.move = me ? this.held.move : null;
        p.moveBeats = me ? n : undefined;
        p.moveT = me ? (((b / n) % 1) + 1) % 1 : 0;
        p.crashed = false;
      }
      phase = 'turn';
      turn = { id, from: this.held.start, to: this.held.start + 16 };
    }
    return {
      gid: c.gid,
      phase,
      t: this.t,
      beat,
      round: seg.round,
      turn,
      poses,
      turnScore: this.turnScore,
      combo: this.combo,
      prompts:
        up !== null || this.held !== null
          ? this.prompts
              .filter(p => !p.judged)
              .slice(0, 8)
              .map(p => ({ key: p.key, beat: p.beat }))
          : [],
      totals: [...this.totals] as [number, number],
      cards: [...this.cards],
      winner: this.winner,
    };
  }
}

export function createMockBattle(o: MockOptions = {}): MockBattle {
  return new MockBattle(o);
}

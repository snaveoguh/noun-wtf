// ── StubSim: a tiny BattleSim until breakdance/sim lands ─────────────────
//
// Enough of a battle to drive net/ and a view: a beat clock, turns that
// alternate crews round by round, one prompt per beat during a turn, inputs
// judged against the beat (DEFAULT_WINDOWS), points with a combo bonus, CPU
// dancers hitting their prompts by skill, a judges' card per round, and a
// winner. Deterministic for a seed + input stream. Implements the contract's
// BattleSim exactly (plus setCpu), so swapping in the real sim is one line in
// factory.ts.

import {
  DEFAULT_WINDOWS,
  type BattleConfig,
  type BattlePhase,
  type BattleSim,
  type BreakInput,
  type BreakKey,
  type CrewId,
  type DancerPose,
  type HitGrade,
  type JudgeCard,
  type MoveId,
  type SimEvent,
  type SimState,
} from '../contract';

/** Beats before the first turn, and between turns (the next dancer walks in, prompts show). */
const INTRO_BEATS = 4;
const GAP_BEATS = 2;
const KEYS: BreakKey[] = ['up', 'down', 'left', 'right', 'a', 'b'];
const POINTS: Record<HitGrade, number> = { perfect: 100, great: 70, ok: 40, miss: 0 };
/** One move per bar, by where the bar falls in the turn. */
const BAR_MOVES: MoveId[][] = [
  ['indian_step', 'salsa_rock', 'cross_step', 'kick_step'],
  ['six_step', 'three_step', 'cc', 'pretzel'],
  ['windmill', 'flare', 'headspin', 'swipe'],
];
const FREEZES: MoveId[] = ['baby_freeze', 'chair_freeze', 'headstand', 'airchair'];

interface Prompt {
  key: BreakKey;
  beat: number;
  judged: boolean;
}

interface Turn {
  id: string;
  round: number;
  from: number;
  to: number;
  prompts: Prompt[];
}

function rng(seed: number) {
  let r = seed >>> 0 || 1;
  return () => {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    return r / 2 ** 32;
  };
}

export class StubSim implements BattleSim {
  readonly config: BattleConfig;
  private t = 0;
  private turns: Turn[] = [];
  private cur = -1;
  private phase: BattlePhase = 'intro';
  private turnScore = 0;
  private combo = 0;
  private totals: [number, number] = [0, 0];
  private roundPts: [number, number] = [0, 0];
  private cards: JudgeCard[] = [];
  private winner: CrewId | 'tie' | undefined;
  private poses = new Map<string, DancerPose>();
  private cpu = new Map<string, number>();
  private out: SimEvent[] = [];
  private lastBeat = -1;
  private rnd: () => number;
  private windows = DEFAULT_WINDOWS;

  constructor(config: BattleConfig) {
    this.config = config;
    this.rnd = rng(config.seed);
    if (config.windows) this.windows = config.windows;
    for (const d of config.dancers) {
      this.poses.set(d.id, { id: d.id, move: null, moveT: 0, centre: false });
      if (!d.human) this.cpu.set(d.id, d.skill ?? 0.5);
    }
    const crews: [string[], string[]] = [[], []];
    for (const d of config.dancers) crews[d.crew].push(d.id);
    const len = config.turnBars * 4;
    let beat = INTRO_BEATS;
    for (let r = 0; r < config.rounds; r++)
      for (let k = 0; k < Math.max(crews[0].length, crews[1].length); k++)
        for (const c of [0, 1] as const) {
          const id = crews[c][k];
          if (id === undefined) continue;
          const prompts: Prompt[] = [];
          for (let b = 0; b < len; b++)
            prompts.push({
              key: KEYS[Math.floor(this.rnd() * KEYS.length)],
              beat: beat + b,
              judged: false,
            });
          this.turns.push({ id, round: r, from: beat, to: beat + len, prompts });
          beat += len + GAP_BEATS;
        }
  }

  private get spb() {
    return 60 / this.config.bpm;
  }

  private get beat() {
    return this.t / this.spb;
  }

  private beatTime(b: number) {
    return b * this.spb;
  }

  private crewOf(id: string): CrewId {
    return this.config.dancers.find(d => d.id === id)?.crew ?? 0;
  }

  input(i: BreakInput) {
    if (this.phase === 'done') return;
    const turn = this.turns.find(
      x =>
        x.id === i.id &&
        i.t >= this.beatTime(x.from) - this.windows.ok &&
        i.t <= this.beatTime(x.to),
    );
    if (turn === undefined || this.cpu.has(i.id)) return;
    let best: Prompt | null = null;
    let bestD = Infinity;
    for (const p of turn.prompts) {
      if (p.judged) continue;
      const d = Math.abs(i.t - this.beatTime(p.beat));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best === null || bestD > this.windows.ok) return;
    best.judged = true;
    const grade: HitGrade =
      best.key !== i.key
        ? 'miss'
        : bestD <= this.windows.perfect
          ? 'perfect'
          : bestD <= this.windows.great
            ? 'great'
            : 'ok';
    this.hit(turn, i.id, grade, i.key, i.t);
  }

  setCpu(id: string, skill: number) {
    this.cpu.set(id, skill);
  }

  private hit(turn: Turn, id: string, grade: HitGrade, key: BreakKey, at: number) {
    const pose = this.poses.get(id)!;
    pose.lastGrade = grade;
    pose.lastAt = at;
    this.out.push({ e: 'hit', id, grade, key });
    if (grade === 'miss') {
      if (this.combo >= 4) this.out.push({ e: 'crash', id });
      this.combo = 0;
      pose.crashed = true;
      return;
    }
    pose.crashed = false;
    this.combo++;
    const pts = Math.round(POINTS[grade] * (1 + Math.min(this.combo, 20) * 0.05));
    this.turnScore += pts;
    if (this.combo % 4 === 0) {
      this.out.push({ e: 'combo', id, combo: this.combo });
      const move = this.moveAt(turn, Math.floor(this.beat));
      if (move !== null) this.out.push({ e: 'move', id, move, landed: true, points: pts * 4 });
    }
  }

  private moveAt(turn: Turn, beat: number): MoveId | null {
    if (beat < turn.from || beat >= turn.to) return null;
    const bar = Math.floor((beat - turn.from) / 4);
    const bars = (turn.to - turn.from) / 4;
    const pick = (list: MoveId[]) => list[(turn.round + bar + turn.from) % list.length];
    if (bar === bars - 1) return pick(FREEZES);
    return pick(BAR_MOVES[Math.min(bar, BAR_MOVES.length - 1)]);
  }

  step(dt: number): SimEvent[] {
    if (this.phase === 'done' || !(dt > 0)) return this.flush();
    this.t += dt;
    const beat = this.beat;
    while (this.lastBeat < Math.floor(beat)) {
      this.lastBeat++;
      this.out.push({ e: 'beat', beat: this.lastBeat, downbeat: this.lastBeat % 4 === 0 });
    }
    // Turn changes: the next dancer is up GAP_BEATS early (walking in, prompts showing)
    const idx = this.turns.findIndex(x => beat >= x.from - GAP_BEATS && beat < x.to);
    if (idx !== this.cur && idx >= 0) {
      if (this.cur >= 0) this.endTurn(this.turns[this.cur], this.turns[idx].round);
      this.cur = idx;
      this.turnScore = 0;
      this.combo = 0;
      const turn = this.turns[idx];
      this.out.push({ e: 'turn', id: turn.id, round: turn.round });
    }
    const turn = this.cur >= 0 ? this.turns[this.cur] : null;
    if (turn !== null) {
      const skill = this.cpu.get(turn.id);
      for (const p of turn.prompts) {
        if (p.judged) continue;
        const pt = this.beatTime(p.beat);
        if (skill !== undefined && this.t >= pt) {
          p.judged = true;
          const r = this.rnd();
          const grade: HitGrade =
            r < skill * 0.45
              ? 'perfect'
              : r < skill * 0.85
                ? 'great'
                : r < 0.2 + skill * 0.75
                  ? 'ok'
                  : 'miss';
          this.hit(turn, turn.id, grade, p.key, pt);
        } else if (this.t > pt + this.windows.ok) {
          p.judged = true;
          this.hit(turn, turn.id, 'miss', p.key, pt);
        }
      }
    }
    // The last turn's over: the final card and a winner
    const last = this.turns[this.turns.length - 1];
    if (last !== undefined && beat >= last.to + 1) {
      this.endTurn(last, -1);
      this.phase = 'done';
      const [a, b] = this.totals;
      this.winner = a === b ? 'tie' : a > b ? 0 : 1;
      this.out.push({ e: 'end', winner: this.winner, totals: [a, b] });
    } else if (turn === null) this.phase = this.cur < 0 ? 'intro' : 'judging';
    else this.phase = beat < turn.from ? (this.cur === 0 ? 'intro' : 'between') : 'turn';
    this.pose(turn);
    return this.flush();
  }

  private endTurn(turn: Turn, nextRound: number) {
    const c = this.crewOf(turn.id);
    this.totals[c] += this.turnScore;
    this.roundPts[c] += this.turnScore;
    if (nextRound !== turn.round) {
      const [a, b] = this.roundPts;
      const lean = a + b > 0 ? a / (a + b) : 0.5;
      const votes: CrewId[] = [0, 1, 2].map(j => (lean + (j - 1) * 0.04 >= 0.5 ? 0 : 1));
      const sc = (k: number): [number, number] => [
        Math.round((a / 100) * k) / 10,
        Math.round((b / 100) * k) / 10,
      ];
      const card: JudgeCard = {
        votes,
        technique: sc(1),
        musicality: sc(0.9),
        originality: sc(0.8),
        power: sc(0.7),
      };
      this.cards.push(card);
      this.out.push({ e: 'card', round: turn.round, card });
      this.roundPts = [0, 0];
    }
  }

  private pose(turn: Turn | null) {
    const beat = this.beat;
    for (const p of this.poses.values()) {
      const up = turn !== null && turn.id === p.id && beat >= turn.from && beat < turn.to;
      p.centre = turn !== null && turn.id === p.id;
      if (!up) {
        p.move = null;
        p.moveT = 0;
        continue;
      }
      p.move = this.moveAt(turn, Math.floor(beat));
      p.moveT = ((((beat - turn.from) % 4) + 4) % 4) / 4;
    }
  }

  private flush() {
    const o = this.out;
    this.out = [];
    return o;
  }

  state(): SimState {
    const turn = this.cur >= 0 ? this.turns[this.cur] : null;
    const beat = this.beat;
    return {
      gid: this.config.gid,
      phase: this.phase,
      t: this.t,
      beat,
      round: turn?.round ?? 0,
      turn: turn ? { id: turn.id, from: turn.from, to: turn.to } : null,
      poses: [...this.poses.values()].map(p => ({ ...p })),
      turnScore: this.turnScore,
      combo: this.combo,
      prompts:
        turn === null
          ? []
          : turn.prompts
              .filter(p => !p.judged && p.beat >= beat - 1 && p.beat < beat + 8)
              .map(p => ({ key: p.key, beat: p.beat })),
      totals: [this.totals[0], this.totals[1]],
      cards: this.cards.map(c => structuredClone(c)),
      ...(this.winner !== undefined ? { winner: this.winner } : {}),
    };
  }
}

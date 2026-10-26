// ── Noun Breaks HUD state: written by the view, read by BreakHud ────────
//
// `state` changes a few times a beat at most (React re-renders on it);
// `live` changes every frame (the beat track reads it in its own rAF, no
// React renders), like hoops/view/hudStore.ts.

import type {
  BattlePhase,
  BreakKey,
  CrewId,
  HitGrade,
  JudgeCard,
  LaneNote,
  SimState,
} from '../contract';

export interface CrewInfo {
  name: string;
  color: string;
  total: number;
  dancers: { id: string; name: string; local: boolean; up: boolean }[];
}

export interface MoveCall {
  id: number;
  text: string;
  points: number;
  landed: boolean;
  big: boolean;
  at: number;
}

export interface GradeFlash {
  id: number;
  grade: HitGrade;
  /** The local player's hit (big, centre) or the dancer up's (small). */
  local: boolean;
  at: number;
}

export interface Banner {
  id: number;
  text: string;
  sub?: string;
  tone: 'gold' | 'red' | 'blue' | 'white';
  at: number;
}

export interface BreakHudState {
  phase: BattlePhase;
  round: number;
  rounds: number;
  bpm: number;
  crews: [CrewInfo, CrewInfo];
  localId: string | null;
  /** The dancer up. */
  up: { id: string; name: string; crew: CrewId; local: boolean } | null;
  /**
   * Whose prompts the beat track shows: the dancer up, or (lead-in, when the
   * sim says so with SimState.promptsFor) the next one, before their turn.
   */
  track: { id: string; crew: CrewId; local: boolean } | null;
  combo: number;
  turnScore: number;
  calls: MoveCall[];
  flash: GradeFlash | null;
  banner: Banner | null;
  /** The card being revealed (judges' cards), and every card so far. */
  reveal: { round: number; card: JudgeCard; at: number } | null;
  cards: JudgeCard[];
  winner: CrewId | 'tie' | null;
  /** The song playing ("♪ title · artist"), null for the generated beat. */
  song: string | null;
}

export interface BreakHudLive {
  /** View beat clock. */
  beat: number;
  /** Incoming prompts of the dancer up. */
  prompts: { key: BreakKey; beat: number }[];
  /** The turn on the beat grid, for the timer. */
  turn: { from: number; to: number } | null;
  /** The rhythm lane (SimState.lane), null when the sim doesn't send one (prompts stand in). */
  lane: LaneNote[] | null;
  /** The move the dancer up is putting together (SimState.forming). */
  forming: SimState['forming'] | null;
  /** The local player's presses (performance.now() ms), flashed on the hit line at once. */
  presses: { key: BreakKey; at: number }[];
}

export class BreakHudStore {
  private listeners = new Set<() => void>();
  state: BreakHudState;
  readonly live: BreakHudLive = {
    beat: 0,
    prompts: [],
    turn: null,
    lane: null,
    forming: null,
    presses: [],
  };

  /** A local key press (keyboard, click or touch): the hit line shows it straight away. */
  pressed(key: BreakKey, at = performance.now()) {
    const p = this.live.presses;
    p.push({ key, at });
    if (p.length > 8) p.shift();
  }

  constructor(initial?: Partial<BreakHudState>) {
    this.state = { ...initialHud(), ...initial };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = () => this.state;

  set(patch: Partial<BreakHudState>) {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof BreakHudState)[])
      if (this.state[k] !== patch[k]) {
        changed = true;
        break;
      }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

export const CREW_COLORS: [string, string] = ['#ff2d6f', '#2fd4ff'];
export const CREW_NAMES: [string, string] = ['RED CREW', 'BLUE CREW'];

export function initialHud(): BreakHudState {
  return {
    phase: 'intro',
    round: 0,
    rounds: 1,
    bpm: 100,
    crews: [
      { name: CREW_NAMES[0], color: CREW_COLORS[0], total: 0, dancers: [] },
      { name: CREW_NAMES[1], color: CREW_COLORS[1], total: 0, dancers: [] },
    ],
    localId: null,
    up: null,
    track: null,
    combo: 0,
    turnScore: 0,
    calls: [],
    flash: null,
    banner: null,
    reveal: null,
    cards: [],
    winner: null,
    song: null,
  };
}

// ── pure helpers (tested) ───────────────────────────────────────────────

export const KEY_GLYPH: Record<BreakKey, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  a: 'A',
  b: 'B',
};

export const GRADE_LABEL: Record<HitGrade, string> = {
  perfect: 'PERFECT',
  great: 'GREAT',
  ok: 'OK',
  miss: 'MISS',
};

export const GRADE_COLOR: Record<HitGrade, string> = {
  perfect: '#3ddc84',
  great: '#ffd400',
  ok: '#2fd4ff',
  miss: '#ff4a3d',
};

export interface TrackItem {
  key: BreakKey;
  beat: number;
  /** 0 at the hit line, 1 at the far end of the track. */
  x: number;
  alpha: number;
  /** On a downbeat (bigger note). */
  down: boolean;
}

/**
 * Lay the incoming prompts out on the beat track: `ahead` beats of track
 * after the hit line, notes fade in at the far end and out just past the
 * line.
 */
export function trackItems(
  prompts: readonly { key: BreakKey; beat: number }[],
  beat: number,
  ahead = 4,
): TrackItem[] {
  const out: TrackItem[] = [];
  for (const p of prompts) {
    const d = p.beat - beat;
    if (d < -0.35 || d > ahead) continue;
    const x = d / ahead;
    const alpha = d < 0 ? Math.max(0, 1 + d / 0.35) : Math.min(1, (ahead - d) / 0.6);
    out.push({
      key: p.key,
      beat: p.beat,
      x,
      alpha,
      down: Math.abs(p.beat - Math.round(p.beat / 4) * 4) < 1e-3,
    });
  }
  return out;
}

export type LaneStatus = 'pending' | 'hit' | 'miss' | 'dead';

export interface LaneItem {
  id: string;
  key: BreakKey;
  beat: number;
  /** 0 at the hit line, 1 at the far end (negative: scrolled past). */
  x: number;
  alpha: number;
  down: boolean;
  status: LaneStatus;
  grade?: HitGrade;
  /** On an OK hit: which side of the beat it was. */
  timing?: 'EARLY' | 'LATE';
  /** The move's name, on its first note. */
  label?: string;
}

/** How far past the hit line notes keep scrolling (beats). */
export const LANE_PAST = 1.2;

/**
 * Lay the rhythm lane out: notes scroll from `ahead` beats out to the hit
 * line and on past it; a hit note's status is its grade (the track bursts
 * it), a miss keeps going marked MISS, a dead one (its move broke) greys.
 * Without a lane (the mock / stub), the prompts stand in as pending notes.
 */
export function laneItems(
  lane: readonly LaneNote[] | null,
  prompts: readonly { key: BreakKey; beat: number }[],
  beat: number,
  ahead = 4,
  name: (move: string) => string = m => m,
): LaneItem[] {
  const src: readonly LaneNote[] =
    lane ??
    prompts.map(p => ({ key: p.key, beat: p.beat, id: `p${p.beat}`, move: 'drop', i: 1, n: 2 }));
  const out: LaneItem[] = [];
  for (const n of src) {
    const d = n.beat - beat;
    if (d < -LANE_PAST || d > ahead) continue;
    const hit = n.grade !== undefined && n.grade !== 'miss';
    const status: LaneStatus = hit
      ? 'hit'
      : n.grade === 'miss'
        ? 'miss'
        : n.dead === true
          ? 'dead'
          : 'pending';
    const alpha =
      d < 0
        ? Math.max(0, 1 + d / LANE_PAST)
        : Math.min(1, (ahead - d) / 0.6) * (status === 'dead' ? 0.45 : 1);
    const it: LaneItem = {
      id: n.id,
      key: n.key,
      beat: n.beat,
      x: d / ahead,
      alpha,
      down: Math.abs(n.beat - Math.round(n.beat / 4) * 4) < 1e-3,
      status,
    };
    if (n.grade !== undefined) it.grade = n.grade;
    if (n.grade === 'ok' && n.off !== undefined && Math.abs(n.off) > 1e-3)
      it.timing = n.off < 0 ? 'EARLY' : 'LATE';
    if (lane !== null && n.i === 0) it.label = name(n.move).toUpperCase();
    out.push(it);
  }
  return out;
}

/** "WINDMILL 2/4" (or "WINDMILL ✓" once it lands). */
export function formingText(f: SimState['forming'] | null, name: (move: string) => string): string {
  if (f === null || f === undefined) return '';
  const n = name(f.move).toUpperCase();
  return f.landed === true ? `${n} ✓` : `${n} ${f.got}/${f.of}`;
}

/** Fraction of the turn left (1 at the start, 0 at the end). */
export function turnLeft(beat: number, turn: { from: number; to: number } | null): number {
  if (turn === null || !(turn.to > turn.from)) return 0;
  return Math.min(1, Math.max(0, (turn.to - beat) / (turn.to - turn.from)));
}

/** Bars and beats left in the turn, e.g. "3.2" (bars.beats), for the timer. */
export function barsLeft(beat: number, turn: { from: number; to: number } | null): string {
  if (turn === null) return '';
  const left = Math.max(0, Math.ceil(turn.to - beat));
  return `${Math.floor(left / 4)}.${left % 4}`;
}

/** Category totals of a judge card for a crew. */
export function cardTotal(card: JudgeCard, crew: CrewId): number {
  return card.technique[crew] + card.musicality[crew] + card.originality[crew] + card.power[crew];
}

/** Votes per crew on a card. */
export function cardVotes(card: JudgeCard): [number, number] {
  const v: [number, number] = [0, 0];
  for (const c of card.votes) v[c]++;
  return v;
}

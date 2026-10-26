// ── Noun Breaks HUD state: written by the view, read by BreakHud ────────
//
// `state` changes a few times a beat at most (React re-renders on it);
// `live` changes every frame (the beat track reads it in its own rAF, no
// React renders), like hoops/view/hudStore.ts.

import type { BattlePhase, BreakKey, CrewId, HitGrade, JudgeCard } from '../contract';

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
}

export interface BreakHudLive {
  /** View beat clock. */
  beat: number;
  /** Incoming prompts of the dancer up. */
  prompts: { key: BreakKey; beat: number }[];
  /** The turn on the beat grid, for the timer. */
  turn: { from: number; to: number } | null;
  /** Prompts already hit (beat → grade), so the track can pop them. */
  hits: { beat: number; grade: HitGrade; at: number }[];
}

export class BreakHudStore {
  private listeners = new Set<() => void>();
  state: BreakHudState;
  readonly live: BreakHudLive = { beat: 0, prompts: [], turn: null, hits: [] };

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

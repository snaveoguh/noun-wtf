// ── HUD state shared between HoopsView (writer) and HoopsHud (React) ────

import type { GamePhase, TeamId } from '../contract';

export type CalloutTone = 'gold' | 'fire' | 'red' | 'blue' | 'white';

export interface Callout {
  id: number;
  text: string;
  sub?: string;
  tone: CalloutTone;
  /** 0 small chip … 2 screen-filling. */
  size: 0 | 1 | 2;
  at: number;
}

export interface BoxRow {
  id: string;
  name: string;
  team: TeamId;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  dnk: number;
}

export interface TeamInfo {
  name: string;
  color: string;
  players: { id: string; name: string; onFire: boolean; local: boolean }[];
}

export interface HoopsHudState {
  phase: GamePhase;
  score: [number, number];
  offense: TeamId;
  shotClock: number;
  shotClockMax: number;
  target: number;
  winBy2: boolean;
  teams: [TeamInfo, TeamInfo];
  localId: string | null;
  callouts: Callout[];
  final: { winner: TeamId; score: [number, number]; box: BoxRow[]; mvp: string | null } | null;
  cameraMode: 'broadcast' | 'chase';
  slowmo: boolean;
}

/** Per-frame values the HUD reads in its own rAF loop (no React renders). */
export interface HoopsHudLive {
  meter: {
    visible: boolean;
    /** Screen px of the local player's shoulder. */
    x: number;
    y: number;
    value: number;
    sweet: number;
    /** Last release: how close to the sweet spot (shot quality) + when. */
    result: number | null;
    resultAt: number;
  };
}

export class HudStore {
  private listeners = new Set<() => void>();
  state: HoopsHudState;
  readonly live: HoopsHudLive = {
    meter: { visible: false, x: 0, y: 0, value: 0, sweet: 0.86, result: null, resultAt: 0 },
  };

  constructor(initial: HoopsHudState) {
    this.state = initial;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = () => this.state;

  set(patch: Partial<HoopsHudState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

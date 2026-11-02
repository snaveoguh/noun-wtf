// ── HUD state shared between FootballView (writer) and FootballHud (React) ──
//
// `state` changes a few times a second (score, clock text, banners) and
// re-renders the React tree; `live` is written every frame (radar dots, the
// controlled player's tag position, the power bar) and read by the HUD's
// own rAF loop without React renders, like hoops/view/hudStore.ts.

import type { Phase, TeamId } from '../contract';

export type BannerKind =
  | 'goal'
  | 'yellow'
  | 'red'
  | 'offside'
  | 'half'
  | 'full'
  | 'penalty'
  | 'save'
  | 'woodwork'
  | 'kickoff';

export interface Banner {
  id: number;
  kind: BannerKind;
  text: string;
  sub?: string;
  team: TeamId | null;
  at: number;
  /** How long it shows (ms). */
  ms: number;
}

export interface HudTeam {
  name: string;
  short: string;
  /** CSS colours. */
  shirt: string;
  shorts: string;
  ink: string;
}

export interface FootballHudState {
  teams: [HudTeam, HudTeam];
  score: [number, number];
  clock: string;
  /** Stoppage time running ("+1:12"). */
  extra: string | null;
  /** Announced added time ("+3"). */
  added: string | null;
  period: string;
  phase: Phase;
  poss: TeamId;
  banners: Banner[];
  hint: string | null;
  shootout: { kicks: [boolean[], boolean[]]; next: TeamId } | null;
  replay: boolean;
  /** Bumped on every replay cut (the HUD's wipe). */
  wipe: number;
  /** Controlled footballer (id) and their team. */
  local: string | null;
  localTeam: TeamId | null;
}

export interface HudLive {
  radar: {
    n: number;
    /** Pitch-normalised −1..1: x across (+ = left of the attacking-+z team), z along. */
    xs: Float32Array;
    zs: Float32Array;
    team: Uint8Array;
    /** Index of the controlled footballer, −1 none. */
    me: number;
    bx: number;
    bz: number;
    /** Pitch aspect (width / length) for the outline. */
    aspect: number;
    /** Which way the radar is drawn: +1 = +z to the right. */
    flip: 1 | -1;
  };
  tag: {
    visible: boolean;
    /** Screen px (top-centre of the tag). */
    x: number;
    y: number;
    name: string;
    number: number;
    stamina: number;
    team: TeamId;
  };
  power: { visible: boolean; value: number; kind: string };
}

export class HudStore {
  private listeners = new Set<() => void>();
  state: FootballHudState;
  readonly live: HudLive = {
    radar: {
      n: 0,
      xs: new Float32Array(32),
      zs: new Float32Array(32),
      team: new Uint8Array(32),
      me: -1,
      bx: 0,
      bz: 0,
      aspect: 68 / 105,
      flip: 1,
    },
    tag: { visible: false, x: 0, y: 0, name: '', number: 0, stamina: 1, team: 0 },
    power: { visible: false, value: 0, kind: '' },
  };

  constructor(initial: FootballHudState) {
    this.state = initial;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = () => this.state;

  set(patch: Partial<FootballHudState>) {
    let changed = false;
    for (const k in patch) {
      const key = k as keyof FootballHudState;
      if (patch[key] !== this.state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

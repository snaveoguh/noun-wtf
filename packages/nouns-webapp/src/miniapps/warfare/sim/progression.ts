// ── Rep (XP) + unlocks ──────────────────────────────────────────────────
//
// Rep is earned per match from your stats and the result. Levels unlock
// blasters. Phase 1 persists to localStorage; `ProgressStore` is the seam
// for phase 2 (wallet-linked server persistence): implement load/save
// against the API and pass it to the page instead of `localProgress`.

import type { ModeId, PlayerState } from './types';

import { WEAPONS, WEAPON_ORDER, type WeaponId } from './weapons';

export interface Profile {
  rep: number;
  matches: number;
  wins: number;
  kills: number;
  /** Last lobby choices. */
  last?: {
    mode?: string;
    map?: string;
    size?: number;
    difficulty?: number;
  };
}

export interface ProgressStore {
  load(): Profile;
  save(p: Profile): void;
  /** Optional remote sync hook (phase 2). */
  sync?(p: Profile): Promise<Profile>;
}

/** Rep needed to reach each level (index = level − 1). */
export const LEVELS = [0, 250, 700, 1400, 2400, 3800, 5600, 8000];
export const LEVEL_TITLES = [
  'Fresh Paint',
  'Splat Rookie',
  'Drip Runner',
  'Turf Tagger',
  'Noggle Sniper',
  'Paint Boss',
  'Splat Legend',
  'Nounish Icon',
];

export function levelFor(rep: number): number {
  let l = 1;
  for (let i = 0; i < LEVELS.length; i++) if (rep >= LEVELS[i]) l = i + 1;
  return l;
}

export function levelProgress(rep: number): { level: number; into: number; need: number } {
  const level = levelFor(rep);
  const base = LEVELS[level - 1];
  const next = LEVELS[level] ?? base;
  return { level, into: rep - base, need: Math.max(0, next - base) };
}

export function unlockedWeapons(rep: number): WeaponId[] {
  const l = levelFor(rep);
  return WEAPON_ORDER.filter(w => WEAPONS[w].unlock <= l);
}

export interface RepBreakdown {
  total: number;
  lines: { label: string; rep: number }[];
}

/** Rep for one finished (or abandoned) match. */
export function matchRep(
  p: PlayerState,
  mode: ModeId,
  won: boolean,
  draw: boolean,
  finished: boolean,
): RepBreakdown {
  const s = p.stats;
  const lines: { label: string; rep: number }[] = [];
  const add = (label: string, rep: number) => {
    if (rep > 0) lines.push({ label, rep: Math.round(rep) });
  };
  add(`${s.kills} splats`, s.kills * 10);
  add(`${s.assists} assists`, s.assists * 4);
  add(`${s.headshots} noggle shots`, s.headshots * 5);
  if (mode === 'turf') add(`${s.captures} captures`, s.captures * 15);
  if (mode === 'elim') add('rounds', s.score);
  add(`best streak ${s.bestStreak}`, s.bestStreak >= 3 ? s.bestStreak * 5 : 0);
  if (finished) add('match played', 25);
  if (finished && won) add('WIN', 75);
  else if (finished && draw) add('draw', 30);
  const total = lines.reduce((a, l) => a + l.rep, 0);
  return { total, lines };
}

const KEY = 'noun-warfare-profile-v1';

export const localProgress: ProgressStore = {
  load(): Profile {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return { rep: 0, matches: 0, wins: 0, kills: 0 };
      const v = JSON.parse(raw) as Partial<Profile>;
      return {
        rep: typeof v.rep === 'number' && Number.isFinite(v.rep) ? Math.max(0, v.rep) : 0,
        matches: typeof v.matches === 'number' ? v.matches : 0,
        wins: typeof v.wins === 'number' ? v.wins : 0,
        kills: typeof v.kills === 'number' ? v.kills : 0,
        last: v.last,
      };
    } catch {
      return { rep: 0, matches: 0, wins: 0, kills: 0 };
    }
  },
  save(p: Profile) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      // storage blocked: progress just won't persist
    }
  },
};

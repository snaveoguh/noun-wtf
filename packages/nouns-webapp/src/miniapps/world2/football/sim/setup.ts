// ── Noun Football: teams, formations, match setup (pure) ─────────────────

import type {
  Difficulty,
  Footballer,
  Formation,
  MatchConfig,
  Ratings,
  Role,
  TeamId,
  TeamKit,
  TeamSize,
} from '../contract';

import { FORMATIONS, PITCHES } from '../contract';

import { hashSeed, rand, type RngHolder } from './rng';

/** Formation slot in the team's attacking frame: u across (−1..1), v along (−1 own line … +1 theirs). */
export interface Slot {
  u: number;
  v: number;
  role: Role;
}

/** Rows (from the back) → v of each row in the base shape. */
const ROW_V: Record<number, number[]> = {
  2: [-0.5, 0.05],
  3: [-0.58, -0.2, 0.12],
  4: [-0.6, -0.33, -0.08, 0.14],
};

/** Spread n players across the width (u in ±spread). */
function spread(n: number, w: number): number[] {
  if (n === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(-w + (2 * w * i) / (n - 1));
  return out;
}

const ROLE_OF_ROW = (row: number, rows: number): Role =>
  row === 0 ? 'DF' : row === rows - 1 ? 'FW' : 'MF';

/** Keeper first, then the rows from the back, each row left (−u) to right. */
export function formationSlots(f: Formation): Slot[] {
  const rows = f.split('-').map(Number);
  const vs = ROW_V[rows.length] ?? ROW_V[3];
  const out: Slot[] = [{ u: 0, v: -0.94, role: 'GK' }];
  rows.forEach((n, i) => {
    const w = n >= 5 ? 0.82 : n === 4 ? 0.72 : n === 3 ? 0.55 : n === 2 ? 0.36 : 0;
    for (const u of spread(n, w)) {
      // Wide players in a back five / midfield five play a bit higher (wing backs)
      const wing = n >= 5 && Math.abs(u) > 0.7 ? 0.08 : 0;
      out.push({ u, v: vs[i] + wing, role: ROLE_OF_ROW(i, rows.length) });
    }
  });
  return out;
}

export const KITS: TeamKit[] = [
  {
    name: 'Noun City',
    short: 'NCY',
    shirt: 0xd22209,
    shorts: 0xffffff,
    socks: 0xd22209,
    keeper: 0x2fb35a,
  },
  {
    name: 'Noggle United',
    short: 'NOG',
    shirt: 0x1f6fe0,
    shorts: 0x0b1f4d,
    socks: 0x1f6fe0,
    keeper: 0xf3c25b,
  },
  {
    name: 'Prop House FC',
    short: 'PRP',
    shirt: 0xf6d21f,
    shorts: 0x141414,
    socks: 0xf6d21f,
    keeper: 0x9b4de0,
  },
  {
    name: 'Lil Nouns Rovers',
    short: 'LIL',
    shirt: 0x7fd3ff,
    shorts: 0xffffff,
    socks: 0x7fd3ff,
    keeper: 0xe05a2f,
  },
  {
    name: 'Camp Wanderers',
    short: 'CMP',
    shirt: 0x2a8c4a,
    shorts: 0xf2efe6,
    socks: 0x2a8c4a,
    keeper: 0xd22209,
  },
  {
    name: 'Treasury Athletic',
    short: 'TRS',
    shirt: 0x141414,
    shorts: 0x141414,
    socks: 0xf6d21f,
    keeper: 0x7fd3ff,
  },
  {
    name: 'Ice Cream Van FC',
    short: 'ICV',
    shirt: 0xf7a8c8,
    shorts: 0x6b3fa0,
    socks: 0xf7a8c8,
    keeper: 0x2fb35a,
  },
  {
    name: 'Jersey High',
    short: 'JRS',
    shirt: 0xff7a1a,
    shorts: 0x1b1b1b,
    socks: 0xff7a1a,
    keeper: 0x1f6fe0,
  },
];

const FIRST = [
  'Pip',
  'Noggs',
  'Lil',
  'Zeb',
  'Duna',
  'Mo',
  'Tubs',
  'Coin',
  'Shrimp',
  'Toast',
  'Crab',
  'Mango',
  'Vibe',
  'Dots',
  'Wave',
  'Buzz',
  'Juno',
  'Rex',
  'Kiko',
  'Ozzy',
  'Bean',
  'Fizz',
  'Gus',
  'Lolo',
];
const LAST = [
  'Nounson',
  'Glasses',
  'Square',
  'Pixel',
  'Prop',
  'Vault',
  'Bidder',
  'Settler',
  'Fork',
  'Quorum',
  'Delegate',
  'Treasury',
  'Auction',
  'Seeder',
  'Descriptor',
  'Timelock',
];

/** Varied ratings around a skill level (0..1). */
function ratingsFor(h: RngHolder, role: Role, level: number): Ratings {
  const r = () => Math.max(0.2, Math.min(0.99, level + (rand(h) - 0.5) * 0.24));
  const base: Ratings = {
    pace: r(),
    shooting: r(),
    passing: r(),
    dribbling: r(),
    defending: r(),
    physical: r(),
    keeping: 0.2,
  };
  if (role === 'GK') {
    base.keeping = Math.min(0.99, level + 0.1 + (rand(h) - 0.5) * 0.1);
    base.shooting = 0.25;
    base.pace = Math.min(base.pace, 0.6);
  } else if (role === 'DF') {
    base.defending = Math.min(0.99, base.defending + 0.12);
    base.shooting = Math.max(0.2, base.shooting - 0.15);
  } else if (role === 'FW') {
    base.shooting = Math.min(0.99, base.shooting + 0.14);
    base.defending = Math.max(0.2, base.defending - 0.2);
  } else {
    base.passing = Math.min(0.99, base.passing + 0.1);
  }
  return base;
}

/** The CPU's level per difficulty (ratings + decision quality). */
export const LEVEL: Record<Difficulty, number> = { 1: 0.5, 2: 0.64, 3: 0.76, 4: 0.88 };

export interface MatchSetup {
  size: TeamSize;
  seed: number;
  humans: { id: string; name: string; team: TeamId }[];
  difficulty?: [Difficulty, Difficulty] | Difficulty;
  kits?: [number, number] | [TeamKit, TeamKit];
  formations?: [Formation, Formation];
  halfSeconds?: number;
  knockout?: boolean;
  offside?: boolean;
  fouls?: boolean;
  /** NounCharacter seed key per footballer (the net layer passes character/NounAppearance seeds). */
  seedKey?: (team: TeamId, i: number) => string;
  /** The humans' own rider seed keys: they play as their rider (first outfield player). */
  humanSeedKey?: Record<string, string>;
  firstKick?: TeamId;
}

/** Real seconds per half by default (a 90 minute match in 8 minutes). */
export const DEFAULT_HALF = 240;

/** Build a full MatchConfig: rosters, names, ratings, kits, formations. */
export function makeMatch(s: MatchSetup): MatchConfig {
  const h: RngHolder = { rng: hashSeed(s.seed, 'setup') };
  const diff: [Difficulty, Difficulty] = Array.isArray(s.difficulty)
    ? s.difficulty
    : [s.difficulty ?? 2, s.difficulty ?? 2];
  let kits: [TeamKit, TeamKit];
  if (s.kits && typeof s.kits[0] === 'object') kits = s.kits as [TeamKit, TeamKit];
  else {
    const k = (s.kits as [number, number] | undefined) ?? [0, 1];
    kits = [KITS[k[0] % KITS.length], KITS[k[1] % KITS.length]];
  }
  const forms: [Formation, Formation] = s.formations ?? [
    FORMATIONS[s.size][0],
    FORMATIONS[s.size][0],
  ];
  const players: Footballer[] = [];
  const usedNames = new Set<string>();
  for (const team of [0, 1] as TeamId[]) {
    const slots = formationSlots(forms[team]);
    const humansHere = s.humans.filter(q => q.team === team);
    // Humans play at a decent level; the CPU at its difficulty's
    const level = humansHere.length > 0 ? 0.72 : LEVEL[diff[team]];
    const numbers = slots.length === 11 ? [1, 2, 5, 4, 3, 7, 8, 6, 11, 10, 9] : undefined;
    slots.forEach((slot, i) => {
      let name = '';
      for (let k = 0; k < 8 && (name === '' || usedNames.has(name)); k++)
        name = `${FIRST[Math.floor(rand(h) * FIRST.length)]} ${LAST[Math.floor(rand(h) * LAST.length)]}`;
      usedNames.add(name);
      players.push({
        id: `t${team}p${i}`,
        team,
        name,
        number: numbers?.[i] ?? i + 1,
        role: slot.role,
        seedKey: s.seedKey?.(team, i) ?? '',
        ratings: ratingsFor(h, slot.role, level),
      });
    });
    // A human plays as their own rider: the striker (or the last outfielder)
    humansHere.forEach((hu, k) => {
      const outfield = players.filter(p => p.team === team && p.role !== 'GK');
      const p = outfield[outfield.length - 1 - k];
      if (p === undefined) return;
      p.name = hu.name.slice(0, 16) || p.name;
      const key = s.humanSeedKey?.[hu.id];
      if (key) p.seedKey = key;
    });
  }
  return {
    size: s.size,
    pitch: PITCHES[s.size],
    halfSeconds: s.halfSeconds ?? DEFAULT_HALF,
    knockout: s.knockout ?? false,
    offside: s.offside ?? s.size !== 5,
    fouls: s.fouls ?? true,
    seed: s.seed,
    players,
    kits,
    formations: forms,
    tactics: [
      { press: 0.5, width: 0.6, direct: 0.4 },
      { press: 0.5, width: 0.6, direct: 0.4 },
    ],
    difficulty: diff,
    humans: s.humans,
    firstKick: s.firstKick,
  };
}

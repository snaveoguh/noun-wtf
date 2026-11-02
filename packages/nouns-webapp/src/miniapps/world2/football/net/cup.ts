// ── Noun Football: a short cup or season (pure) ─────────────────────────
//
//   CUP     8 clubs, knockout: quarter-final, semi-final, final (3 matches
//           for you; draws go to extra time + penalties in the sim)
//   SEASON  4 clubs, a round robin (3 matchdays), 3 points a win; top wins
//
// You play your fixture each round; the others' results come from a seeded
// roll weighted by their strength. Plain JSON, saved in localStorage by the
// mode (`noun-football-cup-v1`).

import type { Difficulty, TeamSize } from '../contract';

import { hashSeed, rand, type RngHolder } from '../sim/rng';
import { KITS } from '../sim/setup';

export type CupKind = 'cup' | 'season';

export interface Fixture {
  home: number;
  away: number;
  score?: [number, number];
  pens?: [number, number];
}

export interface Standing {
  club: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

export interface CupState {
  kind: CupKind;
  seed: number;
  size: TeamSize;
  difficulty: Difficulty;
  /** Kit index of your club. */
  me: number;
  /** Clubs (kit indices) in the competition. */
  clubs: number[];
  /** Club strength 0..1 (the CPU's level when you meet them). */
  strength: Record<number, number>;
  rounds: Fixture[][];
  round: number;
  done: boolean;
  /** Champions (kit index) once done. */
  winner: number | null;
}

export const CUP_ROUND_NAMES = ['QUARTER-FINAL', 'SEMI-FINAL', 'FINAL'];

function shuffle<T>(a: T[], h: RngHolder) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(h) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newCup(
  kind: CupKind,
  seed: number,
  me: number,
  size: TeamSize,
  difficulty: Difficulty,
): CupState {
  const h: RngHolder = { rng: hashSeed(seed, `cup:${kind}`) };
  const n = kind === 'cup' ? 8 : 4;
  const others = shuffle(
    KITS.map((_, i) => i).filter(i => i !== me),
    h,
  ).slice(0, n - 1);
  const clubs = [me, ...others];
  const strength: Record<number, number> = {};
  for (const c of clubs) strength[c] = c === me ? 0.7 : 0.35 + rand(h) * 0.5;
  const st: CupState = {
    kind,
    seed,
    size,
    difficulty,
    me,
    clubs,
    strength,
    rounds: [],
    round: 0,
    done: false,
    winner: null,
  };
  if (kind === 'cup') {
    const draw = shuffle(clubs.slice(), h);
    const r: Fixture[] = [];
    for (let i = 0; i < draw.length; i += 2) r.push({ home: draw[i], away: draw[i + 1] });
    st.rounds.push(r);
  } else {
    // Round robin (circle method) for 4 clubs: 3 matchdays
    const c = clubs;
    st.rounds = [
      [
        { home: c[0], away: c[1] },
        { home: c[2], away: c[3] },
      ],
      [
        { home: c[2], away: c[0] },
        { home: c[3], away: c[1] },
      ],
      [
        { home: c[0], away: c[3] },
        { home: c[1], away: c[2] },
      ],
    ];
  }
  return st;
}

/** Your fixture this round (null when you're out or it's over). */
export function myFixture(st: CupState): Fixture | null {
  if (st.done) return null;
  const r = st.rounds[st.round];
  return r?.find(f => f.home === st.me || f.away === st.me) ?? null;
}

/** The CPU difficulty for your next opponent (stronger clubs play harder). */
export function opponentDifficulty(st: CupState): Difficulty {
  const f = myFixture(st);
  if (!f) return st.difficulty;
  const opp = f.home === st.me ? f.away : f.home;
  const s = st.strength[opp] ?? 0.5;
  const d = st.difficulty + (s > 0.72 ? 1 : s < 0.45 ? -1 : 0);
  return Math.max(1, Math.min(4, d)) as Difficulty;
}

function rollGoals(h: RngHolder, attack: number, defence: number): number {
  const mean = 0.6 + 2.2 * attack - 1.4 * defence + 0.6;
  // Poisson-ish by inversion
  let g = 0;
  let p = Math.exp(-Math.max(0.2, mean));
  let s = p;
  const u = rand(h);
  while (u > s && g < 8) {
    g++;
    p *= Math.max(0.2, mean) / g;
    s += p;
  }
  return g;
}

/** Record your result for this round, roll the others, and move on. */
export function recordMine(
  st: CupState,
  myGoals: number,
  theirGoals: number,
  pens?: [number, number],
): CupState {
  const out: CupState = JSON.parse(JSON.stringify(st));
  const f = myFixture(out);
  if (!f) return out;
  const home = f.home === out.me;
  f.score = home ? [myGoals, theirGoals] : [theirGoals, myGoals];
  if (pens) f.pens = home ? pens : [pens[1], pens[0]];
  const h: RngHolder = { rng: hashSeed(out.seed, `round:${out.round}`) };
  for (const g of out.rounds[out.round]) {
    if (g.score) continue;
    const a = out.strength[g.home] ?? 0.5;
    const b = out.strength[g.away] ?? 0.5;
    g.score = [rollGoals(h, a, b), rollGoals(h, b, a)];
    if (out.kind === 'cup' && g.score[0] === g.score[1]) {
      const p0 = 3 + Math.floor(rand(h) * 3);
      let p1 = 3 + Math.floor(rand(h) * 3);
      if (p1 === p0) p1 = p0 + (rand(h) < 0.5 ? -1 : 1);
      g.pens = [p0, p1];
    }
  }
  if (out.kind === 'cup') {
    const winners = out.rounds[out.round].map(fixtureWinner);
    if (winners.length === 1) {
      out.done = true;
      out.winner = winners[0];
    } else if (!winners.includes(out.me)) {
      // knocked out: play out the rest
      let w = winners;
      while (w.length > 1) {
        const r: Fixture[] = [];
        for (let i = 0; i < w.length; i += 2) {
          const g: Fixture = { home: w[i], away: w[i + 1] };
          const a = out.strength[g.home] ?? 0.5;
          const b = out.strength[g.away] ?? 0.5;
          g.score = [rollGoals(h, a, b), rollGoals(h, b, a)];
          if (g.score[0] === g.score[1]) g.pens = rand(h) < 0.5 ? [5, 4] : [4, 5];
          r.push(g);
        }
        out.rounds.push(r);
        w = r.map(fixtureWinner);
      }
      out.round = out.rounds.length - 1;
      out.done = true;
      out.winner = w[0];
    } else {
      const r: Fixture[] = [];
      for (let i = 0; i < winners.length; i += 2)
        r.push({ home: winners[i], away: winners[i + 1] });
      out.rounds.push(r);
      out.round++;
    }
  } else {
    out.round++;
    if (out.round >= out.rounds.length) {
      out.done = true;
      out.winner = table(out)[0].club;
      out.round = out.rounds.length - 1;
    }
  }
  return out;
}

export function fixtureWinner(f: Fixture): number {
  const s = f.score ?? [0, 0];
  if (s[0] !== s[1]) return s[0] > s[1] ? f.home : f.away;
  const p = f.pens ?? [1, 0];
  return p[0] > p[1] ? f.home : f.away;
}

/** League table (season), sorted. */
export function table(st: CupState): Standing[] {
  const rows = new Map<number, Standing>();
  for (const c of st.clubs) rows.set(c, { club: c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const r of st.rounds)
    for (const f of r) {
      if (!f.score) continue;
      const a = rows.get(f.home)!;
      const b = rows.get(f.away)!;
      const [x, y] = f.score;
      a.p++;
      b.p++;
      a.gf += x;
      a.ga += y;
      b.gf += y;
      b.ga += x;
      if (x > y) {
        a.w++;
        b.l++;
        a.pts += 3;
      } else if (y > x) {
        b.w++;
        a.l++;
        b.pts += 3;
      } else {
        a.d++;
        b.d++;
        a.pts++;
        b.pts++;
      }
    }
  return [...rows.values()].sort(
    (a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.club - b.club,
  );
}

/** The round's name for the HUD. */
export function roundName(st: CupState): string {
  if (st.kind === 'season') return `MATCHDAY ${Math.min(st.round + 1, 3)} / 3`;
  const left = st.rounds[st.round]?.length ?? 1;
  return left === 4 ? CUP_ROUND_NAMES[0] : left === 2 ? CUP_ROUND_NAMES[1] : CUP_ROUND_NAMES[2];
}

// ── NOUN PARKOUR: your bests and ghosts (localStorage, per route) ────────
//
// Not on the shared leaderboard: a time trial has no physics proof the
// stats server could check (see the run-proofs skill), so best times and
// ghosts stay on this device for now.

import { unpackGhost } from '../sim/route';

const KEY = 'noun-parkour-v1:';

export interface Best {
  time: number;
  splits: number[];
  ghost: number[] | null;
  at: number;
}

export function loadBest(route: string): Best | null {
  try {
    const raw = localStorage.getItem(KEY + route);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<Best>;
    if (typeof v.time !== 'number' || !Number.isFinite(v.time) || v.time <= 0) return null;
    const splits = Array.isArray(v.splits) ? v.splits.filter(n => typeof n === 'number') : [];
    return { time: v.time, splits, ghost: unpackGhost(v.ghost), at: Number(v.at) || 0 };
  } catch {
    return null;
  }
}

export function saveBest(route: string, b: Best) {
  try {
    localStorage.setItem(KEY + route, JSON.stringify(b));
  } catch {
    // Full or blocked storage: the run still counts on screen
  }
}

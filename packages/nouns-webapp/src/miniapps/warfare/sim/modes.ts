// ── Mode rules: targets, timers, respawns, labels ──────────────────────

import type { ModeId, TeamSize } from './types';

export interface ModeInfo {
  id: ModeId;
  name: string;
  short: string;
  blurb: string;
  teams: boolean;
}

export const MODES: Record<ModeId, ModeInfo> = {
  tdm: {
    id: 'tdm',
    name: 'Team Splat',
    short: 'TEAM SPLAT',
    blurb: 'Team deathmatch. First crew to the splat target wins.',
    teams: true,
  },
  elim: {
    id: 'elim',
    name: 'Elimination',
    short: 'ELIMINATION',
    blurb: 'One life per round. Wipe the other crew. Best of 7.',
    teams: true,
  },
  turf: {
    id: 'turf',
    name: 'Turf War',
    short: 'TURF WAR',
    blurb: 'Hold the three zones. Every second on your turf scores.',
    teams: true,
  },
  ffa: {
    id: 'ffa',
    name: 'Free-for-All',
    short: 'FREE-FOR-ALL',
    blurb: 'Every Noun for themself. Most splats wins.',
    teams: false,
  },
};

export const MODE_ORDER: ModeId[] = ['tdm', 'elim', 'turf', 'ffa'];

export function modeTarget(mode: ModeId, size: TeamSize): number {
  switch (mode) {
    case 'tdm':
      return size === 2 ? 15 : size === 4 ? 30 : 40;
    case 'ffa':
      return size === 2 ? 10 : size === 4 ? 15 : 20;
    case 'turf':
      return 200;
    case 'elim':
      return 4;
  }
}

/** Live-play time limit in seconds (per round in Elimination). */
export function modeTimeLimit(mode: ModeId): number {
  switch (mode) {
    case 'tdm':
      return 480;
    case 'ffa':
      return 420;
    case 'turf':
      return 420;
    case 'elim':
      return 100;
  }
}

/** Seconds a splatted player waits (Infinity = out until next round). */
export function respawnDelay(mode: ModeId): number {
  switch (mode) {
    case 'tdm':
      return 2.5;
    case 'ffa':
      return 2;
    case 'turf':
      return 3.5;
    case 'elim':
      return Infinity;
  }
}

export const COUNTDOWN = 3;
export const ROUND_BREAK = 4;
/** Turf capture rate (progress units / s for one player; full swing is 2). */
export const TURF_CAP_RATE = 0.3;

export function scoreLabel(mode: ModeId): string {
  switch (mode) {
    case 'tdm':
      return 'SPLATS';
    case 'ffa':
      return 'SPLATS';
    case 'turf':
      return 'TURF';
    case 'elim':
      return 'ROUNDS';
  }
}

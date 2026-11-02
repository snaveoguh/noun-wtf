// ── Noun Football HUD: formatting (pure) ────────────────────────────────

import type { Period, Phase, Restart, TeamId } from '../contract';

/** Match clock (s) at which a period's regular time ends. */
export function periodEnd(period: Period): number {
  switch (period) {
    case 1:
      return 45 * 60;
    case 2:
      return 90 * 60;
    case 3:
      return 105 * 60;
    default:
      return 120 * 60;
  }
}

/** mm:ss (minutes can run past 99: "105:00"). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

/**
 * The scoreboard clock: regular time stops at the period's end ("45:00")
 * and stoppage time counts on beside it ("+1:12"), like TV.
 */
export function formatClock(clock: number, period: Period): { main: string; extra: string | null } {
  if (period === 5) return { main: 'PENS', extra: null };
  const end = periodEnd(period);
  if (clock <= end) return { main: mmss(clock), extra: null };
  return { main: mmss(end), extra: `+${mmss(clock - end).replace(/^0/, '')}` };
}

/** Announced stoppage time: "+3" (rounded up to whole minutes), or null. */
export function addedChip(added: number): string | null {
  if (!(added > 0)) return null;
  return `+${Math.max(1, Math.ceil(added / 60 - 1e-6))}`;
}

/** The minute a clock reads as ("23'", "45+2'"). */
export function minuteLabel(clock: number, period: Period): string {
  if (period === 5) return 'PENS';
  const end = periodEnd(period);
  if (clock <= end) return `${Math.min(end / 60, Math.floor(clock / 60) + 1)}'`;
  return `${end / 60}+${Math.floor((clock - end) / 60) + 1}'`;
}

export function periodLabel(period: Period, phase: Phase): string {
  if (phase === 'halftime') return period >= 3 ? 'ET HT' : 'HT';
  if (phase === 'fulltime' || phase === 'final') return 'FT';
  return ['', '1ST', '2ND', 'ET 1', 'ET 2', 'PENS'][period] ?? '';
}

/** 0xRRGGBB → "#rrggbb". */
export const hexCss = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** Readable text on a kit colour (black on light, white on dark). */
export function inkOn(n: number): string {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b0b12' : '#ffffff';
}

/** The set-piece hint line for a restart (for the team taking it / defending it). */
export function setPieceHint(r: Restart | null, mine: TeamId | null): string | null {
  if (r === null || mine === null) return null;
  const ours = r.team === mine;
  switch (r.kind) {
    case 'corner':
      return ours ? 'CORNER · Ⓧ CROSS · Ⓐ SHORT · RB CURL' : 'DEFEND THE CORNER · LB SWITCH';
    case 'free_kick':
      return ours
        ? r.direct === false
          ? 'INDIRECT FREE KICK · Ⓐ PASS · Ⓧ LOB'
          : 'FREE KICK · Ⓑ SHOOT · RB CURL · Ⓐ PASS'
        : 'FREE KICK AGAINST · HOLD THE WALL';
    case 'penalty':
      return ours ? 'PENALTY · AIM + Ⓑ SHOOT' : 'PENALTY · MOVE TO DIVE';
    case 'throw_in':
      return ours ? 'THROW-IN · Ⓐ SHORT · Ⓧ LONG' : null;
    case 'goal_kick':
      return ours ? 'GOAL KICK · Ⓐ SHORT · Ⓧ LONG' : null;
    case 'kickoff':
      return ours ? 'KICK-OFF · Ⓐ PASS' : null;
    default:
      return null;
  }
}

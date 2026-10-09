// ── Trick naming + combo scoring ─────────────────────────────────────────

import type { TrickInput } from '../core/Input';

export interface FlipDef {
  name: string;
  /** Board roll (about its long axis) in full turns; sign = direction. */
  roll: number;
  /** Board yaw spin (shove-it) in half turns; sign = direction. */
  spin: number;
  /** Seconds the flip takes to complete. */
  duration: number;
  points: number;
}

export const FLIPS: Record<TrickInput, FlipDef> = {
  ollie: { name: 'Ollie', roll: 0, spin: 0, duration: 0, points: 100 },
  nollie: { name: 'Nollie', roll: 0, spin: 0, duration: 0, points: 120 },
  kickflip: { name: 'Kickflip', roll: -1, spin: 0, duration: 0.42, points: 300 },
  heelflip: { name: 'Heelflip', roll: 1, spin: 0, duration: 0.42, points: 300 },
  shuvit: { name: 'Pop Shove-it', roll: 0, spin: 1, duration: 0.38, points: 200 },
  fs_shuvit: { name: 'FS Shove-it', roll: 0, spin: -1, duration: 0.38, points: 220 },
  varial: { name: 'Varial Flip', roll: -1, spin: 1, duration: 0.46, points: 450 },
  hardflip: { name: 'Hardflip', roll: -1, spin: -1, duration: 0.46, points: 550 },
  treflip: { name: '360 Flip', roll: -1, spin: 2, duration: 0.52, points: 650 },
  impossible: { name: 'Impossible', roll: 0, spin: 0, duration: 0.5, points: 500 },
};

export interface ComboEntry {
  name: string;
  points: number;
}

export interface ComboState {
  entries: ComboEntry[];
  /** Points accumulated by continuous tricks (grind/manual/grab time). */
  running: number;
  multiplier: number;
  total: number;
  /** Last banked combo for HUD flash. */
  lastBanked: { points: number; label: string; at: number; bailed: boolean } | null;
  best: number;
  session: number;
}

export function createCombo(): ComboState {
  return {
    entries: [],
    running: 0,
    multiplier: 0,
    total: 0,
    lastBanked: null,
    best: 0,
    session: 0,
  };
}

export function addTrick(c: ComboState, name: string, points: number) {
  // Collapse repeats so "50-50 + 50-50" doesn't spam the list
  const last = c.entries[c.entries.length - 1];
  if (last !== undefined && last.name === name && /grind|slide|manual|50-50|5-0/i.test(name)) {
    last.points += points;
  } else {
    c.entries.push({ name, points });
    c.multiplier = c.entries.length;
  }
  c.total += points;
}

export function addRunning(c: ComboState, pts: number) {
  c.running += pts;
}

export function comboScore(c: ComboState) {
  return Math.round((c.total + c.running) * Math.max(1, c.multiplier));
}

export function comboLabel(c: ComboState) {
  return c.entries.map(e => e.name).join(' + ');
}

export function bankCombo(c: ComboState, now: number) {
  if (c.entries.length === 0 && c.running < 1) return;
  const pts = comboScore(c);
  c.lastBanked = { points: pts, label: comboLabel(c), at: now, bailed: false };
  c.session += pts;
  c.best = Math.max(c.best, pts);
  c.entries = [];
  c.running = 0;
  c.total = 0;
  c.multiplier = 0;
}

export function bailCombo(c: ComboState, now: number) {
  if (c.entries.length === 0) return;
  c.lastBanked = { points: comboScore(c), label: comboLabel(c), at: now, bailed: true };
  c.entries = [];
  c.running = 0;
  c.total = 0;
  c.multiplier = 0;
}

/** Name an air trick from its pieces. */
export function airTrickName(opts: {
  flip: TrickInput | null;
  pop: 'ollie' | 'nollie';
  fakie: boolean;
  yawDeg: number;
  grab: string | null;
  frontside: boolean;
}) {
  const spin = Math.round(Math.abs(opts.yawDeg) / 180) * 180;
  const parts: string[] = [];
  if (opts.fakie && opts.pop !== 'nollie') parts.push('Fakie');
  if (opts.pop === 'nollie') parts.push('Nollie');
  if (spin >= 180) parts.push(`${opts.frontside ? 'FS' : 'BS'} ${spin}`);
  if (opts.flip && opts.flip !== 'ollie' && opts.flip !== 'nollie')
    parts.push(FLIPS[opts.flip].name);
  else if (spin < 180 && opts.pop === 'ollie' && !opts.grab) parts.push('Ollie');
  if (opts.grab) parts.push(opts.grab);
  const name = parts.join(' ').replace(/^Nollie$/, 'Nollie');
  return name || 'Ollie';
}

const MULTI = ['', '', 'Double', 'Triple', 'Quadruple', 'Quintuple', 'Sextuple'];

/** "Double Kickflip", "Quadruple Heelflip", "Kickflip to Double Heelflip"… */
export function chainedFlipName(flips: TrickInput[]): string {
  const runs: { trick: TrickInput; n: number }[] = [];
  for (const f of flips) {
    const last = runs[runs.length - 1];
    if (last && last.trick === f) last.n++;
    else runs.push({ trick: f, n: 1 });
  }
  return runs
    .map(({ trick, n }) => {
      const name = FLIPS[trick].name;
      if (n === 1) return name;
      return `${MULTI[n] ?? `${n}x`} ${name}`;
    })
    .join(' to ');
}

export function spinPoints(yawDeg: number) {
  const halfTurns = Math.round(Math.abs(yawDeg) / 180);
  return halfTurns * 220;
}

export function grindName(
  type: 'fiftyfifty' | 'fivezero' | 'nosegrind' | 'boardslide' | 'lipslide' | 'crooked',
  rail: string,
) {
  const base = {
    fiftyfifty: '50-50',
    fivezero: '5-0',
    nosegrind: 'Nosegrind',
    boardslide: 'Boardslide',
    lipslide: 'Lipslide',
    crooked: 'Crooked Grind',
  }[type];
  if (rail === 'coping') return base === '50-50' ? 'Axle Stall' : base;
  if (rail === 'ledge' && type === 'fiftyfifty') return '50-50';
  return base;
}

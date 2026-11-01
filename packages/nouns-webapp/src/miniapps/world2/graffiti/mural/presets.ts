// Mural mode's brushes and per-player settings (pen feel, finger mode, grid).

import { DEFAULT_FEEL, type PenFeel } from './pressure';

export interface Brush {
  id: string;
  label: string;
  /** Nozzle radius at full pressure (mm). */
  radius: number;
  hard: boolean;
  /** 1..16 */
  opacity: number;
  /** Lightest-touch width for this brush (overrides the feel's minSize). */
  minSize: number;
}

export const BRUSHES: readonly Brush[] = [
  { id: 'fine', label: 'FINE LINER', radius: 4, hard: true, opacity: 16, minSize: 0.35 },
  { id: 'marker', label: 'MARKER', radius: 14, hard: true, opacity: 12, minSize: 0.55 },
  { id: 'fat', label: 'FAT CAP', radius: 60, hard: false, opacity: 16, minSize: 0.3 },
  { id: 'soft', label: 'SOFT SPRAY', radius: 140, hard: false, opacity: 6, minSize: 0.45 },
];

export interface MuralSettings {
  feel: PenFeel;
  /** Fingers without a pen: paint or move the view. */
  fingers: 'paint' | 'move';
  grid: boolean;
  /** The brush preset last picked (null: none / tools changed by hand). */
  brush: string | null;
}

const KEY = 'w2-mural-v1';

function load(): MuralSettings {
  const base: MuralSettings = {
    feel: { ...DEFAULT_FEEL },
    fingers: 'paint',
    grid: false,
    brush: null,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<MuralSettings> | null;
    if (raw === null || typeof raw !== 'object') return base;
    const f = (raw.feel ?? {}) as Partial<PenFeel>;
    const num = (x: unknown, lo: number, hi: number, d: number) =>
      typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
    base.feel = {
      curve: num(f.curve, -1, 1, DEFAULT_FEEL.curve),
      minSize: num(f.minSize, 0.05, 1, DEFAULT_FEEL.minSize),
      tilt: num(f.tilt, 0, 1, DEFAULT_FEEL.tilt),
      smoothing: num(f.smoothing, 0, 1, DEFAULT_FEEL.smoothing),
      fingerPressure: f.fingerPressure !== false,
    };
    base.fingers = raw.fingers === 'move' ? 'move' : 'paint';
    base.grid = raw.grid === true;
    base.brush = typeof raw.brush === 'string' ? raw.brush : null;
  } catch {
    // private mode: defaults
  }
  return base;
}

let state: MuralSettings | null = null;
const listeners = new Set<() => void>();

export const muralSettings = {
  get(): MuralSettings {
    state ??= load();
    return state;
  },
  set(patch: Partial<MuralSettings>) {
    state = { ...muralSettings.get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
    for (const l of listeners) l();
  },
  setFeel(patch: Partial<PenFeel>) {
    muralSettings.set({ feel: { ...muralSettings.get().feel, ...patch } });
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

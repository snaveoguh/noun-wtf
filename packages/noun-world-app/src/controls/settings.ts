// Persisted control preferences (per device).

export interface ControlSettings {
  /** Steer by tilting the phone (accelerometer) instead of a left stick. */
  tilt: boolean;
  /** Degrees of roll for full lock. Smaller = more sensitive. */
  range: number;
  /** Flip the steering direction. */
  invert: boolean;
  /** Neutral roll offset in degrees (set by "calibrate"). */
  offset: number;
}

const KEY = 'noun-world-controls-v1';

export const DEFAULT_SETTINGS: ControlSettings = {
  tilt: true,
  range: 22,
  invert: false,
  offset: 0,
};

export function loadSettings(): ControlSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ControlSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: ControlSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode / storage blocked: settings just don't persist
  }
}

const BEST_KEY = 'noun-world-downhill-best-v1';

export interface DownhillBest {
  /** Longest time on the board in one run, seconds. */
  survival: number;
  /** Fastest full run top → finish, seconds (0 = never cleared). */
  clear: number;
}

export function loadBest(): DownhillBest {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) return { survival: 0, clear: 0, ...(JSON.parse(raw) as Partial<DownhillBest>) };
  } catch {
    // ignore
  }
  return { survival: 0, clear: 0 };
}

export function saveBest(b: DownhillBest) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    // ignore
  }
}

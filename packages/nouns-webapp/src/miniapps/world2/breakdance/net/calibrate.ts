// ── Audio / input latency calibration ───────────────────────────────────
//
// The battle already schedules its music `outputLatency` early so a beat is
// heard when the battle clock says it is. What that misses (Bluetooth
// headphones that under-report their latency, a slow keyboard, a player
// who hears late) shows up as taps that land consistently late or early.
// The menu's CALIBRATE plays a count-in and 8 clicks, scheduled exactly as
// the battle schedules its beat; the median of (tap − click heard) is the
// offset, stored per browser and taken off every press's stamp.
//
// Pure (the UI in BreakUi does the audio and the taps).

export const CALIB_KEY = 'noun-breaks-offset-ms';
/** Offsets beyond this are a mistake, not a latency. */
export const CALIB_MAX_MS = 250;
/** Clicks to tap along to, after a one-bar count-in. */
export const CALIB_CLICKS = 8;
export const CALIB_COUNT_IN = 4;
export const CALIB_BPM = 100;

export interface CalibResult {
  /** Median tap − click (ms): + = you tap late (presses get moved earlier by this). */
  offsetMs: number;
  /** Median absolute deviation (ms): how steady the taps were. */
  spreadMs: number;
  /** Taps that matched a click. */
  n: number;
}

const median = (xs: readonly number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Taps and the clicks' heard times (both performance.now() ms) → the
 * offset. Each tap goes to its nearest click within half a beat (one tap
 * per click); fewer than 5 matched taps is no result.
 */
export function calibrate(
  taps: readonly number[],
  clicks: readonly number[],
  beatMs = 60_000 / CALIB_BPM,
): CalibResult | null {
  const used = new Set<number>();
  const diffs: number[] = [];
  for (const t of taps) {
    let best = -1;
    for (let i = 0; i < clicks.length; i++) {
      if (used.has(i)) continue;
      if (best < 0 || Math.abs(t - clicks[i]) < Math.abs(t - clicks[best])) best = i;
    }
    if (best < 0 || Math.abs(t - clicks[best]) > beatMs / 2) continue;
    used.add(best);
    diffs.push(t - clicks[best]);
  }
  if (diffs.length < 5) return null;
  const off = median(diffs);
  const spread = median(diffs.map(d => Math.abs(d - off)));
  return {
    offsetMs: Math.round(Math.max(-CALIB_MAX_MS, Math.min(CALIB_MAX_MS, off))),
    spreadMs: Math.round(spread),
    n: diffs.length,
  };
}

/** The stored offset (ms), 0 when there's none or storage is blocked. */
export function loadCalib(): number {
  try {
    const v = Number(window.localStorage.getItem(CALIB_KEY));
    return Number.isFinite(v) ? Math.max(-CALIB_MAX_MS, Math.min(CALIB_MAX_MS, Math.round(v))) : 0;
  } catch {
    return 0;
  }
}

export function saveCalib(ms: number): void {
  try {
    if (ms === 0) window.localStorage.removeItem(CALIB_KEY);
    else window.localStorage.setItem(CALIB_KEY, String(Math.round(ms)));
  } catch {
    /* storage blocked: this session only */
  }
}

/** The audio output latency the battle compensates for (s), same rule as view/audio.ts. */
export function outputLatency(ctx: BaseAudioContext): number {
  const c = ctx as BaseAudioContext & { outputLatency?: number; baseLatency?: number };
  const lat = c.outputLatency ?? c.baseLatency ?? 0;
  return Number.isFinite(lat) ? Math.min(Math.max(lat, 0), 0.2) : 0;
}

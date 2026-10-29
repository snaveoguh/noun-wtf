// ── Frame pacing: run the game at a frame-rate cap on any display ───────
//
// requestAnimationFrame fires at the display's rate: 120 / 144 / 240 Hz on
// gaming monitors and ProMotion MacBooks. Uncapped, every one of those ran
// the whole sim + render pipeline, 2-4x the work of a 60 Hz screen, for a
// picture nobody asked for (the heat players reported). Game.frame asks
// `pace` on every rAF tick and skips the tick when it's early.
//
// A run is due once the clock reaches `next - tol`; `next` then moves on by
// exactly one cap interval, so over any stretch of time the game runs at
// most cap frames a second whatever the display's rate. The tolerance (30%
// of an interval) absorbs vsync jitter and lets a 144 Hz display alternate
// 2 and 3 ticks a frame (60 on average) without dropping to 48. A display
// that ticks at about the cap or slower (a 60 Hz panel at 60.4 Hz, or a
// machine that can't reach the cap) runs every tick: pacing it would only
// drop the odd frame. A late frame (a hitch, a slow GPU) never causes a
// burst of catch-up frames: `next` restarts from now.
//
// The sim sees the interval since the last run frame, as it always has: a
// capped 144 Hz display steps the sim exactly as a 60 Hz display does.

/** Cap choices (Settings → Frame rate). 0 = uncapped. */
export const FRAME_CAPS = ['30', '60', 'max'] as const;
export type FrameCapSetting = (typeof FRAME_CAPS)[number];

/** Window blurred (another app or window has focus): the game still shows, at this. */
export const BLURRED_FPS = 30;
/** A menu over the game (settings, map): what's left showing behind it, at this. */
export const COVERED_FPS = 30;

export function capFps(s: FrameCapSetting): number {
  return s === 'max' ? 0 : Number(s);
}

export interface FramePacer {
  /** Clock (ms) the next frame is due at. */
  next: number;
  /** Last tick's clock (ms). */
  last: number;
  /** Smoothed ms between ticks (0 = not known yet). */
  tick: number;
}

export function makePacer(): FramePacer {
  return { next: -Infinity, last: -Infinity, tick: 0 };
}

/** Ticks this close to the cap interval (or slower) run every time. */
export const NEAR_CAP = 0.9;

/** Share of an interval a tick may come early and still run. */
export const PACE_TOLERANCE = 0.3;

/**
 * One display tick at `now` (ms, the rAF timestamp) under a cap of `fps`
 * (0 = none). True: run a frame on this tick.
 */
export function pace(p: FramePacer, now: number, fps: number): boolean {
  const d = now - p.last;
  p.last = now;
  // A clock that went back (a new timeline): start the schedule over
  if (d < 0) p.next = -Infinity;
  // (a hidden tab's gap or a long hitch isn't the display's rate)
  if (d > 0 && d < 100) p.tick = p.tick === 0 ? d : p.tick + (d - p.tick) * 0.1;
  const iv = fps > 0 ? 1000 / fps : 0;
  if (iv === 0 || p.tick >= iv * NEAR_CAP) {
    p.next = now + iv;
    return true;
  }
  if (now < p.next - iv * PACE_TOLERANCE) return false;
  p.next += iv;
  // Late (or the first frame): restart the schedule from now, no catch-up burst
  if (p.next <= now) p.next = now + iv;
  return true;
}

/** The lowest of the caps that apply (0 = no cap). */
export function effectiveFps(...caps: number[]): number {
  let out = 0;
  for (const c of caps) if (c > 0 && (out === 0 || c < out)) out = c;
  return out;
}

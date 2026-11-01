// ── CAMP's opening shot as waking up from a trip: hard style cuts (pure, tested) ──
//
// The fly-in (intro.ts, INTRO_SECONDS) is graded by one full-screen pass
// (render/TripPass.ts) that cuts, Spider-Verse style, between looks that
// settle as you come to:
//
//   TRIP  0 → 1.55 s   kaleidoscope + melting warp, acid colour cycling,
//                      chromatic split, posterised, feedback trails
//   ANIME 1.55 → 3.15  flat cel bands, screentone, speed lines, print
//                      misregistration; the camera on twos (12 fps)
//   HAZE  3.15 → W     soft focus, bloom haze, VHS bleed, grain, weave
//   B&W   W → W+1.05   high contrast, grain, gate weave (W = the moment the
//                      camera crosses the window plane: the big cut)
//   none  after        the game's own look, well before the hand-off
//
// with a few 4-frame flicker cuts (a look from before or after flashing
// in) to sell it. Every change is a hard cut: no dissolves, so the pass
// only ever changes uniforms.
//
// Photosensitivity (WCAG 2.3.1): every cut counts as a flash transition and
// no 1 s window holds more than 3 of them (≤ 1.5 flashes a second; the rule
// allows 3). Reduced motion or the setting off: nothing at all.

export type IntroStyle = 'none' | 'trip' | 'anime' | 'haze' | 'bw';

/** The shader's `uStyle`. */
export const STYLE_CODE: Record<IntroStyle, number> = {
  none: 0,
  trip: 1,
  anime: 2,
  haze: 3,
  bw: 4,
};

export interface StyleCut {
  /** Seconds into the shot. */
  at: number;
  style: IntroStyle;
  /** A short flicker (a few frames) rather than a section. */
  flicker?: boolean;
}

export interface StyleFrame {
  style: IntroStyle;
  /** 0…1, how hard the look is pushed (sections ease off as you come to). */
  amt: number;
  flicker: boolean;
  /** Camera frame rate to step at (on twos), 0 = every frame. */
  step: number;
  /** When the current cut started (for stepping from it). */
  since: number;
}

/** A flicker lasts 4 frames at 60 fps (2 at 30: a capture never drops it). */
export const FLICKER = 4 / 60;
/** The window crossing when it isn't known (the spawns land 5.36–6.01 s). */
export const DEFAULT_CROSS = 5.6;
/** The grade is gone by here at the latest (the shot is 7.5 s). */
export const STYLES_END = 7.1;
/** On twos: 12 drawings a second through the anime section. */
const ANIME_STEP = 12;

/** The cuts for a shot whose camera crosses the window at `cross` seconds. */
export function styleCuts(cross = DEFAULT_CROSS): StyleCut[] {
  // Keep the window cut inside the haze → B&W slot, whatever the spawn
  const W = Math.min(STYLES_END - 1.05, Math.max(4.6, cross));
  const end = W + 1.05;
  // (a b&w flash-forward in the haze, when there's room for it)
  const ahead: StyleCut[] =
    W - 1.05 >= 4.3
      ? [
          { at: 4.3, style: 'bw', flicker: true },
          { at: 4.3 + FLICKER, style: 'haze' },
        ]
      : [];
  return [
    { at: 0, style: 'trip' },
    { at: 1.05, style: 'anime', flicker: true },
    { at: 1.05 + FLICKER, style: 'trip' },
    { at: 1.55, style: 'anime' },
    { at: 2.6, style: 'haze', flicker: true },
    { at: 2.6 + FLICKER, style: 'anime' },
    { at: 3.15, style: 'haze' },
    ...ahead,
    { at: W, style: 'bw' },
    // one last echo of the trip, then you're awake
    { at: W + 0.45, style: 'trip', flicker: true },
    { at: W + 0.45 + FLICKER, style: 'bw' },
    { at: end, style: 'none' },
  ];
}

const NONE: StyleFrame = { style: 'none', amt: 0, flicker: false, step: 0, since: 0 };

/**
 * The look at `t` seconds into the opening shot. `off` (reduced motion, the
 * setting off, post-processing unavailable) is always 'none'.
 */
export function styleAt(
  t: number,
  opts: { cross?: number; off?: boolean; cuts?: StyleCut[] } = {},
): StyleFrame {
  if (opts.off === true || !(t >= 0)) return NONE;
  const cuts = opts.cuts ?? styleCuts(opts.cross);
  let i = 0;
  while (i + 1 < cuts.length && cuts[i + 1]!.at <= t) i++;
  const c = cuts[i]!;
  if (c.style === 'none') return { ...NONE, since: c.at };
  // How hard each section pushes, easing off inside it as you come to
  const sec = section(cuts, c.style, t);
  const u = sec.len > 0 ? Math.min(1, Math.max(0, (t - sec.at) / sec.len)) : 0;
  const amt =
    c.flicker === true
      ? 1
      : c.style === 'trip'
        ? 1 - 0.3 * u
        : c.style === 'haze'
          ? 1 - 0.35 * u
          : c.style === 'bw'
            ? 1 - 0.4 * u
            : 1;
  return {
    style: c.style,
    amt,
    flicker: c.flicker === true,
    step: c.style === 'anime' && c.flicker !== true ? ANIME_STEP : 0,
    since: c.at,
  };
}

/** The section (not flicker) of `style` that `t` falls in: its start and length. */
function section(cuts: StyleCut[], style: IntroStyle, t: number): { at: number; len: number } {
  let at = 0;
  let found = false;
  for (const c of cuts) {
    if (c.at > t) break;
    if (c.style === style && c.flicker !== true && !found) {
      at = c.at;
      found = true;
    } else if (c.style !== style && c.flicker !== true) found = false;
  }
  // The section runs until the next non-flicker cut to another style
  let end = at;
  for (const c of cuts)
    if (c.at > at && c.flicker !== true && c.style !== style) {
      end = c.at;
      break;
    }
  return { at, len: end - at };
}

/** The shot time to sample the camera at: held on twos while `f.step` says. */
export function steppedTime(t: number, f: StyleFrame): number {
  if (f.step <= 0) return t;
  return f.since + Math.floor((t - f.since) * f.step) / f.step;
}

/** Most hard changes in any `win`-second window (each cut and each flicker's return). */
export function maxCutsPerWindow(cuts: StyleCut[], win = 1): number {
  const at = cuts.slice(1).map(c => c.at);
  let most = 0;
  for (let i = 0; i < at.length; i++) {
    let n = 0;
    for (let j = i; j < at.length && at[j]! < at[i]! + win; j++) n++;
    most = Math.max(most, n);
  }
  return most;
}

/** When the camera first crosses the window plane (z = faceZ), or DEFAULT_CROSS. */
export function windowCrossAt(
  posAt: (sec: number) => readonly [number, number, number],
  faceZ: number,
  seconds: number,
): number {
  let prev = posAt(0)[2];
  for (let s = 0.02; s <= seconds; s += 0.02) {
    const z = posAt(s)[2];
    if (prev < faceZ && z >= faceZ) return s;
    prev = z;
  }
  return DEFAULT_CROSS;
}

// ── The Grand Exchange under the Noggles Fountain (pure) ─────────────────
//
// The plaza's fountain (landmark "Noggles Fountain" at the origin: a noggles
// statue r ≈ 4.5 m, a water basin out to the rim at r ≈ 7 m) hides the way
// down. Nothing on screen says so:
//   • a loose tile on the rim's outer face (toward the Fountain spawn) with
//     a tiny red noggle: press E beside it, or knock on it three times
//     (tap / click), and it opens;
//   • the code N-O-U-N-S typed anywhere near the fountain;
//   • once found (remembered per browser), a small "↓ EXCHANGE" sign.
// Opening plays the descent: the basin's water drains open in a sweep, the
// camera dives through, then the hall takes over. Coming back up reverses
// it and eases into the gameplay camera.

export const FOUNTAIN = { x: 0, y: 0, z: 0 } as const;
/** The basin ring the water drains from (between the statue and the rim). */
export const BASIN = { inner: 4.7, outer: 6.85, y: 0.06 } as const;
/** The loose tile: outer face of the rim, on the side facing the spawn. */
export const TILE = { x: 0, y: 0.24, z: 7.36, yaw: 0 } as const;
/** Where the camera drops through (the basin, in front of the statue). */
export const HOLE = { x: 0, y: 0, z: 5.8 } as const;

/** Press E within this of the tile. */
export const PRESS_DIST = 1.9;
/** The code works within this of the fountain. */
export const CODE_DIST = 30;
export const CODE = 'NOUNS';
/** Knocks on the tile that open it, and the window they must land in. */
export const KNOCKS = 3;
export const KNOCK_MS = 2000;

export const FOUND_KEY = 'noun-world-exchange-found';

const dist2 = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);
export const tileDist = (x: number, z: number) => dist2(x, z, TILE);
export const fountainDist = (x: number, z: number) => dist2(x, z, FOUNTAIN);

/** The faint sparkle at the tile: 0 beyond 3.5 m, full by 1 m. */
export function sparkle(d: number): number {
  if (d >= 3.5) return 0;
  if (d <= 1) return 1;
  return (3.5 - d) / 2.5;
}

/** Typed keys → true when the code completes (letters only, within a time window). */
export class CodeMatcher {
  private buf = '';
  private at = -Infinity;
  constructor(
    private readonly code = CODE,
    private readonly windowMs = 4000,
  ) {}

  push(key: string, now: number): boolean {
    if (key.length !== 1 || !/[a-z]/i.test(key)) return false;
    if (now - this.at > this.windowMs) this.buf = '';
    this.at = now;
    this.buf = (this.buf + key.toUpperCase()).slice(-this.code.length);
    if (this.buf === this.code) {
      this.buf = '';
      return true;
    }
    return false;
  }
}

/** Knocks on the tile → true on the KNOCKS-th inside KNOCK_MS. */
export class Knock {
  private times: number[] = [];
  constructor(
    private readonly n = KNOCKS,
    private readonly windowMs = KNOCK_MS,
  ) {}
  tap(now: number): boolean {
    this.times = [...this.times.filter(t => now - t < this.windowMs), now];
    if (this.times.length >= this.n) {
      this.times = [];
      return true;
    }
    return false;
  }
  get count() {
    return this.times.length;
  }
}

// ── Camera paths ──

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Pose {
  pos: V3;
  look: V3;
}

export const DESCENT_S = 2.8;
export const ASCENT_S = 1.8;
/** The screen goes dark over the last part of the descent / first of the ascent. */
export const DARK_FROM = 2.15;

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp3 = (a: V3, b: V3, k: number): V3 => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  z: a.z + (b.z - a.z) * k,
});
const lerpPose = (a: Pose, b: Pose, k: number): Pose => ({
  pos: lerp3(a.pos, b.pos, k),
  look: lerp3(a.look, b.look, k),
});
const add = (a: V3, x: number, y: number, z: number): V3 => ({
  x: a.x + x,
  y: a.y + y,
  z: a.z + z,
});

/** Key poses of the dive: over the rim, hovering at the opening, down through it. */
export function divePoses(): Pose[] {
  return [
    { pos: add(HOLE, 0, 7, 9), look: HOLE },
    { pos: add(HOLE, 0, 2.6, 1.2), look: add(HOLE, 0, -1, 0) },
    { pos: add(HOLE, 0, -7, 0.1), look: add(HOLE, 0, -14, 0) },
  ];
}

/** How far the water has drained open (0 … 1) at descent time t. */
export function drainAt(t: number): number {
  return ease((t - 0.5) / 1.1);
}

/** Camera pose during the descent, from wherever the gameplay camera was. */
export function descentPose(t: number, start: Pose): Pose {
  const [a, b, c] = divePoses() as [Pose, Pose, Pose];
  if (t <= 0.9) return lerpPose(start, a, ease(t / 0.9));
  if (t <= 1.7) return lerpPose(a, b, ease((t - 0.9) / 0.8));
  // Accelerate down through the opening
  const k = Math.min(1, (t - 1.7) / (DESCENT_S - 1.7));
  return lerpPose(b, c, k * k);
}

/** Camera pose coming back up: out of the opening and into the live gameplay camera. */
export function ascentPose(t: number, live: Pose): Pose {
  const [, b, c] = divePoses() as [Pose, Pose, Pose];
  const up: Pose = { pos: c.pos, look: add(HOLE, 0, 6, 0.01) };
  const out: Pose = { pos: b.pos, look: add(HOLE, 0, 3, -3) };
  if (t <= 0.7) return lerpPose(up, out, ease(t / 0.7));
  return lerpPose(out, live, ease((t - 0.7) / (ASCENT_S - 0.7)));
}

/** Screen darkness (0 … 1) during the descent / ascent. */
export function darkness(phase: 'down' | 'up', t: number): number {
  if (phase === 'down') return ease((t - DARK_FROM) / (DESCENT_S - DARK_FROM));
  return 1 - ease(t / 0.6);
}

// ── Cutscene scripts: data, easing, and what the screen shows at time t ───
//
// Pure (no three.js, no DOM): CutscenePlayer.ts applies a frame from here to
// the camera, the overlay and the characters.
//
// A script is a list of timed steps. Camera steps (`shot`, `orbit`) are
// written in the scene's anchor frame: x across, y up, z along the anchor's
// facing, so the same scene works wherever its character stands. The first
// shot can start from 'start' (wherever the gameplay camera was when the scene
// began) and a `blendOut` step eases from the last shot back into the live
// gameplay camera, so a scene never hard-cuts in or out of play.

export type Vec3 = readonly [number, number, number];

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'whip';

export interface CamPose {
  pos: Vec3;
  look: Vec3;
  /** Vertical FOV (degrees). */
  fov: number;
}

export type Step =
  /** Move the camera from one pose to another (a dolly / push-in / crane / pan). */
  | { k: 'shot'; at: number; dur: number; from: CamPose | 'start'; to: CamPose; ease?: Ease }
  /** Orbit round a point (angles in radians, 0 = on the anchor's +z). */
  | {
      k: 'orbit';
      at: number;
      dur: number;
      centre: Vec3;
      radius: number;
      height: number;
      from: number;
      to: number;
      fov: number;
      ease?: Ease;
    }
  /** Handheld shake (metres of wobble) for a stretch. */
  | { k: 'shake'; at: number; dur: number; amp: number }
  /** Ease back into the gameplay camera. */
  | { k: 'blendOut'; at: number; dur: number; ease?: Ease }
  /** Letterbox bars in or out. */
  | { k: 'bars'; at: number; on: boolean; dur?: number }
  /** A spoken subtitle (voice is a voice key: an NPC id, or 'rider'). */
  | {
      k: 'say';
      at: number;
      dur: number;
      speaker: string;
      text: string;
      voice: string;
      lineId?: string;
    }
  /** Big centred text. */
  | { k: 'title'; at: number; dur: number; text: string; sub?: string }
  /** Time scale for the world (1 normal, 0 frozen), eased over `dur`. */
  | { k: 'time'; at: number; scale: number; dur?: number }
  /** Screen colour wash from one opacity to another. */
  | { k: 'fade'; at: number; dur: number; color: string; from: number; to: number }
  /** A flash: full at `at`, gone after `dur`. */
  | { k: 'flash'; at: number; dur: number; color: string; peak?: number }
  /** Direct a character: look at the rider, wave, play a clip, or go back to normal. */
  | { k: 'act'; at: number; who: string; do: 'look' | 'wave' | 'clip' | 'release'; clip?: string }
  | { k: 'sfx'; at: number; id: string; gain?: number; rate?: number }
  | { k: 'music'; at: number; cue: string; dur: number }
  /**
   * A hook into the game (enter the Upside Down, light the crystal ball).
   * `must` cues still run when the scene is skipped.
   */
  | { k: 'cue'; at: number; name: string; must?: boolean; dur?: number };

export interface Script {
  id: string;
  title: string;
  steps: Step[];
}

/** Instant steps: they fire once when the clock passes them. */
export type Instant = Extract<Step, { k: 'say' | 'act' | 'sfx' | 'music' | 'cue' }>;
const INSTANT = new Set(['say', 'act', 'sfx', 'music', 'cue']);
const isInstant = (s: Step): s is Instant => INSTANT.has(s.k);

// ── Easing ──

export function ease(e: Ease | undefined, x: number): number {
  const k = Math.min(1, Math.max(0, x));
  switch (e ?? 'inOut') {
    case 'linear':
      return k;
    case 'in':
      return k * k * k;
    case 'out':
      return 1 - (1 - k) ** 3;
    case 'inOut':
      // smootherstep
      return k * k * k * (k * (k * 6 - 15) + 10);
    case 'whip': {
      // Most of the move in the middle third: a whip-pan
      const s = k * k * k * (k * (k * 6 - 15) + 10);
      return s * s * (3 - 2 * s);
    }
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

export function lerpPose(a: CamPose, b: CamPose, k: number): CamPose {
  return {
    pos: lerp3(a.pos, b.pos, k),
    look: lerp3(a.look, b.look, k),
    fov: lerp(a.fov, b.fov, k),
  };
}

// ── Anchor frame ──

export interface Anchor {
  x: number;
  y: number;
  z: number;
  /** Facing (radians; 0 looks along world +Z, as three.js rotates about Y). */
  yaw: number;
}

/** Anchor-local → world. */
export function toWorld(a: Anchor, p: Vec3): Vec3 {
  const c = Math.cos(a.yaw);
  const s = Math.sin(a.yaw);
  return [a.x + p[0] * c + p[2] * s, a.y + p[1], a.z - p[0] * s + p[2] * c];
}

/** World → anchor-local. */
export function toLocal(a: Anchor, p: Vec3): Vec3 {
  const c = Math.cos(a.yaw);
  const s = Math.sin(a.yaw);
  const dx = p[0] - a.x;
  const dz = p[2] - a.z;
  return [dx * c - dz * s, p[1] - a.y, dx * s + dz * c];
}

// ── Evaluation ──

export function duration(s: Script): number {
  let end = 0;
  for (const st of s.steps)
    end = Math.max(end, st.at + ('dur' in st && st.dur !== undefined ? st.dur : 0));
  return end;
}

const camSteps = (s: Script) =>
  s.steps.filter(
    (x): x is Extract<Step, { k: 'shot' | 'orbit' }> => x.k === 'shot' || x.k === 'orbit',
  );

function orbitPose(o: Extract<Step, { k: 'orbit' }>, k: number): CamPose {
  const a = lerp(o.from, o.to, ease(o.ease ?? 'linear', k));
  return {
    pos: [
      o.centre[0] + Math.sin(a) * o.radius,
      o.centre[1] + o.height,
      o.centre[2] + Math.cos(a) * o.radius,
    ],
    look: o.centre,
    fov: o.fov,
  };
}

/** The scripted camera at t (anchor frame), ignoring the blend back to play. */
export function cameraAt(s: Script, t: number, start: CamPose): CamPose {
  let cur: Extract<Step, { k: 'shot' | 'orbit' }> | null = null;
  for (const c of camSteps(s)) if (c.at <= t && (cur === null || c.at >= cur.at)) cur = c;
  if (cur === null) return start;
  const k = cur.dur > 0 ? (t - cur.at) / cur.dur : 1;
  if (cur.k === 'orbit') return orbitPose(cur, Math.min(1, k));
  const from = cur.from === 'start' ? start : cur.from;
  return lerpPose(from, cur.to, ease(cur.ease, k));
}

/** Deterministic handheld wobble (three gentle sines per axis). */
export function shakeOffset(t: number, amp: number): Vec3 {
  if (amp <= 0) return [0, 0, 0];
  const w = (a: number, b: number, c: number) =>
    amp * (0.55 * Math.sin(t * a) + 0.3 * Math.sin(t * b + 1.3) + 0.15 * Math.sin(t * c + 2.1));
  return [w(1.9, 3.7, 7.3), w(2.3, 4.1, 6.7) * 0.7, w(1.7, 3.3, 8.1) * 0.5];
}

function shakeAt(s: Script, t: number): number {
  let a = 0;
  for (const st of s.steps) {
    if (st.k !== 'shake' || t < st.at || t > st.at + st.dur) continue;
    // Ease in and out over a quarter second
    const e = Math.min(1, (t - st.at) / 0.25, (st.at + st.dur - t) / 0.25);
    a = Math.max(a, st.amp * e);
  }
  return a;
}

/** Letterbox amount (0 none .. 1 full bars). */
export function barsAt(s: Script, t: number): number {
  let v = 0;
  const bars = s.steps
    .filter((x): x is Extract<Step, { k: 'bars' }> => x.k === 'bars')
    .sort((a, b) => a.at - b.at);
  for (const b of bars) {
    if (t < b.at) break;
    const dur = b.dur ?? 0.5;
    const target = b.on ? 1 : 0;
    const k = dur > 0 ? Math.min(1, (t - b.at) / dur) : 1;
    v = lerp(v, target, ease('inOut', k));
  }
  return v;
}

/** World time scale at t. */
export function timeScaleAt(s: Script, t: number): number {
  let v = 1;
  const ts = s.steps
    .filter((x): x is Extract<Step, { k: 'time' }> => x.k === 'time')
    .sort((a, b) => a.at - b.at);
  for (const st of ts) {
    if (t < st.at) break;
    const k = st.dur !== undefined && st.dur > 0 ? Math.min(1, (t - st.at) / st.dur) : 1;
    v = lerp(v, st.scale, ease('inOut', k));
  }
  return Math.max(0, v);
}

/** Colour wash over the screen (the strongest of the fades and flashes at t). */
export function washAt(s: Script, t: number, flashScale = 1): { color: string; a: number } | null {
  let best: { color: string; a: number } | null = null;
  const take = (color: string, a: number) => {
    if (a > 0.001 && (best === null || a > best.a)) best = { color, a };
  };
  // Fades hold their end value after they finish (until another fade)
  let fade: { color: string; a: number } | null = null;
  for (const st of s.steps) {
    if (st.k !== 'fade' || t < st.at) continue;
    const k = st.dur > 0 ? Math.min(1, (t - st.at) / st.dur) : 1;
    fade = { color: st.color, a: lerp(st.from, st.to, ease('inOut', k)) };
  }
  if (fade !== null) take(fade.color, fade.a);
  for (const st of s.steps) {
    if (st.k !== 'flash' || t < st.at || t > st.at + st.dur) continue;
    const k = (t - st.at) / st.dur;
    take(st.color, (st.peak ?? 1) * flashScale * (1 - ease('out', k)));
  }
  return best;
}

export interface Subtitle {
  speaker: string;
  text: string;
  /** Characters showing. */
  shown: number;
  /** 0..1 fade (in at the start, out at the end). */
  alpha: number;
  step: Extract<Step, { k: 'say' }>;
}

/** Characters showing `elapsed` seconds into a line (the typewriter). */
export type Reveal = (step: Extract<Step, { k: 'say' }>, elapsed: number) => number;

/** A plain typewriter (30 characters a second) when no voice timing is given. */
export const plainReveal: Reveal = (st, e) =>
  Math.max(0, Math.min([...st.text].length, Math.floor(e * 30)));

export function subtitleAt(s: Script, t: number, reveal: Reveal = plainReveal): Subtitle | null {
  let cur: Extract<Step, { k: 'say' }> | null = null;
  for (const st of s.steps)
    if (st.k === 'say' && t >= st.at && t < st.at + st.dur && (cur === null || st.at >= cur.at))
      cur = st;
  if (cur === null) return null;
  const e = t - cur.at;
  const alpha = Math.min(1, e / 0.15, (cur.at + cur.dur - t) / 0.25);
  return { speaker: cur.speaker, text: cur.text, shown: reveal(cur, e), alpha, step: cur };
}

export function titleAt(
  s: Script,
  t: number,
): { text: string; sub?: string; alpha: number } | null {
  for (const st of s.steps) {
    if (st.k !== 'title' || t < st.at || t >= st.at + st.dur) continue;
    const alpha = Math.min(1, (t - st.at) / 0.2, (st.at + st.dur - t) / 0.3);
    return { text: st.text, sub: st.sub, alpha };
  }
  return null;
}

/** Instant steps whose time falls in (t0, t1] (t0 < 0 includes steps at 0). */
export function crossed(s: Script, t0: number, t1: number): Instant[] {
  return s.steps.filter((st): st is Instant => isInstant(st) && st.at > t0 && st.at <= t1);
}

/** The game hooks that must still run when a scene is skipped at t. */
export function skipCues(s: Script, t: number): Extract<Step, { k: 'cue' }>[] {
  return s.steps.filter(
    (st): st is Extract<Step, { k: 'cue' }> => st.k === 'cue' && st.must === true && st.at > t,
  );
}

/** When the blend back to gameplay starts (the script's end if it has none). */
export function blendOutOf(s: Script): Extract<Step, { k: 'blendOut' }> {
  const b = s.steps.find((x): x is Extract<Step, { k: 'blendOut' }> => x.k === 'blendOut');
  return b ?? { k: 'blendOut', at: duration(s), dur: 0 };
}

export interface Frame {
  /** Scripted camera (anchor frame), with handheld wobble added. */
  cam: CamPose;
  /** 0..1 of the way back to the live gameplay camera. */
  blend: number;
  bars: number;
  timeScale: number;
  wash: { color: string; a: number } | null;
  sub: Subtitle | null;
  title: { text: string; sub?: string; alpha: number } | null;
  /** The scene is over (the player hands back). */
  done: boolean;
}

export interface EvalOpts {
  reveal?: Reveal;
  /** 0 = reduce motion: no handheld wobble, gentler flashes. */
  motion?: number;
}

/** Everything the screen shows at scene time t. */
export function evalAt(s: Script, t: number, start: CamPose, o: EvalOpts = {}): Frame {
  const motion = o.motion ?? 1;
  const bo = blendOutOf(s);
  // The camera holds its blend-out starting pose while easing back to play
  const camT = Math.min(t, bo.at);
  let cam = cameraAt(s, camT, start);
  const amp = shakeAt(s, t) * motion;
  if (amp > 0) {
    const d = shakeOffset(t, amp);
    const [px, py, pz] = cam.pos;
    const [lx, ly, lz] = cam.look;
    cam = {
      ...cam,
      pos: [px + d[0], py + d[1], pz + d[2]],
      look: [lx + d[0] * 0.5, ly + d[1] * 0.5, lz + d[2] * 0.5],
    };
  }
  const blend = t < bo.at ? 0 : bo.dur > 0 ? ease(bo.ease ?? 'inOut', (t - bo.at) / bo.dur) : 1;
  const end = duration(s);
  return {
    cam,
    blend,
    bars: barsAt(s, t),
    timeScale: timeScaleAt(s, t),
    wash: washAt(s, t, motion > 0 ? 1 : 0.35),
    sub: subtitleAt(s, t, o.reveal),
    title: titleAt(s, t),
    done: t >= end,
  };
}

/** A script is well formed: steps in time, durations sane, one blend-out at the end. */
export function validate(s: Script): string[] {
  const errs: string[] = [];
  const end = duration(s);
  for (const st of s.steps) {
    if (!Number.isFinite(st.at) || st.at < 0) errs.push(`${st.k} at ${st.at}`);
    if ('dur' in st && st.dur !== undefined && !(st.dur >= 0)) errs.push(`${st.k} dur ${st.dur}`);
  }
  const bos = s.steps.filter(x => x.k === 'blendOut');
  if (bos.length !== 1) errs.push(`${bos.length} blendOut steps`);
  else if (Math.abs(bos[0]!.at + (bos[0] as { dur: number }).dur - end) > 1e-6)
    errs.push('blendOut must end the scene');
  return errs;
}

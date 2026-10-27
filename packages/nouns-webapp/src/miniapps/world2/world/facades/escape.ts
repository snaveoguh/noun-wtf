// ── Fire escapes: a walkable zig-zag up the street wall (pure, tested) ──
//
// Laid out in the wall's own frame: `u` runs along the wall from end A to
// end B, `d` is the distance out from the wall face, `y` is height. Two
// lanes, both a metre wide:
//
//   inner lane (d 0.05–1.05): a full-length platform at every floor;
//   outer lane (d 1.05–2.1):  a stair flight per floor rising from A to B,
//                             and a landing pad at B at every floor.
//
// Every flight rises in the same direction, so each one runs exactly one
// storey above the last (full headroom). The way up is a zig-zag: up a
// flight (A → B) onto the pad, step in onto the floor's platform, walk it
// back to A, step out onto the next flight. The last flight climbs a bit
// higher than a storey, to just over the parapet; a deck and a ramp carry
// you across the parapet and down onto the roof.
//
// You get on from the street by a drop ladder hanging off the first pad:
// a climbable panel (the game's climb finds a wall at chest and head
// height, and mantles you onto the pad over its top).
//
// Flights collide as smooth ramps (the foot controller walks any slope with
// a normal steeper than 0.55 up; skating rides them too) and draw as
// stairs. Platforms, pads and rails collide as thin boxes.

export interface EscapeBox {
  kind: 'box';
  role: 'platform' | 'pad' | 'deck' | 'rail' | 'ladder' | 'post';
  u0: number;
  u1: number;
  d0: number;
  d1: number;
  y0: number;
  y1: number;
  /** Part of the collision (the visual-only bits are false). */
  solid: boolean;
}

/** A sloped slab: its top runs from y0 (at the axis start) to y1 (at its end). */
export interface EscapeRamp {
  kind: 'ramp';
  role: 'flight' | 'bridge' | 'rail';
  /** 'u': rises along the wall; 'd': rises along d (toward the wall when d0 > d1). */
  axis: 'u' | 'd';
  u0: number;
  u1: number;
  d0: number;
  d1: number;
  /** Top surface height at the start (u0 or d0) and at the end (u1 or d1). */
  y0: number;
  y1: number;
  /** Slab thickness under the top surface. */
  thick: number;
  /** Visual stair steps (0 = a plain ramp). */
  steps: number;
  solid: boolean;
}

export type EscapePart = EscapeBox | EscapeRamp;

export interface EscapeSpec {
  /** Length along the wall (m). */
  length: number;
  /** Roof floor height (the collision roof). */
  roof: number;
  /** Parapet top (roof + parapet height). */
  parapet: number;
  /** Parapet thickness, measured from the wall face inward. */
  parapetDepth?: number;
  /** First floor's platform height (just above the shopfronts' awnings). */
  first?: number;
  storey?: number;
}

export interface EscapePlan {
  parts: EscapePart[];
  /** Platform heights, bottom to top (the last is the top deck). */
  levels: number[];
  /** Top deck height (over the parapet). */
  top: number;
  length: number;
  /** Depth of the outer edge. */
  depth: number;
  /** The ladder's span along u (it hangs off the outer edge, d = depth). */
  ladder: { u0: number; u1: number; top: number };
}

export const LANE = 1.05;
export const DEPTH = 2.1;
/** Landing pad length at end B. */
export const PAD = 1.25;
const PLATE = 0.1;
const RAIL_H = 1.0;
const RAIL_T = 0.05;
/** Visual step rise (each flight is drawn with ≈ this rise per step). */
export const STEP_RISE = 0.2;
/** Lowest a ramp's surface normal may point (cos of the steepest slope we build). */
export const MIN_NORMAL_Y = 0.72;
/** The foot controller stands on anything with normal.y above this. */
export const WALKABLE_NORMAL_Y = 0.55;

/** Normal.y of a slope rising `rise` over `run`. */
export function slopeNormalY(rise: number, run: number): number {
  return run / Math.hypot(rise, run);
}

/**
 * The shortest escape that keeps every flight walkable: the last flight
 * climbs a storey plus the parapet, over the length minus the pad.
 */
export function minEscapeLength(spec: Pick<EscapeSpec, 'storey'> = {}): number {
  const storey = spec.storey ?? 3.4;
  const rise = storey + 1.25;
  // run such that run / hypot(rise, run) ≥ MIN_NORMAL_Y
  const k = MIN_NORMAL_Y / Math.sqrt(1 - MIN_NORMAL_Y * MIN_NORMAL_Y);
  return Math.ceil((rise * k + PAD) * 10) / 10;
}

/** Plan an escape (wall frame). Null when the building is too low for one. */
export function planEscape(spec: EscapeSpec): EscapePlan | null {
  const storey = spec.storey ?? 3.4;
  // 3 cm over the GLB's string courses (their tops are at 3.6, 7.0, …),
  // so a platform's top never lies in the same plane as one
  const first = spec.first ?? storey + 0.23;
  const L = spec.length;
  const top = spec.parapet + 0.2;
  if (spec.roof < first + 1 || L < minEscapeLength({ storey })) return null;
  const pd = spec.parapetDepth ?? 0.3;
  const levels: number[] = [];
  // Floors whose next climb (a storey, or the last one to the top) stays walkable
  for (let y = first; y <= top - storey + 0.2 - 1e-6 || levels.length === 0; y += storey) {
    levels.push(y);
    if (levels.length > 40) break;
  }
  const parts: EscapePart[] = [];
  const box = (
    role: EscapeBox['role'],
    u0: number,
    u1: number,
    d0: number,
    d1: number,
    y0: number,
    y1: number,
    solid = true,
  ) => parts.push({ kind: 'box', role, u0, u1, d0, d1, y0, y1, solid });
  const run = L - PAD;
  const ladder = { u0: run + 0.18, u1: L - 0.18, top: levels[0]! };

  levels.forEach((y, k) => {
    const next = k + 1 < levels.length ? levels[k + 1]! : top;
    // Inner platform, full length
    box('platform', 0, L, 0.05, LANE, y - PLATE, y);
    // Pad at B (outer lane)
    box('pad', run, L, LANE, DEPTH, y - PLATE, y);
    // Flight A → B up to the next level
    const rise = next - y;
    parts.push({
      kind: 'ramp',
      role: 'flight',
      axis: 'u',
      u0: 0,
      u1: run,
      d0: LANE + 0.02,
      d1: DEPTH - 0.02,
      y0: y,
      y1: next,
      thick: 0.14,
      steps: Math.max(2, Math.round(rise / STEP_RISE)),
      solid: true,
    });
    // Rails: the flight's outer edge (sloped), the pad's outer edge (a gap
    // over the ladder on the first floor), both ends
    parts.push({
      kind: 'ramp',
      role: 'rail',
      axis: 'u',
      u0: 0,
      u1: run,
      d0: DEPTH - RAIL_T,
      d1: DEPTH,
      y0: y + RAIL_H,
      y1: next + RAIL_H,
      thick: RAIL_H,
      steps: 0,
      solid: true,
    });
    if (k === 0) {
      box('rail', run, ladder.u0, DEPTH - RAIL_T, DEPTH, y, y + RAIL_H);
      box('rail', ladder.u1, L, DEPTH - RAIL_T, DEPTH, y, y + RAIL_H);
    } else box('rail', run, L, DEPTH - RAIL_T, DEPTH, y, y + RAIL_H);
    box('rail', L - RAIL_T, L, 0.05, DEPTH, y, y + RAIL_H);
    box('rail', 0, RAIL_T, 0.05, DEPTH, y, y + RAIL_H);
    // Corner posts (visual)
    for (const u of [0, run, L - RAIL_T])
      box('post', u, u + RAIL_T, DEPTH - RAIL_T, DEPTH, y - PLATE, y + RAIL_H, false);
  });

  // Top: pad + deck at B over the parapet, then a ramp down onto the roof
  box('pad', run, L, LANE, DEPTH, top - PLATE, top);
  box('deck', run, L, -(pd + 0.25), LANE, top - PLATE, top);
  parts.push({
    kind: 'ramp',
    role: 'bridge',
    axis: 'd',
    u0: run,
    u1: L,
    d0: -(pd + 0.25),
    d1: -(pd + 0.25) - Math.max(1.6, (top - spec.roof) / 0.6),
    y0: top,
    y1: spec.roof,
    thick: 0.14,
    steps: Math.max(2, Math.round((top - spec.roof) / STEP_RISE)),
    solid: true,
  });
  box('rail', L - RAIL_T, L, 0.05, DEPTH, top, top + RAIL_H);
  box('rail', run, L, DEPTH - RAIL_T, DEPTH, top, top + RAIL_H);

  // Drop ladder: a climbable panel from just off the ground to the first pad
  box('ladder', ladder.u0, ladder.u1, DEPTH, DEPTH + 0.06, 0.15, levels[0]!);

  return { parts, levels, top, length: L, depth: DEPTH, ladder };
}

/** Everything a walker needs, checked (tests + a runtime guard). */
export function checkEscape(plan: EscapePlan, spec: EscapeSpec): string[] {
  const errs: string[] = [];
  const storey = spec.storey ?? 3.4;
  for (const p of plan.parts) {
    if (p.kind !== 'ramp' || p.role === 'rail') continue;
    const run = p.axis === 'u' ? Math.abs(p.u1 - p.u0) : Math.abs(p.d1 - p.d0);
    const rise = Math.abs(p.y1 - p.y0);
    const ny = slopeNormalY(rise, run);
    if (ny < MIN_NORMAL_Y) errs.push(`${p.role} too steep (normal.y ${ny.toFixed(2)})`);
    if (p.steps > 0 && rise / p.steps > 0.26) errs.push(`${p.role} steps too tall`);
  }
  const flights = plan.parts.filter(
    (p): p is EscapeRamp => p.kind === 'ramp' && p.role === 'flight',
  );
  // Each flight starts on a level and ends on the next (or the top)
  flights.forEach((f, k) => {
    if (Math.abs(f.y0 - plan.levels[k]!) > 1e-6) errs.push(`flight ${k} starts off its level`);
    const next = k + 1 < plan.levels.length ? plan.levels[k + 1]! : plan.top;
    if (Math.abs(f.y1 - next) > 1e-6) errs.push(`flight ${k} misses the next level`);
  });
  if (flights.length !== plan.levels.length) errs.push('a level has no flight');
  // Headroom: stacked flights / platforms are a storey apart
  for (let k = 1; k < plan.levels.length; k++)
    if (plan.levels[k]! - plan.levels[k - 1]! < storey - 1e-6) errs.push('levels too close');
  if (plan.top < spec.parapet + 0.05) errs.push('top deck under the parapet');
  const bridge = plan.parts.find(p => p.kind === 'ramp' && p.role === 'bridge');
  if (bridge === undefined || Math.abs(bridge.y1 - spec.roof) > 1e-6)
    errs.push('no way down onto the roof');
  if (Math.abs(plan.ladder.top - plan.levels[0]!) > 1e-6) errs.push('ladder misses the first pad');
  return errs;
}

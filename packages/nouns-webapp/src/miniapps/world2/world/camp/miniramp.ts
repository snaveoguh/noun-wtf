// ── CAMP's mini ramp: two quarter pipes and a flat (pure, tested) ────────
//
// Built along its own x (centred on 0), `width` across z. Each end is a
// quarter-circle transition of radius `r` cut off at `height` (a mini:
// the lip stands short of vertical), then a deck. The profile is what
// both the drawing and the collision use.

export interface MiniRampSpec {
  /** Overall length along x (deck to deck). */
  length: number;
  width: number;
  height: number;
  /** Transition radius (> height). */
  r: number;
  deck: number;
}

export const CAMP_RAMP: MiniRampSpec = { length: 8.4, width: 2.2, height: 1.0, r: 1.5, deck: 0.55 };

/** Horizontal run of one transition. */
export function transitionRun(s: MiniRampSpec): number {
  return Math.sqrt(s.r * s.r - (s.r - s.height) ** 2);
}

/** Surface height at x (0 on the flat, `height` on the decks; 0 past the ends). */
export function rampHeight(s: MiniRampSpec, x: number): number {
  const half = s.length / 2;
  const ax = Math.abs(x);
  if (ax > half) return 0;
  const run = transitionRun(s);
  const lipX = half - s.deck;
  if (ax >= lipX) return s.height;
  const t0 = lipX - run;
  if (ax <= t0) return 0;
  // Circle centred (t0, r): y = r − sqrt(r² − (ax − t0)²)
  const u = ax - t0;
  return s.r - Math.sqrt(Math.max(0, s.r * s.r - u * u));
}

/**
 * The profile as points along +x from the centre to the far end of the
 * deck (mirror for the other half): flat, `segs` steps up the transition,
 * the lip, the deck.
 */
export function rampProfile(s: MiniRampSpec, segs = 10): [number, number][] {
  const half = s.length / 2;
  const run = transitionRun(s);
  const lipX = half - s.deck;
  const t0 = lipX - run;
  const pts: [number, number][] = [
    [0, 0],
    [t0, 0],
  ];
  for (let i = 1; i <= segs; i++) {
    const x = t0 + (run * i) / segs;
    pts.push([x, rampHeight(s, x)]);
  }
  pts.push([half, s.height]);
  return pts;
}

/** The ramp's top surface as triangles (centred; both halves); `withEnds` adds the sides + backs for collision. */
export function rampSurface(s: MiniRampSpec, withEnds = true): number[] {
  const prof = rampProfile(s, 12);
  const pts = [
    ...prof
      .slice(1)
      .reverse()
      .map(([x, y]) => [-x, y] as [number, number]),
    ...prof,
  ];
  const z0 = -s.width / 2;
  const z1 = s.width / 2;
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, ya] = pts[i]!;
    const [xb, yb] = pts[i + 1]!;
    if (Math.abs(xb - xa) < 1e-6 && Math.abs(yb - ya) < 1e-6) continue;
    // CCW seen from above (normal up)
    out.push(xa, ya, z0, xa, ya, z1, xb, yb, z1, xa, ya, z0, xb, yb, z1, xb, yb, z0);
  }
  if (withEnds) out.push(...rampSides(s));
  return out;
}

/** The ramp's sides (filled down to the floor) and the decks' backs. */
export function rampSides(s: MiniRampSpec): number[] {
  const prof = rampProfile(s, 12);
  const out: number[] = [];
  const half = s.length / 2;
  for (const sx of [-1, 1])
    for (const z of [-s.width / 2, s.width / 2]) {
      const n = z > 0 ? 1 : -1;
      for (let i = 0; i + 1 < prof.length; i++) {
        const [xa, ya] = prof[i]!;
        const [xb, yb] = prof[i + 1]!;
        if (ya <= 0 && yb <= 0) continue;
        const a = [sx * xa, ya, z];
        const b = [sx * xb, yb, z];
        const a0 = [sx * xa, 0, z];
        const b0 = [sx * xb, 0, z];
        // wind so the face points out (+z on the near side)
        const flip = sx * n > 0;
        const quad = flip ? [a0, b0, b, a0, b, a] : [a0, b, b0, a0, a, b];
        for (const v of quad) out.push(v[0]!, v[1]!, v[2]!);
      }
    }
  for (const sx of [-1, 1]) {
    const x = sx * half;
    const q = [
      [x, 0, -s.width / 2],
      [x, 0, s.width / 2],
      [x, s.height, s.width / 2],
      [x, s.height, -s.width / 2],
    ];
    const order = sx > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of order) out.push(...(q[i] as [number, number, number]));
  }
  return out;
}

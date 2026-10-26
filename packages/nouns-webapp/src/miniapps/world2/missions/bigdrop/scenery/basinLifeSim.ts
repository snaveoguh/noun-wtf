// ── The Big Drop basin's wildlife: herding and fleeing (pure) ───────────
//
// Out on the snowfield at the bottom live three kinds of Noun beasts (models
// in animals.ts, drawn by basinLife.ts): shaggy NOGGLE YAKS that plod about
// in herds and stampede when you ride at them, SNOW HARES that hop in loose
// groups and scatter, and PENGUINS that waddle in a huddle and belly-slide
// off when you come by. Herds spawn on a ring ahead of the player (most of
// them where you're heading) and are recycled once you've left them behind.
// Everything here is plain numbers in peak coordinates, so it's tested on
// its own.

export type AnimalKind = 'yak' | 'hare' | 'penguin';
export const ANIMAL_KINDS: readonly AnimalKind[] = ['yak', 'hare', 'penguin'];

interface KindSpec {
  /** Herd size range. */
  min: number;
  max: number;
  /** Herd radius (m). */
  spread: number;
  /** Walking and fleeing speed (m/s). */
  walk: number;
  run: number;
  /** Flees a rider within this (m). */
  fear: number;
  /** Turn rate (rad/s). */
  turn: number;
}

export const ANIMAL: Record<AnimalKind, KindSpec> = {
  yak: { min: 4, max: 9, spread: 22, walk: 1.4, run: 11, fear: 55, turn: 1.2 },
  hare: { min: 3, max: 6, spread: 14, walk: 2.2, run: 15, fear: 45, turn: 4 },
  penguin: { min: 5, max: 10, spread: 9, walk: 0.7, run: 7, fear: 35, turn: 2.2 },
};

export const LIFE = {
  /** Herds of each kind at once, by quality. */
  herds: { low: 2, medium: 3, high: 4 } as Record<'low' | 'medium' | 'high', number>,
  /** Spawn ring round the player (m) and the recycle distance. */
  spawnNear: 260,
  spawnFar: 1000,
  window: 1500,
  /** Calm again this long after the rider's gone (s). */
  calm: 3,
} as const;

export interface Animal {
  kind: AnimalKind;
  x: number;
  z: number;
  /** Heading (rad, atan2(dx, dz)) and speed (m/s). */
  hd: number;
  sp: number;
  /** Gait phase (rad). */
  phase: number;
  /** Seconds of fright left (0 = calm). */
  fright: number;
  /** Personal quirks: speed and offset in the herd. */
  quirk: number;
  ox: number;
  oz: number;
}

export interface Herd {
  kind: AnimalKind;
  /** Centre, heading and the members. */
  x: number;
  z: number;
  hd: number;
  members: Animal[];
}

export type Rng = () => number;

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** A new herd of `kind` on the ring ahead of a player at (px, pz) heading `phd`. */
export function spawnHerd(
  kind: AnimalKind,
  px: number,
  pz: number,
  phd: number,
  rng: Rng,
  initial = false,
): Herd {
  const spec = ANIMAL[kind];
  // Mostly ahead, some off to the sides; on entry, anywhere round you
  const a = phd + (rng() - 0.5) * (initial ? 2.6 : 1.6);
  const d = (initial ? 120 : LIFE.spawnNear) + rng() * (LIFE.spawnFar - LIFE.spawnNear);
  const herd: Herd = {
    kind,
    x: px + Math.sin(a) * d,
    z: pz + Math.cos(a) * d,
    hd: rng() * Math.PI * 2,
    members: [],
  };
  const n = spec.min + Math.floor(rng() * (spec.max - spec.min + 1));
  for (let i = 0; i < n; i++) {
    const r = spec.spread * Math.sqrt(rng());
    const t = rng() * Math.PI * 2;
    const ox = Math.sin(t) * r;
    const oz = Math.cos(t) * r;
    herd.members.push({
      kind,
      x: herd.x + ox,
      z: herd.z + oz,
      hd: herd.hd + (rng() - 0.5) * 0.8,
      sp: 0,
      phase: rng() * Math.PI * 2,
      fright: 0,
      quirk: 0.85 + rng() * 0.3,
      ox,
      oz,
    });
  }
  return herd;
}

/** Left behind for good? */
export function herdGone(h: Herd, px: number, pz: number): boolean {
  return Math.hypot(h.x - px, h.z - pz) > LIFE.window;
}

/**
 * One frame. Riders are (x, z, speed) triples: the player and the NPCs;
 * anything fast inside an animal's `fear` radius sends it running away
 * from the rider's path.
 */
export function stepHerd(h: Herd, dt: number, riders: readonly number[], rng: Rng): void {
  const spec = ANIMAL[h.kind];
  // The herd's own heading wanders
  h.hd = wrap(h.hd + (rng() - 0.5) * 0.4 * dt);
  let cx = 0;
  let cz = 0;
  for (const m of h.members) {
    // Scared? (a rider close and moving)
    for (let i = 0; i + 2 < riders.length; i += 3) {
      const rx = riders[i]!;
      const rz = riders[i + 1]!;
      if (riders[i + 2]! < 4) continue;
      const dx = m.x - rx;
      const dz = m.z - rz;
      const d = Math.hypot(dx, dz);
      if (d < spec.fear) {
        m.fright = LIFE.calm;
        // Away from the rider, the herd breaking a little each way
        m.hd = wrap(
          m.hd + wrap(Math.atan2(dx, dz) + m.ox * 0.02 - m.hd) * Math.min(1, spec.turn * 2 * dt),
        );
      }
    }
    let want: number;
    if (m.fright > 0) {
      m.fright = Math.max(0, m.fright - dt);
      want = spec.run * m.quirk;
    } else {
      // Drift with the herd, back toward its centre when strayed
      const tx = h.x + m.ox - m.x;
      const tz = h.z + m.oz - m.z;
      const off = Math.hypot(tx, tz);
      const target = off > 3 ? Math.atan2(tx, tz) : h.hd;
      m.hd = wrap(m.hd + wrap(target - m.hd) * Math.min(1, spec.turn * dt));
      // Grazing pauses: walk on and off
      const go = Math.sin(m.phase * 0.07 + m.quirk * 9) > -0.3 ? 1 : 0;
      want = spec.walk * m.quirk * go * Math.min(1.6, 0.6 + off / 10);
    }
    m.sp += (want - m.sp) * Math.min(1, 3 * dt);
    m.x += Math.sin(m.hd) * m.sp * dt;
    m.z += Math.cos(m.hd) * m.sp * dt;
    // Gait: faster legs when running
    m.phase += dt * (2 + m.sp * (h.kind === 'hare' ? 0.9 : 1.6));
    cx += m.x;
    cz += m.z;
  }
  const n = Math.max(1, h.members.length);
  // The herd's centre follows its members (a scattered herd regroups where it ends up)
  const calm = h.members.every(m => m.fright <= 0);
  if (calm) {
    h.x += Math.sin(h.hd) * spec.walk * 0.5 * dt;
    h.z += Math.cos(h.hd) * spec.walk * 0.5 * dt;
  } else {
    h.x += (cx / n - h.x) * Math.min(1, dt);
    h.z += (cz / n - h.z) * Math.min(1, dt);
  }
}

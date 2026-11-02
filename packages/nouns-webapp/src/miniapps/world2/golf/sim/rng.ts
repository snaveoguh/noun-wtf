// ── Seeded randomness ───────────────────────────────────────────────────
//
// mulberry32: a 32-bit state, fast, good enough for games, and the same
// sequence on every machine. The sim never calls Math.random.

export type Rng = () => number;

/** A PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix several integers into one 32-bit seed (order matters). */
export function hashInts(...xs: number[]): number {
  let h = 0x811c9dc5 >>> 0;
  for (const x of xs) {
    h ^= x | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** A hash of a string (round ids, player ids) to a 32-bit seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return hashInts(h);
}

/** A standard normal sample (Box–Muller) from a uniform PRNG. */
export function gaussian(rng: Rng): number {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Uniform in [a, b). */
export function range(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}

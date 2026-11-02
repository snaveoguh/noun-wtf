// Seeded PRNG (mulberry32, same as hoops/sim/rng.ts). The state is a plain uint32 kept in the sim's
// serialisable internals, so load(state()) resumes the exact same stream.

export interface RngHolder {
  rng: number;
}

/** Uniform [0, 1). */
export function rand(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform [a, b). */
export function randRange(h: RngHolder, a: number, b: number): number {
  return a + (b - a) * rand(h);
}

/** Standard normal (Box-Muller, two draws). */
export function gauss(h: RngHolder): number {
  const u = Math.max(1e-9, rand(h));
  const v = rand(h);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Mix a seed with a string (FNV-1a) into a uint32. */
export function hashSeed(seed: number, s: string): number {
  let h = (0x811c9dc5 ^ (seed | 0)) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h | 0;
}

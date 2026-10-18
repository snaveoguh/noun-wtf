// Seeded RNG for the exchange (mulberry32). The state is a uint32 kept in
// ExchangeState.rng, so a tick replays identically from the same JSON.

export interface Rng {
  /** Uniform [0, 1). */
  (): number;
  /** Current state, to write back into ExchangeState. */
  state(): number;
}

export function rngFrom(seed: number): Rng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.state = () => a;
  return next;
}

/** Integer in [lo, hi]. */
export const randInt = (r: () => number, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Stable hash of small ints to [-1, 1] (time-noise for town prices; no RNG state). */
export function hashNoise(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

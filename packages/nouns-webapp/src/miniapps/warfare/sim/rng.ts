// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────
//
// The sim never touches Math.random: every random choice (spread, bot
// decisions, spawn tie-breaks) comes from here so two sims fed the same
// seed + inputs stay bit-identical. The state is a single uint32 that lives
// in the snapshot, so a host can hand it to a joining client.

export class Rng {
  s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Symmetric [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Stable 32-bit hash of a string (FNV-1a), for seeding from names / ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

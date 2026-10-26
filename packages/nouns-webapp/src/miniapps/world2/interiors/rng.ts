// ── Seeded randomness for interiors (pure) ──────────────────────────────
//
// Everything about a building (its name, its kind, its room, who lives
// there) comes from its door id, so the same door always opens onto the
// same place on every client.

export { mulberry32 } from '../towns/orders';

/** FNV-1a, 32-bit: a stable number from a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** One of `xs`. */
export function pick<T>(rnd: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length) % xs.length]!;
}

/** One of `xs`, by weight. */
export function pickWeighted<T>(rnd: Rng, xs: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of xs) total += Math.max(0, w);
  let r = rnd() * total;
  for (const [x, w] of xs) {
    r -= Math.max(0, w);
    if (r < 0) return x;
  }
  return xs[xs.length - 1]![0];
}

/** Integer in [a, b]. */
export function int(rnd: Rng, a: number, b: number): number {
  return a + Math.floor(rnd() * (b - a + 1));
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(rnd: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

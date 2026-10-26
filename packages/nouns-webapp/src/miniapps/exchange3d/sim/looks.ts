// ── 3D Grand Exchange: Noun looks (pure) ─────────────────────────────────
//
// Every trader is a real Noun: a seed (background, body, accessory, head,
// glasses) into the on-chain art. Bots wear their real Noun's seed; riders
// and the simulated crowd get a stable seed hashed from their id.
// `rasterNoun` decodes the art's run-length parts into 32×32 RGBA so the
// instanced crowd can carry every trader's face in one texture atlas.

export interface Seed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

export interface ArtCounts {
  bodies: number;
  accessories: number;
  heads: number;
  glasses: number;
  backgrounds: number;
}

/** FNV-1a over a string (stable, not secret). */
export function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A stable Noun seed from any id. */
export function seedFromId(id: string, n: ArtCounts): Seed {
  let h = hashStr(id);
  const take = (k: number) => {
    const v = h % Math.max(1, k);
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return v;
  };
  return {
    background: take(n.backgrounds),
    body: take(n.bodies),
    accessory: take(n.accessories),
    head: take(n.heads),
    glasses: take(n.glasses),
  };
}

export const seedFromArray = (s: readonly number[]): Seed => ({
  background: s[0] ?? 0,
  body: s[1] ?? 0,
  accessory: s[2] ?? 0,
  head: s[3] ?? 0,
  glasses: s[4] ?? 0,
});

export const SPRITE = 32;

/**
 * Paint run-length encoded Noun parts (the on-chain format: palette byte,
 * top/right/bottom/left bounds, then [length, colour] pairs) into a 32×32
 * RGBA buffer, later parts on top. Colour 0 is transparent.
 */
export function rasterNoun(
  parts: readonly string[],
  palette: readonly string[],
  out: Uint8ClampedArray = new Uint8ClampedArray(SPRITE * SPRITE * 4),
): Uint8ClampedArray {
  for (const part of parts) {
    const d = part.replace(/^0x/, '');
    if (d.length < 10) continue;
    const top = parseInt(d.slice(2, 4), 16);
    const right = parseInt(d.slice(4, 6), 16);
    const left = parseInt(d.slice(8, 10), 16);
    let x = left;
    let y = top;
    for (let i = 10; i + 4 <= d.length; i += 4) {
      let len = parseInt(d.slice(i, i + 2), 16);
      const ci = parseInt(d.slice(i + 2, i + 4), 16);
      const hex = ci !== 0 ? palette[ci] : undefined;
      const r = hex !== undefined ? parseInt(hex.slice(0, 2), 16) : 0;
      const g = hex !== undefined ? parseInt(hex.slice(2, 4), 16) : 0;
      const b = hex !== undefined ? parseInt(hex.slice(4, 6), 16) : 0;
      while (len > 0 && y < SPRITE) {
        const run = Math.min(len, right - x);
        if (run <= 0) break;
        if (hex !== undefined)
          for (let k = 0; k < run; k++) {
            const px = x + k;
            if (px < 0 || px >= SPRITE) continue;
            const o = (y * SPRITE + px) * 4;
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = 255;
          }
        x += run;
        len -= run;
        if (x >= right) {
          x = left;
          y++;
        }
      }
    }
  }
  return out;
}

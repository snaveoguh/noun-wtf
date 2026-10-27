// ── How sharp each painted wall is drawn (pure: no three.js) ────────────
//
// The plaza has ~2,100 painted cells. Each one used to hold a 512×256
// canvas (or bigger) and a mipmapped texture of it: ~1.1 GB of canvases and
// up to ~1.5 GB of GPU memory once you'd looked round. Phones can't hold
// that (Safari caps canvas memory at a few hundred MB and hands back blank
// canvases past it), so paint went missing. Now every cell is drawn at once
// at a small size, enough for a 6 m cell seen from 50 m (~130 px across on
// a laptop screen), and the cells round the rider are redrawn at full size.

/** Canvas width of a cell drawn from afar (height is half). */
export const FAR_W = 128;
/** A cell this close (m) gets its full-size canvas... */
export const NEAR_M = 35;
/** ...and keeps it until it's this far away. */
export const FAR_M = 50;

export interface LodCell {
  id: string;
  near: boolean;
  /** Metres from the rider. */
  dist: number;
  /** Always sharp (being painted). */
  pinned: boolean;
}

/**
 * Which cells change size now: the nearest far cells that should be sharp
 * go up and the furthest sharp ones that shouldn't come down, at most
 * `budget` of each, so a burst of walls never redraws all in one frame.
 */
export function lodChanges(
  cells: Iterable<LodCell>,
  budget: number,
): { promote: string[]; demote: string[] } {
  const up: LodCell[] = [];
  const down: LodCell[] = [];
  for (const c of cells) {
    const sharp = c.pinned || c.dist < NEAR_M || (c.near && c.dist < FAR_M);
    if (sharp && !c.near) up.push(c);
    else if (!sharp && c.near) down.push(c);
  }
  up.sort((a, b) => a.dist - b.dist);
  down.sort((a, b) => b.dist - a.dist);
  return {
    promote: up.slice(0, budget).map(c => c.id),
    demote: down.slice(0, budget).map(c => c.id),
  };
}

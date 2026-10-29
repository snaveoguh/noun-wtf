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

export interface LodTuning {
  nearM: number;
  farM: number;
  /** At most this many cells sharp at once (the nearest; pinned ones always). */
  maxNear: number;
}

/** Desktop (and medium / high anywhere): as it always was. */
export const LOD_DEFAULT: LodTuning = { nearM: NEAR_M, farM: FAR_M, maxNear: Infinity };

/**
 * Phones: ~340 painted cells sit within 35 m of the plaza's centre, each a
 * 512×256 canvas sharp (~180 MB of canvases plus their mipmapped textures on
 * a 4 GB phone). A phone draws a sharp cell only close up, and only so many.
 */
export function lodTuning(quality: 'low' | 'medium' | 'high', weak: boolean): LodTuning {
  if (quality !== 'low') return LOD_DEFAULT;
  return weak ? { nearM: 12, farM: 18, maxNear: 16 } : { nearM: 20, farM: 28, maxNear: 40 };
}

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
  t: LodTuning = LOD_DEFAULT,
): { promote: string[]; demote: string[] } {
  const up: LodCell[] = [];
  const down: LodCell[] = [];
  const want: LodCell[] = [];
  for (const c of cells) {
    const sharp = c.pinned || c.dist < t.nearM || (c.near && c.dist < t.farM);
    if (sharp) want.push(c);
    else if (c.near) down.push(c);
  }
  // Over the cap: the furthest of the wanted ones stay (or go back to) small.
  // A sharp one counts as a little nearer, so two at the edge don't swap.
  if (want.length > t.maxNear) {
    const slack = (t.farM - t.nearM) / 2;
    const key = (c: LodCell) => c.dist - (c.near ? slack : 0);
    want.sort((a, b) => Number(b.pinned) - Number(a.pinned) || key(a) - key(b));
    for (const c of want.splice(Math.max(t.maxNear, want.filter(w => w.pinned).length)))
      if (c.near) down.push(c);
  }
  for (const c of want) if (!c.near) up.push(c);
  up.sort((a, b) => a.dist - b.dist);
  down.sort((a, b) => b.dist - a.dist);
  return {
    promote: up.slice(0, budget).map(c => c.id),
    demote: down.slice(0, budget).map(c => c.id),
  };
}

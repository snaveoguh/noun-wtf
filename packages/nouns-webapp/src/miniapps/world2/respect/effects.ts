// ── What your respect changes elsewhere (each one tiny) ─────────────────
//
//   tipBonus     town customers (towns/TownSystem) tip a little more the
//                better known you are: outcast −10%, local +5%, regular
//                +10%, legend +20% of the tip (never the price)
//   LEGEND_BADGE the noggles on a legend's name label (Game's remote name
//                tags, relayed as the pose blob's `rs: 'L'`, net/Net.ts)
//   GREETS       the Noun Jersey crew greeting a legend (hooks.ts wave)
//   tier         interiors/ reads `game.respect.state().tier` for residents

import type { RespectTier } from '../interiors/contract';

export const TIP_MULT: Record<RespectTier, number> = {
  outcast: 0.9,
  stranger: 1,
  local: 1.05,
  regular: 1.1,
  legend: 1.2,
};

/** The tip after the tier's bonus (whole COIN, never below 0). */
export function tipBonus(tip: number, tier: RespectTier | undefined): number {
  return Math.max(0, Math.round(tip * TIP_MULT[tier ?? 'stranger']));
}

/** The canonical red noggles (the real sprite, never redrawn). */
export const NOGGLES_SRC = '/sprites/glasses/glasses-square-red.png';

/** Appended to a legend's name tag. */
export const LEGEND_BADGE = `<img class="w2-legend" src="${NOGGLES_SRC}" alt="legend" title="Respect: legend" width="18" height="9" style="display:inline-block;margin-left:4px;vertical-align:middle;image-rendering:pixelated" />`;

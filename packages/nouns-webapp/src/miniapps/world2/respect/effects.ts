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

import { NOG_RED, NOGGLES } from '../../../components/NounOS/home/introScene';

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

/**
 * The canonical noggles as an image: an SVG built pixel for pixel from the
 * homepage intro's grid (introScene's NOGGLES, which a test checks against
 * glasses-square-red.png), never redrawn by hand.
 */
export function nogglesSvg(): string {
  const fill = { R: NOG_RED, W: '#ffffff', B: '#000000' } as const;
  const rects = NOGGLES.flatMap((row, y) =>
    [...row].flatMap((k, x) =>
      k === '.'
        ? []
        : [`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill[k as 'R' | 'W' | 'B']}"/>`],
    ),
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 6" shape-rendering="crispEdges">${rects}</svg>`;
}

export const NOGGLES_SRC = `data:image/svg+xml,${encodeURIComponent(nogglesSvg())}`;

/** Appended to a legend's name tag. */
export const LEGEND_BADGE = `<img class="w2-legend" src="${NOGGLES_SRC}" alt="legend" title="Respect: legend" width="18" height="7" style="display:inline-block;margin-left:4px;vertical-align:middle;image-rendering:pixelated" />`;

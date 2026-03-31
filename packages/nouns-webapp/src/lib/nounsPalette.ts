/**
 * Noundry-style sorted Nouns color palette.
 * Inspired by volkyeth/noundry Studio's color sorting algorithm.
 *
 * Colors are sorted: grayscale last → by hue → by saturation → by lightness.
 * Includes nearest-color matching for snapping custom picks to official palette.
 */
import { ImageData } from '@noundry/nouns-assets';

// ─── Color math ──────────────────────────────────────────────────────────────

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s, l };
}

function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16),
    g1 = parseInt(hex1.slice(3, 5), 16),
    b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16),
    g2 = parseInt(hex2.slice(3, 5), 16),
    b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// ─── Palette ─────────────────────────────────────────────────────────────────

/** Official Nouns palette as #hex strings */
export const nounsPaletteHex: string[] = ImageData.palette.map(hex => `#${hex}`);

/** Sorted palette: grayscale last, then by hue → saturation → lightness */
export function sortedPalette(): string[] {
  return [...nounsPaletteHex].sort((a, b) => {
    const hslA = hexToHSL(a);
    const hslB = hexToHSL(b);

    // Grayscale (low saturation) goes to end
    const isGrayA = hslA.s < 0.08;
    const isGrayB = hslB.s < 0.08;
    if (isGrayA !== isGrayB) return isGrayA ? 1 : -1;

    // Both grayscale: sort by lightness
    if (isGrayA && isGrayB) return hslA.l - hslB.l;

    // Sort by hue, then saturation (desc), then lightness
    if (Math.abs(hslA.h - hslB.h) > 5) return hslA.h - hslB.h;
    if (Math.abs(hslA.s - hslB.s) > 0.05) return hslB.s - hslA.s;
    return hslA.l - hslB.l;
  });
}

/** Find N closest official palette colors to a given hex */
export function getClosestPaletteColors(hex: string, count = 8): string[] {
  return [...nounsPaletteHex]
    .sort((a, b) => colorDistance(hex, a) - colorDistance(hex, b))
    .slice(0, count);
}

/** Background colors */
export const bgColors = ImageData.bgcolors.map(hex => `#${hex}`);

/** Cached sorted palette */
let _sorted: string[] | null = null;
export function getSortedPalette(): string[] {
  if (!_sorted) _sorted = sortedPalette();
  return _sorted;
}

import { FC, useMemo } from 'react';

import { getNounData, ImageData } from '@noundry/nouns-assets';

import { INounSeed } from '@/wrappers/nounToken';

interface ColorInfo {
  hex: string;
  pixels: number;
}

/**
 * Decode RLE image data to extract (runLength, colorIndex) pairs.
 * Mirrors the decode logic from @nouns/sdk/image/svg-builder.ts.
 * Each 4-hex-char chunk is [0:2]=runLength, [2:4]=colorIndex.
 */
const decodeRlePairs = (rleData: string): Array<[number, number]> => {
  const data = rleData.replace(/^0x/, '');
  // Skip first 10 chars (palette index 2 + bounds 8)
  const rects = data.substring(10);
  const pairs: Array<[number, number]> = [];
  const chunks = rects.match(/.{1,4}/g) ?? [];
  for (const chunk of chunks) {
    const runLength = parseInt(chunk.substring(0, 2), 16);
    const colorIndex = parseInt(chunk.substring(2, 4), 16);
    pairs.push([runLength, colorIndex]);
  }
  return pairs;
};

/**
 * Extract the unique hex colors + pixel counts used in a Noun's traits.
 * Sorted alphabetically by hex value (matching probe.wtf style).
 */
export const getNounColors = (seed: INounSeed): ColorInfo[] => {
  const { parts } = getNounData(seed);
  const palette = ImageData.palette;

  // Count pixel frequency of each color index across all parts
  const freq = new Map<number, number>();
  for (const part of parts) {
    // A V2 seed can carry trait indices beyond the bundled V1 asset set
    // (e.g. body 31 when only 0–30 exist), so getNounData yields an
    // undefined part. Reading `part.data` then threw and — because the
    // crash happens in the NavBar's palette swatch — tombstoned the whole
    // /v2 page. Skip any part we can't decode instead of throwing.
    if (typeof part?.data !== 'string') continue;
    const pairs = decodeRlePairs(part.data);
    for (const [runLength, colorIndex] of pairs) {
      if (colorIndex === 0) continue; // 0 = transparent
      freq.set(colorIndex, (freq.get(colorIndex) ?? 0) + runLength);
    }
  }

  // Map to hex colors with pixel counts, sort alphabetically by hex
  const colors: ColorInfo[] = Array.from(freq.entries())
    .map(([idx, pixels]) => ({ hex: `#${palette[idx]}`, pixels }))
    .sort((a, b) => a.hex.localeCompare(b.hex));

  // Prepend background color (not in trait RLE data)
  const bgHex = `#${ImageData.bgcolors[seed.background] ?? 'd5d7e1'}`;
  const bgPixels = 32 * 32 - Array.from(freq.values()).reduce((s, v) => s + v, 0);
  const withoutBg = colors.filter(c => c.hex !== bgHex);

  return [{ hex: bgHex, pixels: Math.max(bgPixels, 0) }, ...withoutBg];
};

interface NounPaletteProps {
  seed: INounSeed;
  /** Max number of swatches to show (0 = all) */
  max?: number;
}

/**
 * Color palette swatches extracted from a Noun's traits.
 * Matches probe.wtf design: colored squares sorted alphabetically.
 */
const NounPalette: FC<NounPaletteProps> = ({ seed, max = 0 }) => {
  const colors = useMemo(() => {
    const all = getNounColors(seed);
    return max > 0 ? all.slice(0, max) : all;
  }, [seed, max]);

  if (colors.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        flexWrap: 'wrap',
        padding: '4px 0',
      }}
    >
      {colors.map((color, i) => (
        <div
          key={`${color.hex}-${i}`}
          title={`${color.hex} (${color.pixels})`}
          style={{
            width: '16px',
            height: '16px',
            backgroundColor: color.hex,
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: '2px',
            cursor: 'default',
          }}
        />
      ))}
    </div>
  );
};

export default NounPalette;

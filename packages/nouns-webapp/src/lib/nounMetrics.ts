import { ImageData, getNounData } from '@noundry/nouns-assets';

import { INounSeed } from '@/wrappers/nounToken';

export interface NounMetrics {
  area: number; // 0-1, proportion of non-bg pixels
  colorfulness: number; // 0-100, color variety + saturation score
  brightness: number; // 0-255, average luminance of the ART pixels only (not background)
}

const CACHE_KEY = 'noun-metrics-v3';
const metricsCache = new Map<number, NounMetrics>();

// Load from localStorage on init
try {
  const stored = localStorage.getItem(CACHE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, NounMetrics>;
    for (const [k, v] of Object.entries(parsed)) {
      metricsCache.set(Number(k), v);
    }
  }
} catch {
  // ignore
}

// Clear old caches
try {
  localStorage.removeItem('noun-metrics-v1');
  localStorage.removeItem('noun-metrics-v2');
} catch {
  // ignore
}

function saveCache() {
  try {
    const obj: Record<string, NounMetrics> = {};
    metricsCache.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore quota errors
  }
}

/** Decode RLE-encoded trait data into pixel color indices */
function decodeRLE(hexData: string): {
  top: number;
  right: number;
  bottom: number;
  left: number;
  pixels: number[];
} {
  const hex = hexData.startsWith('0x') ? hexData.slice(2) : hexData;
  const top = parseInt(hex.slice(2, 4), 16);
  const right = parseInt(hex.slice(4, 6), 16);
  const bottom = parseInt(hex.slice(6, 8), 16);
  const left = parseInt(hex.slice(8, 10), 16);

  const pixels: number[] = [];
  let i = 10;
  while (i + 3 <= hex.length) {
    const length = parseInt(hex.slice(i, i + 2), 16);
    const colorIndex = parseInt(hex.slice(i + 2, i + 4), 16);
    for (let j = 0; j < length; j++) pixels.push(colorIndex);
    i += 4;
  }

  return { top, right, bottom, left, pixels };
}

/** Parse hex color to RGB */
function hexToRGB(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** ITU-R BT.601 weighted luminance */
function luminance(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Saturation of an RGB color (0-1) */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/**
 * Compute pixel-accurate metrics by decoding RLE trait data
 * and analyzing the composite 32x32 grid.
 *
 * Brightness and colorfulness are computed on ART pixels only
 * (excluding background), so the sort produces visually meaningful results.
 */
function computeFromPixels(seed: INounSeed): NounMetrics {
  try {
    const { parts, background } = getNounData(seed);

    // Composite all parts onto 32x32 grid (0 = transparent/background)
    const grid = new Int16Array(32 * 32);

    for (const part of parts) {
      const decoded = decodeRLE(part.data);
      let pixelIdx = 0;
      for (let y = decoded.top; y < decoded.bottom && y < 32; y++) {
        for (let x = decoded.left; x < decoded.right && x < 32; x++) {
          if (pixelIdx < decoded.pixels.length) {
            const colorIdx = decoded.pixels[pixelIdx];
            if (colorIdx !== 0) {
              grid[y * 32 + x] = colorIdx;
            }
            pixelIdx++;
          }
        }
      }
    }

    // Analyze art pixels only (skip background)
    let artBrightness = 0;
    let artPixelCount = 0;
    let totalSaturation = 0;
    const uniqueColors = new Set<number>();

    const totalPixels = 32 * 32;

    for (let i = 0; i < totalPixels; i++) {
      const colorIdx = grid[i];
      if (colorIdx === 0) continue; // skip background

      const hex = ImageData.palette[colorIdx];
      if (!hex) continue;

      const [r, g, b] = hexToRGB(hex);
      artBrightness += luminance(r, g, b);
      totalSaturation += saturation(r, g, b);
      artPixelCount++;
      uniqueColors.add(colorIdx);
    }

    const area = artPixelCount / totalPixels;

    // Brightness: average luminance of art pixels only
    const avgBrightness = artPixelCount > 0 ? artBrightness / artPixelCount : 128;

    // Colorfulness: unique colors + average saturation
    // More unique colors + higher saturation = more colorful
    const avgSaturation = artPixelCount > 0 ? totalSaturation / artPixelCount : 0;
    const colorfulness = Math.min(
      100,
      uniqueColors.size * 2.5 + avgSaturation * 60,
    );

    return {
      area: Math.max(0, Math.min(1, area)),
      colorfulness: Math.max(0, Math.min(100, colorfulness)),
      brightness: Math.max(0, Math.min(255, avgBrightness)),
    };
  } catch {
    return { area: 0.5, colorfulness: 50, brightness: 128 };
  }
}

/**
 * Get cached metrics or compute them (pixel-accurate, art-only).
 */
export function getNounMetrics(seed: INounSeed, nounId: number): NounMetrics {
  const cached = metricsCache.get(nounId);
  if (cached) return cached;

  const metrics = computeFromPixels(seed);
  metricsCache.set(nounId, metrics);

  if (metricsCache.size % 50 === 0) {
    saveCache();
  }

  return metrics;
}

/**
 * Flush metrics cache to localStorage.
 */
export function flushMetricsCache() {
  saveCache();
}

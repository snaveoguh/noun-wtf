import { ImageData, getNounData } from '@noundry/nouns-assets';

import { INounSeed } from '@/wrappers/nounToken';

export interface NounMetrics {
  area: number; // 0-1, proportion of non-bg pixels
  colorfulness: number; // 0-100, color variety + saturation score
  brightness: number; // 0-255, average luminance of ART pixels only (not background)
}

const CACHE_KEY = 'noun-metrics-v3';
const metricsCache = new Map<number, NounMetrics>();

try {
  const stored = localStorage.getItem(CACHE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, NounMetrics>;
    for (const [k, v] of Object.entries(parsed)) {
      metricsCache.set(Number(k), v);
    }
  }
} catch { /* ignore */ }

try { localStorage.removeItem('noun-metrics-v1'); localStorage.removeItem('noun-metrics-v2'); } catch { /* ignore */ }

function saveCache() {
  try {
    const obj: Record<string, NounMetrics> = {};
    metricsCache.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch { /* ignore quota */ }
}

function decodeRLE(hexData: string) {
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

function hexToRGB(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function luminance(r: number, g: number, b: number) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function computeFromPixels(seed: INounSeed): NounMetrics {
  try {
    const { parts, background } = getNounData(seed);
    const [bgR, bgG, bgB] = hexToRGB(background);
    const grid = new Int16Array(32 * 32);

    for (const part of parts) {
      const decoded = decodeRLE(part.data);
      let pixelIdx = 0;
      for (let y = decoded.top; y < decoded.bottom && y < 32; y++) {
        for (let x = decoded.left; x < decoded.right && x < 32; x++) {
          if (pixelIdx < decoded.pixels.length) {
            const colorIdx = decoded.pixels[pixelIdx];
            if (colorIdx !== 0) grid[y * 32 + x] = colorIdx;
            pixelIdx++;
          }
        }
      }
    }

    let artBrightness = 0, artPixelCount = 0, totalSaturation = 0;
    const uniqueColors = new Set<number>();

    for (let i = 0; i < 1024; i++) {
      const colorIdx = grid[i];
      if (colorIdx === 0) continue;
      const hex = ImageData.palette[colorIdx];
      if (!hex) continue;
      const [r, g, b] = hexToRGB(hex);
      artBrightness += luminance(r, g, b);
      totalSaturation += saturation(r, g, b);
      artPixelCount++;
      uniqueColors.add(colorIdx);
    }

    const area = artPixelCount / 1024;
    const avgBrightness = artPixelCount > 0 ? artBrightness / artPixelCount : 128;
    const avgSaturation = artPixelCount > 0 ? totalSaturation / artPixelCount : 0;
    const colorfulness = Math.min(100, uniqueColors.size * 2.5 + avgSaturation * 60);

    return {
      area: Math.max(0, Math.min(1, area)),
      colorfulness: Math.max(0, Math.min(100, colorfulness)),
      brightness: Math.max(0, Math.min(255, avgBrightness)),
    };
  } catch {
    return { area: 0.5, colorfulness: 50, brightness: 128 };
  }
}

export function getNounMetrics(seed: INounSeed, nounId: number): NounMetrics {
  const cached = metricsCache.get(nounId);
  if (cached) return cached;
  const metrics = computeFromPixels(seed);
  metricsCache.set(nounId, metrics);
  if (metricsCache.size % 50 === 0) saveCache();
  return metrics;
}

export function flushMetricsCache() { saveCache(); }

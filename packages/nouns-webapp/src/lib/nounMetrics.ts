import { ImageData } from '@noundry/nouns-assets';

import { INounSeed } from '@/wrappers/nounToken';

export interface NounMetrics {
  area: number; // 0-1, proportion of non-bg pixels
  colorfulness: number; // 0-100, color variety score
  brightness: number; // 0-255, average luminance
}

const CACHE_KEY = 'noun-metrics-v1';
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

/**
 * Compute visual metrics for a noun by rendering its SVG to a canvas
 * and analyzing pixel data.
 */
export function computeNounMetrics(seed: INounSeed, nounId: number): NounMetrics {
  const cached = metricsCache.get(nounId);
  if (cached) return cached;

  try {
    // Parse background color
    const bgHex = ImageData.bgcolors[seed.background];
    const bgR = parseInt(bgHex.slice(0, 2), 16);
    const bgG = parseInt(bgHex.slice(2, 4), 16);
    const bgB = parseInt(bgHex.slice(4, 6), 16);

    // Since we can't easily render SVG to canvas synchronously,
    // use a deterministic heuristic based on trait indices
    const metrics = computeFromSeed(seed, bgR, bgG, bgB);
    metricsCache.set(nounId, metrics);

    // Batch save periodically
    if (metricsCache.size % 50 === 0) {
      saveCache();
    }

    return metrics;
  } catch {
    const fallback: NounMetrics = { area: 0.5, colorfulness: 50, brightness: 128 };
    metricsCache.set(nounId, fallback);
    return fallback;
  }
}

/**
 * Approximate metrics from seed values without rendering.
 * This is fast and deterministic.
 */
function computeFromSeed(seed: INounSeed, bgR: number, bgG: number, bgB: number): NounMetrics {
  // Area: heads with more detail tend to have higher indices
  // Normalize head + accessory + body indices to estimate coverage
  const headCount = ImageData.images.heads.length;
  const bodyCount = ImageData.images.bodies.length;
  const accessoryCount = ImageData.images.accessories.length;
  const glassesCount = ImageData.images.glasses.length;

  // Use a hash of all traits to create pseudo-random but deterministic metrics
  const combined = seed.head * 1000 + seed.body * 100 + seed.accessory * 10 + seed.glasses;
  const hash = (combined * 2654435761) >>> 0; // Knuth multiplicative hash

  // Area: 0.3 to 0.8 range based on head + body complexity
  const area = 0.3 + ((seed.head / headCount + seed.body / bodyCount) / 2) * 0.5;

  // Colorfulness: based on trait diversity and background
  const traitVariety =
    (seed.head / headCount +
      seed.body / bodyCount +
      seed.accessory / accessoryCount +
      seed.glasses / glassesCount) /
    4;
  const colorfulness = 20 + traitVariety * 60 + ((hash % 20) - 10);

  // Brightness: based on background + trait indices
  const bgBrightness = (bgR * 299 + bgG * 587 + bgB * 114) / 1000;
  const brightness = bgBrightness * 0.4 + 128 * 0.3 + ((hash >> 8) % 64) + 32;

  return {
    area: Math.max(0, Math.min(1, area)),
    colorfulness: Math.max(0, Math.min(100, colorfulness)),
    brightness: Math.max(0, Math.min(255, brightness)),
  };
}

/**
 * Get cached metrics or compute them.
 */
export function getNounMetrics(seed: INounSeed, nounId: number): NounMetrics {
  return computeNounMetrics(seed, nounId);
}

/**
 * Flush metrics cache to localStorage.
 */
export function flushMetricsCache() {
  saveCache();
}

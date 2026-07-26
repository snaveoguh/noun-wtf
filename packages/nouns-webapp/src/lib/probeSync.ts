/**
 * Publish dreams to the dream-nouns API (nouns-api on Railway).
 * This replaced the probe.wtf DigitalOcean Laravel backend on 2026-07-19;
 * the endpoint accepts the same multipart form the Laravel API did.
 */

import type { SavedDream } from '@/lib/dreamStorage';

const PROBE_API = 'https://spirited-flexibility-production-3c30.up.railway.app/api/dream-nouns';

/**
 * Post a new dream to probe.wtf's Laravel API.
 * Throws on network error or non-2xx response so callers can surface the failure.
 * If a custom trait is uploaded, the layer's seed is sent as null so probe's renderer
 * knows to use the uploaded image instead of a standard trait.
 */
export async function syncDreamToProbe(
  dream: SavedDream,
  walletAddress: string,
  customTraitFile?: File,
): Promise<void> {
  const formData = new FormData();
  formData.append('dreamer', walletAddress);
  formData.append('background_seed_id', String(dream.seed.background));

  const customLayer = dream.customTraitLayer;
  const hasCustom = customLayer !== undefined && customTraitFile !== undefined;

  // For each standard layer, send the seed — but omit it (null) if a custom
  // trait replaces that layer. Matches what probe's existing records show
  // (e.g. head_seed_id = null when custom_trait_layer = 'head').
  const layerSeeds: Array<[keyof SavedDream['seed'], string]> = [
    ['accessory', 'accessory_seed_id'],
    ['body', 'body_seed_id'],
    ['glasses', 'glasses_seed_id'],
    ['head', 'head_seed_id'],
  ];
  for (const [key, field] of layerSeeds) {
    if (hasCustom && customLayer === key) continue;
    formData.append(field, String(dream.seed[key]));
  }

  if (hasCustom) {
    formData.append('custom_trait_image', customTraitFile);
    formData.append('custom_trait_layer', customLayer);
  }

  const response = await fetch(PROBE_API, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`probe.wtf POST ${response.status}: ${body.slice(0, 200)}`);
  }
}

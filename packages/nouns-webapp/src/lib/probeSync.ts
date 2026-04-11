/**
 * Cross-post dreams to probe.wtf's backend API.
 * Remove this file when DigitalOcean is sunset.
 */

import type { CustomTraitLayer, SavedDream } from '@/lib/dreamStorage';

const PROBE_API = 'https://api.probe.wtf/api/dream-nouns';

/**
 * Post a new dream to probe.wtf's Laravel API.
 * Fire-and-forget — failures are logged but don't block the local save.
 */
export async function syncDreamToProbe(
  dream: SavedDream,
  walletAddress: string,
  customTraitFile?: File,
): Promise<void> {
  try {
    const formData = new FormData();
    formData.append('dreamer', walletAddress);
    formData.append('accessory_seed_id', String(dream.seed.accessory));
    formData.append('background_seed_id', String(dream.seed.background));
    formData.append('body_seed_id', String(dream.seed.body));
    formData.append('glasses_seed_id', String(dream.seed.glasses));
    formData.append('head_seed_id', String(dream.seed.head));

    if (dream.customTraitLayer && customTraitFile) {
      formData.append('custom_trait_image', customTraitFile);
      formData.append('custom_trait_layer', dream.customTraitLayer);
    }

    const response = await fetch(PROBE_API, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      console.warn('[probeSync] Failed to sync dream:', response.status, await response.text());
    } else {
      console.log('[probeSync] Dream synced to probe.wtf');
    }
  } catch (err) {
    // Non-blocking — probe.wtf sync is best-effort
    console.warn('[probeSync] Failed to sync dream:', err);
  }
}

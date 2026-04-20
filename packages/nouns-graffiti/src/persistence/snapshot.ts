// Snapshot helpers: compose a surface canvas to a PNG blob for cold storage,
// or apply a PNG blob back to a surface.

import { surfaces } from '../core/registry.js';

/** Export as a PNG Blob (for upload to IPFS / blob storage). */
export function surfaceToPngBlob(surfaceId: string): Promise<Blob | null> {
  const surface = surfaces.get(surfaceId);
  if (!surface) return Promise.resolve(null);
  return new Promise(resolve => {
    surface.canvas.toBlob(blob => resolve(blob), 'image/png');
  });
}

/** Export as a PNG data URL. */
export function surfaceToPngDataUrl(surfaceId: string): string | null {
  const surface = surfaces.get(surfaceId);
  if (!surface) return null;
  return surface.toPng();
}

/** Apply a PNG (data URL or remote URL) as the baseline for a surface. */
export async function applyPngBaseline(surfaceId: string, pngUrl: string): Promise<boolean> {
  const surface = surfaces.get(surfaceId);
  if (!surface) return false;
  await surface.applyBaseline(pngUrl);
  return true;
}

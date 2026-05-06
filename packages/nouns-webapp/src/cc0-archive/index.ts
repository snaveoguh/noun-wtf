/**
 * cc0-archive — runtime loader.
 *
 * The data lives as static JSON under `public/cc0-archive/` (served by Vite
 * in dev and by Netlify in prod). Catalogue lazy-loads it the first time
 * the user opens the catalogue so we don't pay the cost on initial page
 * load — Sebastien's NOUNDRY repo alone is ~2.8MB of metadata.
 */

export type {
  ArchiveAsset,
  ArchiveCreator,
  ArchiveIndex,
  ArchiveLicense,
  ArchiveManifest,
  ArchiveMediaType,
  ArchiveSource,
} from './types';

import type { ArchiveIndex, ArchiveManifest } from './types';

const BASE = '/cc0-archive';

export async function loadArchiveIndex(): Promise<ArchiveIndex> {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`cc0-archive index fetch failed: ${res.status}`);
  return (await res.json()) as ArchiveIndex;
}

export async function loadArchiveCreator(id: string): Promise<ArchiveManifest> {
  const res = await fetch(`${BASE}/creators/${id}.json`);
  if (!res.ok) throw new Error(`cc0-archive creator ${id} fetch failed: ${res.status}`);
  return (await res.json()) as ArchiveManifest;
}

/** Convenience: load the index, then load every creator manifest in parallel. */
export async function loadAllArchive(): Promise<ArchiveManifest[]> {
  const index = await loadArchiveIndex();
  return Promise.all(index.creators.map(c => loadArchiveCreator(c.id)));
}

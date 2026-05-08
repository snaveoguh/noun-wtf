/**
 * Shared helpers for cc0-archive ingestor scripts.
 *
 * Each ingestor calls `loadManifest(creatorId)` to read the existing JSON,
 * adds new assets via `mergeAssets(...)` (dedupes by `id`), and writes back
 * with `saveManifest(...)`. The index file is rebuilt by `rebuildIndex()`
 * from the live creator files so asset counts stay in sync.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Data lives in public/ so the webapp serves it as static JSON at runtime
// (the catalogue lazy-fetches it instead of bundling 4k+ entries into JS).
export const DATA_DIR = join(HERE, '..', '..', 'public', 'cc0-archive');
export const CREATORS_DIR = join(DATA_DIR, 'creators');
export const INDEX_PATH = join(DATA_DIR, 'index.json');

export async function loadManifest(creatorId) {
  const path = join(CREATORS_DIR, `${creatorId}.json`);
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

export async function saveManifest(creatorId, manifest) {
  const path = join(CREATORS_DIR, `${creatorId}.json`);
  // Stable sort on id so diffs stay readable when re-running ingest.
  manifest.assets.sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(path, json, 'utf8');
}

/** Merge new assets into existing list. New entries win on `id` collision. */
export function mergeAssets(existing, incoming) {
  const byId = new Map(existing.map(a => [a.id, a]));
  for (const a of incoming) byId.set(a.id, a);
  return [...byId.values()];
}

export async function rebuildIndex() {
  const files = (await readdir(CREATORS_DIR)).filter(f => f.endsWith('.json'));
  const creators = [];
  for (const f of files) {
    const m = JSON.parse(await readFile(join(CREATORS_DIR, f), 'utf8'));
    creators.push({
      id: m.creator.id,
      name: m.creator.name,
      file: `creators/${f}`,
      assetCount: m.assets.length,
      ...(m.creator.inMemoriam ? { inMemoriam: true } : {}),
    });
  }
  creators.sort((a, b) => a.id.localeCompare(b.id));
  const index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    creators,
  };
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

/** Pick a media type from a URL/mime tuple. Conservative defaults. */
export function inferMediaType(url, mime) {
  const u = (url || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (m.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(u)) return 'video';
  if (m === 'image/gif' || u.endsWith('.gif')) return 'gif';
  if (m === 'image/svg+xml' || u.endsWith('.svg')) return 'svg';
  if (m.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(u)) return 'audio';
  if (/\.(glb|gltf|obj|fbx|usdz)$/i.test(u)) return '3d';
  if (m.startsWith('image/') || /\.(png|jpe?g|webp|avif)$/i.test(u)) return 'image';
  return 'other';
}

/** Slugify text into an id-safe segment. */
export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

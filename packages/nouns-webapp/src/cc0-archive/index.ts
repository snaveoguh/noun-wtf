/**
 * cc0-archive — runtime loader.
 *
 * The data lives as static JSON under `public/cc0-archive/` (served by Vite
 * in dev and by Netlify in prod). The CC0 Library lazy-loads it the first
 * time someone opens /cc0 so nobody else pays for it: Sebastien's NOUNDRY
 * repo alone is ~2.8 MB of metadata.
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

import type { ArchiveAsset, ArchiveIndex, ArchiveManifest } from './types';

const BASE = '/cc0-archive';
const SLUG_RE = /^[\da-z][\da-z-]{0,63}$/;

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An index.json off the wire, or null if it isn't one we can read. */
export function parseArchiveIndex(v: unknown): ArchiveIndex | null {
  if (!isObj(v) || v.version !== 1 || !Array.isArray(v.creators)) return null;
  const creators = v.creators.filter(
    (c): c is ArchiveIndex['creators'][number] =>
      isObj(c) && typeof c.id === 'string' && SLUG_RE.test(c.id) && typeof c.name === 'string',
  );
  return { version: 1, updatedAt: String(v.updatedAt ?? ''), creators };
}

function isAsset(a: unknown): a is ArchiveAsset {
  return (
    isObj(a) &&
    typeof a.id === 'string' &&
    typeof a.creatorId === 'string' &&
    typeof a.title === 'string' &&
    typeof a.mediaUrl === 'string' &&
    typeof a.sourceUrl === 'string' &&
    typeof a.mediaType === 'string' &&
    Array.isArray(a.tags)
  );
}

/** A creator manifest off the wire: malformed assets are dropped, a bad shape is null. */
export function parseArchiveManifest(v: unknown): ArchiveManifest | null {
  if (!isObj(v) || !isObj(v.creator) || !Array.isArray(v.assets)) return null;
  const c = v.creator;
  if (typeof c.id !== 'string' || typeof c.name !== 'string') return null;
  return {
    creator: {
      id: c.id,
      name: c.name,
      bio: typeof c.bio === 'string' ? c.bio : '',
      ...(c.inMemoriam === true ? { inMemoriam: true } : {}),
      ...(typeof c.avatar === 'string' ? { avatar: c.avatar } : {}),
      links: isObj(c.links) ? (c.links as ArchiveManifest['creator']['links']) : {},
    },
    assets: v.assets.filter(isAsset),
  };
}

export async function loadArchiveIndex(f: Fetch = fetch): Promise<ArchiveIndex> {
  const res = await f(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`cc0-archive index fetch failed: ${res.status}`);
  const idx = parseArchiveIndex(await res.json());
  if (idx === null) throw new Error('cc0-archive index is malformed');
  return idx;
}

export async function loadArchiveCreator(id: string, f: Fetch = fetch): Promise<ArchiveManifest> {
  if (!SLUG_RE.test(id)) throw new Error(`cc0-archive: bad creator id ${id}`);
  const res = await f(`${BASE}/creators/${id}.json`);
  if (!res.ok) throw new Error(`cc0-archive creator ${id} fetch failed: ${res.status}`);
  const m = parseArchiveManifest(await res.json());
  if (m === null) throw new Error(`cc0-archive creator ${id} is malformed`);
  return m;
}

/**
 * Load the index, then every creator manifest in parallel. Creators with no
 * assets yet are skipped (no request), and one broken manifest doesn't sink
 * the rest. Throws only when the index itself can't be read.
 */
export async function loadAllArchive(f: Fetch = fetch): Promise<ArchiveManifest[]> {
  const index = await loadArchiveIndex(f);
  const wanted = index.creators.filter(c => c.assetCount === undefined || c.assetCount > 0);
  const got = await Promise.allSettled(wanted.map(c => loadArchiveCreator(c.id, f)));
  return got.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
}

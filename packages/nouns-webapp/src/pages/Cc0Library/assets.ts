// The CC0 Library's asset model: every source (the curated cc0-archive,
// cc0-lib.wtf, community uploads) is normalised into one `Cc0Asset` so the
// grid, filters and detail panel treat them alike. Pure, so it's testable.
//
// The source adapters are restored from the old Catalogue shell
// (CatalogueShell/useCatalogueAssets.ts, removed in 78f476012), trimmed to
// the CC0 sources and typed.

import type {
  ArchiveAsset,
  ArchiveCreator,
  ArchiveManifest,
  ArchiveMediaType,
} from '@/cc0-archive';

import { fileUrl, type Cc0Upload } from './uploadRules';

export type AssetType = 'image' | 'gif' | 'svg' | 'pixel' | 'video' | 'audio' | '3d' | 'other';
export type AssetSource = 'archive' | 'cc0-lib' | 'upload';

export interface Cc0Asset {
  /** Unique across sources (`archive-…`, `cc0-…`, `upload-…`) */
  id: string;
  title: string;
  creator: string;
  /** Stable creator key for the creator filter */
  creatorId: string;
  source: AssetSource;
  type: AssetType;
  /** Something an <img> can show; undefined for audio / 3D / unknown files */
  thumb?: string;
  /** The original file (download / open) */
  fileUrl: string;
  /** Where it lives on the web (repo page, cc0-lib entry, creator's link) */
  sourceUrl?: string;
  sourceLabel: string;
  /** File extension, lower case ("png", "glb"), when known */
  ext?: string;
  tags: string[];
  description?: string;
  /** Pixel art: scale with `image-rendering: pixelated` */
  isPixel: boolean;
  /** Creator has passed away (memorial badge) */
  inMemoriam?: boolean;
  /** Community upload id (for the report button) */
  uploadId?: string;
  /** Bytes, when known */
  bytes?: number;
  /** ms since epoch, when known */
  at?: number;
  /** A finished piece (not a part / layer): shown before the rest of its source */
  featured?: boolean;
}

export const TYPE_LABEL: Record<AssetType, string> = {
  image: 'IMAGE',
  gif: 'GIF',
  svg: 'SVG',
  pixel: 'PIXEL',
  video: 'VIDEO',
  audio: 'AUDIO',
  '3d': '3D',
  other: 'FILE',
};

export const SOURCE_LABEL: Record<AssetSource, string> = {
  archive: 'ARCHIVE',
  'cc0-lib': 'CC0-LIB',
  upload: 'UPLOADED',
};

/** "Foo.vxm.png" → "png"; ignores query strings. */
export function extOf(url: string): string | undefined {
  const path = url.split(/[#?]/)[0] ?? '';
  const m = /\.([\da-z]{2,5})$/i.exec(path);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** Media bucket from a file extension (restored `inferMedia`, plus gif). */
export function typeFromExt(ext?: string): AssetType {
  if (ext === undefined) return 'other';
  if (ext === 'gif') return 'gif';
  if (['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (['glb', 'gltf', 'fbx', 'obj', 'stl', 'vox', 'vxm'].includes(ext)) return '3d';
  return 'other';
}

const SHOWABLE: ReadonlySet<AssetType> = new Set(['image', 'gif', 'svg', 'pixel']);

const uniq = (xs: string[]) => xs.filter((t, i) => t !== '' && xs.indexOf(t) === i);

// ── cc0-archive (curated creators) ──────────────────────────────────

function archiveType(media: ArchiveMediaType, ext?: string): AssetType {
  switch (media) {
    case 'gif':
      return 'gif';
    case 'image':
      return ext === 'gif' ? 'gif' : ext === 'svg' ? 'svg' : 'image';
    case 'other':
      return typeFromExt(ext);
    default:
      return media;
  }
}

/** "1block (2).vxm.png" → "1block (2)" */
export function cleanArchiveTitle(t: string): string {
  const s = t.replace(/(\.(vxm|vxr|vox|png|gif|jpe?g|webp|svg|obj|gltf|glb|stl))+$/i, '').trim();
  return s === '' ? t : s;
}

/** The repo folders an asset sits in, as search tags ("HEAD/NOUNS/Sushi/x.png" → head, nouns, sushi). */
function folderTags(description?: string): string[] {
  const path = description?.split(' · ')[1];
  if (path === undefined) return [];
  return path
    .split('/')
    .slice(0, -1)
    .map(s =>
      s
        .toLowerCase()
        .replace(/[^\da-z]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(s => s.length > 1);
}

/**
 * NOUNDRY folders hold a finished render (`Name.vxr.png`, or a file named
 * after its folder) next to the voxel parts it was built from. The finished
 * ones lead the grid; the parts are still all there.
 */
export function isFinishedPiece(a: Pick<ArchiveAsset, 'title' | 'description'>): boolean {
  if (/\.vxr\.png$/i.test(a.title)) return true;
  const folders = a.description?.split(' · ')[1]?.split('/') ?? [];
  const folder = folders[folders.length - 2]?.replace(/^-+|-+$/g, '').toLowerCase();
  return folder !== undefined && cleanArchiveTitle(a.title).toLowerCase() === folder;
}

export function archiveToAsset(a: ArchiveAsset, creator?: ArchiveCreator): Cc0Asset {
  const ext = extOf(a.mediaUrl);
  const type = archiveType(a.mediaType, ext);
  const ts = Date.parse(a.createdAt ?? a.ingestedAt);
  const size = a.meta?.size;
  return {
    id: `archive-${a.id}`,
    title: cleanArchiveTitle(a.title),
    creator: creator?.name ?? a.creatorId,
    creatorId: a.creatorId,
    source: 'archive',
    type,
    thumb: SHOWABLE.has(type) ? a.mediaUrl : undefined,
    fileUrl: a.mirrorUrl ?? a.mediaUrl,
    sourceUrl: a.sourceUrl,
    sourceLabel: hostLabel(a.sourceUrl) ?? a.source,
    ext,
    tags: uniq([...a.tags.map(t => t.toLowerCase()), ...folderTags(a.description)]),
    description: a.description,
    // NOUNDRY's voxel renders are small, hard-edged images: keep them crisp
    isPixel: a.mediaType === 'pixel' || /\.vx[mr]\.png$/i.test(a.mediaUrl),
    ...(creator?.inMemoriam === true ? { inMemoriam: true } : {}),
    ...(typeof size === 'number' ? { bytes: size } : {}),
    ...(Number.isFinite(ts) ? { at: ts } : {}),
    ...(SHOWABLE.has(type) && isFinishedPiece(a) ? { featured: true } : {}),
  };
}

/** Every creator's assets, finished pieces first (otherwise in file order). */
export function archiveAssets(manifests: ArchiveManifest[]): Cc0Asset[] {
  const all = manifests.flatMap(m => m.assets.map(a => archiveToAsset(a, m.creator)));
  return [...all.filter(a => a.featured === true), ...all.filter(a => a.featured !== true)];
}

// ── cc0-lib.wtf public API ──────────────────────────────────────────

/** One item as cc0-lib.wtf's /api/data returns it. */
export interface CC0LibItem {
  ID?: string;
  Title?: string;
  Description?: string;
  File?: string;
  Filetype?: string;
  Type?: string;
  Tags?: string[];
  Source?: string;
  ENS?: string;
  'Social Link'?: string;
  Thumbnails?: { name: string; url: string; rawUrl?: string }[];
}

export const CC0_LIB_API = 'https://cc0-lib.wtf/api/data';
/** cc0-lib's API needs a parameter (no list-all), so probe a curated set of tags. */
export const CC0_LIB_TAGS = ['design', 'art', 'logo', 'icon', 'brand', 'meme', '3d', 'ui'];

const httpsOnly = (u?: string) => (u !== undefined && /^https:\/\//i.test(u) ? u : undefined);

export function hostLabel(url?: string): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function cc0LibToAsset(it: CC0LibItem): Cc0Asset | null {
  const file = httpsOnly(it.File);
  const thumb = httpsOnly(it.Thumbnails?.[0]?.url) ?? file;
  if (file === undefined && thumb === undefined) return null;
  const ext = (it.Filetype ?? '').toLowerCase() || extOf(file ?? '');
  const tagList = (it.Tags ?? []).filter((t): t is string => typeof t === 'string');
  const lower = tagList.map(t => t.toLowerCase());
  // cc0-lib is mixed media: only pixelate what self-tags as pixel art
  const isPixel =
    lower.includes('pixel') ||
    lower.includes('pixel-art') ||
    lower.includes('pixelart') ||
    (it.Type ?? '').toLowerCase() === 'pixel';
  const type = typeFromExt(ext);
  const src = httpsOnly(it.Source) ?? file ?? 'https://cc0-lib.wtf';
  const who = it.ENS?.trim();
  const key = it.ID ?? it.Title ?? file ?? thumb!;
  return {
    id: `cc0-${key}`,
    title: it.Title?.trim() || 'Untitled',
    creator: who !== undefined && who !== '' ? who : 'cc0-lib',
    creatorId: who !== undefined && who !== '' ? `ens:${who.toLowerCase()}` : 'cc0-lib',
    source: 'cc0-lib',
    type,
    thumb: SHOWABLE.has(type) || it.Thumbnails?.[0] !== undefined ? thumb : undefined,
    fileUrl: file ?? thumb!,
    sourceUrl: src,
    sourceLabel: 'cc0-lib.wtf',
    ext: ext === '' ? undefined : ext,
    tags: uniq(['cc0', ...lower, (it.Type ?? '').toLowerCase()]),
    description: it.Description,
    isPixel,
  };
}

/** Every item from a batch of cc0-lib responses, deduped by id. */
export function cc0LibAssets(responses: unknown[]): Cc0Asset[] {
  const out: Cc0Asset[] = [];
  const seen = new Set<string>();
  for (const r of responses) {
    const data = (r as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) continue;
    for (const raw of data) {
      if (typeof raw !== 'object' || raw === null) continue;
      const a = cc0LibToAsset(raw as CC0LibItem);
      if (a === null || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

// ── Community uploads ───────────────────────────────────────────────

export function uploadToAsset(u: Cc0Upload): Cc0Asset {
  const type: AssetType =
    u.kind === 'audio'
      ? 'audio'
      : u.kind === '3d'
        ? '3d'
        : u.ext === 'gif'
          ? 'gif'
          : u.ext === 'svg'
            ? 'svg'
            : 'image';
  const url = fileUrl(u.id);
  return {
    id: `upload-${u.id}`,
    title: u.title,
    creator: u.creator,
    creatorId: `upload:${u.creator.toLowerCase().replace(/^@/, '')}`,
    source: 'upload',
    type,
    thumb: type === 'audio' || type === '3d' ? undefined : url,
    fileUrl: url,
    sourceUrl: u.link,
    sourceLabel: u.link !== undefined ? (hostLabel(u.link) ?? 'link') : 'noun.wtf',
    ext: u.ext,
    tags: uniq(['cc0', 'uploaded', ...u.tags]),
    isPixel: false,
    uploadId: u.id,
    bytes: u.bytes,
    at: u.at,
  };
}

// ── Merge / filter ──────────────────────────────────────────────────

/** Uploads first (newest first), then cc0-lib, then the archive. First id wins. */
export function mergeAssets(sources: {
  uploads?: Cc0Asset[];
  cc0Lib?: Cc0Asset[];
  archive?: Cc0Asset[];
}): Cc0Asset[] {
  const out: Cc0Asset[] = [];
  const seen = new Set<string>();
  const ups = [...(sources.uploads ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  for (const a of [...ups, ...(sources.cc0Lib ?? []), ...(sources.archive ?? [])]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export interface Filters {
  q: string;
  /** 'all' or a type; 'image' also matches gif / svg / pixel */
  type: 'all' | AssetType;
  source: 'all' | AssetSource;
  /** 'all' or a creatorId */
  creator: string;
}

export const NO_FILTERS: Filters = { q: '', type: 'all', source: 'all', creator: 'all' };

function typeMatches(want: Filters['type'], t: AssetType): boolean {
  if (want === 'all' || want === t) return true;
  return want === 'image' && (t === 'gif' || t === 'svg' || t === 'pixel');
}

/** Search (every word must hit title / creator / tags / ext / description) plus the filters. */
export function filterAssets(assets: Cc0Asset[], f: Filters): Cc0Asset[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter(a => {
    if (!typeMatches(f.type, a.type)) return false;
    if (f.source !== 'all' && a.source !== f.source) return false;
    if (f.creator !== 'all' && a.creatorId !== f.creator) return false;
    if (words.length === 0) return true;
    const hay =
      `${a.title} ${a.creator} ${a.tags.join(' ')} ${a.ext ?? ''} ${a.type} ${a.description ?? ''}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

export interface Facet<T extends string> {
  value: T;
  label: string;
  count: number;
}

/** Creator options (most assets first) for the creator filter. */
export function creatorFacets(assets: Cc0Asset[]): Facet<string>[] {
  const by = new Map<string, Facet<string>>();
  for (const a of assets) {
    const f = by.get(a.creatorId);
    if (f) f.count++;
    else by.set(a.creatorId, { value: a.creatorId, label: a.creator, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Type chips with counts (image counts gif / svg / pixel too); empty types dropped. */
export function typeFacets(assets: Cc0Asset[]): Facet<AssetType>[] {
  const order: AssetType[] = ['image', 'gif', 'svg', 'pixel', 'audio', '3d', 'video', 'other'];
  return order
    .map(t => ({
      value: t,
      label: TYPE_LABEL[t],
      count: assets.filter(a => typeMatches(t, a.type)).length,
    }))
    .filter(f => f.count > 0);
}

export function formatBytes(n?: number): string | undefined {
  if (n === undefined) return undefined;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

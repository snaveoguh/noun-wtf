/**
 * CC0 archive types.
 *
 * The archive is a curated, version-controlled collection of CC0 work from
 * specific noun-adjacent creators. Lives as JSON under
 * `packages/nouns-assets/cc0-archive/` and is consumed by the webapp's
 * Catalogue shell as a `cc0-archive` collection.
 *
 * Stored in git rather than a runtime DB because:
 *   - the data is essentially read-only artifact metadata
 *   - matches the existing pattern (cc0-lib.wtf serves JSON, Noundry serves
 *     a CDN'd manifest)
 *   - CC0-aligned: anyone can fork the repo and have the archive
 *   - no infra cost; Netlify CDN-caches it
 *   - Ponder's schema is recreated per-deploy, so this kind of curated
 *     long-lived data doesn't belong there
 */

export type ArchiveMediaType =
  | 'image'
  | 'gif'
  | 'video'
  | 'svg'
  | '3d'
  | 'audio'
  | 'pixel'
  | 'other';

export type ArchiveLicense = 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'unknown';

export type ArchiveSource = 'farcaster' | 'zora' | 'noundry' | 'twitter' | 'web' | 'manual';

export interface ArchiveCreator {
  /** URL-safe slug used as filename + asset-id prefix. */
  id: string;
  /** Display name. */
  name: string;
  /** Short bio shown on creator detail. */
  bio: string;
  /** Avatar/portrait image URL. */
  avatar?: string;
  /** Set when the creator has passed away — surfaces a memorial badge. */
  inMemoriam?: boolean;
  /** Free-form additional notes (drove decision rationale, era, etc.). */
  notes?: string;
  links: {
    farcaster?: { fid: number; handle: string };
    zora?: { address: `0x${string}`; profileUrl?: string };
    twitter?: { handle: string };
    warpcast?: string;
    website?: string;
    github?: string;
  };
}

export interface ArchiveAsset {
  /** Globally unique. Convention: `{creatorId}-{slug-or-source-id}`. */
  id: string;
  creatorId: string;
  title: string;
  description?: string;
  source: ArchiveSource;
  /** Canonical link to where this asset lives on the source platform. */
  sourceUrl: string;
  /** Direct media URL the renderer loads (gif/png/mp4/etc). */
  mediaUrl: string;
  /** Optional self-hosted mirror URL — populated when origin links rot. */
  mirrorUrl?: string;
  mediaType: ArchiveMediaType;
  mimeType?: string;
  width?: number;
  height?: number;
  tags: string[];
  license: ArchiveLicense;
  /** ISO timestamp of when this entry was added to the archive. */
  ingestedAt: string;
  /** ISO timestamp of original creation if known (cast date, mint date, etc). */
  createdAt?: string;
}

export interface ArchiveManifest {
  creator: ArchiveCreator;
  assets: ArchiveAsset[];
}

export interface ArchiveIndex {
  /** Schema version — bump when shape changes break older readers. */
  version: 1;
  /** Last time any creator file changed (ISO). */
  updatedAt: string;
  creators: Array<{
    id: string;
    name: string;
    file: string;
    assetCount: number;
    inMemoriam?: boolean;
  }>;
}

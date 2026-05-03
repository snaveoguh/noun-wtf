/**
 * AssetDetailModal — popover for a single Catalogue asset.
 *
 * Built on top of <GlassModal> from the Liquid Sand glass primitives
 * (handles ESC + scrim-click dismissal natively). Renders:
 *  - Large preview (preserves pixelated rendering for pixel art)
 *  - Title, collection, media type, source label
 *  - "Download" — fetches the asset and triggers a save with a derived
 *    filename. Falls back to opening the source in a new tab on CORS / fetch
 *    failure.
 *  - "Copy URL" — copies the canonical source URL (or the image URL for
 *    data: assets) to the clipboard.
 *  - "View source →" — external link to the canonical home of the asset.
 *  - "×" close button (top-right).
 *
 * Per the shell lockdown, internal noun.wtf URLs are inert externally,
 * but they still make sense as a clickable label, so we let the browser
 * follow them in a new tab the same way `CatalogueHome` does for `.href`.
 */
import { useEffect, useState, type ReactElement } from 'react';

import { GlassButton, GlassModal } from '@/liquid-sand/glass';

import type { CatalogueAsset } from './useCatalogueAssets';

interface Props {
  asset: CatalogueAsset | null;
  onClose: () => void;
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Image',
  pixel: 'Pixel art',
  svg: 'SVG',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D',
  other: 'Other',
};

const COLLECTION_LABEL: Record<string, string> = {
  'nouns-trait': 'Nouns Traits',
  'lil-trait': 'Lil Nouns Traits',
  'lil-noun': 'Lil Nouns',
  'past-noun': 'Past Nouns',
  sketch: 'Sketches',
  'probe-trait': 'Custom Traits',
  'cc0-lib': 'cc0-lib.wtf',
  auction: 'Live Auction',
  propdate: 'Propdates',
  dream: 'Dreams',
  'nouns-world': 'Nouns World',
};

/** Normalise a free-form title to a safe, lower-case-kebab filename slug. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'asset';
}

/** Best-effort filetype guess from a URL (or the data: prefix). */
function inferExt(url: string, fallback: string): string {
  if (url.startsWith('data:image/svg')) return 'svg';
  if (url.startsWith('data:image/png')) return 'png';
  if (url.startsWith('data:image/jpeg')) return 'jpg';
  if (url.startsWith('data:image/gif')) return 'gif';
  if (url.startsWith('data:image/webp')) return 'webp';
  if (url.startsWith('data:')) return fallback;
  // Strip query / hash, take last extension after final dot
  const clean = url.split(/[?#]/, 1)[0];
  const m = clean.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : fallback;
}

function downloadAsBlob(url: string, filename: string): Promise<void> {
  // For data: URLs we can synthesise a download without going through fetch.
  if (url.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return Promise.resolve();
  }
  return fetch(url, { mode: 'cors' })
    .then(r => {
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      return r.blob();
    })
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    });
}

export default function AssetDetailModal({ asset, onClose }: Props): ReactElement | null {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [downloadState, setDownloadState] =
    useState<'idle' | 'pending' | 'done' | 'error'>('idle');

  // Reset transient state when switching assets.
  useEffect(() => {
    setCopyState('idle');
    setDownloadState('idle');
  }, [asset?.id]);

  if (!asset) return null;

  const downloadUrl = asset.fileUrl ?? asset.image;
  const sourceUrl = asset.sourceUrl ?? asset.href;
  const sourceLabel = asset.sourceLabel ?? new URL(sourceUrl, window.location.href).hostname;
  const mediaLabel = MEDIA_LABEL[asset.media] ?? asset.media;
  const collectionLabel = COLLECTION_LABEL[asset.collection] ?? asset.collection;
  const extGuess = inferExt(downloadUrl, asset.media === 'pixel' || asset.media === 'svg' ? 'svg' : 'png');
  const filename = `${slugify(asset.collection)}-${slugify(asset.title)}.${extGuess}`;

  const handleDownload = async () => {
    setDownloadState('pending');
    try {
      await downloadAsBlob(downloadUrl, filename);
      setDownloadState('done');
      window.setTimeout(() => setDownloadState('idle'), 1800);
    } catch {
      // CORS or network failure — fall back to opening the source in a new
      // tab so the user can save manually.
      setDownloadState('error');
      try {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      } catch {
        /* popup blocker — surface the error state */
      }
      window.setTimeout(() => setDownloadState('idle'), 2400);
    }
  };

  const handleCopy = async () => {
    const toCopy = sourceUrl || downloadUrl;
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState('idle'), 1600);
  };

  const handleViewSource = () => {
    if (/^https?:/i.test(sourceUrl)) {
      window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <GlassModal
      open
      onScrimClick={onClose}
      closeOnEscape
      size="lg"
      style={{ position: 'relative', padding: 0, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 10,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(0, 0, 0, 0.4)',
          color: '#f5f5f5',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      >
        ×
      </button>

      {/* Preview */}
      <div
        style={{
          background: asset.bgColor ?? '#27272a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          minHeight: 240,
          maxHeight: 480,
          flexShrink: 0,
        }}
      >
        <img
          src={asset.image}
          alt={asset.title}
          style={{
            maxWidth: '100%',
            maxHeight: 432,
            objectFit: 'contain',
            display: 'block',
            imageRendering: asset.isPixel || asset.media === 'pixel' ? 'pixelated' : undefined,
          }}
          onError={e => {
            (e.currentTarget as HTMLImageElement).style.opacity = '0.25';
          }}
        />
      </div>

      {/* Body */}
      <div
        style={{
          padding: '16px 20px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflowY: 'auto',
          minHeight: 0,
          color: 'var(--ls-fg-primary)',
          fontFamily: 'var(--ls-font-sans)',
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'var(--ls-font-display)',
              fontSize: 'var(--ls-text-xl)',
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.2,
              wordBreak: 'break-word',
            }}
          >
            {asset.title}
          </h2>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--ls-text-sm)',
              color: 'var(--ls-fg-secondary)',
            }}
          >
            {asset.subtitle}
          </p>
        </div>

        {/* Metadata list */}
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: '110px 1fr',
            rowGap: 6,
            columnGap: 12,
            fontSize: 'var(--ls-text-sm)',
          }}
        >
          <MetaRow label="Collection" value={collectionLabel} />
          <MetaRow label="Category" value={asset.category} />
          <MetaRow label="Media" value={mediaLabel} />
          <MetaRow
            label="Source"
            value={
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--ls-accent, #ff7a00)',
                  textDecoration: 'underline',
                  wordBreak: 'break-all',
                }}
              >
                {sourceLabel}
              </a>
            }
          />
          {asset.timestamp ? (
            <MetaRow
              label="Added"
              value={new Date(asset.timestamp).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            />
          ) : null}
        </dl>

        {/* Action row */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 4,
          }}
        >
          <GlassButton
            variant="primary"
            size="md"
            onClick={handleDownload}
            disabled={downloadState === 'pending'}
          >
            {downloadState === 'pending'
              ? 'Downloading…'
              : downloadState === 'done'
                ? 'Saved ✓'
                : downloadState === 'error'
                  ? 'Opened in tab ↗'
                  : 'Download'}
          </GlassButton>
          <GlassButton variant="default" size="md" onClick={handleCopy}>
            {copyState === 'copied'
              ? 'Copied ✓'
              : copyState === 'error'
                ? 'Copy failed'
                : 'Copy URL'}
          </GlassButton>
          <GlassButton variant="ghost" size="md" onClick={handleViewSource}>
            View source →
          </GlassButton>
        </div>
      </div>
    </GlassModal>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }): ReactElement {
  return (
    <>
      <dt
        style={{
          fontSize: 'var(--ls-text-xs)',
          color: 'var(--ls-fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 600,
          alignSelf: 'baseline',
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: 'var(--ls-text-sm)',
          color: 'var(--ls-fg-primary)',
          fontFamily: 'var(--ls-font-mono)',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </dd>
    </>
  );
}

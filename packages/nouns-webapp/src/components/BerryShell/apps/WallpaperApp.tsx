/**
 * BerryOS — Desktop & Screensaver app.
 *
 * Self-registers with `berryRegistry` at module-import time (matches the
 * convention used by CalculatorApp / ConsoleApp / etc.).
 *
 * UI: a responsive grid of available wallpapers. Click to apply — preview
 * updates live via `wallpaperStore`. Whatever desktop background subscribes
 * to `useCurrentWallpaper()` (or listens for `system:wallpaperChanged`)
 * picks up the new value immediately.
 *
 * HIG / Liquid Sand notes:
 *   - 8pt grid throughout (16pt content padding, 8pt thumb gap per brief).
 *   - Thumbnails are 10pt radius (`--ls-r-md`).
 *   - Active wallpaper gets a sand accent ring via `--ls-accent` outline,
 *     plus a glass checkmark badge.
 *   - Tile button itself is bare (transparent) so the only "glass" surface
 *     in the grid is the thumbnail — no nested glass.
 */

import { useEffect, type CSSProperties } from 'react';

import { GlassChip, GlassPanel, GlassToolbar } from '@/liquid-sand/glass';
import { Sparkle } from '@/liquid-sand/icons';

import { berryRegistry } from '../system/berryRegistry';
import {
  useCurrentWallpaperId,
  useWallpaperList,
  wallpaperStore,
  type WallpaperDef,
} from '../system/wallpaper';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WallpaperApp() {
  const list = useWallpaperList();
  const currentId = useCurrentWallpaperId();
  const current = list.find(w => w.id === currentId);

  // No-op effect — kept so future intent (e.g. analytics hook) has a clear
  // place to land. Removing it doesn't change behavior today.
  useEffect(() => undefined, []);

  return (
    // HIG 8pt grid: 16pt content padding, 16pt gap between sections
    <div
      className="flex flex-col h-full box-border"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
        padding: 16,
        gap: 16,
      }}
    >
      {/* Header — title + subtitle, no glass over the heading text. */}
      <div className="flex items-start" style={{ gap: 12 }}>
        <div className="flex-1 min-w-0">
          <div
            style={{
              fontFamily: 'var(--ls-font-sans)',
              fontSize: 'var(--ls-text-xl)',
              fontWeight: 700,
              lineHeight: 1.2,
              color: 'var(--ls-fg-primary)',
            }}
          >
            Desktop &amp; Screensaver
          </div>
          <div
            style={{
              fontSize: 'var(--ls-text-sm)',
              lineHeight: 1.4,
              color: 'var(--ls-fg-muted)',
              marginTop: 4,
            }}
          >
            Pick a wallpaper. The desktop updates live.
          </div>
        </div>
        {current && (
          <GlassToolbar size="sm" align="end" aria-label="Wallpaper status">
            <GlassChip tone="accent" size="sm">
              {current.name}
            </GlassChip>
          </GlassToolbar>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label="Wallpapers"
        className="grid overflow-y-auto pr-1 flex-1"
        style={{
          // 140pt min thumbnail keeps the touch target healthy on wide layouts;
          // 8pt gap between thumbs per app brief.
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {list.map(w => (
          <WallpaperTile
            key={w.id}
            wallpaper={w}
            selected={w.id === currentId}
            onSelect={() => wallpaperStore.setWallpaper(w.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface TileProps {
  wallpaper: WallpaperDef;
  selected: boolean;
  onSelect: () => void;
}

function WallpaperTile({ wallpaper, selected, onSelect }: TileProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={tileStyle(selected)}
      title={wallpaper.name}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <GlassPanel
        as="div"
        radius="md"
        tone="auto"
        padded={false}
        bordered
        style={{
          width: '100%',
          paddingTop: '60%',
          background: wallpaper.thumb ?? wallpaper.src,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}
      >
        {selected && (
          <div
            className="absolute inline-flex items-center justify-center"
            style={{
              top: 6,
              right: 6,
              width: 22,
              height: 22,
              borderRadius: 'var(--ls-r-full)',
              background: 'var(--ls-accent)',
              color: 'var(--ls-fg-on-dark)',
              boxShadow: 'var(--ls-shadow-glow), 0 0 0 1px var(--ls-border-glass)',
            }}
            aria-hidden
          >
            <Sparkle size={12} />
          </div>
        )}
      </GlassPanel>
      <div
        style={{
          marginTop: 8,
          // HIG caption 13pt — readable label without competing with the thumb.
          fontSize: 'var(--ls-text-sm)',
          lineHeight: 1.4,
          fontWeight: 600,
          textAlign: 'center',
          color: selected ? 'var(--ls-accent)' : 'var(--ls-fg-secondary)',
        }}
      >
        {wallpaper.name}
      </div>
    </button>
  );
}

function tileStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    padding: 8,
    background: 'transparent',
    border: 'none',
    // 10pt radius per app brief — `--ls-r-md` is 10px in tokens.css.
    borderRadius: 'var(--ls-r-md)',
    cursor: 'pointer',
    // Sand accent ring per brief — uses `--ls-accent` outline with offset so
    // it floats off the thumbnail edge.
    outline: selected ? '2px solid var(--ls-accent)' : '2px solid transparent',
    outlineOffset: 2,
    boxShadow: selected ? 'var(--ls-shadow-glow)' : 'none',
    // HIG: 44pt min touch target for tile click
    minHeight: 44,
    transition:
      'transform var(--ls-dur-base) var(--ls-ease-spring), outline-color var(--ls-dur-base) var(--ls-ease-soft), box-shadow var(--ls-dur-base) var(--ls-ease-soft)',
  };
}

// ---------------------------------------------------------------------------
// Self-registration — runs once on first import.
// ---------------------------------------------------------------------------

berryRegistry.register({
  id: 'wallpaper',
  name: 'Desktop & Screensaver',
  icon: '🖼️',
  component: WallpaperApp,
  defaultWindow: { w: 560, h: 380 },
  capabilities: ['system:lifecycle'],
});

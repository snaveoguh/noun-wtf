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
 */

import { useEffect, type CSSProperties } from 'react';

import { GlassPanel } from '@/liquid-sand/glass';
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
      <div>
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
      <div
        role="radiogroup"
        aria-label="Wallpapers"
        className="grid overflow-y-auto pr-1 flex-1"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 16,
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
            className="absolute top-1 right-1 inline-flex items-center justify-center"
            style={{
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
    borderRadius: 'var(--ls-r-md)',
    cursor: 'pointer',
    outline: selected ? '2px solid var(--ls-accent)' : 'none',
    outlineOffset: 2,
    // HIG: 44pt min touch target for tile click
    minHeight: 44,
    transition:
      'transform var(--ls-dur-base) var(--ls-ease-spring), outline-color var(--ls-dur-base) var(--ls-ease-soft)',
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

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
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        height: '100%',
        boxSizing: 'border-box',
        fontFamily: 'var(--theme-font-display, system-ui)',
        color: 'var(--theme-text-primary, #111)',
        background: 'var(--theme-bg-card, #f4f4f4)',
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
          Desktop &amp; Screensaver
        </div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          Pick a wallpaper. The desktop updates live.
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label="Wallpapers"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 10,
          overflowY: 'auto',
          paddingRight: 4,
          flex: 1,
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
      <div
        aria-hidden
        style={{
          width: '100%',
          paddingTop: '60%',
          background: wallpaper.thumb ?? wallpaper.src,
          borderRadius: 6,
          border: '1px solid rgba(0, 0, 0, 0.18)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.25)',
        }}
      />
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
          color: 'inherit',
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
    padding: 6,
    background: selected ? 'var(--theme-accent, #2d7ad8)' : 'transparent',
    color: selected ? '#fff' : 'inherit',
    border: selected
      ? '1px solid var(--theme-accent, #2d7ad8)'
      : '1px solid transparent',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'background 120ms ease, border-color 120ms ease, transform 120ms ease',
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

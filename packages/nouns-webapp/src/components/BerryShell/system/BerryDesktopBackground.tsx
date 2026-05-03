/**
 * BerryDesktopBackground — full-viewport painted layer that reflects the
 * currently-selected wallpaper.
 *
 * BerryShell's existing implementation paints its own aqua gradient on the
 * outer wrapper. This component sits as a fixed-position layer behind it so
 * non-aqua wallpapers (Strawberry, Sunset, Space) can show through when the
 * shell's own background is overridden — and so the lock-screen blur layer
 * has something deterministic to read from.
 *
 * The shell wrapper currently has its own opaque gradient, so to keep the
 * wallpaper visible we set `data-berry-wallpaper` on `<html>`. CSS in
 * `LifecycleMount` (and any consumer) can use:
 *
 *   html[data-berry-wallpaper] body { background: transparent !important; }
 *
 * If the shell author wants to honour the wallpaper directly, they can read
 * `useCurrentWallpaper()` and apply it themselves — this component remains
 * authoritative for the persisted choice.
 *
 * Even without those overrides this component is useful: the lock screen
 * reads the same `useCurrentWallpaper()` hook, so picking a wallpaper
 * immediately changes the lock-screen background without touching anything
 * shell-side.
 */

import { useEffect } from 'react';

import { useCurrentWallpaper } from './wallpaper';

export default function BerryDesktopBackground() {
  const wallpaper = useCurrentWallpaper();

  // Mirror the current wallpaper to a CSS custom property on <html> so any
  // theme CSS that wants to opt in can read `var(--berry-wallpaper)`.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--berry-wallpaper', wallpaper.src);
    document.documentElement.setAttribute('data-berry-wallpaper', wallpaper.id);
    return () => {
      // Don't remove on unmount — the wallpaper should persist across
      // BootSequence remounts and theme swaps.
    };
  }, [wallpaper.src, wallpaper.id]);

  return (
    <div
      aria-hidden
      data-berry-desktop-bg
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: wallpaper.src,
        pointerEvents: 'none',
        // Animate gradient changes smoothly — 320ms feels live without dragging.
        transition: 'background 320ms ease',
      }}
    />
  );
}

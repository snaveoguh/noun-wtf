/**
 * BerryDesktopBackground — Liquid Sand sand-tone gradient under the shell.
 *
 * Default: a soft warm gradient running from `--ls-sand-50` at top to
 * `--ls-sand-200` at bottom — readable cream-to-sepia field that gives
 * frost-glass surfaces something warm to bend behind. Wallpaper switching
 * still works via the wallpaper.ts module — picking anything other than the
 * default (id `aqua`) overrides this paint with the wallpaper CSS string.
 *
 * The lock screen also reads `useCurrentWallpaper()`, so picking a wallpaper
 * immediately changes the lock-screen background.
 */

import { useEffect } from 'react';

import { useCurrentWallpaper } from './wallpaper';

const SAND_GRADIENT =
  'linear-gradient(180deg, var(--ls-sand-50) 0%, var(--ls-sand-100) 45%, var(--ls-sand-200) 100%)';

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

  // The legacy "aqua" id is the default in the catalogue; in Liquid Sand we
  // re-skin that default to the warm sand gradient. Anything else (Strawberry,
  // Sunset, Space, future user uploads) paints as supplied.
  const background = wallpaper.id === 'aqua' ? SAND_GRADIENT : wallpaper.src;

  return (
    <div
      aria-hidden
      data-berry-desktop-bg
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background,
        pointerEvents: 'none',
        // Animate gradient changes smoothly with the Liquid Sand glide easing.
        transition: 'background var(--ls-dur-slow) var(--ls-ease-glide)',
      }}
    />
  );
}

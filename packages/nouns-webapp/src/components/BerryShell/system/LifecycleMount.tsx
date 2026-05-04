/**
 * LifecycleMount — single drop-in wrapper that wires every BerryOS lifecycle
 * surface to a shell tree.
 *
 * Composes:
 *   - <BootSequence>  — wraps children, paints splash on first mount
 *   - <ShutdownSequence /> — confirm dialog + fade-to-black + theme switch
 *   - <LockScreen />  — auto-lock + manual lock overlay
 *   - <BerryDesktopBackground /> — paints the wallpaper behind windows so the
 *     wallpaper picker is reactive (BerryShell's inline gradient is layered
 *     above this and `background: transparent` would normally block — we
 *     mount with z-index 0 below the shell content but above the document
 *     body, then BerryShell's own gradient renders on top).
 *
 * Side-effect imports register the lifecycle apps (currently just Wallpaper)
 * with `berryRegistry` so they appear in the launcher / Spotlight.
 *
 * Usage from BerryShell (`packages/nouns-webapp/src/components/BerryShell/index.tsx`):
 *
 *   import LifecycleMount from './system/LifecycleMount';
 *   ...
 *   return (
 *     <LifecycleMount>
 *       <div style={{ position: 'relative', minHeight: '100vh', ... }}>
 *         ...existing BerryShell tree...
 *       </div>
 *     </LifecycleMount>
 *   );
 *
 * That's the only edit BerryShell needs.
 */

import type { ReactNode } from 'react';

import BootSequence from './BootSequence';
import LockScreen from './LockScreen';
import ShutdownSequence from './ShutdownSequence';
// Side-effect import — registers WallpaperApp on the registry.
import './lifecycleApps';
import BerryDesktopBackground from './BerryDesktopBackground';

interface LifecycleMountProps {
  children: ReactNode;
  /** Force-skip the boot splash (tests / embedded contexts). */
  skipBoot?: boolean;
}

export default function LifecycleMount({ children, skipBoot }: LifecycleMountProps) {
  return (
    <BootSequence skip={skipBoot}>
      {/* The wallpaper background sits behind everything else but inside the
          BootSequence wrapper so the boot splash still occludes it. */}
      <BerryDesktopBackground />
      {children}
      {/* Lifecycle overlays sit above all windows; ShutdownSequence ramps to
          the highest z because it's the most disruptive. */}
      <LockScreen />
      <ShutdownSequence />
    </BootSequence>
  );
}

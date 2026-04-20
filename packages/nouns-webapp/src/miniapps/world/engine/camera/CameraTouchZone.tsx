// ── CameraTouchZone — Mobile Camera Orbit ────────────────────────────
//
// Invisible DOM overlay covering the middle-right vertical strip
// (x: 40%–75% of viewport). Touch drag inside this strip mutates
// `inputRef.current.cameraAngle` so the player can orbit the rig on
// mobile without a physical mouse or right stick.
//
// Renders OUTSIDE the Canvas (it's a DOM element). Mount it anywhere
// in the page tree above the crosshair/HUD.
//
// The strip intentionally avoids the left 40% (virtual joystick lives
// there, per MobileControls) and the right 25% (action-button cluster).

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import type { InputState } from '../input';
import { TOUCH_ORBIT_SENSITIVITY, TOUCH_ZONE_X_END, TOUCH_ZONE_X_START } from './rigConfig';

/**
 * True iff the device supports touch. Defined locally so the component
 * doesn't depend on MobileControls import.
 */
function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}

interface CameraTouchZoneProps {
  inputRef: React.RefObject<InputState | null>;
  /** Extra z-index control. Default 15 — above canvas, below modals. */
  zIndex?: number;
  /**
   * Force-render on desktop too. Useful for debugging on a laptop
   * with a touchscreen or when the page is opened via DevTools
   * mobile emulation.
   */
  forceShow?: boolean;
}

export const CameraTouchZone: FC<CameraTouchZoneProps> = ({
  inputRef,
  zIndex = 15,
  forceShow = false,
}) => {
  const activeTouchId = useRef<number | null>(null);
  const lastX = useRef(0);
  const [enabled, setEnabled] = useState(() => forceShow || detectTouch());

  // Re-check on mount — detectTouch reads window, which is only safe
  // after hydration.
  useEffect(() => {
    setEnabled(forceShow || detectTouch());
  }, [forceShow]);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (activeTouchId.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    activeTouchId.current = t.identifier;
    lastX.current = t.clientX;
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (activeTouchId.current === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (!t || t.identifier !== activeTouchId.current) continue;
        const dx = t.clientX - lastX.current;
        lastX.current = t.clientX;
        const input = inputRef.current;
        if (input) {
          // Positive dx (rightward drag) → increase cameraAngle
          // (orbit camera clockwise when viewed from above).
          input.cameraAngle = (input.cameraAngle ?? 0) + dx * TOUCH_ORBIT_SENSITIVITY;
        }
        e.preventDefault();
        break;
      }
    },
    [inputRef],
  );

  const onTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t) continue;
      if (t.identifier === activeTouchId.current) {
        activeTouchId.current = null;
        break;
      }
    }
  }, []);

  if (!enabled) return null;

  const left = `${TOUCH_ZONE_X_START * 100}%`;
  const width = `${(TOUCH_ZONE_X_END - TOUCH_ZONE_X_START) * 100}%`;

  return (
    <div
      data-camera-touch-zone
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{
        position: 'fixed',
        top: 0,
        left,
        width,
        height: '100%',
        zIndex,
        // Transparent — this is an invisible interaction layer.
        background: 'transparent',
        // Disable default touch behaviors (scroll, pinch-zoom) inside strip.
        touchAction: 'none',
        // pointerEvents:auto so touch handlers fire. On touch devices
        // that's fine — there's no mouse. On desktop we short-circuit
        // above (`if (!enabled) return null`) so this only renders when
        // the device is touch-capable.
        pointerEvents: 'auto',
      }}
    />
  );
};

export default CameraTouchZone;

/**
 * useDraggableScroll — adds click-and-drag scrolling to a horizontal scroll container.
 * Works alongside auto-scrolling banners by pausing animation during drag.
 *
 * Usage:
 *   const { onPointerDown } = useDraggableScroll(scrollRef, pausedRef);
 *   <div ref={scrollRef} onPointerDown={onPointerDown} ...>
 */
import { useCallback, useRef } from 'react';

export function useDraggableScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  pausedRef: React.MutableRefObject<boolean>,
) {
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollStart = useRef(0);
  const hasMoved = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current;
      if (!el) return;

      // Ignore non-primary buttons (right-click, middle-click)
      if (e.button !== 0) return;

      isDragging.current = true;
      hasMoved.current = false;
      startX.current = e.clientX;
      scrollStart.current = el.scrollLeft;
      pausedRef.current = true;

      // Don't call setPointerCapture on pointerdown — that redirects the
      // subsequent click event to the scroll container, preventing clicks
      // on children (cards) from ever firing. Only capture once the user
      // has actually started dragging (past the movement threshold).

      // Clear any pending resume
      if (resumeTimer.current) {
        clearTimeout(resumeTimer.current);
        resumeTimer.current = null;
      }

      const pointerId = e.pointerId;
      let captured = false;

      const onPointerMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const dx = ev.clientX - startX.current;
        if (Math.abs(dx) > 8) {
          if (!hasMoved.current) {
            hasMoved.current = true;
            el.style.cursor = 'grabbing';
            // Now that we know this is a drag (not a click), capture the pointer
            try {
              el.setPointerCapture(pointerId);
              captured = true;
            } catch {
              // Pointer may have been released already
            }
          }
          el.scrollLeft = scrollStart.current - dx;
        }
      };

      const onPointerUp = () => {
        isDragging.current = false;
        el.style.cursor = '';
        if (captured) {
          try {
            el.releasePointerCapture(pointerId);
          } catch {
            // Already released
          }
        }

        // Resume auto-scroll after a short delay so it doesn't snap
        resumeTimer.current = setTimeout(() => {
          pausedRef.current = false;
        }, 1500);

        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', onPointerUp);
        el.removeEventListener('pointercancel', onPointerUp);
      };

      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
    },
    [scrollRef, pausedRef],
  );

  // Prevent clicks on children after a drag
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (hasMoved.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return { onPointerDown, onClickCapture };
}

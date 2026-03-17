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

      isDragging.current = true;
      hasMoved.current = false;
      startX.current = e.clientX;
      scrollStart.current = el.scrollLeft;
      pausedRef.current = true;
      el.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);

      // Clear any pending resume
      if (resumeTimer.current) {
        clearTimeout(resumeTimer.current);
        resumeTimer.current = null;
      }

      const onPointerMove = (ev: PointerEvent) => {
        if (!isDragging.current) return;
        const dx = ev.clientX - startX.current;
        if (Math.abs(dx) > 3) hasMoved.current = true;
        el.scrollLeft = scrollStart.current - dx;
      };

      const onPointerUp = () => {
        isDragging.current = false;
        el.style.cursor = '';

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

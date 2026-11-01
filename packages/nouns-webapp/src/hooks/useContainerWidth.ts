import { useCallback, useLayoutEffect, useState } from 'react';

import { atLeast, tierFor, type ContainerTier } from '@/lib/responsive/breakpoints';

/**
 * The width of the nearest page container: the NounOS window a page renders
 * in (`.nos-content[data-container]`), or the full-page shell. Use it instead
 * of `window.innerWidth` / `matchMedia('(max-width…)')` for layout decisions,
 * because a narrow window on a wide screen should get the narrow layout.
 *
 *   const { ref, width, tier, atLeast } = useContainerWidth<HTMLDivElement>();
 *   return <div ref={ref}>{atLeast('md') ? <Wide /> : <Narrow />}</div>;
 *
 * - `ref` goes on any element inside the page; the hook measures the closest
 *   `[data-container]` ancestor (or the element itself if it carries one).
 * - Outside any container it falls back to the viewport (`window.innerWidth`
 *   + resize), which is what pages did before, so nothing changes there.
 * - It re-renders only when the width changes; it is measured before paint
 *   (layout effect), and the first render uses the viewport width.
 * - Pass `{ self: true }` to measure the ref'd element instead of its
 *   container (e.g. a card that lays itself out from its own width).
 */
export function useContainerWidth<T extends HTMLElement = HTMLElement>(
  options: { self?: boolean } = {},
) {
  const { self = false } = options;
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState<number>(() => viewportWidth());

  const ref = useCallback((el: T | null) => setNode(el), []);

  useLayoutEffect(() => {
    const target = node === null ? null : self ? node : findContainer(node);
    if (target === null) {
      const onResize = () => setWidth(viewportWidth());
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const measure = () => setWidth(contentWidth(target));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      const box = entry?.contentBoxSize?.[0];
      setWidth(Math.round(box !== undefined ? box.inlineSize : contentWidth(target)));
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, [node, self]);

  const tier: ContainerTier = tierFor(width);
  return {
    ref,
    width,
    tier,
    /** Mobile-first: true from `t`'s lower edge up (same as the `@t:` variant). */
    atLeast: (t: ContainerTier) => atLeast(width, t),
    /** Below `t`'s lower edge (same as the `@max-t:` variant). */
    below: (t: ContainerTier) => !atLeast(width, t),
  };
}

/** The nearest element that is a page container, including `el` itself. */
export function findContainer(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-container]');
}

/** Content-box width, the box container queries measure. */
function contentWidth(el: HTMLElement): number {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
  return Math.round(Math.max(0, el.clientWidth - pad));
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth;
}

export default useContainerWidth;

import type { CSSProperties, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Which bottom corner of the page it floats in. */
  side?: 'end' | 'start';
  /** Gap from the window's bottom edge, px. */
  offset?: number;
  className?: string;
};

/**
 * A floating action button that stays inside its NounOS window.
 *
 * `position: fixed` puts a button at the *viewport's* corner: outside a
 * window that isn't full screen, and over the window's own controls. This is
 * sticky to the bottom of the page's scroller instead, with no layout height.
 * Render it as the LAST child of an element that spans the whole page (its
 * sticky range is that parent's box). On a page shorter than the window it
 * sits just under the content, not at the window's bottom edge.
 */
export function PageFab({ children, side = 'end', offset = 16, className }: Props) {
  const style: CSSProperties = {
    bottom: offset,
    justifyContent: side === 'end' ? 'flex-end' : 'flex-start',
  };
  return (
    <div
      className="pointer-events-none sticky z-20 flex h-0 overflow-visible px-4"
      style={style}
      data-page-fab=""
    >
      <div className={`pointer-events-auto -translate-y-full ${className ?? ''}`}>{children}</div>
    </div>
  );
}

export default PageFab;

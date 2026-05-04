import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Page with a folded corner — sticky note / stickies. */
export const StickyNote = forwardRef<SVGSVGElement, IconProps>(function StickyNote(
  { size = '1em', ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 4.5h11l4 4v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" />
      <path d="M16 4.5v3a1 1 0 0 0 1 1h3" />
      <path d="M7.5 12.5h9M7.5 16h6" />
    </svg>
  );
});

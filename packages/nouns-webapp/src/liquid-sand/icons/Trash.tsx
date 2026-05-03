import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Trash = forwardRef<SVGSVGElement, IconProps>(function Trash(
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
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="m6 6.5 1 12.5a2 2 0 0 0 2 1.85h6a2 2 0 0 0 2-1.85l1-12.5" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
});

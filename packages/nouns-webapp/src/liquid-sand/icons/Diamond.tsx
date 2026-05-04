import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Faceted diamond — treasury. */
export const Diamond = forwardRef<SVGSVGElement, IconProps>(function Diamond(
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
      <path d="M5.5 9.5h13L12 21Z" />
      <path d="M5.5 9.5 8 4h8l2.5 5.5" />
      <path d="M8 4 12 9.5 16 4" />
      <path d="M5.5 9.5 12 21l6.5-11.5" />
      <path d="M9 9.5 12 21l3-11.5" />
    </svg>
  );
});

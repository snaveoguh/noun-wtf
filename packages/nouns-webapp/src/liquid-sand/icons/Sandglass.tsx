import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Hourglass / sandglass — boot, loading, waiting. */
export const Sandglass = forwardRef<SVGSVGElement, IconProps>(function Sandglass(
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
      <path d="M6.5 3.5h11" />
      <path d="M6.5 20.5h11" />
      <path d="M7 3.5v3.25c0 1.2.5 2.36 1.4 3.15L12 12l3.6-2.1A4.2 4.2 0 0 0 17 6.75V3.5" />
      <path d="M7 20.5v-3.25c0-1.2.5-2.36 1.4-3.15L12 12l3.6 2.1c.9.79 1.4 1.95 1.4 3.15v3.25" />
    </svg>
  );
});

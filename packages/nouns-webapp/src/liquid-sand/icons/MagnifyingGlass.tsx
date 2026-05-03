import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Search / spotlight. */
export const MagnifyingGlass = forwardRef<SVGSVGElement, IconProps>(function MagnifyingGlass(
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
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.5 15.5 4.5 4.5" />
    </svg>
  );
});

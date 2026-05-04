import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Star = forwardRef<SVGSVGElement, IconProps>(function Star(
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
      <path d="m12 3.5 2.7 5.5 6 .85-4.35 4.25 1.05 6L12 17.25 6.6 20.1l1.05-6L3.3 9.85l6-.85Z" />
    </svg>
  );
});

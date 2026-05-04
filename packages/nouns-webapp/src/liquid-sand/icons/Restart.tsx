import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Restart = forwardRef<SVGSVGElement, IconProps>(function Restart(
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
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4.25h-4.25" />
    </svg>
  );
});

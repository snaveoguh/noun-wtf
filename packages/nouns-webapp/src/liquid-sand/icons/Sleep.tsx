import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Sleep = forwardRef<SVGSVGElement, IconProps>(function Sleep(
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
      <path d="M20.5 14.25A8.5 8.5 0 1 1 9.75 3.5a7 7 0 0 0 10.75 10.75Z" />
    </svg>
  );
});

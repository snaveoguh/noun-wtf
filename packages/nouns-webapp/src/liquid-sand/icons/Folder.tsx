import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Folder = forwardRef<SVGSVGElement, IconProps>(function Folder(
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
      <path d="M3 7.25c0-1.1.9-2 2-2h3.5l2 2H19c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7.25Z" />
    </svg>
  );
});

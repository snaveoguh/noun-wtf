import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Lock = forwardRef<SVGSVGElement, IconProps>(function Lock(
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
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.25" />
      <path d="M7.75 10.5V7.25a4.25 4.25 0 0 1 8.5 0v3.25" />
    </svg>
  );
});

import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Wifi = forwardRef<SVGSVGElement, IconProps>(function Wifi(
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
      <path d="M2.5 9.5a14 14 0 0 1 19 0" />
      <path d="M5.75 13a9 9 0 0 1 12.5 0" />
      <path d="M9 16.5a4 4 0 0 1 6 0" />
      <circle cx="12" cy="19.5" r="0.6" />
    </svg>
  );
});

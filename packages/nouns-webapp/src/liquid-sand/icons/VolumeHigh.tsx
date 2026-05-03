import { forwardRef } from 'react';
import type { IconProps } from './types';

export const VolumeHigh = forwardRef<SVGSVGElement, IconProps>(function VolumeHigh(
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
      <path d="M3.5 10v4a1 1 0 0 0 1 1h2.5L11.5 18.5V5.5L7 9H4.5a1 1 0 0 0-1 1Z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M17.75 7a7 7 0 0 1 0 10" />
    </svg>
  );
});

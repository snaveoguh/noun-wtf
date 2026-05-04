import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Wallet = forwardRef<SVGSVGElement, IconProps>(function Wallet(
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
      <path d="M3.5 8.5V17a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2H5.5a2 2 0 0 1 0-4H17" />
      <circle cx="16.75" cy="13.75" r="0.85" />
    </svg>
  );
});

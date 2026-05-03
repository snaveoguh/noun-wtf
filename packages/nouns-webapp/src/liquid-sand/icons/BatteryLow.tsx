import { forwardRef } from 'react';
import type { IconProps } from './types';

export const BatteryLow = forwardRef<SVGSVGElement, IconProps>(function BatteryLow(
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
      <rect x="2.5" y="8" width="17" height="8" rx="1.75" />
      <path d="M21.5 11v2" />
      <path d="M5 10.25v3.5h2v-3.5z" />
    </svg>
  );
});

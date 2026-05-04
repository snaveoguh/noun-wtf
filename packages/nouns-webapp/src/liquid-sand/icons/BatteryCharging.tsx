import { forwardRef } from 'react';
import type { IconProps } from './types';

export const BatteryCharging = forwardRef<SVGSVGElement, IconProps>(function BatteryCharging(
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
      <path d="m11.5 9.75-2.5 3h3l-2.5 2.5" />
    </svg>
  );
});

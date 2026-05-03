import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Maximize = forwardRef<SVGSVGElement, IconProps>(function Maximize(
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
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.25" />
    </svg>
  );
});

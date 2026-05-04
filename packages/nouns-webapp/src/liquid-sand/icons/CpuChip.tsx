import { forwardRef } from 'react';
import type { IconProps } from './types';

/** CPU / chip — services / activity monitor. */
export const CpuChip = forwardRef<SVGSVGElement, IconProps>(function CpuChip(
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
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.75" />
      <path d="M9.5 3.5v2.5M14.5 3.5v2.5M9.5 18v2.5M14.5 18v2.5M3.5 9.5h2.5M3.5 14.5h2.5M18 9.5h2.5M18 14.5h2.5" />
    </svg>
  );
});

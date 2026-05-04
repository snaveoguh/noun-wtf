import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Settings = forwardRef<SVGSVGElement, IconProps>(function Settings(
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
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.75M12 18.75v2.75M4.78 4.78l1.95 1.95M17.27 17.27l1.95 1.95M2.5 12h2.75M18.75 12h2.75M4.78 19.22l1.95-1.95M17.27 6.73l1.95-1.95" />
    </svg>
  );
});

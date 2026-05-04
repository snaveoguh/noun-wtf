import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Up-arrow on a baseline — "boot up". */
export const Boot = forwardRef<SVGSVGElement, IconProps>(function Boot(
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
      <path d="M4.5 19.5h15" />
      <path d="M12 16.5V5" />
      <path d="m6.75 10.25 5.25-5.25 5.25 5.25" />
    </svg>
  );
});

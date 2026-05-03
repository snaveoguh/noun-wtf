import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Terminal / console window. */
export const Console = forwardRef<SVGSVGElement, IconProps>(function Console(
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
      <rect x="3" y="4.5" width="18" height="15" rx="2.25" />
      <path d="m7 10 3 2.5L7 15" />
      <path d="M12.5 15.25H17" />
    </svg>
  );
});

import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Shutdown = forwardRef<SVGSVGElement, IconProps>(function Shutdown(
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v4.75" />
      <path d="M9.25 10a4 4 0 1 0 5.5 0" />
    </svg>
  );
});

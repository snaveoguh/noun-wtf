import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Mail = forwardRef<SVGSVGElement, IconProps>(function Mail(
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
      <rect x="3" y="5.5" width="18" height="13" rx="2.25" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </svg>
  );
});

import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Close = forwardRef<SVGSVGElement, IconProps>(function Close(
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
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
});

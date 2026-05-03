import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Power = forwardRef<SVGSVGElement, IconProps>(function Power(
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
      <path d="M12 3v9" />
      <path d="M7.5 6.2a8 8 0 1 0 9 0" />
    </svg>
  );
});

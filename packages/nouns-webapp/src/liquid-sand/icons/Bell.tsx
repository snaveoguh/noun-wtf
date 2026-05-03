import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Bell = forwardRef<SVGSVGElement, IconProps>(function Bell(
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
      <path d="M5.75 17.25h12.5l-1.5-1.85a2 2 0 0 1-.45-1.26V10a4.3 4.3 0 0 0-8.6 0v4.14c0 .46-.16.9-.45 1.26Z" />
      <path d="M10 20.25a2.25 2.25 0 0 0 4 0" />
    </svg>
  );
});

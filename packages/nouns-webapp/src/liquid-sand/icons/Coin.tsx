import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Coin = forwardRef<SVGSVGElement, IconProps>(function Coin(
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
      <path d="M14.25 9.5h-3a1.75 1.75 0 0 0 0 3.5h1.5a1.75 1.75 0 0 1 0 3.5H9.5" />
      <path d="M12 7.75v1.75M12 14.5v1.75" />
    </svg>
  );
});

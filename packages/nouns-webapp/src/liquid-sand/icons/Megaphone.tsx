import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Megaphone = forwardRef<SVGSVGElement, IconProps>(function Megaphone(
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
      <path d="M3.5 10.5v3a1.5 1.5 0 0 0 1.5 1.5h2.25l9.75 4.5V5L7.25 9.5H5a1.5 1.5 0 0 0-1.5 1.5Z" />
      <path d="M7.25 9.5v6" />
      <path d="M19.5 9.25a3 3 0 0 1 0 5.5" />
    </svg>
  );
});

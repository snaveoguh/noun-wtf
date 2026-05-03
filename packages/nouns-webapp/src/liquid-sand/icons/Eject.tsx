import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Eject = forwardRef<SVGSVGElement, IconProps>(function Eject(
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
      <path d="M5.5 14.5h13L12 5.25Z" />
      <path d="M5.5 18.5h13" />
    </svg>
  );
});

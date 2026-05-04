import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Heart = forwardRef<SVGSVGElement, IconProps>(function Heart(
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
      <path d="M12 20s-7-4.35-7-10a4.5 4.5 0 0 1 7-3.7A4.5 4.5 0 0 1 19 10c0 5.65-7 10-7 10Z" />
    </svg>
  );
});

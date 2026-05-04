import { forwardRef } from 'react';
import type { IconProps } from './types';

export const Calculator = forwardRef<SVGSVGElement, IconProps>(function Calculator(
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
      <rect x="5" y="3" width="14" height="18" rx="2.25" />
      <path d="M8 7h8v3H8z" />
      <path d="M9 14h.01M12 14h.01M15 14h.01M9 17.5h.01M12 17.5h.01M15 17.5h.01" />
    </svg>
  );
});

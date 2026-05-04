import { forwardRef } from 'react';
import type { IconProps } from './types';

export const ChatBubble = forwardRef<SVGSVGElement, IconProps>(function ChatBubble(
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
      <path d="M4 11.5C4 7.36 7.58 4 12 4s8 3.36 8 7.5-3.58 7.5-8 7.5a9.4 9.4 0 0 1-3.07-.5L4.5 20l1.05-3.6A6.93 6.93 0 0 1 4 11.5Z" />
    </svg>
  );
});

import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// noun.wtf button system (see src/STYLEGUIDE.md): pill shape, semibold,
// white text on every filled button. `cta` (acid) is the one exception and
// is reserved for the single most important action on a screen.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4ff3a]/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-white/[.14] text-white hover:bg-white/[.22] backdrop-blur',
        cta: 'bg-[#d4ff3a] text-black hover:bg-[#e2ff74] shadow-[0_0_24px_rgba(212,255,58,.25)]',
        destructive: 'bg-[#ff3b5c] text-white hover:bg-[#ff5a76]',
        outline: 'bg-transparent text-white ring-1 ring-inset ring-white/25 hover:bg-white/[.08]',
        secondary: 'bg-white/[.07] text-white hover:bg-white/[.14]',
        ghost: 'text-white hover:bg-white/[.08]',
        link: 'text-[#d4ff3a] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-5',
        sm: 'h-8 px-3.5 text-xs',
        lg: 'h-12 px-7 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = ({
  ref,
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps & { ref?: React.RefObject<HTMLButtonElement | null> }) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
};
Button.displayName = 'Button';

export { Button, buttonVariants };

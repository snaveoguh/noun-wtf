import { FC, ReactNode } from 'react';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { Address } from '@/utils/types';

import { VoterHoverCardContent } from './VoterHoverCardContent';

interface VoterHoverCardProps {
  /** Address whose voter profile we render inside the hover card. */
  address: Address | string | undefined | null;
  /** Trigger element — the rendered .eth name / username. */
  children: ReactNode;
  /** Extra classes for the hover-card content itself (rare). */
  contentClassName?: string;
  /**
   * If true, render `children` directly without any wrapping span — useful
   * when the trigger is already a focusable element. Default: false.
   */
  asChild?: boolean;
}

/**
 * Wraps any text node (typically a rendered .eth name) with a rich voter
 * tooltip matching nouns.game's voter card. Uses the shadcn/Radix
 * HoverCard primitive, which already gives us:
 *   • portal-rendered content (no parent overflow clipping)
 *   • collision-aware positioning (auto-flip)
 *   • configurable open / close delays
 *   • touch-tap fallback on mobile
 *
 * Open/close delays are tuned to match the spec (200ms hover, brief grace
 * period for moving into the card). Data fetching only kicks off once the
 * card opens — the wrapper itself is essentially free at render time.
 */
export const VoterHoverCard: FC<VoterHoverCardProps> = ({
  address,
  children,
  contentClassName,
  asChild = false,
}) => {
  // Without a valid address there's nothing to look up, so we short-circuit
  // to a plain wrapper. This keeps consumer code simple — they don't need
  // to gate the wrap themselves.
  if (!address) {
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={200} closeDelay={120}>
      <HoverCardTrigger asChild={asChild}>
        {asChild ? (
          children
        ) : (
          <span className="cursor-default">{children}</span>
        )}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          // Override the shadcn defaults (white card with hard black border)
          // — voter cards on nouns.game are dark, compact, and have a soft
          // shadow. Width range matches the spec (~280-320px).
          'w-[300px] rounded-lg border border-zinc-700/80 bg-zinc-950 p-0 text-zinc-100 shadow-xl shadow-black/40',
          contentClassName,
        )}
      >
        <VoterHoverCardContent address={address as Address} />
      </HoverCardContent>
    </HoverCard>
  );
};

export default VoterHoverCard;

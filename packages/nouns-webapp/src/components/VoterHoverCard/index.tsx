import { FC, ReactNode } from 'react';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/liquid-sand/glass';
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
 * Surface uses Liquid Sand <GlassPanel tone="dark"> so the card matches
 * the rest of the design system rather than the legacy zinc-950 sheet.
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
        // Strip the shadcn defaults — GlassPanel below provides the surface
        // (frosted dark glass, hairline border, lg drop shadow) so the wrapper
        // shouldn't paint any of its own background or border.
        className={cn(
          'w-[300px] border-0 bg-transparent p-0 shadow-none',
          contentClassName,
        )}
      >
        <GlassPanel
          blur="medium"
          tone="dark"
          bordered
          radius="md"
          // Override the default shadow stack with the heavier `lg` drop
          // — hover cards float above the surface so they need more lift
          // than a flush panel. Inset glass highlight + hairline border are
          // re-applied here so we don't lose the glass read-out.
          style={{
            boxShadow:
              'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg)',
          }}
        >
          <VoterHoverCardContent address={address as Address} />
        </GlassPanel>
      </HoverCardContent>
    </HoverCard>
  );
};

export default VoterHoverCard;

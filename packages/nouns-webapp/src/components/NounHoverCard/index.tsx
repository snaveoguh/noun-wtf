import { FC, ReactNode } from 'react';

import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/components/ui/hover-card';
import { INounSeed } from '@/wrappers/nounToken';

import { NounHoverCardContent } from './NounHoverCardContent';

interface NounHoverCardProps {
  nounId: bigint;
  seed?: INounSeed;
  children: ReactNode;
}

/**
 * Wraps any Noun image/element with a rich hover popover.
 * Shows traits, auction data, color palette, and action buttons.
 *
 * Uses Radix HoverCard with 350ms open delay / 200ms close delay
 * (matching the BiasBar popover pattern from pooter.world).
 *
 * On mobile / touch devices, Radix handles tap-to-open automatically.
 */
export const NounHoverCard: FC<NounHoverCardProps> = ({
  nounId,
  seed,
  children,
}) => {
  return (
    <HoverCard openDelay={350} closeDelay={200}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={8}>
        <NounHoverCardContent nounId={nounId} seed={seed} />
      </HoverCardContent>
    </HoverCard>
  );
};

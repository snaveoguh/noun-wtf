import { FC, ReactNode } from 'react';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

import { PropHoverCardContent } from './PropHoverCardContent';

interface BaseProps {
  /** Trigger element — typically the rendered title or `#963` token. */
  children: ReactNode;
  /** Extra classes for the hover-card content itself (rare). */
  contentClassName?: string;
  /**
   * If true, render `children` directly without any wrapping span — useful
   * when the trigger is already a focusable element. Default: false.
   */
  asChild?: boolean;
}

interface ProposalProps extends BaseProps {
  type: 'proposal';
  proposalId: string | number;
  candidateSlug?: never;
}
interface CandidateProps extends BaseProps {
  type: 'candidate';
  candidateSlug: string;
  proposalId?: never;
}

export type PropHoverCardProps = ProposalProps | CandidateProps;

/**
 * Wraps a proposal/candidate title (or the `#963` token) with a rich tooltip
 * matching nouns.game's depth-on-hover. Mirrors the API shape of
 * `VoterHoverCard` — same shadcn HoverCard primitive, same `asChild` opt-in,
 * same dark zinc-950 surface, ~300px wide.
 *
 * The card is purely informational: the only navigation it offers is the
 * external "View on nouns.game" deep link, since the Game shell is read-only.
 *
 * Data fetching only kicks off once the card opens — the wrapper itself is
 * essentially free at render time.
 */
export const PropHoverCard: FC<PropHoverCardProps> = props => {
  const { children, contentClassName, asChild = false } = props;

  // Without an identifier the lookup can't resolve, so render the trigger as
  // a plain pass-through. Keeps consumers from needing to gate the wrap.
  const id = props.type === 'proposal' ? props.proposalId : props.candidateSlug;
  if (id === undefined || id === null || id === '') {
    return <>{children}</>;
  }

  return (
    <HoverCard openDelay={200} closeDelay={120}>
      <HoverCardTrigger asChild={asChild}>
        {asChild ? children : <span className="cursor-default">{children}</span>}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          // Dark surface matches VoterHoverCard for consistency across all
          // depth-on-hover surfaces in the Game shell. ~300px lines up with
          // the spec's 280-320px range.
          'w-[300px] rounded-lg border border-zinc-700/80 bg-zinc-950 p-0 text-zinc-100 shadow-xl shadow-black/40',
          contentClassName,
        )}
      >
        {props.type === 'proposal' ? (
          <PropHoverCardContent type="proposal" proposalId={String(props.proposalId)} />
        ) : (
          <PropHoverCardContent type="candidate" candidateSlug={props.candidateSlug} />
        )}
      </HoverCardContent>
    </HoverCard>
  );
};

export default PropHoverCard;

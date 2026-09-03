/**
 * Thin re-export barrel over `eventRegistry.ts`.
 *
 * Kept so the sunset shells (GameShell/GameFeed, CampShell, BerryShell) and
 * anything else importing `EVENT_TYPES` / `formatEventDescription` /
 * `extractAddresses` / `timeAgo` from this path keep compiling. New code
 * should import from `./eventRegistry` directly.
 */
import type { ReactNode } from 'react';

import {
  EVENT_REGISTRY,
  describeEvent,
  type CandidateTitleLookup,
  type EnsLookup,
  type EventData,
} from './eventRegistry';

export type {
  CandidateTitleLookup,
  DescribeCtx,
  EnsLookup,
  EventData,
  EventDef,
  ExpandMode,
  ProposalTitleLookup,
  ResolvedEventDef,
} from './eventRegistry';

export {
  EVENT_REGISTRY,
  FILTER_TABS,
  describeEvent,
  ethFromWei,
  extractAddresses,
  fmtEth,
  formatMarketplace,
  formatStreamAmount,
  getEventDef,
  getEventLink,
  getExpandableText,
  humanDuration,
  makeDescribeCtx,
  prettifyCandidateId,
  supportLabel,
  timeAgo,
} from './eventRegistry';

/** Legacy shape consumed by the sunset shells. */
export interface EventTypeConfig {
  label: string;
  color: string;
  filterKey: string;
  /** Single-glyph icon shown to the left of the row in dense feed mode. */
  icon?: string;
}

/** Legacy static map (no data-dependent variants) derived from the registry. */
export const EVENT_TYPES: Record<string, EventTypeConfig> = Object.fromEntries(
  Object.entries(EVENT_REGISTRY).map(([type, d]) => [
    type,
    { label: d.label, color: d.color, filterKey: d.filterKey, icon: d.icon },
  ]),
);

/** Legacy entry point — same as `describeEvent`. */
export function formatEventDescription(
  type: string,
  data: EventData,
  ensLookup?: EnsLookup,
  candidateTitleLookup?: CandidateTitleLookup,
): ReactNode {
  return describeEvent(type, data, ensLookup, candidateTitleLookup);
}

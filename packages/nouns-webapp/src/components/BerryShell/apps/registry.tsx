import type { ComponentType } from 'react';

import AuctionApp from './AuctionApp';
import CandidatesApp from './CandidatesApp';
import FinderApp from './FinderApp';
import SettingsApp from './SettingsApp';
import VoteApp from './VoteApp';

export interface BerryAppDef {
  appId: string;
  title: string;
  emoji: string;
  Component: ComponentType;
  width: number;
  height: number;
  /** External route for icons that aren't ported as in-shell apps yet. */
  externalRoute?: string;
}

/**
 * App registry — single source of truth for what the dock can launch.
 * Only entries with a `Component` open as in-shell windows; entries with
 * `externalRoute` navigate to a regular noun.wtf page.
 */
export const APP_REGISTRY: Record<string, BerryAppDef> = {
  finder: {
    appId: 'finder',
    title: 'Finder',
    emoji: '🍓',
    Component: FinderApp,
    width: 540,
    height: 480,
  },
  auction: {
    appId: 'auction',
    title: 'Auction',
    emoji: '🍆',
    Component: AuctionApp,
    width: 600,
    height: 460,
  },
  vote: {
    appId: 'vote',
    title: 'Vote — Proposals',
    emoji: '🗳️',
    Component: VoteApp,
    width: 640,
    height: 520,
  },
  candidates: {
    appId: 'candidates',
    title: 'Candidates',
    emoji: '📜',
    Component: CandidatesApp,
    width: 560,
    height: 480,
  },
  settings: {
    appId: 'settings',
    title: 'Settings',
    emoji: '⚙️',
    Component: SettingsApp,
    width: 460,
    height: 420,
  },
};

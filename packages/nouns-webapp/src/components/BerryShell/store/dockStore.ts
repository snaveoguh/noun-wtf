/**
 * Dock store — pinned apps for the Berry shell dock.
 *
 * Mirrors the shape of BerryCC0/berry's `dockStore.ts`
 * (https://github.com/BerryCC0/berry/blob/main/src/OS/store/dockStore.ts) — a
 * fixed list of pinned apps the user can later customise. For this port we
 * keep the list static (no localStorage persistence yet — Day 2 scope).
 */

export interface DockApp {
  appId: string;
  title: string;
  emoji: string;
}

// Berry stays focused on core Nouns DAO functionality — Auction, Vote,
// Candidates. Anything noun-wtf-specific (Grants, Hackathons, Terraforms,
// Marketplace, Predictions, Probe, etc.) lives in Pro + Terminal themes only.
export const PINNED_APPS: readonly DockApp[] = [
  { appId: 'finder', title: 'Finder', emoji: '🍓' },
  { appId: 'auction', title: 'Auction', emoji: '🍆' },
  { appId: 'vote', title: 'Vote', emoji: '🗳️' },
  { appId: 'candidates', title: 'Candidates', emoji: '📜' },
  { appId: 'settings', title: 'Settings', emoji: '⚙️' },
] as const;

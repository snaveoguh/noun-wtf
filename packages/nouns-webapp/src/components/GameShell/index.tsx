import type { ReactNode } from 'react';

import AppNav from './AppNav';
import classes from './GameShell.module.css';

interface GameShellProps {
  children: ReactNode;
  /** Optional wired search — passed through to AppNav so the input shows up. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

/**
 * Site-wide chrome wrapper for the Game theme.
 *
 * Dark dashboard rooted in `--gs-body-bg` (#0a0a0e). Provides only the sticky
 * nav and the dark scaffold; child routes (home, vote, explore, etc.) render
 * their own body content directly under the nav.
 *
 * `data-game-shell` lets descendants scope theme-specific overrides via
 * attribute selectors without touching unrelated themes.
 */
export default function GameShell({ children, searchValue, onSearchChange }: GameShellProps) {
  return (
    <div data-game-shell className={classes.shell}>
      <AppNav searchValue={searchValue} onSearchChange={onSearchChange} />
      <main className={classes.main}>{children}</main>
    </div>
  );
}

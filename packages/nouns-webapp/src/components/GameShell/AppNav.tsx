import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router';
import { formatEther } from 'viem';

import ThemeSwitcher from '@/components/ThemeSwitcher';

import classes from './GameShell.module.css';

function TreasuryPill() {
  const treasury = useReadNounsTreasuryBalancesInEth({
    query: { select: data => data.total },
  }).data;
  if (treasury === undefined) return null;
  const eth = Math.round(Number(formatEther(treasury))).toLocaleString();
  return (
    <a
      href="https://etherscan.io/address/0xb1a32fc9f9d8b2cf86c068cae13108809ad8ca58"
      target="_blank"
      rel="noreferrer"
      className={classes.treasuryPill}
      title="DAO treasury"
    >
      <span className={classes.treasuryLabel}>Treasury</span>
      <span>Ξ {eth}</span>
    </a>
  );
}

interface AppNavProps {
  /**
   * Search props are intentionally accepted but ignored — the radically
   * minimal nav has no search affordance. Callers (proposal pages) used to
   * route their search term through here; they keep working without it.
   */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

/**
 * Top horizontal nav for the Game theme.
 *
 * Radically minimal: just a joystick mark on the left (links home), and the
 * utility cluster on the right — Full UX pill (nouns.game) → treasury → wallet
 * → theme switcher. Navigation lives in the Feed and Proposals panels below;
 * we don't duplicate it up here.
 */
export default function AppNav(_props: AppNavProps) {
  return (
    <header className={classes.nav}>
      <div className={classes.navInner}>
        <Link to="/" aria-label="Home" className={classes.brand}>
          <span aria-hidden className={classes.brandMark}>
            🕹️
          </span>
        </Link>

        <div className={classes.spacer} />

        <a
          href="https://www.nouns.game"
          target="_blank"
          rel="noopener noreferrer"
          className={classes.fullUxPill}
          title="Open nouns.game in a new tab"
        >
          <span>nouns.game</span>
          <span aria-hidden className={classes.fullUxArrow}>↗</span>
        </a>

        <TreasuryPill />

        <ConnectKitButton.Custom>
          {({ isConnected, show, ensName, truncatedAddress, address }) => {
            if (!isConnected) {
              return (
                <button
                  type="button"
                  onClick={show}
                  className={clsx(classes.connectPill, classes.connectPillCta)}
                >
                  Connect
                </button>
              );
            }
            const label = ensName ?? truncatedAddress ?? 'Wallet';
            // Two-char monogram from ENS (preferred) or wallet address. Lower-case
            // to match nouns.game's lowercase ENS rendering.
            const initials = (
              ensName?.replace(/\.eth$/, '').slice(0, 2) ?? address?.slice(2, 4) ?? '?'
            ).toLowerCase();
            return (
              <button
                type="button"
                onClick={show}
                className={clsx(classes.connectPill, classes.connectPillConnected)}
              >
                <span aria-hidden className={classes.connectPillAvatar}>
                  {initials}
                </span>
                <span>{label}</span>
                <ChevronDown size={11} aria-hidden className={classes.connectPillChevron} />
              </button>
            );
          }}
        </ConnectKitButton.Custom>

        <ThemeSwitcher variant="navbar" />
      </div>
    </header>
  );
}

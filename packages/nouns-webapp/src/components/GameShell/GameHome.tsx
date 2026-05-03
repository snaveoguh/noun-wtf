import { useEffect, useState } from 'react';

import { useDispatch } from 'react-redux';

import { useAppSelector } from '@/hooks';
import { setLastAuctionNounId, setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';

import GameFeed from './GameFeed';
import GameProposals from './GameProposals';
import classes from './GameShell.module.css';

import GameShell from './index';

// ---------- onDisplay auction sync ----------

/**
 * Keeps `onDisplayAuction` slice in sync with the active auction. The Bid
 * component and other parts of the app rely on `onDisplayAuctionNounId` being
 * populated even when no auction strip is visible (see Auction/index.tsx).
 */
function useSyncOnDisplayAuction() {
  const dispatch = useDispatch();
  const activeAuction = useAppSelector(s => s.auction.activeAuction);

  useEffect(() => {
    if (!activeAuction) return;
    const nid = Number(activeAuction.nounId);
    dispatch(setOnDisplayAuctionNounId(nid));
    dispatch(setLastAuctionNounId(nid));
  }, [activeAuction, dispatch]);
}

// ---------- root ----------

/**
 * Bespoke `/` rendered when `theme === 'game'`.
 *
 * Layout: dark NavBar across the top, then a dark two-pane body with the
 * activity feed on the left and proposal/candidate tabs on the right. The
 * panes fill the viewport below the nav.
 *
 * Search lives in the nav and is passed through `GameShell` so it's available
 * from the home page.
 */
export default function GameHome() {
  const [search, setSearch] = useState('');
  useSyncOnDisplayAuction();

  return (
    <GameShell searchValue={search} onSearchChange={setSearch}>
      <div className={classes.body}>
        <GameFeed />
        <GameProposals />
      </div>
    </GameShell>
  );
}

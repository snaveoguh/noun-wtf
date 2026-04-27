import React from 'react';

import { Trans } from '@lingui/react/macro';
import { formatEther } from 'viem';

import classes from './ReservePriceBadge.module.css';

interface ReservePriceBadgeProps {
  /** Current high-bid amount, in wei. 0 means no qualifying bid yet. */
  currentBidWei: bigint;
  /** NounsAuctionHouse.reservePrice() — undefined while the hook loads. */
  reservePriceWei: bigint | undefined;
}

/**
 * Minimal badge that tells bidders the reserve price on the active auction.
 *
 * Shown only when the reserve is non-zero and the current top bid is still
 * below it — once someone clears the reserve the minimum-increment rule
 * takes over and the badge is no longer the interesting constraint.
 */
const ReservePriceBadge: React.FC<ReservePriceBadgeProps> = ({
  currentBidWei,
  reservePriceWei,
}) => {
  if (reservePriceWei === undefined || reservePriceWei === 0n) return null;
  if (currentBidWei >= reservePriceWei) return null;

  const reserveEth = formatEther(reservePriceWei);

  return (
    <div className={classes.wrapper} data-testid="reserve-price-badge">
      <span className={classes.label}>
        <Trans>Bid reserve</Trans>
      </span>
      <span className={classes.value}>{reserveEth} ETH</span>
    </div>
  );
};

export default ReservePriceBadge;

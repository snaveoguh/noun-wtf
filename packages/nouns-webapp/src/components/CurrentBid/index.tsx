import React from 'react';

import { Trans } from '@lingui/react/macro';

import TruncatedAmount from '@/components/TruncatedAmount';

import classes from './CurrentBid.module.css';

/**
 * Passible to CurrentBid as `currentBid` prop to indicate that
 * the bid amount is not applicable to this auction. (Nounder Noun)
 */
export const BID_N_A = 'n/a';

/**
 * Sentinel for burned (reserve-not-met) past auctions. Rendered as a clear
 * "no qualifying bid" label rather than "0.00 ETH" — which would be
 * technically correct but would misleadingly collide with the nounder-noun
 * n/a state.
 */
export const BID_UNMET = 'unmet';

/**
 * Special Bid type for not applicable auctions (Nounder Nouns)
 */
type BidNa = typeof BID_N_A;
type BidUnmet = typeof BID_UNMET;

interface CurrentBidProps {
  currentBid: bigint | BidNa | BidUnmet;
  auctionEnded: boolean;
}

const CurrentBid: React.FC<CurrentBidProps> = props => {
  const { currentBid, auctionEnded } = props;
  const titleContent = auctionEnded ? <Trans>Winning bid</Trans> : <Trans>Current bid</Trans>;

  return (
    <div className={classes.wrapper}>
      <div className={classes.label}>{titleContent}</div>
      <div className={classes.amount}>
        {currentBid === BID_N_A ? (
          BID_N_A
        ) : currentBid === BID_UNMET ? (
          <span title="Reserve not met — noun burned">—</span>
        ) : (
          <TruncatedAmount amount={currentBid} />
        )}
      </div>
    </div>
  );
};

export default CurrentBid;

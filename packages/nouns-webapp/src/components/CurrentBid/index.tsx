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
 * Special Bid type for not applicable auctions (Nounder Nouns)
 */
type BidNa = typeof BID_N_A;

interface CurrentBidProps {
  currentBid: bigint | BidNa;
  auctionEnded: boolean;
}

const CurrentBid: React.FC<CurrentBidProps> = props => {
  const { currentBid, auctionEnded } = props;
  const titleContent = auctionEnded ? <Trans>Winning bid</Trans> : <Trans>Current bid</Trans>;

  return (
    <div className={classes.wrapper}>
      <div className={classes.label}>{titleContent}</div>
      <div className={classes.amount}>
        {currentBid === BID_N_A ? BID_N_A : <TruncatedAmount amount={currentBid} />}
      </div>
    </div>
  );
};

export default CurrentBid;

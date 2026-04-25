import React from 'react';

import { XIcon } from '@heroicons/react/solid';
import { Trans } from '@lingui/react/macro';
import ReactDOM from 'react-dom';

import BidHistoryModalRow from '@/components/BidHistoryModalRow';
import useActiveDao from '@/hooks/useActiveDao';
import useModalBodyLock from '@/hooks/useModalBodyLock';
import { Bid } from '@/utils/types';
import { useV2AuctionBids } from '@/wrappers/nounV2Bids';
import { Auction } from '@/wrappers/nounsAuction';
import { useAuctionBids } from '@/wrappers/onDisplayAuction';

import classes from './BidHistoryModal.module.css';

interface BackdropProps {
  onDismiss: () => void;
}

export const Backdrop: React.FC<BackdropProps> = props => {
  return <div className={classes.backdrop} onClick={props.onDismiss} />;
};

interface BidHistoryModalOverlayProps {
  auction: Auction;
  onDismiss: () => void;
}

const BidHistoryModalOverlay: React.FC<BidHistoryModalOverlayProps> = ({ auction, onDismiss }) => {
  const { activeDao } = useActiveDao();
  // Both hooks always run (React hook rules). The DAO toggle picks which
  // one's result drives the list. v2 reads AuctionBid logs directly from
  // the v2 contract since no Ponder index is wired for v2 yet.
  const v1Bids = useAuctionBids(BigInt(auction.nounId));
  const v2Bids = useV2AuctionBids(BigInt(auction.nounId));
  const bids = activeDao === 'nounv2' ? v2Bids : v1Bids;

  return (
    <>
      <div className={classes.closeBtnWrapper}>
        <button onClick={onDismiss} className={classes.closeBtn}>
          <XIcon className={classes.icon} />
        </button>
      </div>

      <div className={classes.modal}>
        <div className={classes.content}>
          <div className={classes.bidWrapper}>
            {bids && bids.length > 0 ? (
              <ul>
                {bids?.map((bid: Bid, i: number) => {
                  return <BidHistoryModalRow key={i} index={i} bid={bid} />;
                })}
              </ul>
            ) : (
              <div className={classes.nullStateText}>
                <Trans>Bids will appear here</Trans>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const BidHistoryModal: React.FC<{
  auction: Auction;
  onDismiss: () => void;
}> = props => {
  const { onDismiss, auction } = props;
  useModalBodyLock(true);
  return (
    <>
      {ReactDOM.createPortal(
        <Backdrop onDismiss={onDismiss} />,
        document.getElementById('backdrop-root')!,
      )}
      {ReactDOM.createPortal(
        <BidHistoryModalOverlay onDismiss={onDismiss} auction={auction} />,
        document.getElementById('overlay-root')!,
      )}
    </>
  );
};

export default BidHistoryModal;

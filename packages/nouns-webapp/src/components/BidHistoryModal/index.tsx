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
  /** Explicit DAO override — bypasses the activeDao heuristic. Used by
   *  callers that already know which contract their auction belongs to
   *  (e.g. NounV2AuctionHero opens this with a synthesized v2 auction).  */
  forceDao?: 'nouns' | 'nounv2';
}

const BidHistoryModalOverlay: React.FC<BidHistoryModalOverlayProps> = ({
  auction,
  onDismiss,
  forceDao,
}) => {
  const { activeDao } = useActiveDao();
  const v1Bids = useAuctionBids(BigInt(auction.nounId));
  const v2Bids = useV2AuctionBids(BigInt(auction.nounId));
  const dao = forceDao ?? activeDao;
  // When the caller explicitly says "this is a v2 auction" (forceDao), trust
  // them — show v2 bids even if empty/loading. Otherwise fall back to the
  // legacy heuristic that prefers v1 when v2 has no events for this nounId
  // (handles the cross-DAO viewing case where a /noun/<mainnet-id> route is
  // visited while the global toggle is on v2).
  const useV2 = forceDao === 'nounv2' || (dao === 'nounv2' && v2Bids != null && v2Bids.length > 0);
  const bids = useV2 ? v2Bids : v1Bids;

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
  forceDao?: 'nouns' | 'nounv2';
}> = props => {
  const { onDismiss, auction, forceDao } = props;
  useModalBodyLock(true);
  return (
    <>
      {ReactDOM.createPortal(
        <Backdrop onDismiss={onDismiss} />,
        document.getElementById('backdrop-root')!,
      )}
      {ReactDOM.createPortal(
        <BidHistoryModalOverlay onDismiss={onDismiss} auction={auction} forceDao={forceDao} />,
        document.getElementById('overlay-root')!,
      )}
    </>
  );
};

export default BidHistoryModal;

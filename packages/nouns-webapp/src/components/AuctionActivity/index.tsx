import React, { useEffect, useState } from 'react';

import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

import AuctionActivityWrapper from '@/components/AuctionActivityWrapper';
import AuctionTimer from '@/components/AuctionTimer';
import Bid from '@/components/Bid';
import BidHistory from '@/components/BidHistory';
import BidHistoryBtn from '@/components/BidHistoryBtn';
import BidHistoryModal from '@/components/BidHistoryModal';
import CurrentBid from '@/components/CurrentBid';
import Holder from '@/components/Holder';
import NounInfoCard from '@/components/NounInfoCard';
import Winner from '@/components/Winner';
import { Auction } from '@/wrappers/nounsAuction';

import classes from './AuctionActivity.module.css';
import bidHistoryClasses from './BidHistory.module.css';

interface AuctionActivityProps {
  auction: Auction;
  isFirstAuction: boolean;
  isLastAuction: boolean;
  onPrevAuctionClick: () => void;
  onNextAuctionClick: () => void;
  displayGraphDepComps: boolean;
}

const AuctionActivity: React.FC<AuctionActivityProps> = (props: AuctionActivityProps) => {
  const { auction, isLastAuction, displayGraphDepComps } = props;

  const [auctionEnded, setAuctionEnded] = useState(false);
  const [auctionTimer, setAuctionTimer] = useState(false);

  const [showBidHistoryModal, setShowBidHistoryModal] = useState(false);
  const showBidModalHandler = () => {
    setShowBidHistoryModal(true);
  };
  const dismissBidModalHandler = () => {
    setShowBidHistoryModal(false);
  };

  const renderAuctionWinner = () => {
    if (isLastAuction && auction.bidder) {
      return <Winner winner={auction.bidder} clientId={auction.clientId} />;
    }
    return <Holder nounId={BigInt(auction.nounId)} />;
  };

  // timer logic
  useEffect(() => {
    const timeLeft = Number(auction.endTime) - Math.floor(Date.now() / 1000);

    if (timeLeft <= 0) {
      setAuctionEnded(true);
    } else {
      setAuctionEnded(false);
      const timer = setTimeout(
        () => {
          setAuctionTimer(!auctionTimer);
        },
        timeLeft > 300 ? 30000 : 1000,
      );

      return () => {
        clearTimeout(timer);
      };
    }
  }, [auctionTimer, auction]);

  return (
    <>
      {showBidHistoryModal && (
        <BidHistoryModal onDismiss={dismissBidModalHandler} auction={auction} />
      )}

      <AuctionActivityWrapper>
        {/* Current Bid — inline, no background */}
        <CurrentBid
          currentBid={BigInt(auction.amount?.toString() ?? '0')}
          auctionEnded={auctionEnded}
        />

        {/* Timer */}
        <div className={classes.timerRow}>
          {auctionEnded ? (
            renderAuctionWinner()
          ) : (
            <AuctionTimer auction={auction} auctionEnded={auctionEnded} />
          )}
        </div>

        {auctionEnded && (
          <div className={classes.nextNounLink}>
            <FontAwesomeIcon icon={faInfoCircle} />
            <Link to="/crystal-ball">
              <Trans>Help mint the next Noun</Trans>
            </Link>
          </div>
        )}

        {/* Row 3: Bid input + bottom action row */}
        {isLastAuction && (
          <Bid
            auction={auction}
            auctionEnded={auctionEnded}
            bottomLeft={
              auction.amount !== 0n ? <BidHistoryBtn onClick={showBidModalHandler} /> : undefined
            }
          />
        )}

        {/* Non-latest auction: info card / bid history */}
        {!isLastAuction && (
          <div className={classes.bottomRow}>
            <NounInfoCard
              nounId={BigInt(auction.nounId)}
              bidHistoryOnClickHandler={showBidModalHandler}
            />
          </div>
        )}
        {isLastAuction && displayGraphDepComps && (
          <BidHistory auctionId={auction.nounId.toString()} max={3} classes={bidHistoryClasses} />
        )}
      </AuctionActivityWrapper>
    </>
  );
};

export default AuctionActivity;

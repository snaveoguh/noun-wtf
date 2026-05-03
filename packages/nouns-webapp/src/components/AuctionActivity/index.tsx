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
import ReservePriceBadge from '@/components/ReservePriceBadge';
import Winner from '@/components/Winner';
import useDaoContext from '@/hooks/useDaoContext';
import { useDaoReservePrice } from '@/wrappers/daoAuctionHouse';
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

  // Reserve price from the active DAO's AuctionHouse. Mainnet Nouns is now
  // 2.8 ETH post-governance prop; v2 defaults to 0 at deploy. We render a
  // ReservePriceBadge when the live auction is below reserve, so users
  // don't assume their bid was silently rejected.
  const dao = useDaoContext();
  const reservePriceWei = useDaoReservePrice(dao);

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
        <BidHistoryModal
          onDismiss={dismissBidModalHandler}
          auction={auction}
          forceDao={dao.isV2 ? 'nounv2' : 'nouns'}
        />
      )}

      <AuctionActivityWrapper>
        {/* Current Bid — inline, no background */}
        <CurrentBid
          currentBid={BigInt(auction.amount?.toString() ?? '0')}
          auctionEnded={auctionEnded}
        />

        {/* Reserve price — shown only on V1 while the auction is live.
             V1 enforces a 2.8 ETH reserve so surfacing it up-front avoids
             users getting a confusing "tx reverted" when they try 0.1 ETH.
             V2's reserve is 50 wei (effectively zero), so the badge is
             noise — hide it. */}
        {isLastAuction && !auctionEnded && !dao.isV2 && (
          <ReservePriceBadge
            currentBidWei={BigInt(auction.amount?.toString() ?? '0')}
            reservePriceWei={reservePriceWei}
          />
        )}

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

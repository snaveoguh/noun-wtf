import React, { useCallback, useEffect } from 'react';

import { Trans } from '@lingui/react/macro';
import { Col, Row } from 'react-bootstrap';
import { formatEther } from 'viem';

import AuctionActivityDateHeadline from '@/components/AuctionActivityDateHeadline';
import AuctionActivityNounTitle from '@/components/AuctionActivityNounTitle';
import AuctionActivityWrapper from '@/components/AuctionActivityWrapper';
import AuctionNavigation from '@/components/AuctionNavigation';
import AuctionTitleAndNavWrapper from '@/components/AuctionTitleAndNavWrapper';

import classes from './BurnedNounContent.module.css';

import auctionActivityClasses from '@/components/AuctionActivity/AuctionActivity.module.css';

interface BurnedNounContentProps {
  /** Mint timestamp (auction start time) for the burned noun. */
  mintTimestamp: bigint;
  nounId: bigint;
  isFirstAuction: boolean;
  isLastAuction: boolean;
  /** Reserve price in wei, if known — shown alongside the "0 bids" subline. */
  reservePriceWei?: bigint;
  onPrevAuctionClick: () => void;
  onNextAuctionClick: () => void;
}

/**
 * Panel shown in place of AuctionActivity when an auction ended with no bid
 * meeting the reserve price. Mirrors the NounderNounContent layout so the
 * page structure stays stable — navigation arrows, date headline, title,
 * then a BURNED banner with the reserve context.
 */
const BurnedNounContent: React.FC<BurnedNounContentProps> = props => {
  const {
    mintTimestamp,
    nounId,
    isFirstAuction,
    isLastAuction,
    reservePriceWei,
    onPrevAuctionClick,
    onNextAuctionClick,
  } = props;

  // Keyboard nav parity with NounderNounContent.
  const handleKeyPress = useCallback(
    (event: { key: string }) => {
      if (event.key === 'ArrowLeft') onPrevAuctionClick();
      if (event.key === 'ArrowRight') onNextAuctionClick();
    },
    [onNextAuctionClick, onPrevAuctionClick],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleKeyPress]);

  const reserveEth = reservePriceWei ? formatEther(reservePriceWei) : null;

  return (
    <AuctionActivityWrapper>
      <div className={auctionActivityClasses.informationRow}>
        <Row className={auctionActivityClasses.activityRow}>
          <AuctionTitleAndNavWrapper>
            <AuctionNavigation
              isFirstAuction={isFirstAuction}
              isLastAuction={isLastAuction}
              onNextAuctionClick={onNextAuctionClick}
              onPrevAuctionClick={onPrevAuctionClick}
            />
            <AuctionActivityDateHeadline startTime={mintTimestamp} />
          </AuctionTitleAndNavWrapper>
          <Col lg={12}>
            <AuctionActivityNounTitle nounId={nounId} />
          </Col>
        </Row>
        <Row className={auctionActivityClasses.activityRow}>
          <Col lg={12}>
            <div className={classes.wrapper}>
              <div className={classes.banner}>
                <Trans>Burned — Reserve not met</Trans>
              </div>
              <div className={classes.subline}>
                {reserveEth ? (
                  <Trans>
                    <span className={classes.sublineStrong}>{reserveEth} ETH</span> reserve · 0
                    qualifying bids
                  </Trans>
                ) : (
                  <Trans>Reserve price not met · 0 qualifying bids</Trans>
                )}
              </div>
              <div className={classes.infoRow}>
                <Trans>
                  This Noun was burned by the auction house contract because no bid reached the
                  minimum reserve price. The auction number is retired — no one owns this Noun.
                </Trans>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    </AuctionActivityWrapper>
  );
};

export default BurnedNounContent;

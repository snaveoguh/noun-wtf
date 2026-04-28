import React, { useCallback, useEffect } from 'react';

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
      {/* Prev/next noun nav — pinned to the top-right corner of the card so
          it never overlaps the date / title / banner block. The wrapper
          AuctionActivityWrapper is `position: relative` already; if not,
          this still degrades to inline. */}
      <div
        style={{
          position: 'absolute',
          top: '0.75rem',
          right: '2.5rem',
          zIndex: 2,
          display: 'flex',
          gap: '0.4rem',
        }}
      >
        <AuctionNavigation
          isFirstAuction={isFirstAuction}
          isLastAuction={isLastAuction}
          onNextAuctionClick={onNextAuctionClick}
          onPrevAuctionClick={onPrevAuctionClick}
        />
      </div>
      <div className={auctionActivityClasses.informationRow}>
        <Row className={auctionActivityClasses.activityRow}>
          <AuctionTitleAndNavWrapper>
            <AuctionActivityDateHeadline startTime={mintTimestamp} />
          </AuctionTitleAndNavWrapper>
          <Col lg={12}>
            <AuctionActivityNounTitle nounId={nounId} />
          </Col>
        </Row>
        <Row className={auctionActivityClasses.activityRow}>
          <Col lg={12}>
            <div className={classes.wrapper}>
              <div
                aria-hidden
                style={{
                  fontSize: '1.4rem',
                  letterSpacing: '0.15em',
                  textAlign: 'center',
                  marginBottom: '0.4rem',
                  filter: 'saturate(1.2)',
                }}
              >
                {'\uD83D\uDD25\uD83E\uDEA6\uD83D\uDD25\uD83E\uDEA6\uD83D\uDD25\uD83E\uDEA6\uD83D\uDD25'}
              </div>
              <div className={classes.banner}>RESERVE NOT MET</div>
              <div className={classes.subline}>
                {reserveEth ? (
                  <>
                    <div>
                      <span className={classes.sublineStrong}>{reserveEth} ETH</span> reserve
                    </div>
                    <div>0 qualifying bids</div>
                  </>
                ) : (
                  <>
                    <div>Reserve price not met</div>
                    <div>0 qualifying bids</div>
                  </>
                )}
              </div>
              <div className={classes.infoRow}>
                {'\uD83E\uDEA6 '}
                This Noun was burned by the auction house contract because no bid reached the
                minimum reserve price. The auction number is retired. No one owns this Noun.
                {' \uD83D\uDD25'}
              </div>
              <div
                aria-hidden
                style={{
                  fontSize: '1.4rem',
                  letterSpacing: '0.15em',
                  textAlign: 'center',
                  marginTop: '0.4rem',
                  filter: 'saturate(1.2)',
                }}
              >
                {'\uD83D\uDD25\uD83E\uDEA6\uD83D\uDD25\uD83E\uDEA6\uD83D\uDD25\uD83E\uDEA6\uD83D\uDD25'}
              </div>
            </div>
          </Col>
        </Row>
      </div>
    </AuctionActivityWrapper>
  );
};

export default BurnedNounContent;

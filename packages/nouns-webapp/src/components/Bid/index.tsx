import React, { ChangeEvent, useEffect, useRef, useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Col, FormControl, Spinner } from 'react-bootstrap';
import { toast } from 'sonner';
import { formatEther, parseEther } from 'viem';

import SettleManuallyBtn from '@/components/SettleManuallyBtn';
import { NOUN_WTF_CLIENT_ID } from '@/config';
import {
  useReadNounsAuctionHouseMinBidIncrementPercentage,
  useWriteNounsAuctionHouseCreateBid,
  useWriteNounsAuctionHouseSettleCurrentAndCreateNewAuction,
} from '@/contracts';
import { useAppSelector } from '@/hooks';
import { useActiveLocale } from '@/hooks/useActivateLocale';
import { Auction } from '@/wrappers/nounsAuction';

import classes from './Bid.module.css';

import responsiveUiUtilsClasses from '@/utils/ResponsiveUIUtils.module.css';

const computeMinimumNextBid = (
  currentBid: bigint,
  minBidIncPercentage: bigint | undefined,
): bigint => {
  if (minBidIncPercentage === undefined) {
    return 0n;
  }
  return (currentBid * (minBidIncPercentage + 100n)) / 100n;
};

const minBidEth = (minBid: bigint): string => {
  if (minBid === 0n) {
    return '0.01';
  }

  const eth = formatEther(minBid);
  const ethNum = parseFloat(eth);
  return (Math.ceil(ethNum * 100) / 100).toFixed(2);
};

const currentBid = (bidInputRef: React.RefObject<HTMLInputElement | null>) => {
  if (!bidInputRef.current || !bidInputRef.current.value) {
    return 0n;
  }
  return parseEther(bidInputRef.current.value);
};

interface BidProps {
  auction: Auction;
  auctionEnded: boolean;
  bottomLeft?: React.ReactNode;
}

const Bid: React.FC<BidProps> = props => {
  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const { auction, auctionEnded, bottomLeft } = props;
  const activeLocale = useActiveLocale();

  const account = useAppSelector(state => state.account.activeAccount);

  const bidInputRef = useRef<HTMLInputElement>(null);

  const [bidInput, setBidInput] = useState('');

  const { t } = useLingui();

  const { data: minBidIncPercentage } = useReadNounsAuctionHouseMinBidIncrementPercentage();
  const minBid = computeMinimumNextBid(
    auction.amount !== undefined ? BigInt(auction.amount.toString()) : 0n,
    minBidIncPercentage !== undefined ? BigInt(minBidIncPercentage.toString()) : undefined,
  );

  const {
    writeContract: placeBid,
    isPending: isPlacingBid,
    isError: didPlaceBidFail,
    isSuccess: placeBidSucceeded,
  } = useWriteNounsAuctionHouseCreateBid();

  const {
    writeContract: settleAuction,
    isPending: isSettlingAuction,
    isSuccess: didSettleAuction,
    isError: didSettleFail,
    isIdle: isSettleIdle,
    error: settleAuctionError,
  } = useWriteNounsAuctionHouseSettleCurrentAndCreateNewAuction();

  const bidInputHandler = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;

    // disable more than 2 digits after the decimal point
    if (input.includes('.') && event.target.value.split('.')[1].length > 2) {
      return;
    }

    setBidInput(event.target.value);
  };

  useEffect(() => {
    if (didPlaceBidFail) toast.error(t`Please try again.`);
  }, [didPlaceBidFail, t]);
  useEffect(() => {
    if (placeBidSucceeded) toast.success(t`Bid placed.`);
  }, [placeBidSucceeded, t]);

  const placeBidHandler = async () => {
    if (auction == undefined || !bidInputRef.current || !bidInputRef.current.value) {
      return;
    }

    if (currentBid(bidInputRef) < minBid) {
      toast.error(
        t`Please place a bid higher than or equal to the minimum bid amount of ${minBidEth(minBid)} ETH`,
      );
      setBidInput(minBidEth(minBid));
      return;
    }

    const value = parseEther(bidInputRef.current.value);
    placeBid({
      args: [BigInt(auction.nounId), NOUN_WTF_CLIENT_ID],
      value,
    });
  };

  const settleAuctionHandler = () => {
    settleAuction({});
  };

  const clearBidInput = () => {
    if (bidInputRef.current) {
      bidInputRef.current.value = '';
    }
  };

  // successful bid using redux store state
  useEffect(() => {
    if (!account) return;

    const isMiningUserTx = isPlacingBid;
    const isCorrectTx = currentBid(bidInputRef) === BigInt(auction.amount?.toString() ?? '0');
    if (isMiningUserTx && auction.bidder === account && isCorrectTx) {
      toast.success(t`Bid was placed successfully!`);
      clearBidInput();
    }
  }, [auction, account, t, isPlacingBid]);

  useEffect(() => {
    if (auctionEnded && didSettleAuction) {
      toast.success(t`Settled auction successfully!`);
    }
    if (auctionEnded && didSettleFail) {
      toast.error(settleAuctionError?.message || t`Please try again.`);
    }
  }, [
    auctionEnded,
    isSettleIdle,
    isSettlingAuction,
    didSettleAuction,
    didSettleFail,
    settleAuctionError?.message,
    t,
  ]);

  if (auction == undefined) return null;

  const isDisabled = isPlacingBid || isSettlingAuction || !activeAccount;

  const crytalBallBtnOnClickHandler = () => {
    // Internal crystal-ball page (App.tsx route /crystal-ball) — used to
    // link externally to nouns.game but noun.wtf now hosts its own version.
    window.open('/crystal-ball', '_self')?.focus();
  };

  const isWalletConnected = activeAccount !== undefined;

  return (
    <div className={classes.bidGroup}>
      {!auctionEnded ? (
        <>
          {/* Full-width bid input */}
          <div className={classes.bidInputWrapper}>
            <span className={classes.customPlaceholderBidAmt}>
              {!bidInput ? (
                <>
                  Ξ {minBidEth(minBid)}{' '}
                  <span
                    className={
                      activeLocale === 'ja-JP' ? responsiveUiUtilsClasses.disableSmallScreens : ''
                    }
                  >
                    <Trans>or more</Trans>
                  </span>
                </>
              ) : (
                ''
              )}
            </span>
            <FormControl
              className={classes.bidInput}
              type="number"
              min="0"
              onChange={bidInputHandler}
              ref={bidInputRef}
              value={bidInput}
            />
          </div>

          {/* Bottom row: VIEW ALL BIDS left, BID button right */}
          <div className={classes.bidActionRow}>
            {bottomLeft}
            {/* @ts-expect-error TS2590: react-bootstrap Button union type too complex */}
            <Button className={classes.bidBtn} onClick={placeBidHandler} disabled={isDisabled}>
              {isPlacingBid ? <Spinner animation="border" size="sm" /> : <Trans>Bid</Trans>}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Col lg={12} className={classes.voteForNextNounBtnWrapper}>
            <Button className={classes.bidBtnAuctionEnded} onClick={crytalBallBtnOnClickHandler}>
              <Trans>Pick the next Noun</Trans> 🥽
            </Button>
          </Col>
          {isWalletConnected && (
            <Col lg={12}>
              <SettleManuallyBtn settleAuctionHandler={settleAuctionHandler} auction={auction} />
            </Col>
          )}
        </>
      )}
    </div>
  );
};
export default Bid;

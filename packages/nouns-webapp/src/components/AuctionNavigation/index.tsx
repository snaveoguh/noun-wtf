import React, { useCallback, useEffect } from 'react';

import { useNavigate } from 'react-router';

import { useAppSelector } from '@/hooks';
import useDaoContext from '@/hooks/useDaoContext';
import { nounPath, nounV2Path } from '@/utils/history';
import useOnDisplayAuction from '@/wrappers/onDisplayAuction';

import classes from './AuctionNavigation.module.css';

interface AuctionNavigationProps {
  isFirstAuction: boolean;
  isLastAuction: boolean;
  onPrevAuctionClick: () => void;
  onNextAuctionClick: () => void;
}

const AuctionNavigation: React.FC<AuctionNavigationProps> = props => {
  const { isFirstAuction, isLastAuction, onPrevAuctionClick, onNextAuctionClick } = props;
  const isCool = useAppSelector(state => state.application.stateBackgroundColor) === '#d5d7e1';
  const navigate = useNavigate();
  const dao = useDaoContext();
  const onDisplayAuction = useOnDisplayAuction();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const onDisplayAuctionNounId = Number(onDisplayAuction?.nounId);

  // Page through Nouns via a keyboard
  // handle what happens on key press
  const handleKeyPress = useCallback(
    (event: { key: string }) => {
      if (event.key === 'ArrowLeft') {
        // This is a hack.
        // If we don't put this, the first keystore
        // from the noun at / doesn't work (i.e.,
        // to go from current noun to current noun - 1 would take two arrow presses)
        // Stay within the active DAO's namespace — without this,
        // pressing ◀ on /v2/noun/0 (which renders BurnedNounContent
        // → AuctionNavigation) was yanking the user back to mainnet
        // /noun/${id}, which then showed mainnet noun data while the
        // DAO toggle still read V2.
        if (onDisplayAuctionNounId === lastAuctionNounId) {
          const path = dao.isV2 ? nounV2Path : nounPath;
          navigate(path(Number(lastAuctionNounId)));
        }

        if (!isFirstAuction) {
          onPrevAuctionClick();
        }
      }
      if (event.key === 'ArrowRight') {
        if (!isLastAuction) {
          onNextAuctionClick();
        }
      }
    },
    [
      dao.isV2,
      isFirstAuction,
      isLastAuction,
      lastAuctionNounId,
      navigate,
      onDisplayAuctionNounId,
      onNextAuctionClick,
      onPrevAuctionClick,
    ],
  );

  useEffect(() => {
    // attach the event listener
    document.addEventListener('keydown', handleKeyPress);

    // remove the event listener
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleKeyPress]);

  // 3-pixel arrow: a tiny 5x7 grid scaled up via CSS image-rendering: pixelated
  const pixelArrowLeft = (
    <svg width="5" height="7" viewBox="0 0 5 7" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ width: 15, height: 21, imageRendering: 'pixelated' }}>
      <rect x="2" y="0" width="1" height="1" />
      <rect x="1" y="1" width="1" height="1" />
      <rect x="0" y="2" width="1" height="1" />
      <rect x="0" y="3" width="1" height="1" />
      <rect x="0" y="4" width="1" height="1" />
      <rect x="1" y="5" width="1" height="1" />
      <rect x="2" y="6" width="1" height="1" />
    </svg>
  );

  const pixelArrowRight = (
    <svg width="5" height="7" viewBox="0 0 5 7" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ width: 15, height: 21, imageRendering: 'pixelated' }}>
      <rect x="2" y="0" width="1" height="1" />
      <rect x="3" y="1" width="1" height="1" />
      <rect x="4" y="2" width="1" height="1" />
      <rect x="4" y="3" width="1" height="1" />
      <rect x="4" y="4" width="1" height="1" />
      <rect x="3" y="5" width="1" height="1" />
      <rect x="2" y="6" width="1" height="1" />
    </svg>
  );

  return (
    <div className={classes.navArrowsContainer}>
      <button
        onClick={() => onPrevAuctionClick()}
        className={isCool ? classes.leftArrowCool : classes.leftArrowWarm}
        disabled={isFirstAuction}
      >
        {pixelArrowLeft}
      </button>
      <button
        onClick={() => onNextAuctionClick()}
        className={isCool ? classes.rightArrowCool : classes.rightArrowWarm}
        disabled={isLastAuction}
      >
        {pixelArrowRight}
      </button>
    </div>
  );
};
export default AuctionNavigation;

import React, { useEffect, useRef, useState } from 'react';

import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

import { useAppSelector } from '@/hooks';
import { Auction } from '@/wrappers/nounsAuction';

import classes from './AuctionTimer.module.css';

dayjs.extend(duration);

interface AuctionTimerProps {
  auction: Auction;
  auctionEnded: boolean;
}

const AuctionTimer: React.FC<AuctionTimerProps> = ({ auction, auctionEnded }) => {
  const [auctionTimer, setAuctionTimer] = useState(0);
  const [timerToggle, setTimerToggle] = useState(true);

  const auctionTimerRef = useRef(auctionTimer);
  auctionTimerRef.current = auctionTimer;

  const timerDuration = dayjs.duration(auctionTimerRef.current, 's');
  const endTimeUnix = Math.floor(Date.now() / 1000) + auctionTimerRef.current;

  useEffect(() => {
    const timeLeft = Number(auction.endTime) - dayjs().unix();

    setAuctionTimer(timeLeft);

    if (timeLeft <= 0) {
      setAuctionTimer(0);
    } else {
      const timer = setTimeout(() => {
        setAuctionTimer(auctionTimerRef.current - 1);
      }, 1000);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [auction, auctionTimer]);

  const flooredMinutes = Math.floor(timerDuration.minutes());
  const flooredSeconds = Math.floor(timerDuration.seconds());
  const isCool = useAppSelector(state => state.application.isCoolBackground);

  const textColor = isCool ? 'var(--brand-cool-light-text)' : 'var(--brand-warm-light-text)';

  return (
    <div
      className={clsx(classes.wrapper, classes.section)}
      onClick={() => setTimerToggle(!timerToggle)}
      style={{ color: textColor }}
    >
      {timerToggle ? (
        <h2 className={clsx(classes.timerWrapper, classes.timeLeft)}>
          <span className={classes.timerLabel}>
            {auctionEnded ? <Trans>Auction ended</Trans> : <Trans>Auction ends in</Trans>}
            {!auctionEnded && '\u00A0'}
          </span>
          {!auctionEnded && (
            <>
              <div className={classes.timerSection}>
                <span>
                  {`${Math.floor(timerDuration.hours())}`}
                  <span className={classes.small}>
                    <Trans>h</Trans>
                  </span>
                </span>
              </div>{' '}
              <div className={classes.timerSection}>
                <span>
                  {`${flooredMinutes}`}
                  <span className={classes.small}>
                    <Trans>m</Trans>
                  </span>
                </span>
              </div>{' '}
              <div className={classes.timerSectionFinal}>
                <span>
                  {`${flooredSeconds}`}
                  <span className={classes.small}>
                    <Trans>s</Trans>
                  </span>
                </span>
              </div>
            </>
          )}
        </h2>
      ) : (
        <h2 className={classes.timerWrapper}>
          <span className={classes.timerLabel}>
            <Trans>Ends on</Trans> {i18n.date(new Date(endTimeUnix * 1000), { month: 'short' })}{' '}
            {i18n.date(new Date(endTimeUnix * 1000), { day: 'numeric' })} <Trans>at</Trans>
          </span>{' '}
          <div className={clsx(classes.timerSection, classes.clockSection)}>
            <span>{i18n.date(new Date(endTimeUnix * 1000), { timeStyle: 'medium' })}</span>
          </div>
        </h2>
      )}
    </div>
  );
};

export default AuctionTimer;

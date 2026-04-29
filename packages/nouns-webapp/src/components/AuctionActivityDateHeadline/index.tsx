import React from 'react';

import { i18n } from '@lingui/core';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

import { useAppSelector } from '@/hooks';

import classes from './AuctionActivityDateHeadline.module.css';

dayjs.extend(utc);

type AuctionActivityDateHeadlineProps = { startTime: bigint };
const AuctionActivityDateHeadline: React.FC<AuctionActivityDateHeadlineProps> = props => {
  const { startTime } = props;
  const isCool = useAppSelector(state => state.application.isCoolBackground);
  // startTime === 0 is a stub sentinel (no real data fetched yet) — render
  // a neutral placeholder instead of "January 01, 1970".
  const hasRealStart = startTime !== undefined && BigInt(startTime) > 0n;
  const auctionStartTimeUTC = hasRealStart
    ? dayjs(Number(startTime) * 1000)
        .utc()
        .format('MMMM DD, YYYY')
    : null;
  return (
    <div className={classes.wrapper}>
      <h4
        className={classes.date}
        style={{ color: isCool ? 'var(--brand-cool-light-text)' : 'var(--brand-warm-light-text)' }}
      >
        {auctionStartTimeUTC
          ? i18n.date(auctionStartTimeUTC, { month: 'long', year: 'numeric', day: '2-digit' })
          : ' '}
      </h4>
    </div>
  );
};

export default AuctionActivityDateHeadline;

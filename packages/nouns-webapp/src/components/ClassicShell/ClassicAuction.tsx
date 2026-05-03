import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import { faArrowLeft, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

import Bid from '@/components/Bid';
import CurrentBid, { BID_N_A } from '@/components/CurrentBid';
import currentBidClasses from '@/components/CurrentBid/CurrentBid.module.css';
import { getNoun } from '@/components/StandaloneNoun';
import { useAppSelector } from '@/hooks';
import { setCurrentNounSeed, setStateBackgroundColor } from '@/state/slices/application';
import { setLastAuctionNounId, setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';
import { beige, grey } from '@/utils/nounBgColors';
import type { Auction as IAuction } from '@/wrappers/nounsAuction';
import { useNounSeed, type INounSeed } from '@/wrappers/nounToken';

import classes from './ClassicAuction.module.css';

dayjs.extend(utc);

function ClassicNounImage({
  nounId,
  onSeedLoad,
}: {
  nounId: bigint;
  onSeedLoad: (seed: INounSeed) => void;
}) {
  const seed = useNounSeed(nounId);
  const seedIsInvalid =
    !seed || Object.values(seed).every(v => v === 0);

  useEffect(() => {
    if (seed && !seedIsInvalid) onSeedLoad(seed);
  }, [seed, seedIsInvalid, onSeedLoad]);

  if (!seed || seedIsInvalid) return null;
  const { image, description } = getNoun(nounId, seed);
  return <img src={image} alt={description} className={classes.nounImg} />;
}

function ClassicTimer({ endTime }: { endTime: bigint }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, Number(endTime) - now);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return (
    <div className={currentBidClasses.wrapper}>
      <div className={currentBidClasses.label}>Auction ends in</div>
      <div className={currentBidClasses.amount}>{`${h}h ${m}m ${s}s`}</div>
    </div>
  );
}

export default function ClassicAuction() {
  const dispatch = useDispatch();
  const activeAuction = useAppSelector(s => s.auction.activeAuction);
  const isCool = useAppSelector(s => s.application.isCoolBackground);

  useEffect(() => {
    if (!activeAuction) return;
    const nid = Number(activeAuction.nounId);
    dispatch(setOnDisplayAuctionNounId(nid));
    dispatch(setLastAuctionNounId(nid));
  }, [activeAuction, dispatch]);

  const handleSeedLoad = (seed: INounSeed) => {
    dispatch(setStateBackgroundColor(seed.background === 0 ? grey : beige));
    dispatch(setCurrentNounSeed(seed));
  };

  if (!activeAuction) {
    return <div className={classes.skeleton} />;
  }

  const auction = {
    nounId: BigInt(activeAuction.nounId),
    startTime: BigInt(activeAuction.startTime),
    endTime: BigInt(activeAuction.endTime),
    amount: activeAuction.amount ? BigInt(activeAuction.amount) : 0n,
    bidder: activeAuction.bidder,
    settled: activeAuction.settled,
    clientId: activeAuction.clientId ?? null,
    burned: activeAuction.burned ?? false,
  } satisfies IAuction;

  const currentBid = auction.amount ?? BID_N_A;

  return (
    <div className={classes.classicAuctionWrapper}>
      <div className={classes.nounCol}>
        <ClassicNounImage nounId={auction.nounId} onSeedLoad={handleSeedLoad} />
      </div>
      <div className={classes.infoCol}>
        <div className={classes.headerRow}>
          {/* Read-only homepage emulation — arrows are visual only,
              no internal navigation off the bespoke ClassicHome. */}
          <button
            type="button"
            className={classes.arrow}
            disabled
            aria-label="Previous noun"
          >
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <button
            type="button"
            className={classes.arrow}
            disabled
            aria-label="Next noun"
          >
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
          <span
            className={classes.dateText}
            style={{
              color: isCool ? 'var(--brand-cool-light-text)' : 'var(--brand-warm-light-text)',
            }}
          >
            {auction.startTime > 0n
              ? dayjs(Number(auction.startTime) * 1000).utc().format('MMMM DD, YYYY')
              : ''}
          </span>
        </div>
        <h1
          className={classes.title}
          style={{
            color: isCool ? 'var(--brand-cool-dark-text)' : 'var(--brand-warm-dark-text)',
          }}
        >
          Noun {auction.nounId.toString()}
        </h1>
        <div className={classes.bidStrip}>
          <div className={classes.bidStripCell}>
            <CurrentBid currentBid={currentBid} auctionEnded={false} />
          </div>
          <div className={classes.bidStripDivider} />
          <div className={classes.bidStripCell}>
            <ClassicTimer endTime={auction.endTime} />
          </div>
        </div>
        <div className={classes.bidRow}>
          <Bid auction={auction} auctionEnded={false} />
        </div>
      </div>
    </div>
  );
}

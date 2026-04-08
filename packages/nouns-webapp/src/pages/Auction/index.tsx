import React, { Suspense, useEffect } from 'react';

import { useNavigate, useParams } from 'react-router';
import { isNumber } from 'remeda';

import Auction from '@/components/Auction';
import CurrentPropsBanner from '@/components/CurrentPropsBanner';
import Documentation from '@/components/Documentation';
import DreamsBanner from '@/components/DreamsBanner';
import FundedPropsBanner from '@/components/FundedPropsBanner';
import NoundryBanner from '@/components/NoundryBanner';
import NounsIntroSection from '@/components/NounsIntroSection';
import NounsWorldBanner from '@/components/NounsWorldBanner';
import PropdatesBanner from '@/components/PropdatesBanner';
import { Bone } from '@/components/Skeleton';

const LilNounsGrid = React.lazy(() => import('@/components/LilNounsGrid'));
import { useAppDispatch, useAppSelector } from '@/hooks';
import { setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';
import { nounPath } from '@/utils/history';
import useOnDisplayAuction from '@/wrappers/onDisplayAuction';

type AuctionPageProps = object;

const AuctionPage: React.FC<AuctionPageProps> = () => {
  const { id: auctionId } = useParams<{ id: string }>();
  const onDisplayAuction = useOnDisplayAuction();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const onDisplayAuctionNounId = Number(onDisplayAuction?.nounId);

  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    if (lastAuctionNounId == null) return;
    if (auctionId === undefined) {
      if (onDisplayAuctionNounId === Number(lastAuctionNounId)) return;
      dispatch(setOnDisplayAuctionNounId(Number(lastAuctionNounId)));
      return;
    }

    if (
      !isNumber(Number(auctionId)) ||
      Number(auctionId) > lastAuctionNounId ||
      Number(auctionId) < 0
    ) {
      navigate(nounPath(lastAuctionNounId));
      return;
    }

    if (Number(auctionId) !== onDisplayAuctionNounId) {
      dispatch(setOnDisplayAuctionNounId(Number(auctionId)));
    }
  }, [auctionId, lastAuctionNounId, dispatch, navigate, onDisplayAuctionNounId]);

  return (
    <>
      <Auction auction={onDisplayAuction} />
      <Suspense fallback={<Bone w="100%" h={100} style={{ borderRadius: 0 }} />}>
        <LilNounsGrid />
      </Suspense>
      <FundedPropsBanner />
      <PropdatesBanner />
      <CurrentPropsBanner />
      <DreamsBanner />
      <NoundryBanner />
      <NounsWorldBanner />
      <div style={{ background: '#fff' }}>
        <NounsIntroSection />
        <Documentation backgroundColor="#ffffff" />
      </div>
    </>
  );
};
export default AuctionPage;

import React, { Suspense, useEffect } from 'react';

import { useNavigate, useParams } from 'react-router';
import { isNumber } from 'remeda';

import Auction from '@/components/Auction';
import { Bone } from '@/components/Skeleton';
import CurrentPropsBanner from '@/components/CurrentPropsBanner';
import Documentation from '@/components/Documentation';
import DreamsBanner from '@/components/DreamsBanner';
import FundedPropsBanner from '@/components/FundedPropsBanner';
import NounsIntroSection from '@/components/NounsIntroSection';
import NounsWorldBanner from '@/components/NounsWorldBanner';
import PropdatesBanner from '@/components/PropdatesBanner';

// Lazy-load TreasuryFlow (Three.js ~600KB — keep out of initial bundle)
const TreasuryFlowSection = React.lazy(() => import('@/components/TreasuryFlow'));
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
    if (!lastAuctionNounId) return;
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
      <NounsWorldBanner />
      <NounsIntroSection />
      <Suspense fallback={<Bone w="100%" h={200} style={{ borderRadius: 0 }} />}>
        <TreasuryFlowSection />
      </Suspense>
      <Documentation backgroundColor="#ffffff" />
    </>
  );
};
export default AuctionPage;

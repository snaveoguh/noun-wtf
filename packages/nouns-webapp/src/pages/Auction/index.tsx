import React, { Suspense, useEffect } from 'react';

import { useNavigate, useParams, useSearchParams } from 'react-router';
import { isNumber } from 'remeda';

import Auction from '@/components/Auction';
import CurrentPropsBanner from '@/components/CurrentPropsBanner';
import Documentation from '@/components/Documentation';
import DreamsBanner from '@/components/DreamsBanner';
import FundedPropsBanner from '@/components/FundedPropsBanner';
import NocTicker from '@/components/NocTicker';
import NoundryBanner from '@/components/NoundryBanner';
import NounsIntroSection from '@/components/NounsIntroSection';
import NounsWorldBanner from '@/components/NounsWorldBanner';
import PropdatesBanner from '@/components/PropdatesBanner';
import { Bone } from '@/components/Skeleton';

const LilNounsGrid = React.lazy(() => import('@/components/LilNounsGrid'));
import { useAppDispatch, useAppSelector } from '@/hooks';
import useActiveDao from '@/hooks/useActiveDao';
import { setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';
import { nounPath } from '@/utils/history';
import useOnDisplayAuction from '@/wrappers/onDisplayAuction';
import useV2OnDisplayAuction from '@/wrappers/onDisplayAuctionV2';

type AuctionPageProps = object;

const AuctionPage: React.FC<AuctionPageProps> = () => {
  const { id: auctionId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainnetAuction = useOnDisplayAuction();
  const v2Auction = useV2OnDisplayAuction();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const { activeDao } = useActiveDao();

  // Only the root auction route honours the DAO toggle. `/noun/:id` is
  // always the mainnet Nouns archive — the historical IDs don't map to
  // the v2 fork, so we hide the switcher there and always use mainnet.
  const isRootAuctionRoute = auctionId === undefined;
  const isV2Active = isRootAuctionRoute && activeDao === 'nounv2';

  // Pick the auction shape for the active DAO. v2 has no past-auction
  // archive yet so we only resolve when on the root route.
  const onDisplayAuction = isV2Active ? v2Auction : mainnetAuction;
  const onDisplayAuctionNounId = Number(onDisplayAuction?.nounId);

  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    // The Redux-driven mainnet auction-id sync only makes sense for the
    // mainnet archive. v2 has no Ponder indexer so there's nothing to
    // mirror into Redux — skip the effect entirely when v2 is active.
    if (isV2Active) return;
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
  }, [auctionId, lastAuctionNounId, dispatch, navigate, onDisplayAuctionNounId, isV2Active]);

  // Handle ?makeArt=1 from navbar on other pages
  useEffect(() => {
    if (searchParams.get('makeArt')) {
      window.dispatchEvent(new CustomEvent('noun-make-art'));
      // Clear `makeArt` but preserve other params (e.g. `dao=nounv2` from the
      // DAO toggle — wiping all params here used to blow the toggle back to
      // the default Nouns view on any makeArt navigation).
      const next = new URLSearchParams(searchParams);
      next.delete('makeArt');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #f8f5f2 15%, #f0ebe6 40%, #e8e2dc 100%)',
      }}
    >
      <Auction auction={onDisplayAuction} />
      <Suspense fallback={<Bone w="100%" h={100} style={{ borderRadius: 0 }} />}>
        <LilNounsGrid />
      </Suspense>
      <FundedPropsBanner />
      <div className="block lg:hidden">
        <NocTicker />
      </div>
      <PropdatesBanner />
      <CurrentPropsBanner />
      <DreamsBanner />
      <NoundryBanner />
      <NounsWorldBanner />
      <div style={{ background: '#fff' }}>
        <NounsIntroSection />
        <Documentation backgroundColor="#ffffff" />
      </div>
    </div>
  );
};
export default AuctionPage;

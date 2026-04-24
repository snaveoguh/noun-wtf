import React, { Suspense, useEffect } from 'react';

import { useNavigate, useParams, useSearchParams } from 'react-router';
import { isNumber } from 'remeda';

import Auction from '@/components/Auction';
import CurrentPropsBanner from '@/components/CurrentPropsBanner';
import DaoToggle from '@/components/DaoToggle';
import Documentation from '@/components/Documentation';
import DreamsBanner from '@/components/DreamsBanner';
import FundedPropsBanner from '@/components/FundedPropsBanner';
import NocTicker from '@/components/NocTicker';
import NounV2AuctionHero from '@/components/NounV2AuctionHero';
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

type AuctionPageProps = object;

const AuctionPage: React.FC<AuctionPageProps> = () => {
  const { id: auctionId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const onDisplayAuction = useOnDisplayAuction();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const onDisplayAuctionNounId = Number(onDisplayAuction?.nounId);
  const { activeDao } = useActiveDao();

  // Only show the DAO toggle on the root route — historical /noun/:id routes
  // are always mainnet Nouns so the switcher would be misleading there.
  const isRootAuctionRoute = auctionId === undefined;
  const showNounV2Hero = isRootAuctionRoute && activeDao === 'nounv2';

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
      {isRootAuctionRoute && <DaoToggle />}
      {showNounV2Hero ? (
        <NounV2AuctionHero />
      ) : (
        <Auction auction={onDisplayAuction} />
      )}
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

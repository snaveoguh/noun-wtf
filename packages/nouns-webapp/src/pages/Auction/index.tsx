import React, { Suspense, useEffect, useMemo } from 'react';

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
import PropdatesBanner from '@/components/PropdatesBanner';
import { Bone } from '@/components/Skeleton';

// Light row (fetches ~8 blocks) instead of the full LilNounsGrid, which builds a
// 316-block pool on mount. The full grid still lives on /probe?tab=lils.
const LilNounsMintRow = React.lazy(() => import('@/components/LilNounsMintRow'));
// Above-the-fold onchain activity feed. Lazy so it can't hurt auction LCP.
const OnchainFeed = React.lazy(() => import('@/components/OnchainFeed'));
import { useAppDispatch, useAppSelector } from '@/hooks';
import useActiveDao from '@/hooks/useActiveDao';
import { setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';
import { nounPath, nounV2Path } from '@/utils/history';
import type { Auction as IAuction } from '@/wrappers/nounsAuction';
import { useV2SettledAuction } from '@/wrappers/nounV2Bids';
import useOnDisplayAuction from '@/wrappers/onDisplayAuction';
import useV2OnDisplayAuction from '@/wrappers/onDisplayAuctionV2';

type AuctionPageProps = object;

const AuctionPage: React.FC<AuctionPageProps> = () => {
  const { id: auctionId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainnetAuction = useOnDisplayAuction();
  const v2LiveAuction = useV2OnDisplayAuction();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const { activeDao } = useActiveDao();
  const isV2 = activeDao === 'nounv2';

  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  // For a past "/v2/noun/:id" (not the live auction) pull the settled amount /
  // winner / times from the indexer. Without this the stub below would show a
  // hardcoded "0.00 ETH" winning bid. `undefined` for the live noun or non-V2.
  const requestedV2Id =
    isV2 && auctionId !== undefined && Number.isFinite(Number(auctionId)) && Number(auctionId) >= 0
      ? Number(auctionId)
      : undefined;
  const isLiveV2 =
    requestedV2Id !== undefined &&
    v2LiveAuction !== undefined &&
    Number(v2LiveAuction.nounId) === requestedV2Id;
  const pastV2NounId =
    requestedV2Id !== undefined && !isLiveV2 ? BigInt(requestedV2Id) : undefined;
  const v2Settled = useV2SettledAuction(pastV2NounId);

  // Build the auction object for the active route. V2 lacks an on-chain
  // history for past auctions so we synthesise a settled stub, backfilling the
  // winning bid / winner / times from the indexer (`v2Settled`) when available.
  // The hero still renders (seed + ownerOf load on-chain inside Auction) and
  // bid history falls back gracefully.
  const onDisplayAuction: IAuction | undefined = useMemo(() => {
    if (!isV2) return mainnetAuction;
    if (auctionId === undefined) return v2LiveAuction;

    const requestedId = Number(auctionId);
    if (!Number.isFinite(requestedId) || requestedId < 0) return v2LiveAuction;

    if (
      v2LiveAuction !== undefined &&
      Number(v2LiveAuction.nounId) === requestedId
    ) {
      return v2LiveAuction;
    }

    return {
      nounId: BigInt(requestedId),
      amount: v2Settled?.amount ?? 0n,
      startTime: v2Settled?.startTime ?? 0n,
      endTime: v2Settled?.endTime ?? 0n,
      bidder: v2Settled?.winner,
      settled: v2Settled?.settled ?? true,
      clientId: null,
      burned: false,
    };
  }, [isV2, auctionId, mainnetAuction, v2LiveAuction, v2Settled]);

  const onDisplayAuctionNounId = Number(onDisplayAuction?.nounId);

  useEffect(() => {
    // The Redux-driven mainnet auction-id sync only makes sense for the
    // mainnet archive. v2 has no Ponder indexer so there's nothing to
    // mirror into Redux — skip the effect entirely when v2 is active.
    if (isV2) return;
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
  }, [auctionId, lastAuctionNounId, dispatch, navigate, onDisplayAuctionNounId, isV2]);

  // Bound-check the V2 noun id against the live auction. Out-of-range ids
  // (e.g. `/v2/noun/9999`) snap back to the live auction so the page never
  // renders an empty noun.
  useEffect(() => {
    if (!isV2 || auctionId === undefined || v2LiveAuction === undefined) return;
    const requestedId = Number(auctionId);
    const liveId = Number(v2LiveAuction.nounId);
    if (!Number.isFinite(requestedId) || requestedId < 0 || requestedId > liveId) {
      navigate(nounV2Path(liveId), { replace: true });
    }
  }, [isV2, auctionId, v2LiveAuction, navigate]);

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
      <Suspense fallback={<Bone w="100%" h={120} style={{ borderRadius: 0 }} />}>
        <OnchainFeed />
      </Suspense>
      <Auction auction={onDisplayAuction} />
      <Suspense fallback={<Bone w="100%" h={100} style={{ borderRadius: 0 }} />}>
        <LilNounsMintRow />
      </Suspense>
      <FundedPropsBanner />
      <div className="block lg:hidden">
        <NocTicker />
      </div>
      <PropdatesBanner />
      <CurrentPropsBanner />
      <DreamsBanner />
      <NoundryBanner />
      <div style={{ background: '#fff' }}>
        <NounsIntroSection />
        <Documentation backgroundColor="#ffffff" />
      </div>
    </div>
  );
};
export default AuctionPage;

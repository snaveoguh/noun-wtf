/**
 * /gamer/:identity · /explore/wallet/:identity — per-wallet "gamer profile"
 * for Nouns DAO: everything the wallet has done in and around the DAO, an AI
 * overview, and the owner's Autopilot panel.
 *
 * Without an identity: the connected wallet's own profile, else a search box.
 * Renders inside the normal app shell in both themes (Dice / Terminal).
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import { useLocation, useParams, useSearchParams } from 'react-router';
import { useAccount } from 'wagmi';

import { ActivityTab } from './ActivityTab';
import { useWalletProfile } from './api';
import { AuctionsTab, NounsTab, TreasuryTab } from './AssetTabs';
import { AutopilotPanel } from './AutopilotPanel';
import { fmtInt } from './format';
import { CandidatesTab, OverviewTab, ProposalsTab, VotesTab } from './GovernanceTabs';
import { OverviewCard, ProfileHeader, StatTiles, StatTilesSkeleton } from './ProfileHeader';
import { PROFILE_TABS, type ProfileTab, type WalletProfile } from './types';
import { Card, Empty, Skeleton } from './ui';
import { profileFixtureEnabled } from './walletProfileFixtures';
import { WalletSearch } from './WalletSearch';

import './WalletProfile.css';

const IdentityGraphTab = lazy(() => import('./IdentityGraphTab'));

const isTab = (v: string | null): v is ProfileTab => PROFILE_TABS.some(t => t.key === v);

function tabCount(profile: WalletProfile | undefined, key: ProfileTab): number | null {
  if (!profile) return null;
  switch (key) {
    case 'votes':
      return profile.voting?.total ?? profile.voting?.recent?.length ?? null;
    case 'proposals':
      return (
        (profile.proposals?.authored?.length ?? 0) + (profile.proposals?.signed?.length ?? 0) ||
        null
      );
    case 'candidates':
      return (
        (profile.candidates?.authored?.length ?? 0) +
          (profile.candidates?.sponsored?.length ?? 0) || null
      );
    case 'auctions':
      return profile.auctions?.wonCount ?? profile.auctions?.won?.length ?? null;
    case 'nouns':
      return profile.holdings?.count ?? profile.holdings?.nouns?.length ?? null;
    case 'treasury':
      return profile.treasury?.streams?.length ?? null;
    default:
      return null;
  }
}

const WalletProfilePage: React.FC = () => {
  const { identity: paramIdentity } = useParams<{ identity?: string }>();
  const { address: connected } = useAccount();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = profileFixtureEnabled();

  const basePath = location.pathname.startsWith('/explore/wallet') ? '/explore/wallet' : '/gamer';
  const identity = paramIdentity ?? connected ?? undefined;

  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState<ProfileTab>(isTab(tabParam) ? tabParam : 'overview');
  useEffect(() => {
    const current = searchParams.get('tab');
    if (isTab(current) && current !== tab) {
      // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
      setTab(current);
    } else if (current == null && tab !== 'overview') {
      setTab('overview');
    }
    // Only react to URL changes (back/forward); the click handler writes the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  const selectTab = useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      setTab(next);
      const sp = new URLSearchParams(searchParams);
      if (next === 'overview') sp.delete('tab');
      else sp.set('tab', next);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const q = useWalletProfile(identity);
  const profile = q.data;

  const profileAddress =
    profile?.identity?.address ?? (identity?.startsWith('0x') === true ? identity : undefined);
  const isOwner = useMemo(() => {
    if (fixture) return true;
    if (!connected) return false;
    if (profileAddress != null) return profileAddress.toLowerCase() === connected.toLowerCase();
    return paramIdentity == null;
  }, [fixture, connected, profileAddress, paramIdentity]);

  if (!identity) {
    return (
      <div className="wp mt-1 px-2 pb-10 sm:px-4 lg:px-6">
        <WalletSearch basePath={basePath} />
      </div>
    );
  }

  return (
    <div className="wp mt-1 grid gap-3 px-2 pb-10 pt-3 sm:px-4 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="wp-muted text-[11px] uppercase tracking-widest">Gamer profile</div>
        <div className="w-full sm:w-80">
          <WalletSearch compact initial={paramIdentity ?? ''} basePath={basePath} />
        </div>
      </div>

      {q.isLoading && (
        <>
          <div className="wp-card flex gap-4">
            <Skeleton h={96} w="96px" />
            <div className="flex-1">
              <Skeleton h={24} w="40%" />
              <Skeleton h={12} w="60%" className="mt-3" />
              <Skeleton h={12} w="50%" className="mt-2" />
            </div>
          </div>
          <StatTilesSkeleton />
          <Card title="AI overview">
            <Skeleton h={60} />
          </Card>
        </>
      )}

      {q.isError && (
        <Card>
          <Empty>
            {q.error.message === 'not found'
              ? `No Nouns footprint found for "${identity}". Check the ENS or address.`
              : `Could not load profile: ${q.error.message}`}
          </Empty>
        </Card>
      )}

      {profile != null && (
        <>
          <ProfileHeader profile={profile} identity={identity} isOwner={isOwner} />
          <StatTiles profile={profile} />
          <OverviewCard profile={profile} identity={identity} />
          <AutopilotPanel
            address={profileAddress ?? identity}
            isOwner={isOwner}
            enabledHint={profile.autopilot?.enabled === true}
          />

          <div className="wp-tabs" role="tablist">
            {PROFILE_TABS.map(t => {
              const n = tabCount(profile, t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`wp-tab ${tab === t.key ? 'active' : ''}`}
                  onClick={() => selectTab(t.key)}
                >
                  {t.label}
                  {n != null && n > 0 && <span className="wp-tab-count">{fmtInt(n)}</span>}
                </button>
              );
            })}
          </div>

          {tab === 'overview' && <OverviewTab profile={profile} onTab={selectTab} />}
          {tab === 'votes' && <VotesTab profile={profile} />}
          {tab === 'proposals' && <ProposalsTab profile={profile} />}
          {tab === 'candidates' && <CandidatesTab profile={profile} />}
          {tab === 'auctions' && <AuctionsTab profile={profile} />}
          {tab === 'nouns' && <NounsTab profile={profile} />}
          {tab === 'treasury' && <TreasuryTab profile={profile} />}
          {tab === 'activity' && <ActivityTab identity={identity} />}
          {tab === 'graph' && (
            <Suspense
              fallback={
                <Card>
                  <Skeleton h={300} />
                </Card>
              }
            >
              <IdentityGraphTab />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
};

export default WalletProfilePage;

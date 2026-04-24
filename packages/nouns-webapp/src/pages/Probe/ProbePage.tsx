import { lazy, Suspense, useEffect, useState } from 'react';

import { useNavigate, useSearchParams } from 'react-router';

import { GenericSkeleton } from '@/components/Skeleton';
import { useActiveDao } from '@/hooks/useActiveDao';

import ExploreTab from './ExploreTab';

const DreamsTab = lazy(() => import('./DreamsTab'));
const LilNounsTab = lazy(() => import('./LilNounsTab'));
const TerraformsProbeTab = lazy(() => import('./TerraformsProbeTab'));
const YellowCollectiveTab = lazy(() => import('./YellowCollectiveTab'));
const BitnounsTab = lazy(() => import('./BitnounsTab'));

type ProbeTab = 'explore' | 'dreams' | 'lils' | 'terraforms' | 'yellow' | 'bitnouns';

const TAB_CONFIG: { key: ProbeTab; label: string }[] = [
  { key: 'explore', label: 'Nouns' },
  { key: 'dreams', label: 'Dreams' },
  { key: 'lils', label: 'Lils' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'bitnouns', label: 'bitNouns' },
  { key: 'terraforms', label: 'Terraforms' },
];

const ProbePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setActiveDao } = useActiveDao();
  const initialTab = (searchParams.get('tab') as ProbeTab) || 'explore';
  const [tab, setTab] = useState<ProbeTab>(
    TAB_CONFIG.some(t => t.key === initialTab) ? initialTab : 'explore',
  );

  useEffect(() => {
    const current = searchParams.get('tab') || 'explore';
    if (current !== tab) {
      setSearchParams(tab === 'explore' ? {} : { tab }, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  const onJumpToV2 = () => {
    setActiveDao('nounv2');
    navigate('/?dao=nounv2');
  };

  return (
    <div className="mt-1 px-2 sm:px-4 lg:px-6">
      {/* Tab Bar */}
      <div className="mb-2 flex gap-1.5 border-b pb-2 pt-3 sm:gap-2 sm:pt-4">
        <button
          type="button"
          onClick={onJumpToV2}
          aria-label="Jump to NounV2 auction"
          className="relative flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white shadow-[0_1px_2px_rgba(220,38,38,0.35)] transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 sm:px-4 sm:py-1.5 sm:text-sm"
        >
          <span className="leading-none">V2</span>
          <span className="rounded-sm bg-white px-1 py-[1px] text-[0.5rem] font-extrabold uppercase tracking-[0.08em] text-red-600">
            New
          </span>
        </button>
        {TAB_CONFIG.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors sm:px-4 sm:py-1.5 sm:text-sm ${
              tab === t.key ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'explore' && <ExploreTab />}
      {tab === 'dreams' && (
        <Suspense fallback={<GenericSkeleton />}>
          <DreamsTab />
        </Suspense>
      )}
      {tab === 'lils' && (
        <Suspense fallback={<GenericSkeleton />}>
          <LilNounsTab />
        </Suspense>
      )}
      {tab === 'yellow' && (
        <Suspense fallback={<GenericSkeleton />}>
          <YellowCollectiveTab />
        </Suspense>
      )}
      {tab === 'bitnouns' && (
        <Suspense fallback={<GenericSkeleton />}>
          <BitnounsTab />
        </Suspense>
      )}
      {tab === 'terraforms' && (
        <Suspense fallback={<GenericSkeleton />}>
          <TerraformsProbeTab />
        </Suspense>
      )}
    </div>
  );
};

export default ProbePage;

import { lazy, Suspense, useEffect, useState } from 'react';

import { useSearchParams } from 'react-router';

import { GenericSkeleton } from '@/components/Skeleton';

import ExploreTab from './ExploreTab';

const DreamsTab = lazy(() => import('./DreamsTab'));
const LilNounsTab = lazy(() => import('./LilNounsTab'));

type ProbeTab = 'explore' | 'dreams' | 'lils';

const TAB_CONFIG: { key: ProbeTab; label: string }[] = [
  { key: 'explore', label: 'Nouns' },
  { key: 'dreams', label: 'Dreams' },
  { key: 'lils', label: 'Lil Nouns' },
];

const ProbePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ProbeTab) || 'explore';
  const [tab, setTab] = useState<ProbeTab>(
    TAB_CONFIG.some(t => t.key === initialTab) ? initialTab : 'explore',
  );

  // Sync tab to URL
  useEffect(() => {
    const current = searchParams.get('tab') || 'explore';
    if (current !== tab) {
      setSearchParams(tab === 'explore' ? {} : { tab }, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  return (
    <div className="mx-auto mt-1 px-4">
      {/* Tab Bar */}
      <div className="mb-2 flex gap-2 border-b pb-2 pt-4">
        {TAB_CONFIG.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
              tab === t.key
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
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
    </div>
  );
};

export default ProbePage;

import { lazy, Suspense, useEffect, useState } from 'react';

import { useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { GenericSkeleton } from '@/components/Skeleton';

import ExploreTab from './ExploreTab';

const DreamsTab = lazy(() => import('./DreamsTab'));
const LilNounsTab = lazy(() => import('./LilNounsTab'));
const TerraformsProbeTab = lazy(() => import('./TerraformsProbeTab'));
const BorgsTab = lazy(() => import('./BorgsTab'));
const BitnounsTab = lazy(() => import('./BitnounsTab'));
const V2ExploreTab = lazy(() => import('./V2ExploreTab'));

type ProbeTab = 'v2' | 'explore' | 'dreams' | 'lils' | 'terraforms' | 'borgs' | 'bitnouns';

const TAB_CONFIG: { key: ProbeTab; label: string }[] = [
  { key: 'explore', label: 'Nouns' },
  { key: 'dreams', label: 'Dreams' },
  { key: 'lils', label: 'Lils' },
  { key: 'borgs', label: 'Borgs' },
  { key: 'bitnouns', label: 'bitNouns' },
  { key: 'terraforms', label: 'Terraforms' },
];

const ProbePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as ProbeTab) || 'explore';
  const isValidTab = initialTab === 'v2' || TAB_CONFIG.some(t => t.key === initialTab);
  const [tab, setTab] = useState<ProbeTab>(isValidTab ? initialTab : 'explore');

  useEffect(() => {
    const current = searchParams.get('tab') || 'explore';
    if (current !== tab) {
      setSearchParams(tab === 'explore' ? {} : { tab }, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  return (
    <div className="mt-1 px-2 sm:px-4 lg:px-6">
      {/* Tab Bar */}
      <div className="mb-2 flex gap-1.5 border-b pb-2 pt-3 sm:gap-2 sm:pt-4">
        <button
          type="button"
          onClick={() => setTab('v2')}
          aria-label="Browse NounV2 tokens"
          className={`relative flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-white shadow-[0_1px_2px_rgba(220,38,38,0.35)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 sm:px-4 sm:py-1.5 sm:text-sm ${
            tab === 'v2'
              ? 'bg-red-700 ring-2 ring-red-500 ring-offset-1'
              : 'bg-red-600 hover:bg-red-700'
          }`}
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
        {/* ⌐◨-◨ copy-paste, restored from probe.wtf's old header */}
        <button
          type="button"
          title="Copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText('⌐◨-◨');
              toast.success('⌐◨-◨ copied', { duration: 3000 });
            } catch (err) {
              console.error('Failed to copy:', err);
            }
          }}
          className="ml-auto shrink-0 cursor-grab self-center px-2 text-xs font-bold text-gray-600 transition-colors hover:text-black sm:text-sm"
        >
          {'⌐◨-◨'}
        </button>
      </div>

      {tab === 'v2' && (
        <Suspense fallback={<GenericSkeleton />}>
          <V2ExploreTab />
        </Suspense>
      )}
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
      {tab === 'borgs' && (
        <Suspense fallback={<GenericSkeleton />}>
          <BorgsTab />
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

/**
 * VotePageRouter — Routes /vote/:id to either the standard Nouns VotePage
 * or the Yellow Collective VotePage based on ?dao=yc query param.
 */
import { lazy, Suspense } from 'react';

import { useSearchParams } from 'react-router';

import { GenericSkeleton } from '@/components/Skeleton';

const VotePage = lazy(() => import('./index'));
const YellowCollectiveVotePage = lazy(() => import('./YellowCollectiveVotePage'));

const VotePageRouter: React.FC = () => {
  const [searchParams] = useSearchParams();
  const isYC = searchParams.get('dao') === 'yc';

  return (
    <Suspense fallback={<GenericSkeleton />}>
      {isYC ? <YellowCollectiveVotePage /> : <VotePage />}
    </Suspense>
  );
};

export default VotePageRouter;

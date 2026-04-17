/**
 * VotePageRouter — Routes /vote/:id to the right detail page based on ?dao=:
 *   ?dao=yc  → Yellow Collective (Snapshot)
 *   ?dao=lil → Lil Nouns (Goldsky subgraph via /api/lil-proposals/:id)
 *   default  → Nouns DAO
 */
import { lazy, Suspense } from 'react';

import { useSearchParams } from 'react-router';

import { GenericSkeleton } from '@/components/Skeleton';

const VotePage = lazy(() => import('./index'));
const YellowCollectiveVotePage = lazy(() => import('./YellowCollectiveVotePage'));
const LilNounsVotePage = lazy(() => import('./LilNounsVotePage'));

const VotePageRouter: React.FC = () => {
  const [searchParams] = useSearchParams();
  const dao = searchParams.get('dao');

  return (
    <Suspense fallback={<GenericSkeleton />}>
      {dao === 'yc' ? (
        <YellowCollectiveVotePage />
      ) : dao === 'lil' || dao === 'lil-nouns' || dao === 'lilnouns' ? (
        <LilNounsVotePage />
      ) : (
        <VotePage />
      )}
    </Suspense>
  );
};

export default VotePageRouter;

import { useParams } from 'react-router';

import { NounDetailView } from '@/components/Marketplace/NounDetailView';

export default function NounDetailPage() {
  const { nounId } = useParams<{ nounId: string }>();
  const id = Number(nounId);

  if (!Number.isFinite(id) || id < 0) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-londrina text-3xl">Noun Not Found</h1>
        <p className="mt-2 text-sm text-neutral-500">
          The Noun &ldquo;{nounId}&rdquo; could not be located.
        </p>
      </div>
    );
  }

  return <NounDetailView nounId={id} />;
}

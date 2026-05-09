import { FC, useEffect, useMemo, useState } from 'react';

import { ImageDataV2 as ImageData, getNounDataV2 as getNounData } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';
import { Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { type SavedDream, deleteDream, loadDreams } from '@/lib/dreamStorage';

function DreamCard({ dream, onDelete }: { dream: SavedDream; onDelete: (id: string) => void }) {
  const svgUri = useMemo(() => {
    try {
      const { parts, background } = getNounData(dream.seed);
      const svg = buildSVG(parts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [dream.seed]);

  return (
    <div className="group relative overflow-hidden rounded-2xl border-2 border-black bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
      {/* Delete button — visible on hover */}
      <button
        onClick={() => onDelete(dream.id)}
        className="absolute right-2 top-2 z-10 hidden rounded-full bg-red-500 p-1.5 text-white transition-colors hover:bg-red-600 group-hover:block"
        title="Delete dream"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {/* Lil-sized Noun preview */}
      <div
        className="flex items-center justify-center py-4"
        style={{ backgroundColor: `#${ImageData.bgcolors[dream.seed.background] ?? 'd5d7e1'}` }}
      >
        {svgUri && (
          <img
            src={svgUri}
            alt={dream.title}
            className="h-24 w-24 transition-transform group-hover:scale-110"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-bold">{dream.title}</h3>
        {dream.description && (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{dream.description}</p>
        )}
        <div className="text-muted-foreground mt-2 text-xs">
          {new Date(dream.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

const DreamsPage: FC = () => {
  const [dreams, setDreams] = useState<SavedDream[]>([]);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');

  // Load from localStorage on mount + listen for updates + poll for cross-tab
  // / out-of-band changes (the storage event only fires on OTHER tabs, so the
  // 15s interval picks up dreams created elsewhere on this same tab without
  // a hard reload).
  useEffect(() => {
    setDreams(loadDreams());

    const handler = () => setDreams(loadDreams());
    window.addEventListener('storage', handler);
    window.addEventListener('dreams-updated', handler);
    const intervalId = window.setInterval(handler, 15_000);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('dreams-updated', handler);
      window.clearInterval(intervalId);
    };
  }, []);

  const sortedDreams = useMemo(() => {
    const sorted = [...dreams];
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
    } else {
      sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
    return sorted;
  }, [sortBy, dreams]);

  const handleDelete = (id: string) => {
    deleteDream(id);
    setDreams(loadDreams());
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Dreams</h1>
          <p className="text-muted-foreground mt-1">
            Your dreamed-up Nouns. Create, collect, admire.
          </p>
        </div>
        <Link to="/dreams/create">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Create Dream
          </Button>
        </Link>
      </div>

      {dreams.length > 0 && (
        <div className="mb-4 flex gap-2">
          <Button
            variant={sortBy === 'newest' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy('newest')}
          >
            Newest
          </Button>
          <Button
            variant={sortBy === 'oldest' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy('oldest')}
          >
            Oldest
          </Button>
        </div>
      )}

      {sortedDreams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="mb-2 text-6xl">💭</p>
          <p className="mb-2 text-2xl font-bold">No dreams yet</p>
          <p className="text-muted-foreground mb-6">
            Create your first Noun dream and it will appear here
          </p>
          <Link to="/dreams/create">
            <Button className="gap-2" size="lg">
              <Plus className="h-4 w-4" />
              Create Your First Dream
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sortedDreams.map(dream => (
            <DreamCard key={dream.id} dream={dream} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
};

export default DreamsPage;

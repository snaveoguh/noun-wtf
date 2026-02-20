import { FC, useMemo, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { INounSeed } from '@/wrappers/nounToken';

// Demo dreams (will be replaced with API data)
const DEMO_DREAMS: Dream[] = [
  {
    id: '1',
    title: 'Cosmic Noun',
    description: 'A noun inspired by the cosmos, with stars in its eyes.',
    creator: '0x1234...5678',
    seed: { background: 1, body: 17, accessory: 41, head: 112, glasses: 8 },
    votes: 42,
    createdAt: new Date('2024-01-15'),
    status: 'published',
  },
  {
    id: '2',
    title: 'Garden Noun',
    description: 'A peaceful garden-themed noun with flowery accessories.',
    creator: '0xabcd...ef01',
    seed: { background: 0, body: 5, accessory: 22, head: 88, glasses: 3 },
    votes: 28,
    createdAt: new Date('2024-02-20'),
    status: 'published',
  },
  {
    id: '3',
    title: 'Cyber Noun',
    description: 'A futuristic noun for the digital age.',
    creator: '0x9876...5432',
    seed: { background: 1, body: 24, accessory: 55, head: 150, glasses: 12 },
    votes: 65,
    createdAt: new Date('2024-03-10'),
    status: 'published',
  },
  {
    id: '4',
    title: 'Ocean Noun',
    description: 'A deep-sea inspired noun, swimming through the blockchain.',
    creator: '0xfeed...beef',
    seed: { background: 0, body: 10, accessory: 30, head: 45, glasses: 5 },
    votes: 19,
    createdAt: new Date('2024-04-01'),
    status: 'published',
  },
];

interface Dream {
  id: string;
  title: string;
  description: string;
  creator: string;
  seed: INounSeed;
  votes: number;
  createdAt: Date;
  status: 'draft' | 'published' | 'proposed';
}

function DreamCard({ dream }: { dream: Dream }) {
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
    <div className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-lg">
      <div
        className="p-4"
        style={{ backgroundColor: `#${ImageData.bgcolors[dream.seed.background]}` }}
      >
        {svgUri && (
          <img
            src={svgUri}
            alt={dream.title}
            className="mx-auto h-48 w-48"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>
      <div className="p-4">
        <h3 className="text-lg font-bold">{dream.title}</h3>
        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{dream.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-muted-foreground text-xs">{dream.creator}</span>
          <div className="flex items-center gap-1">
            <span className="text-lg">❤️</span>
            <span className="text-sm font-bold">{dream.votes}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const DreamsPage: FC = () => {
  const [sortBy, setSortBy] = useState<'votes' | 'newest'>('votes');

  const sortedDreams = useMemo(() => {
    const sorted = [...DEMO_DREAMS];
    if (sortBy === 'votes') {
      sorted.sort((a, b) => b.votes - a.votes);
    } else {
      sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return sorted;
  }, [sortBy]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Dreams</h1>
          <p className="text-muted-foreground mt-1">
            Community-created Noun designs. Vote for your favorites!
          </p>
        </div>
        <Link to="/dreams/create">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Create Dream
          </Button>
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <Button
          variant={sortBy === 'votes' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSortBy('votes')}
        >
          Most Voted
        </Button>
        <Button
          variant={sortBy === 'newest' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSortBy('newest')}
        >
          Newest
        </Button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedDreams.map(dream => (
          <DreamCard key={dream.id} dream={dream} />
        ))}
      </div>
    </div>
  );
};

export default DreamsPage;

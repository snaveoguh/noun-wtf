import { useCallback, useEffect, useState } from 'react';

interface FarcasterCast {
  hash: string;
  text: string;
  timestamp: string;
  author: {
    fid: number;
    username: string;
    display_name: string;
    pfp_url: string;
  };
  reactions: {
    likes_count: number;
    recasts_count: number;
  };
  replies: {
    count: number;
  };
  embeds?: Array<{ url?: string; metadata?: { image?: { width_px: number } } }>;
}

type FeedTab = 'all' | 'nouns' | 'noc';

const TAB_LABELS: Record<FeedTab, string> = {
  all: 'ALL',
  nouns: '/NOUNS',
  noc: '/NOC',
};

const API_URL = import.meta.env.VITE_API_URL || 'https://spirited-flexibility-production-3c30.up.railway.app';

const fetchChannel = async (channel: string): Promise<FarcasterCast[]> => {
  const res = await fetch(`${API_URL}/api/feed/${channel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.casts ?? [];
};

const FeedPage: React.FC = () => {
  const [tab, setTab] = useState<FeedTab>('all');
  const [casts, setCasts] = useState<FarcasterCast[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeed = useCallback(async (activeTab: FeedTab) => {
    setIsLoading(true);
    setError(null);
    try {
      let results: FarcasterCast[];

      if (activeTab === 'all') {
        // Fetch both channels in parallel, merge by timestamp
        const [nouns, noc] = await Promise.all([
          fetchChannel('nouns'),
          fetchChannel('noc'),
        ]);
        results = [...nouns, ...noc].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      } else {
        results = await fetchChannel(activeTab);
      }

      setCasts(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed(tab);
  }, [tab, fetchFeed]);

  const timeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">Activity Feed</h1>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b pb-2">
        {(['all', 'nouns', 'noc'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
              tab === t
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-black" />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}. The Feed backend may not be deployed yet.
          <button onClick={() => fetchFeed(tab)} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && casts.length === 0 && (
        <div className="py-12 text-center text-gray-400">No activity yet</div>
      )}

      {/* Cast list */}
      <div className="flex flex-col gap-3">
        {casts.map(cast => (
          <div key={cast.hash} className="rounded-lg border p-4 transition-colors hover:bg-gray-50">
            <div className="mb-2 flex items-center gap-2">
              {cast.author.pfp_url && (
                <img
                  src={cast.author.pfp_url}
                  alt=""
                  className="h-8 w-8 rounded-full"
                  loading="lazy"
                />
              )}
              <div className="flex flex-col">
                <span className="text-sm font-bold">{cast.author.display_name}</span>
                <span className="text-xs text-gray-400">@{cast.author.username}</span>
              </div>
              <span className="ml-auto text-xs text-gray-400">{timeAgo(cast.timestamp)}</span>
            </div>
            <p className="text-sm" style={{ textTransform: 'none' }}>
              {cast.text}
            </p>
            {/* Embedded images */}
            {cast.embeds?.some(e => e.metadata?.image) && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {cast.embeds
                  ?.filter(e => e.url && e.metadata?.image)
                  .map((e, i) => (
                    <img
                      key={i}
                      src={e.url}
                      alt=""
                      className="max-h-48 rounded-lg object-cover"
                      loading="lazy"
                    />
                  ))}
              </div>
            )}
            <div className="mt-2 flex gap-4 text-xs text-gray-400">
              <span>♥ {cast.reactions.likes_count}</span>
              <span>🔁 {cast.reactions.recasts_count}</span>
              <span>💬 {cast.replies?.count ?? 0}</span>
              <a
                href={`https://warpcast.com/~/conversations/${cast.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-blue-400 hover:text-blue-600"
              >
                View on Warpcast
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FeedPage;

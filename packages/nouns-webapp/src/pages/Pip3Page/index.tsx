import { useCallback, useEffect, useRef, useState } from 'react';

import useModalBodyLock from '@/hooks/useModalBodyLock';

// ─── Giphy channel feed (no API key needed) ─────────────────────────────────

const CHANNEL_ID = '19207767'; // 60r90
const PAGE_SIZE = 50;

interface GifItem {
  id: string;
  w: number;
  h: number;
}

const API_BASE = import.meta.env.VITE_MAINNET_SUBGRAPH
  || 'https://spirited-flexibility-production-3c30.up.railway.app';

async function fetchPage(offset: number): Promise<{ gifs: GifItem[]; hasNext: boolean }> {
  try {
    const res = await fetch(
      `${API_BASE}/api/pip3-gifs?channel=${CHANNEL_ID}&offset=${offset}&limit=${PAGE_SIZE}`,
    );
    if (!res.ok) return { gifs: [], hasNext: false };
    const data = await res.json();
    const results: GifItem[] = (data.results || []).map(
      (item: {
        id: string;
        images?: {
          source?: { width?: string | number; height?: string | number };
          original?: { width?: string | number; height?: string | number };
          fixed_width?: { width?: string | number; height?: string | number };
        };
      }) => {
        const dims = item.images?.source ?? item.images?.original ?? item.images?.fixed_width;
        return {
          id: item.id,
          w: Number(dims?.width || 480),
          h: Number(dims?.height || 480),
        };
      },
    );
    return { gifs: results, hasNext: !!data.next };
  } catch {
    return { gifs: [], hasNext: false };
  }
}

// ─── Pip3 Page ──────────────────────────────────────────────────────────────

const gifUrl = (id: string) => `https://media.giphy.com/media/${id}/giphy.gif`;

const Pip3Page: React.FC = () => {
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useModalBodyLock(expanded !== null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    const { gifs: newGifs, hasNext } = await fetchPage(offset);
    if (newGifs.length === 0) {
      setHasMore(false);
      setLoading(false);
      setInitialLoad(false);
      return;
    }

    setGifs(prev => {
      const existingIds = new Set(prev.map(g => g.id));
      const deduped = newGifs.filter(g => !existingIds.has(g.id));
      return [...prev, ...deduped];
    });
    setOffset(prev => prev + newGifs.length);
    setHasMore(hasNext);
    setLoading(false);
    setInitialLoad(false);
  }, [offset, loading, hasMore]);

  // Initial load
  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          loadMore();
        }
      },
      { rootMargin: '800px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, loading, hasMore]);

  // Close expanded on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000',
      padding: '0 0 80px',
    }}>
      {/* Pip3 @font-face lives in index.css. The pro theme sets Comic Sans on *
          with !important, so this class rule needs [data-theme] + !important
          to out-rank it. */}
      <style>{`
        .pip3-type,
        [data-theme] .pip3-type {
          font-family: 'Pip3', 'PT Root UI', sans-serif !important;
          text-transform: uppercase;
        }
      `}</style>
      {/* Header */}
      <div style={{
        padding: '48px 20px 32px',
        textAlign: 'center',
      }}>
        <h1 className="pip3-type" style={{
          fontSize: '3rem',
          fontWeight: 400,
          color: '#fff',
          margin: 0,
          letterSpacing: '0.02em',
        }}>
          pip3
        </h1>
        <a
          href="https://giphy.com/channel/60r90"
          target="_blank"
          rel="noreferrer"
          className="pip3-type"
          style={{
            fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.3)',
            margin: '8px 0 0',
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            display: 'inline-block',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
        >
          by 60r90
        </a>
      </div>

      {/* Initial loading */}
      {initialLoad && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '80px 0',
        }}>
          <div style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: 'rgba(255,255,255,0.6)',
            borderRadius: '50%',
            animation: 'pip3-spin 0.8s linear infinite',
          }} />
          <style>{`@keyframes pip3-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Expanded overlay */}
      {expanded && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 20,
          }}
          onClick={() => setExpanded(null)}
        >
          <img
            src={gifUrl(expanded)}
            alt=""
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              objectFit: 'contain',
            }}
          />
          <div style={{
            position: 'absolute',
            top: 20,
            right: 24,
            color: 'rgba(255,255,255,0.4)',
            fontSize: '1.5rem',
            fontWeight: 300,
          }}>
            {'\u00D7'}
          </div>
        </div>
      )}

      {/* Masonry grid */}
      <style>{`
        @media (max-width: 1600px) { .pip3-grid { column-count: 18 !important; } }
        @media (max-width: 1200px) { .pip3-grid { column-count: 12 !important; } }
        @media (max-width: 900px)  { .pip3-grid { column-count: 8 !important; } }
        @media (max-width: 600px)  { .pip3-grid { column-count: 5 !important; column-gap: 3px !important; padding: 0 3px !important; } }
        @media (max-width: 400px)  { .pip3-grid { column-count: 4 !important; } }
      `}</style>
      {gifs.length > 0 && (
        <div
          className="pip3-grid"
          style={{
            columnCount: 25,
            columnGap: 4,
            padding: '0 6px',
            maxWidth: '100%',
            margin: '0 auto',
          }}
        >
          {gifs.map(gif => (
            <div
              key={gif.id}
              style={{
                marginBottom: 6,
                breakInside: 'avoid',
                borderRadius: 6,
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.03)',
                cursor: 'pointer',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              onClick={() => setExpanded(gif.id)}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.02)';
                e.currentTarget.style.boxShadow = '0 8px 30px rgba(255,255,255,0.06)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = '';
              }}
            >
              <img
                src={gifUrl(gif.id)}
                alt=""
                loading="lazy"
                style={{
                  width: '100%',
                  height: 'auto',
                  aspectRatio: `${gif.w} / ${gif.h}`,
                  display: 'block',
                  objectFit: 'cover',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} style={{ height: 1, width: '100%' }} />

      {/* Loading more indicator */}
      {loading && !initialLoad && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '40px 0',
        }}>
          <div style={{
            width: 24,
            height: 24,
            border: '2px solid rgba(255,255,255,0.1)',
            borderTopColor: 'rgba(255,255,255,0.5)',
            borderRadius: '50%',
            animation: 'pip3-spin 0.8s linear infinite',
          }} />
        </div>
      )}

      {/* End of feed */}
      {!hasMore && gifs.length > 0 && (
        <div className="pip3-type" style={{
          textAlign: 'center',
          padding: '40px 0',
          color: 'rgba(255,255,255,0.2)',
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.15em',
        }}>
          {gifs.length} gifs
        </div>
      )}

      {/* Giphy attribution */}
      <div style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        opacity: 0.25,
        transition: 'opacity 0.2s',
        zIndex: 10,
      }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.6'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.25'; }}
      >
        <a
          href="https://giphy.com/channel/60r90"
          target="_blank"
          rel="noreferrer"
          className="pip3-type"
          style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: '0.55rem',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Powered by GIPHY
        </a>
      </div>
    </div>
  );
};

export default Pip3Page;

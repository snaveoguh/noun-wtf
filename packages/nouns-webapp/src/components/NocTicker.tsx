import { FC, useCallback, useEffect, useRef, useState } from 'react';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';

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
}

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

/**
 * Horizontal auto-scrolling ticker of /noc Farcaster channel casts.
 * Sits directly under the auction section on the homepage.
 */
const NocTicker: FC = () => {
  const [casts, setCasts] = useState<FarcasterCast[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const fetchCasts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/feed/noc`);
      if (!res.ok) return;
      const data = await res.json();
      setCasts(data.casts ?? []);
    } catch {
      // Silently fail — ticker is non-critical
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchCasts();
    // Refresh every 2 min
    const iv = setInterval(fetchCasts, 120_000);
    return () => clearInterval(iv);
  }, [fetchCasts]);

  // Auto-scroll animation
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || casts.length === 0) return;

    const speed = 0.5; // px per frame
    let pos = 0;

    const tick = () => {
      if (!pausedRef.current) {
        pos += speed;
        // When we've scrolled past the first set, reset seamlessly
        const halfWidth = el.scrollWidth / 2;
        if (pos >= halfWidth) pos = 0;
        el.scrollLeft = pos;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [casts]);

  const timeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  if (!loaded || casts.length === 0) return null;

  // Duplicate casts for seamless loop
  const displayCasts = [...casts, ...casts];

  return (
    <div
      style={{
        width: '100%',
        overflow: 'hidden',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(0,0,0,0.02)',
        padding: '6px 0',
        position: 'relative',
      }}
    >
      {/* Channel label */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '12px',
          paddingRight: '16px',
          background: 'linear-gradient(90deg, rgba(245,245,245,1) 70%, rgba(245,245,245,0) 100%)',
          fontWeight: 800,
          fontSize: '0.6rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          color: '#7c3aed',
          whiteSpace: 'nowrap' as const,
        }}
      >
        /noc
      </div>

      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        style={{
          display: 'flex',
          gap: '0',
          overflow: 'hidden',
          scrollbarWidth: 'none' as const,
          paddingLeft: '48px',
          cursor: 'grab',
        }}
      >
        {displayCasts.map((cast, i) => (
          <a
            key={`${cast.hash}-${i}`}
            href={`https://warpcast.com/~/conversations/${cast.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 16px',
              flexShrink: 0,
              textDecoration: 'none',
              color: 'inherit',
              borderRight: '1px solid rgba(0,0,0,0.06)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {cast.author.pfp_url && (
              <img
                src={cast.author.pfp_url}
                alt=""
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  flexShrink: 0,
                }}
                loading="lazy"
              />
            )}
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#333',
                whiteSpace: 'nowrap' as const,
                maxWidth: '300px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textTransform: 'none' as const,
              }}
            >
              {cast.text.slice(0, 80)}{cast.text.length > 80 ? '...' : ''}
            </span>
            <span
              style={{
                fontSize: '0.6rem',
                color: '#999',
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
              }}
            >
              {timeAgo(cast.timestamp)}
            </span>
            <span
              style={{
                fontSize: '0.6rem',
                color: '#aaa',
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
              }}
            >
              ♥{cast.reactions.likes_count}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
};

export default NocTicker;

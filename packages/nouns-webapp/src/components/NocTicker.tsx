import { FC, useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

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
  embeds?: Array<{ url?: string }>;
}

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── Cast Modal ─────────────────────────────────────────────────────────────

const CastModal: FC<{
  cast: FarcasterCast;
  onClose: () => void;
}> = ({ cast, onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const date = new Date(cast.timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Extract image embeds
  const imageUrl = cast.embeds?.find(e => e.url && /\.(jpg|jpeg|png|gif|webp)/i.test(e.url))?.url;

  const backdrop = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10,
        background: 'rgba(20, 20, 31, 0.5)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        cursor: 'pointer',
      }}
    />
  );

  const modal = (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: visible ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.92)',
        zIndex: 100,
        maxWidth: 520,
        width: '90vw',
        maxHeight: '85vh',
        borderRadius: 20,
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.3) inset',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        display: 'flex',
        flexDirection: 'column' as const,
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 'none',
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.6)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.4)')}
      >
        ✕
      </button>

      {/* Image embed */}
      {imageUrl && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <img
            src={imageUrl}
            alt=""
            style={{
              width: '100%',
              maxHeight: 300,
              objectFit: 'cover',
              display: 'block',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 60,
              background: 'linear-gradient(0deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0) 100%)',
            }}
          />
        </div>
      )}

      {/* Content */}
      <div
        style={{
          padding: '16px 24px 24px',
          overflowY: 'auto',
          flex: 1,
        }}
      >
        {/* Author */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
          }}
        >
          {cast.author.pfp_url && (
            <img
              src={cast.author.pfp_url}
              alt=""
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
              }}
            />
          )}
          <div>
            <div
              style={{
                fontFamily: "'PT Root UI'",
                fontWeight: 700,
                fontSize: '0.9rem',
                color: '#14141f',
              }}
            >
              {cast.author.display_name}
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: '#7c3aed',
                fontWeight: 600,
              }}
            >
              @{cast.author.username}
            </div>
          </div>
        </div>

        {/* Cast text */}
        <p
          style={{
            fontFamily: "'PT Root UI'",
            fontSize: '0.95rem',
            lineHeight: 1.6,
            color: '#2a2a3a',
            margin: '0 0 14px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {cast.text}
        </p>

        {/* Stats */}
        <div
          style={{
            display: 'flex',
            gap: 20,
            fontSize: '0.78rem',
            color: '#888',
            marginBottom: 16,
          }}
        >
          <span>♥ {cast.reactions.likes_count}</span>
          <span>↻ {cast.reactions.recasts_count}</span>
          <span>💬 {cast.replies.count}</span>
        </div>

        <div
          style={{
            fontSize: '0.7rem',
            color: '#999',
            marginBottom: 16,
          }}
        >
          {dateStr}
        </div>

        {/* View on Warpcast */}
        <a
          href={`https://warpcast.com/~/conversations/${cast.hash}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 10,
            background: '#7c3aed',
            color: '#fff',
            fontFamily: "'PT Root UI'",
            fontWeight: 700,
            fontSize: '0.82rem',
            textDecoration: 'none',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#6d28d9')}
          onMouseLeave={e => (e.currentTarget.style.background = '#7c3aed')}
        >
          View on Warpcast
          <span style={{ fontSize: '1rem' }}>→</span>
        </a>

        {/* Branding */}
        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#b0a890',
            textTransform: 'uppercase' as const,
          }}
        >
          <span style={{ color: '#7c3aed' }}>/noc</span> <span>farcaster</span>
        </div>
      </div>
    </div>
  );

  const backdropRoot = document.getElementById('backdrop-root');
  const overlayRoot = document.getElementById('overlay-root');
  if (!backdropRoot || !overlayRoot) return null;

  return (
    <>
      {ReactDOM.createPortal(backdrop, backdropRoot)}
      {ReactDOM.createPortal(modal, overlayRoot)}
    </>
  );
};

// ─── NocTicker ──────────────────────────────────────────────────────────────

/**
 * Horizontal auto-scrolling ticker of /noc Farcaster channel casts.
 * Sits directly under the auction section on the homepage.
 */
const NocTicker: FC = () => {
  const [casts, setCasts] = useState<FarcasterCast[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedCast, setSelectedCast] = useState<FarcasterCast | null>(null);
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
    let pos = el.scrollLeft;
    let wasPaused = false;

    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        // Sync position after drag so it doesn't snap back
        if (wasPaused) {
          pos = el.scrollLeft;
          wasPaused = false;
        }
        pos += speed;
        const halfWidth = el.scrollWidth / 2;
        if (halfWidth > 0 && pos >= halfWidth) pos -= halfWidth;
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
    <>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: '#fff',
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
            background: 'linear-gradient(90deg, rgba(255,255,255,1) 70%, rgba(255,255,255,0) 100%)',
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
            <div
              key={`${cast.hash}-${i}`}
              onClick={() => setSelectedCast(cast)}
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
                cursor: 'pointer',
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
            </div>
          ))}
        </div>
      </div>

      {selectedCast && (
        <CastModal cast={selectedCast} onClose={() => setSelectedCast(null)} />
      )}
    </>
  );
};

export default NocTicker;

import { FC, useCallback, useEffect, useRef, useState } from 'react';

import ReactDOM from 'react-dom';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';
import { useFarcasterAuth } from '@/hooks/useFarcasterAuth';
import useModalBodyLock from '@/hooks/useModalBodyLock';

// ─── Types (matches Neynar v2 response) ─────────────────────────────────────

interface EmbedMetadata {
  content_type?: string;
  image?: { width_px: number; height_px: number };
  video?: {
    streams: Array<{ height_px: number; width_px: number; codec_name: string }>;
    duration_s: number;
  };
  html?: {
    ogTitle?: string;
    ogImage?: Array<{ url: string }>;
    ogDescription?: string;
    fcFrame?: {
      version?: string;
      imageUrl?: string;
      image?: { url: string };
      button?: { title: string; action?: { url?: string; name?: string } };
    };
  };
  _status?: string;
}

interface CastEmbed {
  url?: string;
  metadata?: EmbedMetadata;
  cast_id?: { fid: number; hash: string };
  cast?: {
    hash: string;
    author: { username: string; display_name: string; pfp_url: string };
    text: string;
    timestamp: string;
    embeds?: CastEmbed[];
  };
}

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
  embeds?: CastEmbed[];
}

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── Inline Embed Renderer ──────────────────────────────────────────────────

const InlineEmbeds: FC<{ embeds: CastEmbed[] }> = ({ embeds }) => {
  if (embeds.length === 0) return null;

  const images: string[] = [];
  const videos: string[] = [];
  const quotedCasts: CastEmbed[] = [];
  const links: CastEmbed[] = [];

  for (const e of embeds) {
    if (e.cast_id && e.cast) {
      quotedCasts.push(e);
      continue;
    }
    if (!e.url) continue;
    const meta = e.metadata;
    if (meta?.video) {
      videos.push(e.url);
    } else if (meta?.image) {
      images.push(e.url);
    } else if (/\.(jpg|jpeg|png|gif|webp|svg)/i.test(e.url)) {
      images.push(e.url);
    } else if (meta?.html?.ogTitle) {
      links.push(e);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {/* Videos */}
      {videos.map((src, i) => (
        <video
          key={`v-${i}`}
          src={src}
          controls
          playsInline
          preload="metadata"
          style={{
            width: '100%',
            maxHeight: 280,
            borderRadius: 10,
            background: '#000',
            objectFit: 'contain',
          }}
        />
      ))}

      {/* Images */}
      {images.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {images.map((src, i) => (
            <img
              key={`img-${i}`}
              src={src}
              alt=""
              loading="lazy"
              style={{
                maxHeight: 260,
                borderRadius: 10,
                objectFit: 'cover',
                cursor: 'pointer',
              }}
              onClick={() => window.open(src, '_blank')}
            />
          ))}
        </div>
      )}

      {/* Quoted casts */}
      {quotedCasts.map((qc, i) => {
        const cast = qc.cast!;
        return (
          <div
            key={`qc-${i}`}
            style={{
              border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 10,
              padding: 10,
              background: 'rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {cast.author.pfp_url && (
                <img
                  src={cast.author.pfp_url}
                  alt=""
                  style={{ width: 18, height: 18, borderRadius: '50%' }}
                />
              )}
              <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                {cast.author.display_name}
              </span>
              <span style={{ fontSize: '0.7rem', color: '#999' }}>@{cast.author.username}</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#444', margin: 0, whiteSpace: 'pre-wrap' }}>
              {cast.text.length > 200 ? cast.text.slice(0, 200) + '...' : cast.text}
            </p>
          </div>
        );
      })}

      {/* Link previews */}
      {links.map((link, i) => {
        const html = link.metadata!.html!;
        const ogImg = html.ogImage?.[0]?.url;
        return (
          <a
            key={`link-${i}`}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.1)',
              overflow: 'hidden',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            {ogImg && (
              <img
                src={ogImg}
                alt=""
                style={{ width: 72, height: 72, objectFit: 'cover', flexShrink: 0 }}
                loading="lazy"
              />
            )}
            <div style={{ padding: '8px 10px', minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {html.ogTitle}
              </div>
              {html.ogDescription && (
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: '#888',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {html.ogDescription.slice(0, 80)}
                </div>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
};

// ─── Cast Modal ─────────────────────────────────────────────────────────────

const CastModal: FC<{
  cast: FarcasterCast;
  onClose: () => void;
}> = ({ cast, onClose }) => {
  useModalBodyLock(true);
  const [visible, setVisible] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [liked, setLiked] = useState(false);
  const [recasted, setRecasted] = useState(false);
  const [localLikes, setLocalLikes] = useState(cast.reactions.likes_count);
  const [localRecasts, setLocalRecasts] = useState(cast.reactions.recasts_count);
  const [localReplies, setLocalReplies] = useState(cast.replies.count);

  const { auth, isLoggedIn, login, publishCast, react } = useFarcasterAuth();

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

  // Body scroll lock + header hide are handled by useModalBodyLock above.

  const date = new Date(cast.timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleLike = async () => {
    if (!isLoggedIn) {
      login();
      return;
    }
    try {
      await react(cast.hash, 'like');
      setLiked(true);
      setLocalLikes(n => n + 1);
    } catch (err) {
      console.error('Like failed:', err);
    }
  };

  const handleRecast = async () => {
    if (!isLoggedIn) {
      login();
      return;
    }
    try {
      await react(cast.hash, 'recast');
      setRecasted(true);
      setLocalRecasts(n => n + 1);
    } catch (err) {
      console.error('Recast failed:', err);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await publishCast(replyText.trim(), { parent: cast.hash });
      setReplyText('');
      setShowReply(false);
      setLocalReplies(n => n + 1);
    } catch (err) {
      console.error('Reply failed:', err);
    } finally {
      setSending(false);
    }
  };

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
        &#x2715;
      </button>

      {/* Content */}
      <div
        style={{
          padding: '20px 24px 24px',
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
              style={{ width: 40, height: 40, borderRadius: '50%' }}
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
          <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#999' }}>{dateStr}</div>
        </div>

        {/* Cast text */}
        <p
          style={{
            fontFamily: "'PT Root UI'",
            fontSize: '0.95rem',
            lineHeight: 1.6,
            color: '#2a2a3a',
            margin: '0 0 4px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {cast.text}
        </p>

        {/* Inline embeds (images, video, quotes, links) */}
        {cast.embeds && cast.embeds.length > 0 && <InlineEmbeds embeds={cast.embeds} />}

        {/* ── Action bar (like, recast, reply) ─────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          {/* Like */}
          <button
            onClick={handleLike}
            disabled={liked}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: liked ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.04)',
              color: liked ? '#ef4444' : '#666',
              cursor: liked ? 'default' : 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: '1rem' }}>{liked ? '\u2764' : '\u2661'}</span>
            {localLikes}
          </button>

          {/* Recast */}
          <button
            onClick={handleRecast}
            disabled={recasted}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: recasted ? 'rgba(34,197,94,0.1)' : 'rgba(0,0,0,0.04)',
              color: recasted ? '#22c55e' : '#666',
              cursor: recasted ? 'default' : 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: '0.9rem' }}>{'\u21BB'}</span>
            {localRecasts}
          </button>

          {/* Reply toggle */}
          <button
            onClick={() => {
              if (!isLoggedIn) {
                login();
                return;
              }
              setShowReply(v => !v);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: showReply ? 'rgba(124,58,237,0.1)' : 'rgba(0,0,0,0.04)',
              color: showReply ? '#7c3aed' : '#666',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: '0.9rem' }}>{'\uD83D\uDCAC'}</span>
            {localReplies}
          </button>

          {/* Auth status */}
          <div style={{ marginLeft: 'auto' }}>
            {isLoggedIn ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.65rem',
                  color: '#999',
                }}
              >
                {auth!.user.pfp_url && (
                  <img
                    src={auth!.user.pfp_url}
                    alt=""
                    style={{ width: 16, height: 16, borderRadius: '50%' }}
                  />
                )}
                @{auth!.user.username}
              </div>
            ) : (
              <button
                onClick={login}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #7c3aed',
                  background: 'transparent',
                  color: '#7c3aed',
                  cursor: 'pointer',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                }}
              >
                Sign in
              </button>
            )}
          </div>
        </div>

        {/* ── Reply box ────────────────────────────────────────────── */}
        {showReply && (
          <div style={{ marginTop: 10 }}>
            <textarea
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder={`Reply to @${cast.author.username}...`}
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.12)',
                background: 'rgba(0,0,0,0.02)',
                fontFamily: "'PT Root UI', sans-serif",
                fontSize: '0.85rem',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#7c3aed')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button
                onClick={() => {
                  setShowReply(false);
                  setReplyText('');
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(0,0,0,0.1)',
                  background: 'transparent',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReply}
                disabled={!replyText.trim() || sending}
                style={{
                  padding: '6px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: replyText.trim() ? '#7c3aed' : '#ccc',
                  color: '#fff',
                  cursor: replyText.trim() && !sending ? 'pointer' : 'default',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Reply'}
              </button>
            </div>
          </div>
        )}

        {/* Branding */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
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
    // Refresh hourly — Neynar credits are expensive
    const iv = setInterval(fetchCasts, 60 * 60_000);
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
        data-site-ticker="true"
        style={{
          width: '100%',
          overflow: 'hidden',
          borderTop: '1px solid var(--theme-border)',
          borderBottom: '1px solid var(--theme-border)',
          background: 'var(--theme-bg-primary)',
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
            background:
              'linear-gradient(90deg, var(--theme-bg-primary) 70%, rgba(255,255,255,0) 100%)',
            fontWeight: 800,
            fontSize: '0.6rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase' as const,
            color: 'var(--theme-accent)',
            whiteSpace: 'nowrap' as const,
            gap: '6px',
          }}
        >
          <span>📡</span>
          <span>/noc</span>
        </div>

        <div
          ref={scrollRef}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          onMouseEnter={() => {
            pausedRef.current = true;
          }}
          onMouseLeave={() => {
            pausedRef.current = false;
          }}
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
                borderRight: '1px solid var(--theme-border)',
                transition: 'background 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--theme-bg-hover)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
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
                  color: 'var(--theme-text-primary)',
                  whiteSpace: 'nowrap' as const,
                  maxWidth: '300px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textTransform: 'none' as const,
                }}
              >
                {cast.text.slice(0, 80)}
                {cast.text.length > 80 ? '...' : ''}
              </span>
              <span
                style={{
                  fontSize: '0.6rem',
                  color: 'var(--theme-text-secondary)',
                  whiteSpace: 'nowrap' as const,
                  flexShrink: 0,
                }}
              >
                {timeAgo(cast.timestamp)}
              </span>
              <span
                style={{
                  fontSize: '0.6rem',
                  color: 'var(--theme-text-muted)',
                  whiteSpace: 'nowrap' as const,
                  flexShrink: 0,
                }}
              >
                &#9829;{cast.reactions.likes_count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {selectedCast && <CastModal cast={selectedCast} onClose={() => setSelectedCast(null)} />}
    </>
  );
};

export default NocTicker;

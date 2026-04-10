/* eslint-disable react/prop-types, @typescript-eslint/strict-boolean-expressions */
import { useCallback, useEffect, useRef, useState } from 'react';

import Hls from 'hls.js';

import { FeedSkeleton } from '@/components/Skeleton';
import { useFarcasterAuth } from '@/hooks/useFarcasterAuth';

// ─── Notification Sound (Web Audio API — no external file) ───────────────────

let audioCtx: AudioContext | null = null;

function playBlip() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;
    const now = ctx.currentTime;

    // Soft click/blip — two quick sine tones
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.06);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    // AudioContext may be blocked until user interaction — silently ignore
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmbedMetadataImage {
  width_px: number;
  height_px: number;
}

interface EmbedMetadataVideo {
  streams: Array<{ height_px: number; width_px: number; codec_name: string }>;
  duration_s: number;
}

interface EmbedMetadataHtml {
  ogTitle?: string;
  ogImage?: Array<{ url: string; type?: string }>;
  ogDescription?: string;
  ogUrl?: string;
  favicon?: string;
  fcFrame?: {
    version?: string;
    imageUrl?: string;
    image?: { url: string };
    button?: {
      title: string;
      action?: {
        url?: string;
        type?: string;
        name?: string;
        splashImageUrl?: string;
        splashBackgroundColor?: string;
      };
    };
    [key: string]: unknown;
  };
}

interface CastEmbed {
  url?: string;
  metadata?: {
    content_type?: string;
    image?: EmbedMetadataImage;
    video?: EmbedMetadataVideo;
    html?: EmbedMetadataHtml;
    _status?: string;
  };
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

type FeedTab = 'all' | 'nouns' | 'noc' | 'lil';

const TAB_LABELS: Record<FeedTab, string> = {
  all: 'ALL',
  nouns: '/NOUNS',
  noc: '/NOC',
  lil: '/LIL',
};

const API_URL =
  import.meta.env.VITE_API_URL || 'https://spirited-flexibility-production-3c30.up.railway.app';

const fetchChannel = async (channel: string): Promise<FarcasterCast[]> => {
  const res = await fetch(`${API_URL}/api/feed/${channel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.casts ?? [];
};

const timeAgo = (timestamp: string) => {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

// ─── HLS Video Player ─────────────────────────────────────────────────────────

const HlsVideo: React.FC<{ src: string; poster?: string }> = ({ src, poster }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsRef.current = hls;
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src;
    }
  }, [src]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      className="max-h-72 w-full rounded-lg object-contain"
      style={{ background: '#000' }}
    />
  );
};

// ─── Embed Renderer ───────────────────────────────────────────────────────────

// ─── Frame Card ─────────────────────────────────────────────────────────────

const FrameCard: React.FC<{ embed: CastEmbed }> = ({ embed }) => {
  const frame = embed.metadata!.html!.fcFrame!;
  const imageUrl = frame.imageUrl ?? frame.image?.url ?? embed.metadata!.html!.ogImage?.[0]?.url;
  const buttonTitle = frame.button?.title ?? 'Open';
  const action = frame.button?.action;
  const actionUrl = action?.url ?? embed.url ?? '#';
  const appName = action?.name;

  return (
    <div className="overflow-hidden rounded-lg border border-purple-200 bg-purple-50/30">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full object-cover"
          style={{ aspectRatio: '3/2', maxHeight: 240 }}
          loading="lazy"
        />
      )}
      <div className="flex items-center gap-2 p-2">
        <a
          href={actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-purple-700"
          style={{ textDecoration: 'none' }}
        >
          {buttonTitle}
        </a>
        {appName && <span className="text-xs text-purple-400">{appName}</span>}
      </div>
    </div>
  );
};

const EmbedRenderer: React.FC<{ embeds: CastEmbed[] }> = ({ embeds }) => {
  if (!embeds || embeds.length === 0) return null;

  const images: CastEmbed[] = [];
  const videos: CastEmbed[] = [];
  const links: CastEmbed[] = [];
  const frames: CastEmbed[] = [];
  const quotedCasts: CastEmbed[] = [];

  for (const e of embeds) {
    // Quoted cast
    if (e.cast_id && e.cast) {
      quotedCasts.push(e);
      continue;
    }

    const meta = e.metadata;
    if (!meta || !e.url) continue;

    // Farcaster Frame (v1 or v2/Mini App)
    if (meta.html?.fcFrame) {
      frames.push(e);
      continue;
    }

    if (meta.video) {
      videos.push(e);
    } else if (meta.image) {
      images.push(e);
    } else if (meta.html?.ogTitle) {
      links.push(e);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Frames */}
      {frames.map((f, i) => (
        <FrameCard key={`frame-${i}`} embed={f} />
      ))}

      {/* Videos */}
      {videos.map((v, i) => (
        <HlsVideo key={`v-${i}`} src={v.url!} />
      ))}

      {/* Images */}
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <img
              key={`img-${i}`}
              src={img.url}
              alt=""
              className="max-h-56 rounded-lg object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {/* Quoted casts */}
      {quotedCasts.map((qc, i) => {
        const cast = qc.cast;
        if (!cast?.hash) return null;
        const text = cast.text ?? '';
        return (
          <a
            key={`qc-${i}`}
            href={`https://warpcast.com/~/conversations/${cast.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className="mb-1 flex items-center gap-2">
              {cast.author?.pfp_url && (
                <img src={cast.author.pfp_url} alt="" className="h-5 w-5 rounded-full" />
              )}
              <span className="text-xs font-bold">{cast.author?.display_name ?? 'Unknown'}</span>
              <span className="text-xs text-gray-400">@{cast.author?.username ?? '?'}</span>
            </div>
            <p className="text-xs text-gray-600" style={{ textTransform: 'none' }}>
              {text.length > 200 ? text.slice(0, 200) + '...' : text}
            </p>
          </a>
        );
      })}

      {/* Link previews (OG cards) */}
      {links.map((link, i) => {
        const html = link.metadata!.html!;
        const ogImg = html.ogImage?.[0]?.url;
        return (
          <a
            key={`link-${i}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex overflow-hidden rounded-lg border border-gray-200 transition-colors hover:bg-gray-50"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            {ogImg && (
              <img
                src={ogImg}
                alt=""
                className="h-20 w-20 flex-shrink-0 object-cover"
                loading="lazy"
              />
            )}
            <div className="flex min-w-0 flex-col justify-center p-2">
              <span className="truncate text-xs font-bold">{html.ogTitle}</span>
              {html.ogDescription && (
                <span className="truncate text-xs text-gray-400">
                  {html.ogDescription.slice(0, 100)}
                </span>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
};

// ─── Inline Compose Box ──────────────────────────────────────────────────────

const ComposeBox: React.FC<{ channel: FeedTab; onCasted?: () => void }> = ({
  channel,
  onCasted,
}) => {
  const { auth, isLoggedIn, login, publishCast } = useFarcasterAuth();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const targetChannel = channel === 'all' ? 'nouns' : channel;

  const handleSubmit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await publishCast(text.trim(), { channel_id: targetChannel });
      setText('');
      onCasted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setSending(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <button
        onClick={login}
        className="mb-4 flex w-full items-center gap-3 rounded-lg border border-dashed border-purple-300 p-3 text-purple-500 transition-colors hover:border-purple-400 hover:bg-purple-50"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm">
          &#9998;
        </div>
        <span className="text-sm">Sign in with Farcaster to cast to /{targetChannel}</span>
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        {auth!.user.pfp_url && (
          <img src={auth!.user.pfp_url} alt="" className="h-6 w-6 rounded-full" />
        )}
        <span className="text-xs font-bold text-gray-600">@{auth!.user.username}</span>
        <span className="ml-auto text-xs text-gray-400">/{targetChannel}</span>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Cast to /${targetChannel}...`}
        rows={2}
        className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm outline-none focus:border-purple-400"
        style={{ textTransform: 'none' }}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || sending}
          className="rounded-lg bg-purple-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-purple-700 disabled:bg-gray-300 disabled:hover:bg-gray-300"
        >
          {sending ? 'Casting...' : 'Cast'}
        </button>
      </div>
    </div>
  );
};

// ─── Cast Card with Inline Actions ──────────────────────────────────────────

const CastCard: React.FC<{
  cast: FarcasterCast;
  isNew: boolean;
}> = ({ cast, isNew }) => {
  const { isLoggedIn, login, publishCast, react } = useFarcasterAuth();
  const [liked, setLiked] = useState(false);
  const [recasted, setRecasted] = useState(false);
  const [localLikes, setLocalLikes] = useState(cast.reactions.likes_count);
  const [localRecasts, setLocalRecasts] = useState(cast.reactions.recasts_count);
  const [localReplies, setLocalReplies] = useState(cast.replies?.count ?? 0);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

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

  return (
    <div
      className="rounded-lg border p-4 transition-colors hover:bg-gray-50"
      style={
        isNew
          ? {
              borderColor: '#22d3ee',
              animation: 'feedPulse 0.5s ease-out',
              background: 'rgba(34, 211, 238, 0.04)',
            }
          : undefined
      }
    >
      {/* Author header */}
      <div className="mb-2 flex items-center gap-2">
        {cast.author.pfp_url && (
          <img src={cast.author.pfp_url} alt="" className="h-8 w-8 rounded-full" loading="lazy" />
        )}
        <div className="flex flex-col">
          <span className="text-sm font-bold">{cast.author.display_name}</span>
          <span className="text-xs text-gray-400">@{cast.author.username}</span>
        </div>
        <span className="ml-auto text-xs text-gray-400">{timeAgo(cast.timestamp)}</span>
      </div>

      {/* Cast text */}
      <p className="text-sm" style={{ textTransform: 'none' }}>
        {cast.text}
      </p>

      {/* Embeds (images, videos, quoted casts, link previews) */}
      {cast.embeds && cast.embeds.length > 0 && <EmbedRenderer embeds={cast.embeds} />}

      {/* Action bar */}
      <div className="mt-3 flex items-center gap-1">
        {/* Like */}
        <button
          onClick={handleLike}
          disabled={liked}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            liked
              ? 'bg-red-50 text-red-500'
              : 'bg-gray-50 text-gray-500 hover:bg-red-50 hover:text-red-400'
          }`}
        >
          <span className="text-sm">{liked ? '\u2764' : '\u2661'}</span>
          {localLikes}
        </button>

        {/* Recast */}
        <button
          onClick={handleRecast}
          disabled={recasted}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            recasted
              ? 'bg-green-50 text-green-500'
              : 'bg-gray-50 text-gray-500 hover:bg-green-50 hover:text-green-400'
          }`}
        >
          <span className="text-sm">{'\u21BB'}</span>
          {localRecasts}
        </button>

        {/* Reply */}
        <button
          onClick={() => {
            if (!isLoggedIn) {
              login();
              return;
            }
            setShowReply(v => !v);
          }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            showReply
              ? 'bg-purple-50 text-purple-500'
              : 'bg-gray-50 text-gray-500 hover:bg-purple-50 hover:text-purple-400'
          }`}
        >
          <span className="text-sm">{'\uD83D\uDCAC'}</span>
          {localReplies}
        </button>
      </div>

      {/* Inline reply */}
      {showReply && (
        <div className="mt-2">
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder={`Reply to @${cast.author.username}...`}
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm outline-none focus:border-purple-400"
            style={{ textTransform: 'none' }}
            autoFocus
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              onClick={() => {
                setShowReply(false);
                setReplyText('');
              }}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-500"
            >
              Cancel
            </button>
            <button
              onClick={handleReply}
              disabled={!replyText.trim() || sending}
              className="rounded-lg bg-purple-600 px-4 py-1 text-xs font-bold text-white transition-colors hover:bg-purple-700 disabled:bg-gray-300"
            >
              {sending ? 'Sending...' : 'Reply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Feed Page ────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 30_000; // 30s

const FeedPage: React.FC = () => {
  const { isLoggedIn, auth, login, logout } = useFarcasterAuth();
  const [tab, setTab] = useState<FeedTab>('all');
  const [casts, setCasts] = useState<FarcasterCast[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newHashes, setNewHashes] = useState<Set<string>>(new Set());
  const knownHashesRef = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  const fetchFeed = useCallback(async (activeTab: FeedTab, silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      let results: FarcasterCast[];

      if (activeTab === 'all') {
        const [nouns, noc, lil] = await Promise.all([
          fetchChannel('nouns'),
          fetchChannel('noc'),
          fetchChannel('lil').catch(() => []),
        ]);
        results = [...nouns, ...noc, ...lil].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      } else {
        results = await fetchChannel(activeTab);
      }

      // Detect new items (skip first load)
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        knownHashesRef.current = new Set(results.map(c => c.hash));
      } else {
        const freshHashes = new Set<string>();
        for (const c of results) {
          if (!knownHashesRef.current.has(c.hash)) {
            freshHashes.add(c.hash);
            knownHashesRef.current.add(c.hash);
          }
        }
        if (freshHashes.size > 0) {
          setNewHashes(freshHashes);
          playBlip();
          // Clear highlight after 4 seconds
          setTimeout(() => setNewHashes(new Set()), 4000);
        }
      }

      setCasts(results);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    isFirstLoad.current = true;
    knownHashesRef.current.clear();
    fetchFeed(tab);

    const timer = setInterval(() => fetchFeed(tab, true), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [tab, fetchFeed]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <style>{`
        @keyframes feedPulse {
          0% { opacity: 0; transform: translateY(-6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header with auth */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity Feed</h1>
        {isLoggedIn ? (
          <div className="flex items-center gap-2">
            {auth!.user.pfp_url && (
              <img src={auth!.user.pfp_url} alt="" className="h-6 w-6 rounded-full" />
            )}
            <span className="text-xs font-bold text-gray-600">@{auth!.user.username}</span>
            <button onClick={logout} className="ml-1 text-xs text-gray-400 hover:text-gray-600">
              Sign out
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="rounded-lg border border-purple-500 px-3 py-1 text-xs font-bold text-purple-500 transition-colors hover:bg-purple-50"
          >
            Sign in with Farcaster
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b pb-2">
        {(['all', 'nouns', 'noc', 'lil'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
              tab === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Compose */}
      <ComposeBox channel={tab} onCasted={() => fetchFeed(tab)} />

      {/* Content */}
      {isLoading && <FeedSkeleton inline />}

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
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
          <CastCard key={cast.hash} cast={cast} isNew={newHashes.has(cast.hash)} />
        ))}
      </div>
    </div>
  );
};

export default FeedPage;

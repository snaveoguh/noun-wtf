import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { X } from 'lucide-react';
import ReactDOM from 'react-dom';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';
import useModalBodyLock from '@/hooks/useModalBodyLock';

export interface NounsWorldStory {
  title: string;
  image: string;
  url: string;
  description: string;
}

export const NOUNS_WORLD_STORIES: NounsWorldStory[] = [
  {
    title: 'Nouns Funds Esports',
    image: 'https://explore.nouns.world/wp-content/uploads/2025/03/nouns-gg-landing-gif.gif',
    url: 'https://explore.nouns.world/nouns-funds-esports/',
    description:
      'Nouns voted to fund professional Esports teams starting with Dota 2 in Proposal 68. Today Nouns Esports competes in Dota 2, Counter-Strike 2, UNITE and Melee — achieving a 7th-place finish at The International as the highest-ranking NA team in four years.',
  },
  {
    title: 'Nounish: Brand Building for Nouns',
    image: 'https://explore.nouns.world/wp-content/uploads/2025/05/nounish-banner-1024x576.png',
    url: 'https://explore.nouns.world/nounish-brand-building-for-nouns/',
    description:
      'A Melbourne-based creative studio that evolved from commercial production into a media powerhouse for Nouns, growing to 550K+ followers. Their "Three Artists" series hit 2M+ views and 70K+ new followers.',
  },
  {
    title: 'The Artist Program',
    image: 'https://explore.nouns.world/wp-content/uploads/2025/10/artist-program-cover-card.png',
    url: 'https://explore.nouns.world/the-artist-program-for-artists-by-artists/',
    description:
      'Nouns funded the Artist Program to empower artists worldwide to mint onchain works under a shared CC0 collection. Over five rounds, 100 artists from Argentina to Nigeria produced 98 unique works permanently recorded onchain.',
  },
  {
    title: "World's Largest Crypto Pizza Party",
    image: 'https://explore.nouns.world/wp-content/uploads/2025/04/pizza-dao-banner-1024x576.png',
    url: 'https://explore.nouns.world/nouns-helps-grow-the-worlds-largest-crypto-pizza-party/',
    description:
      'Nouns helped expand PizzaDAO\'s Global Pizza Party to hundreds of cities across the globe celebrating Bitcoin Pizza Day. With Nouns\' support, the 2023 event grew to over 112 events worldwide.',
  },
  {
    title: 'Pirate Ship Playground',
    image:
      'https://explore.nouns.world/wp-content/uploads/2025/04/pirateship-playground-header-1-1024x576.png',
    url: 'https://explore.nouns.world/public-pirate-ship-playground/',
    description:
      'A large Nounish Pirate Ship play structure inviting kids and families into the world of Nouns through playful discovery. The public playground is located on the Ground Floor of Qilin Plaza in Guangzhou, China.',
  },
  {
    title: 'John Hamon x Nouns: Public Art',
    image: 'https://explore.nouns.world/wp-content/uploads/2025/02/john-hamon-banner-1024x576.png',
    url: 'https://explore.nouns.world/john-hamon-and-nouns/',
    description:
      'French street artist John Hamon was funded through Proposal 126 to bring Nouns into the streets through guerrilla-style public art. The collaboration resulted in 1,000 posters of Hamon wearing Noggles across Paris, Lyon, Marseille, Madrid, and Berlin.',
  },
  {
    title: 'NounsWatch: 🧿 on Your Wrist',
    image:
      'https://explore.nouns.world/wp-content/uploads/2025/06/nouns-watch-header-image-4-1024x540.png',
    url: 'https://explore.nouns.world/time-well-spent-nounswatch-brings-%E2%8C%90%E2%97%A8-%E2%97%A8-to-your-wrist/',
    description:
      'A precision timepiece designed by Rafael Miranda that transforms the iconic Noggles into a wearable daily watch. Funded with $69K via Proposal 480, the open-source design has sold over 551 watches.',
  },
  {
    title: 'Building Better Governance: Agora',
    image: 'https://explore.nouns.world/wp-content/uploads/2025/03/image3-1024x576.png',
    url: 'https://explore.nouns.world/building-better-governance-nouns-agora/',
    description:
      'Originally funded by Nouns, Agora grew from a governance tool into a major platform — securing $5M in seed funding from Haun Ventures, Coinbase Ventures, and Consensys. A start-up success story born from the DAO.',
  },
  {
    title: 'Sunny Pires in Nicaragua',
    image:
      'https://explore.nouns.world/wp-content/uploads/2025/02/sunny-surf-gif-optimize-4.gif',
    url: 'https://explore.nouns.world/nouns-and-sunny-pires-in-nicaragua/',
    description:
      'Nouns funded Sunny Pires in March 2024 to adventure along the coast of Nicaragua — combining breathtaking surfing, beach clean-ups, and connecting with the local community, all while taking Nouns along for the ride.',
  },
  {
    title: '$100K to Support Gitcoin',
    image:
      'https://explore.nouns.world/wp-content/uploads/2025/04/stand-with-crypto-header-1024x576.png',
    url: 'https://explore.nouns.world/nouns-donated-100k-to-support-gitcoins-crypto-advocacy-efforts/',
    description:
      'In August 2023, Nouns passed Proposal 278 to support Gitcoin\'s web3 policy and advocacy efforts with a donation of 55 ETH (~$103K), helping fund education for policymakers and crypto community activation.',
  },
  {
    title: 'Mucho Love: Real-World Action',
    image:
      'https://explore.nouns.world/wp-content/uploads/2025/04/pizza-dao-banner-1024x576.png',
    url: 'https://explore.nouns.world/mucho-love-turning-nounish-values-into-real-world-action/',
    description:
      'Nouns backed Mucho, a Nounish experiment rooted in community service that has grown into a movement — from hospital visits and art workshops to medical missions, clothing drives, and viral storytelling.',
  },
  {
    title: 'Quick Start Guide to Nouns',
    image: 'https://explore.nouns.world/wp-content/uploads/2025/02/Cover-1-1024x614-1.jpg',
    url: 'https://explore.nouns.world/a-quick-start-guide-to-playing-nouns/',
    description:
      'A curated guide for newcomers: six key ways to participate in Nouns weekly, from voting on proposals and joining Warpcast\'s /nouns channel to attending Nouncil calls and bidding on Nouns.',
  },
];

// ─── Liquid Glass Modal ─────────────────────────────────────────────────────

const StoryModal: FC<{
  story: NounsWorldStory;
  onClose: () => void;
}> = ({ story, onClose }) => {
  useModalBodyLock(true);
  const [visible, setVisible] = useState(false);

  // Animate in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: visible
          ? 'translate(-50%, -50%) scale(1)'
          : 'translate(-50%, -50%) scale(0.92)',
        zIndex: 100,
        maxWidth: 640,
        width: '90vw',
        maxHeight: '85vh',
        borderRadius: 20,
        background: 'rgba(255, 255, 255, 0.88)',
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
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.6)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.4)')}
      >
        <X size={18} />
      </button>

      {/* Cover image */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img
          src={story.image}
          alt={story.title}
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* Gradient fade at bottom of image */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 60,
            background:
              'linear-gradient(0deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0) 100%)',
          }}
        />
      </div>

      {/* Content */}
      <div
        style={{
          padding: '16px 28px 24px',
          overflowY: 'auto',
          flex: 1,
        }}
      >
        <h2
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.6rem',
            fontWeight: 400,
            margin: '0 0 10px',
            lineHeight: 1.2,
            color: '#14141f',
          }}
        >
          {story.title}
        </h2>

        <p
          style={{
            fontFamily: "'PT Root UI'",
            fontSize: '0.88rem',
            lineHeight: 1.6,
            color: '#4a4a5a',
            margin: '0 0 20px',
          }}
        >
          {story.description}
        </p>

        {/* Read full story link */}
        <a
          href={story.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 10,
            background: '#14141f',
            color: '#fff',
            fontFamily: "'PT Root UI'",
            fontWeight: 700,
            fontSize: '0.82rem',
            textDecoration: 'none',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#2a2a3f')}
          onMouseLeave={e => (e.currentTarget.style.background = '#14141f')}
        >
          Read full story
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
          <span>🪩</span>{' '}
          <span>nouns.world</span>
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

// ─── Banner ─────────────────────────────────────────────────────────────────

/**
 * Horizontal auto-scrolling banner of Nouns World stories from explore.nouns.world.
 * Clicking a card opens a liquid glass modal with the story details.
 */
const NounsWorldBanner: FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [selectedStory, setSelectedStory] = useState<NounsWorldStory | null>(null);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  // Auto-scroll animation
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const speed = 1.0;
    let pos = el.scrollLeft;
    let wasPaused = false;

    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        if (wasPaused) { pos = el.scrollLeft; wasPaused = false; }
        pos += speed;
        const halfWidth = el.scrollWidth / 2;
        if (halfWidth > 0 && pos >= halfWidth) pos -= halfWidth;
        el.scrollLeft = pos;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Duplicate for seamless loop
  const displayStories = useMemo(() => [...NOUNS_WORLD_STORIES, ...NOUNS_WORLD_STORIES], []);

  const handleClose = useCallback(() => setSelectedStory(null), []);

  return (
    <>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(90deg, #faf5ee 0%, #f5efe4 50%, #faf5ee 100%)',
          padding: '10px 0',
          position: 'relative',
          borderBottom: '1px solid rgba(180, 160, 120, 0.2)',
        }}
      >
        {/* Left label */}
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
            paddingRight: '24px',
            background: 'linear-gradient(90deg, #faf5ee 70%, rgba(250,245,238,0) 100%)',
            fontWeight: 900,
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}
        >
          <span>🌐</span>
          <span style={{ color: '#8b7355', marginLeft: '6px' }}>NOUNS WORLD</span>
        </div>

        {/* Right fade */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 2,
            width: '50px',
            background: 'linear-gradient(270deg, #faf5ee 0%, rgba(250,245,238,0) 100%)',
            pointerEvents: 'none',
          }}
        />

        <div
          ref={scrollRef}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          onMouseEnter={() => { pausedRef.current = true; }}
          onMouseLeave={() => { pausedRef.current = false; }}
          style={{
            display: 'flex',
            gap: '10px',
            overflow: 'hidden',
            scrollbarWidth: 'none' as const,
            paddingLeft: '110px',
            cursor: 'grab',
          }}
        >
          {displayStories.map((story, i) => (
            <div
              key={`${story.title}-${i}`}
              onClick={() => setSelectedStory(story)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter') setSelectedStory(story);
              }}
              style={{
                flexShrink: 0,
                width: 220,
                height: 124,
                borderRadius: 10,
                overflow: 'hidden',
                position: 'relative',
                cursor: 'pointer',
                display: 'block',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.03)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
              }}
            >
              {/* Cover image */}
              <img
                src={story.image}
                alt={story.title}
                loading="lazy"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />

              {/* Title overlay */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)',
                  padding: '24px 10px 8px',
                }}
              >
                <span
                  style={{
                    color: '#fff',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    lineHeight: 1.3,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }}
                >
                  {story.title}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Liquid Glass Modal */}
      {selectedStory && (
        <StoryModal story={selectedStory} onClose={handleClose} />
      )}
    </>
  );
};

export default NounsWorldBanner;

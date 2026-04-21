/**
 * NoundryBanner — Auto-scrolling marquee of Nouns traits from the official palette.
 * Same architecture as DreamsBanner: rAF scroll, duplicated items for seamless loop.
 * Shows individual traits (heads, accessories, bodies, glasses) rendered as mini SVGs.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import ReactDOM from 'react-dom';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';

// ─── Trait card data ─────────────────────────────────────────────────────────

interface TraitCard {
  id: string;
  name: string;
  category: 'head' | 'body' | 'accessory' | 'glasses';
  svgDataUrl: string;
  bgColor: string;
}

// ─── RLE → pixel decoder ─────────────────────────────────────────────────────

function decodeRLE(data: string, palette: string[]): string[][] {
  const hex = data.replace(/^0x/, '');
  const top = parseInt(hex.substring(2, 4), 16);
  const right = parseInt(hex.substring(4, 6), 16);
  const left = parseInt(hex.substring(8, 10), 16);
  const grid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(''));

  const pairs = hex.substring(10).match(/.{1,4}/g) || [];
  let x = left,
    y = top;
  for (const r of pairs) {
    const runLen = parseInt(r.substring(0, 2), 16);
    const colorIdx = parseInt(r.substring(2, 4), 16);
    for (let i = 0; i < runLen; i++) {
      if (colorIdx !== 0 && y < 32 && x < 32) {
        grid[y][x] = `#${palette[colorIdx]}`;
      }
      x++;
      if (x >= right) {
        x = left;
        y++;
      }
    }
  }
  return grid;
}

function pixelsToSvg(grid: string[][], bgColor: string): string {
  let rects = `<rect width="320" height="320" fill="#${bgColor}" />`;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (grid[y][x]) {
        rects += `<rect x="${x * 10}" y="${y * 10}" width="10" height="10" fill="${grid[y][x]}" />`;
      }
    }
  }
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" shape-rendering="crispEdges">${rects}</svg>`,
  )}`;
}

// ─── Build trait cards from assets ───────────────────────────────────────────

function buildTraitCards(): TraitCard[] {
  const palette = ImageData.palette;
  const bgColors = ImageData.bgcolors;
  const cards: TraitCard[] = [];
  const categories: {
    key: 'heads' | 'bodies' | 'accessories' | 'glasses';
    cat: TraitCard['category'];
  }[] = [
    { key: 'heads', cat: 'head' },
    { key: 'bodies', cat: 'body' },
    { key: 'accessories', cat: 'accessory' },
    { key: 'glasses', cat: 'glasses' },
  ];

  for (const { key, cat } of categories) {
    const images = ImageData.images[key];
    // Take a sample — not all traits (too many)
    const step = Math.max(1, Math.floor(images.length / 30));
    for (let i = 0; i < images.length; i += step) {
      const img = images[i];
      const bg = bgColors[i % bgColors.length];
      const grid = decodeRLE(img.data, palette);
      cards.push({
        id: `${cat}-${i}`,
        name:
          img.filename?.replace(/^(head|body|accessory|glasses)-/, '').replace(/-/g, ' ') ||
          `${cat} ${i}`,
        category: cat,
        svgDataUrl: pixelsToSvg(grid, bg),
        bgColor: `#${bg}`,
      });
    }
  }

  // Shuffle for variety
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

let _cachedCards: TraitCard[] | null = null;
function getTraitCards(): TraitCard[] {
  if (!_cachedCards) _cachedCards = buildTraitCards();
  return _cachedCards;
}

// ─── Modal ───────────────────────────────────────────────────────────────────

const TraitModal: FC<{ card: TraitCard; onClose: () => void }> = ({ card, onClose }) => {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const backdrop = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    />
  );

  const modal = (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        background: '#fff',
        borderRadius: 16,
        padding: 20,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        maxWidth: 340,
        width: '90vw',
        fontFamily: "'PT Root UI', sans-serif",
      }}
    >
      <img
        src={card.svgDataUrl}
        alt={card.name}
        style={{
          width: 200,
          height: 200,
          borderRadius: 12,
          imageRendering: 'pixelated',
          display: 'block',
          margin: '0 auto',
        }}
      />
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'capitalize' }}>
          {card.name}
        </div>
        <div
          style={{
            fontSize: '0.6rem',
            color: '#999',
            marginTop: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {card.category}
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('noundry-trait-edit', {
                detail: { category: card.category, index: parseInt(card.id.split('-')[1], 10) },
              }),
            );
            window.scrollTo({ top: 0, behavior: 'smooth' });
            onClose();
          }}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 8,
            background: '#d4544e',
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Open in Editor
        </button>
        <a
          href="https://gallery.noundry.wtf"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.1)',
            fontSize: '0.7rem',
            color: '#666',
            textDecoration: 'none',
            fontWeight: 700,
          }}
        >
          Gallery →
        </a>
      </div>
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          border: 'none',
          background: 'rgba(0,0,0,0.05)',
          borderRadius: 8,
          width: 28,
          height: 28,
          cursor: 'pointer',
          fontSize: '0.8rem',
          color: '#999',
        }}
      >
        ×
      </button>
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

// ─── Banner ──────────────────────────────────────────────────────────────────

const NoundryBanner: FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [selectedCard, setSelectedCard] = useState<TraitCard | null>(null);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const cards = useMemo(() => getTraitCards(), []);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const speed = 1.2;
    let pos = el.scrollLeft;
    let wasPaused = false;
    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        if (wasPaused) { pos = el.scrollLeft; wasPaused = false; }
        pos += speed;
        const half = el.scrollWidth / 2;
        if (half > 0 && pos >= half) pos -= half;
        el.scrollLeft = pos;
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [cards]);

  const displayCards = useMemo(() => [...cards, ...cards], [cards]);

  const handleClose = useCallback(() => setSelectedCard(null), []);

  if (cards.length === 0) return null;

  return (
    <>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(90deg, #fef3e8 0%, #fdecd8 50%, #fef3e8 100%)',
          padding: '10px 0',
          position: 'relative',
          borderBottom: '1px solid rgba(224, 108, 117, 0.15)',
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
            paddingLeft: 12,
            paddingRight: 24,
            background: 'linear-gradient(90deg, #fef3e8 70%, rgba(254,243,232,0) 100%)',
            fontWeight: 900,
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}
        >
          <span>🎨</span>
          <span style={{ color: '#d4544e', marginLeft: 6 }}>NOUNDRY</span>
        </div>

        {/* Right fade */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 2,
            width: 50,
            background: 'linear-gradient(270deg, #fef3e8 0%, rgba(254,243,232,0) 100%)',
            pointerEvents: 'none',
          }}
        />

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
            gap: 10,
            overflow: 'hidden',
            scrollbarWidth: 'none' as const,
            paddingLeft: 110,
            cursor: 'grab',
          }}
        >
          {displayCards.map((card, i) => (
            <div
              key={`${card.id}-${i}`}
              onClick={() => setSelectedCard(card)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter') setSelectedCard(card);
              }}
              style={{
                flexShrink: 0,
                width: 100,
                height: 100,
                borderRadius: 10,
                overflow: 'hidden',
                position: 'relative',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                transition: 'transform 0.15s, box-shadow 0.15s',
                background: card.bgColor,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
              }}
            >
              <img
                src={card.svgDataUrl}
                alt={card.name}
                loading="lazy"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  imageRendering: 'pixelated',
                  objectFit: 'cover',
                }}
              />
              {/* Trait name badge */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
                  padding: '12px 4px 3px',
                  fontFamily: "'PT Root UI', sans-serif",
                  fontSize: '0.45rem',
                  fontWeight: 700,
                  color: '#fff',
                  textAlign: 'center',
                  textTransform: 'capitalize',
                  letterSpacing: '0.03em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {card.name}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedCard && <TraitModal card={selectedCard} onClose={handleClose} />}
    </>
  );
};

export default NoundryBanner;

/**
 * DreamsBanner — auto-scrolling horizontal banner of recent Nouns Dreams
 * from probe.wtf. Shows user-created dream Noun designs that could become
 * real Nouns if the community supports them.
 *
 * API: https://api.probe.wtf/api/dream-nouns
 * Links to: https://probe.wtf/en-US/nouns/dreams
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery as useReactQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import ReactDOM from 'react-dom';

import { ImageData, getNounData } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DreamNoun {
  id: number;
  dreamer: string;
  accessory_seed_id: number | null;
  background_seed_id: number | null;
  body_seed_id: number | null;
  glasses_seed_id: number | null;
  head_seed_id: number | null;
  custom_trait_image: string | null;
  custom_trait_layer: string | null;
  custom_trait_image_url: string | null;
  created_at: string;
  updated_at: string;
}

interface DreamCard {
  id: number;
  dreamer: string;
  svgBase64: string | null;            // composed SVG (base64) — full noun or base layers only
  glassesSvgBase64: string | null;     // glasses-only SVG (transparent bg) — for custom trait dreams
  customOverlayUrl: string | null;     // custom trait image URL (if custom head)
  customLayer: string | null;
  bgColor: string;
  createdAt: string;
  traits: {
    background: string;
    body: string;
    accessory: string;
    head: string;
    glasses: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const { images, bgcolors, palette } = ImageData;

function traitName(filename: string): string {
  return filename
    .replace(/^(body|accessory|head|glasses)-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function buildDreamCard(dream: DreamNoun): DreamCard | null {
  try {
    const bg = dream.background_seed_id ?? 0;
    const body = dream.body_seed_id ?? 0;
    const accessory = dream.accessory_seed_id ?? 0;
    const head = dream.head_seed_id ?? 0;
    const glasses = dream.glasses_seed_id ?? 0;

    const bgColor = bgcolors[bg] || bgcolors[0];

    // Build trait names
    const bodyName = images.bodies[body]
      ? traitName(images.bodies[body].filename)
      : 'Unknown';
    const accessoryName = images.accessories[accessory]
      ? traitName(images.accessories[accessory].filename)
      : 'Unknown';
    const headName = dream.head_seed_id !== null && images.heads[head]
      ? traitName(images.heads[head].filename)
      : dream.custom_trait_image
        ? 'Custom'
        : 'Unknown';
    const glassesName = images.glasses[glasses]
      ? traitName(images.glasses[glasses].filename)
      : 'Unknown';

    // Build SVG from standard seeds
    // Layer order must be: background → body → accessory → head → glasses (top)
    // For custom traits, we split into: base SVG + custom overlay + glasses SVG
    let svgBase64: string | null = null;
    let glassesSvgBase64: string | null = null;
    let customOverlayUrl: string | null = null;

    const hasCustomTrait = dream.custom_trait_layer && dream.custom_trait_image_url;

    if (hasCustomTrait) {
      // Build base SVG: background + body + accessory (NO head, NO glasses)
      const nounData = getNounData({ background: bg, body, accessory, head: 0, glasses: 0 });
      const baseParts = [nounData.parts[0], nounData.parts[1]]; // body + accessory
      const baseSvg = buildSVG(baseParts, palette, bgColor);
      svgBase64 = btoa(baseSvg);

      // Build glasses-only SVG on transparent background (glasses always on top)
      const glassesNounData = getNounData({ background: 0, body: 0, accessory: 0, head: 0, glasses });
      const glassesSvg = buildSVG([glassesNounData.parts[3]], palette); // no bg color → transparent
      glassesSvgBase64 = btoa(glassesSvg);

      customOverlayUrl = dream.custom_trait_image_url;
    } else {
      // Full standard SVG — all layers composed in correct order by buildSVG
      const seed = { background: bg, body, accessory, head, glasses };
      const nounData = getNounData(seed);
      const svg = buildSVG(nounData.parts, palette, bgColor);
      svgBase64 = btoa(svg);
    }

    return {
      id: dream.id,
      dreamer: dream.dreamer,
      svgBase64,
      glassesSvgBase64,
      customOverlayUrl,
      customLayer: dream.custom_trait_layer,
      bgColor,
      createdAt: dream.created_at,
      traits: {
        background: bg === 0 ? 'Cool' : 'Warm',
        body: bodyName,
        accessory: accessoryName,
        head: headName,
        glasses: glassesName,
      },
    };
  } catch {
    return null;
  }
}

// ─── Data Hook ────────────────────────────────────────────────────────────────

function useDreams() {
  return useReactQuery({
    queryKey: ['probeDreams'],
    queryFn: async (): Promise<DreamCard[]> => {
      const res = await fetch(
        'https://api.probe.wtf/api/dream-nouns?sort_method=desc&sort_property=id&page=1&per_page=40',
      );
      if (!res.ok) throw new Error(`Dreams API ${res.status}`);
      const json = await res.json();
      const dreams: DreamNoun[] = json.data || [];
      const cards = dreams.map(buildDreamCard).filter(Boolean) as DreamCard[];
      return cards;
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 2,
  });
}

// ─── Dream Modal ──────────────────────────────────────────────────────────────

const DreamModal: FC<{
  dream: DreamCard;
  onClose: () => void;
}> = ({ dream, onClose }) => {
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

  const date = new Date(dream.createdAt);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const backdrop = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10,
        background: 'rgba(20, 15, 30, 0.55)',
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
        maxWidth: 420,
        width: '90vw',
        maxHeight: '85vh',
        borderRadius: 20,
        background: 'rgba(255, 255, 255, 0.90)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow:
          '0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.3) inset',
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

      {/* Dream Noun preview */}
      <div
        style={{
          background: `#${dream.bgColor}`,
          padding: 24,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative', width: 200, height: 200 }}>
          {dream.svgBase64 && (
            <img
              src={`data:image/svg+xml;base64,${dream.svgBase64}`}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                imageRendering: 'pixelated',
                display: 'block',
              }}
            />
          )}
          {/* Custom trait layer (between base and glasses) */}
          {dream.customOverlayUrl && (
            <img
              src={dream.customOverlayUrl}
              alt=""
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                imageRendering: 'pixelated',
              }}
            />
          )}
          {/* Glasses on top */}
          {dream.glassesSvgBase64 && (
            <img
              src={`data:image/svg+xml;base64,${dream.glassesSvgBase64}`}
              alt=""
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                imageRendering: 'pixelated',
              }}
            />
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 40,
            background:
              'linear-gradient(0deg, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0) 100%)',
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
        {/* Dream ID badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(168, 85, 247, 0.12)',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#9333ea',
            marginBottom: 10,
          }}
        >
          Dream #{dream.id}
        </div>

        <h2
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.4rem',
            fontWeight: 400,
            margin: '0 0 12px',
            lineHeight: 1.2,
            color: '#14141f',
          }}
        >
          Dream Noun #{dream.id}
        </h2>

        {/* Traits */}
        <div style={{ marginBottom: 16 }}>
          {[
            ['Head', dream.traits.head],
            ['Body', dream.traits.body],
            ['Accessory', dream.traits.accessory],
            ['Glasses', dream.traits.glasses],
            ['Background', dream.traits.background],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                fontSize: '0.78rem',
                fontFamily: "'PT Root UI'",
                borderBottom: '1px solid rgba(0,0,0,0.05)',
              }}
            >
              <span style={{ color: '#888', fontWeight: 600 }}>{label}</span>
              <span style={{ color: '#333', fontWeight: 500 }}>
                {value}
                {label === 'Head' && dream.customOverlayUrl && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: '0.6rem',
                      color: '#9333ea',
                      fontWeight: 700,
                    }}
                  >
                    CUSTOM
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Dreamer */}
        <div
          style={{
            fontSize: '0.72rem',
            color: '#999',
            marginBottom: 6,
            fontFamily: "'PT Root UI'",
          }}
        >
          Dreamer:{' '}
          <span style={{ fontFamily: 'monospace', color: '#666' }}>
            {shortenAddress(dream.dreamer)}
          </span>
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

        {/* Link to probe.wtf */}
        <a
          href={`https://probe.wtf/en-US/nouns/dreams`}
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
          View on probe.wtf
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
            color: '#b0a0c0',
            textTransform: 'uppercase' as const,
          }}
        >
          <span>🧞</span>{' '}
          <span>nouns dreams</span>
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

// ─── Banner ───────────────────────────────────────────────────────────────────

const DreamsBanner: FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [selectedDream, setSelectedDream] = useState<DreamCard | null>(null);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const { data: dreams, isLoading } = useDreams();

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const speed = 1.5;
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
  }, [dreams]);

  // Duplicate for seamless loop
  const displayDreams = useMemo(() => {
    if (!dreams || dreams.length === 0) return [];
    return [...dreams, ...dreams];
  }, [dreams]);

  const handleClose = useCallback(() => setSelectedDream(null), []);

  if (isLoading || !dreams || dreams.length === 0) return null;

  return (
    <>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          background:
            'linear-gradient(90deg, #f3eef8 0%, #ede5f5 50%, #f3eef8 100%)',
          padding: '10px 0',
          position: 'relative',
          borderBottom: '1px solid rgba(147, 51, 234, 0.15)',
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
            background:
              'linear-gradient(90deg, #f3eef8 70%, rgba(243,238,248,0) 100%)',
            fontWeight: 900,
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}
        >
          <span>💭</span>
          <span style={{ color: '#7c3aed', marginLeft: '6px' }}>DREAMS</span>
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
            background:
              'linear-gradient(270deg, #f3eef8 0%, rgba(243,238,248,0) 100%)',
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
            gap: '10px',
            overflow: 'hidden',
            scrollbarWidth: 'none' as const,
            paddingLeft: '110px',
            cursor: 'grab',
          }}
        >
          {displayDreams.map((dream, i) => (
            <div
              key={`${dream.id}-${i}`}
              onClick={() => setSelectedDream(dream)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter') setSelectedDream(dream);
              }}
              style={{
                flexShrink: 0,
                width: 124,
                height: 124,
                borderRadius: 10,
                overflow: 'hidden',
                position: 'relative',
                cursor: 'pointer',
                display: 'block',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                transition: 'transform 0.15s, box-shadow 0.15s',
                background: `#${dream.bgColor}`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.boxShadow =
                  '0 4px 16px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow =
                  '0 2px 8px rgba(0,0,0,0.08)';
              }}
            >
              {/* Layer 1: Base SVG (bg + body + accessory, or full noun if no custom) */}
              {dream.svgBase64 && (
                <img
                  src={`data:image/svg+xml;base64,${dream.svgBase64}`}
                  alt=""
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    imageRendering: 'pixelated',
                    display: 'block',
                  }}
                />
              )}

              {/* Layer 2: Custom trait (e.g. custom head) — between base and glasses */}
              {dream.customOverlayUrl && (
                <img
                  src={dream.customOverlayUrl}
                  alt=""
                  loading="lazy"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    imageRendering: 'pixelated',
                  }}
                />
              )}

              {/* Layer 3: Glasses on top — always visible above custom traits */}
              {dream.glassesSvgBase64 && (
                <img
                  src={`data:image/svg+xml;base64,${dream.glassesSvgBase64}`}
                  alt=""
                  loading="lazy"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    imageRendering: 'pixelated',
                  }}
                />
              )}

              {/* Bottom overlay with dream ID */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background:
                    'linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 100%)',
                  padding: '16px 6px 5px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                }}
              >
                <span
                  style={{
                    fontSize: '0.5rem',
                    fontWeight: 800,
                    background: 'rgba(147, 51, 234, 0.85)',
                    color: '#fff',
                    padding: '1px 5px',
                    borderRadius: 3,
                    letterSpacing: '0.03em',
                  }}
                >
                  #{dream.id}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal */}
      {selectedDream && (
        <DreamModal dream={selectedDream} onClose={handleClose} />
      )}
    </>
  );
};

export default DreamsBanner;

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { X } from 'lucide-react';
import ReactDOM from 'react-dom';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';
import { type PropdateEntry, usePropdates } from '@/hooks/usePropdates';

// ─── Propdate Modal ───────────────────────────────────────────────────────────

const PropdateModal: FC<{
  entry: PropdateEntry;
  onClose: () => void;
}> = ({ entry, onClose }) => {
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

  const date = new Date(entry.timestamp * 1000);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Simple markdown → text (strip images, links, headings)
  const cleanText = entry.update
    .replace(/!\[[^\]]*]\([^)]*\)/g, '') // remove images
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1') // links → text
    .replace(/^#+\s*/gm, '') // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .trim();

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
        transform: visible ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.92)',
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
      {entry.imageUrl && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <img
            src={entry.imageUrl}
            alt={entry.title}
            style={{
              width: '100%',
              aspectRatio: '16 / 9',
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
              background:
                'linear-gradient(0deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0) 100%)',
            }}
          />
        </div>
      )}

      {/* Content */}
      <div
        style={{
          padding: '16px 28px 24px',
          overflowY: 'auto',
          flex: 1,
        }}
      >
        {/* Prop badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: entry.isCompleted ? 'rgba(34, 197, 94, 0.12)' : 'rgba(59, 130, 246, 0.12)',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: entry.isCompleted ? '#16a34a' : '#2563eb',
            marginBottom: 10,
          }}
        >
          Prop {entry.propId}
          {entry.isCompleted && ' ✓ Completed'}
        </div>

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
          {entry.title}
        </h2>

        <p
          style={{
            fontFamily: "'PT Root UI'",
            fontSize: '0.82rem',
            lineHeight: 1.6,
            color: '#4a4a5a',
            margin: '0 0 12px',
            whiteSpace: 'pre-wrap',
            maxHeight: '30vh',
            overflow: 'auto',
          }}
        >
          {cleanText.slice(0, 600)}
          {cleanText.length > 600 && '...'}
        </p>

        <div
          style={{
            fontSize: '0.7rem',
            color: '#999',
            marginBottom: 16,
          }}
        >
          {dateStr}
        </div>

        {/* Link to propdates */}
        <a
          href={`https://propdates.nouns.wtf/prop/${entry.propId}`}
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
          View on Propdates
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
          <span>🦎</span> <span>propdates</span>
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

// Placeholder for cards while loading
const PLACEHOLDER_GRADIENT = 'linear-gradient(135deg, #e8f4e8 0%, #d4e8d4 50%, #c0dcc0 100%)';

/**
 * PropdatesBanner — auto-scrolling horizontal banner of recent Nouns proposal updates
 * from the Propdates contract. Same style as NounsWorldBanner but 2x speed.
 * Reads PostUpdate events directly from chain.
 */
const PropdatesBanner: FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [selectedEntry, setSelectedEntry] = useState<PropdateEntry | null>(null);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const { data: propdates, isLoading } = usePropdates();

  // 2x speed of NounsWorldBanner (which is 1.0)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const speed = 2.0;
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
  }, [propdates]);

  // Duplicate for seamless loop
  const displayEntries = useMemo(() => {
    if (!propdates || propdates.length === 0) return [];
    return [...propdates, ...propdates];
  }, [propdates]);

  const handleClose = useCallback(() => setSelectedEntry(null), []);

  if (isLoading || !propdates || propdates.length === 0) return null;

  return (
    <>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(90deg, #eef5ee 0%, #e4f0e4 50%, #eef5ee 100%)',
          padding: '10px 0',
          position: 'relative',
          borderBottom: '1px solid rgba(120, 160, 120, 0.2)',
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
            background: 'linear-gradient(90deg, #eef5ee 70%, rgba(238,245,238,0) 100%)',
            fontWeight: 900,
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}
        >
          <span>✍️</span>
          <span style={{ color: '#4a7c4a', marginLeft: '6px' }}>PROPDATES</span>
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
            background: 'linear-gradient(270deg, #eef5ee 0%, rgba(238,245,238,0) 100%)',
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
          {displayEntries.map((entry, i) => (
            <div
              key={`${entry.propId}-${i}`}
              onClick={() => setSelectedEntry(entry)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter') setSelectedEntry(entry);
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
                background: entry.imageUrl ? undefined : PLACEHOLDER_GRADIENT,
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
              {/* Cover image or gradient placeholder */}
              {entry.imageUrl ? (
                <img
                  src={entry.imageUrl}
                  alt={entry.title}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.5rem',
                    opacity: 0.3,
                  }}
                >
                  🐸
                </div>
              )}

              {/* Title overlay */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
                  padding: '28px 10px 8px',
                }}
              >
                {/* Prop ID badge */}
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '0.5rem',
                    fontWeight: 800,
                    background: entry.isCompleted
                      ? 'rgba(34, 197, 94, 0.8)'
                      : 'rgba(59, 130, 246, 0.8)',
                    color: '#fff',
                    padding: '1px 5px',
                    borderRadius: 3,
                    marginBottom: 3,
                    letterSpacing: '0.03em',
                  }}
                >
                  Prop {entry.propId}
                  {entry.isCompleted ? ' ✓' : ''}
                </span>
                <span
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    color: '#fff',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    lineHeight: 1.3,
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                  }}
                >
                  {entry.title}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Liquid Glass Modal */}
      {selectedEntry && <PropdateModal entry={selectedEntry} onClose={handleClose} />}
    </>
  );
};

export default PropdatesBanner;

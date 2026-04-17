import type { ProbeDreamWithPreview } from '@/hooks/useProbeDreams';

import { FC, useEffect, useMemo, useRef } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { createPortal } from 'react-dom';

import { getNounColors } from '@/components/NounPalette';
import { traitName } from '@/lib/traitName';
import { useReverseENSLookUp } from '@/utils/ensLookup';

interface Props {
  dream: ProbeDreamWithPreview;
  anchorRect: DOMRect;
  onClose: () => void;
}

const DreamDetailPopover: FC<Props> = ({ dream, anchorRect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const dreamerEns = useReverseENSLookUp(dream.dreamer as `0x${string}`);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Build seed for standard traits (use 0 for null custom layer slots).
  // ALL layers can be null when a dream's custom trait replaces that layer
  // on probe.wtf — seed IDs come back as null for head / accessory / glasses
  // / body alike, not just head + accessory.
  const seed = useMemo(
    () => ({
      background: dream.seeds.background,
      body: dream.seeds.body ?? 0,
      accessory: dream.seeds.accessory ?? 0,
      head: dream.seeds.head ?? 0,
      glasses: dream.seeds.glasses ?? 0,
    }),
    [dream.seeds],
  );

  // Get colors from the standard traits
  const colors = useMemo(() => getNounColors(seed), [seed]);

  // Clean up custom trait filename to a readable name.
  // probe.wtf stores the full CDN path like "custom-traits/glasses/swaggy_frames.png"
  // — strip the directory + extension so we show just "Swaggy Frames".
  const customTraitName = useMemo(() => {
    if (!dream.customImage) return 'Custom';
    const baseName = dream.customImage.split('/').pop() ?? dream.customImage;
    return baseName
      .replace(/\.\w+$/, '')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }, [dream.customImage]);

  // Trait names — use filename for custom layer
  const traitList = useMemo(() => {
    const customLayer = dream.customLayer;
    const name = (layer: string, seedVal: number | null) => {
      if (seedVal == null && customLayer === layer) return customTraitName;
      if (customLayer === layer) return customTraitName;
      return seedVal != null
        ? traitName(layer as 'head' | 'body' | 'accessory' | 'glasses', seedVal)
        : '—';
    };

    return [
      ['Head', name('head', dream.seeds.head)],
      ['Noggles', name('glasses', dream.seeds.glasses)],
      ['Body', name('body', dream.seeds.body)],
      ['Accessory', name('accessory', dream.seeds.accessory)],
      ['BG', traitName('background', dream.seeds.background)],
    ] as [string, string][];
  }, [dream, customTraitName]);

  // Centered vertically in viewport, horizontally near anchor
  const popW = 280;
  const popEstH = 420;
  let left = anchorRect.left + anchorRect.width / 2 - popW / 2;
  const top = Math.max(8, (window.innerHeight - popEstH) / 2);
  if (left < 8) left = 8;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;

  const bgColor = `#${ImageData.bgcolors[dream.seeds.background] ?? 'd5d7e1'}`;
  const dreamerDisplay = dreamerEns || `${dream.dreamer.slice(0, 6)}...${dream.dreamer.slice(-4)}`;

  return createPortal(
    <div
      ref={ref}
      className="animate-in fade-in zoom-in-95"
      style={{
        position: 'fixed',
        left,
        top,
        width: popW,
        maxHeight: `${window.innerHeight - 16}px`,
        zIndex: 1000,
        borderRadius: 16,
        overflow: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        background: '#fff',
        border: 'none',
      }}
    >
      {/* Dream image */}
      <div style={{ backgroundColor: bgColor, lineHeight: 0 }}>
        <img
          src={dream.nounSvgUrl}
          alt={`Dream #${dream.id}`}
          style={{ width: '100%', imageRendering: 'pixelated', display: 'block' }}
        />
      </div>

      {/* Card body */}
      <div style={{ padding: '10px 12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>Dream {dream.id}</span>
          {dream.customLayer && (
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 700,
                color: '#7c3aed',
                background: '#ede9fe',
                padding: '2px 6px',
                borderRadius: 8,
              }}
            >
              Custom {dream.customLayer}
            </span>
          )}
        </div>

        <a
          href={`https://etherscan.io/address/${dream.dreamer}`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: '0.65rem',
            color: '#3b82f6',
            textDecoration: 'none',
            display: 'block',
            marginTop: 2,
          }}
        >
          {dreamerDisplay}
        </a>

        <p style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: 2 }}>
          {new Date(dream.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>

        {/* Traits */}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {traitList.map(([label, value]) => (
            <div key={label} style={{ fontSize: '0.65rem', display: 'flex', gap: 6 }}>
              <span style={{ color: '#9ca3af', width: 68, flexShrink: 0 }}>{label}</span>
              <span style={{ fontWeight: 600, color: '#374151' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Colors */}
        {colors.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {colors.map((c, i) => (
              <div
                key={`${c.hex}-${i}`}
                title={c.hex}
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: c.hex,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,0,0.1)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default DreamDetailPopover;

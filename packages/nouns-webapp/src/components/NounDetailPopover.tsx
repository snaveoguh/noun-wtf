import { FC, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { formatEther } from 'viem';

import { getNounColors } from '@/components/NounPalette';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';
import { useNounHoverData } from '@/components/NounHoverCard/useNounHoverData';
import { useReverseENSLookUp } from '@/utils/ensLookup';

interface Props {
  nounId: bigint;
  seed?: INounSeed;
  anchorRect: DOMRect;
  onClose: () => void;
}

const NounDetailPopover: FC<Props> = ({ nounId, seed: providedSeed, anchorRect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { seed, traits, owner, auction, colors } = useNounHoverData(nounId, providedSeed);

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

  const svgUri = useMemo(() => {
    if (!seed) return '';
    try {
      const { parts, background } = getNounData(seed);
      const svg = buildSVG(parts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [seed]);

  // Position: vertically centered in viewport, horizontally near anchor
  const popW = 280;
  const popEstH = 420;
  let left = anchorRect.left + anchorRect.width / 2 - popW / 2;
  let top = Math.max(8, (window.innerHeight - popEstH) / 2);

  if (left < 8) left = 8;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;

  const bgColor = seed ? `#${ImageData.bgcolors[seed.background]}` : '#d5d7e1';
  const ownerEns = useReverseENSLookUp(owner ?? '');
  const ownerDisplay = ownerEns || (owner ? `${owner.slice(0, 6)}...${owner.slice(-4)}` : '');

  const traitList = traits
    ? [
        ['Head', traits.head],
        ['Noggles', traits.glasses],
        ['Body', traits.body],
        ['Accessory', traits.accessory],
        ['BG', traits.background],
      ] as const
    : [];

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
      {/* Noun image — top, full width, flush */}
      <div style={{ backgroundColor: bgColor, lineHeight: 0 }}>
        {svgUri && (
          <img
            src={svgUri}
            alt={`Noun ${nounId}`}
            style={{ width: '100%', imageRendering: 'pixelated', display: 'block' }}
          />
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '10px 12px 8px' }}>
        {/* Title row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
            Noun {nounId.toString()}
          </span>
          {auction?.amount && (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280' }}>
              {parseFloat(formatEther(auction.amount)).toFixed(2)} ETH
            </span>
          )}
        </div>

        {/* Owner */}
        {owner && (
          <a
            href={`https://etherscan.io/address/${owner}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.65rem', color: '#3b82f6', textDecoration: 'none', display: 'block', marginTop: 2 }}
          >
            {ownerDisplay}
          </a>
        )}

        {/* Traits */}
        {traitList.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {traitList.map(([label, value]) => (
              <div key={label} style={{ fontSize: '0.65rem', display: 'flex', gap: 6 }}>
                <span style={{ color: '#9ca3af', width: 68, flexShrink: 0 }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#374151' }}>{value}</span>
              </div>
            ))}
          </div>
        )}

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

        {/* View auction */}
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <a
            href={`/noun/${nounId}`}
            style={{ fontSize: '0.65rem', fontWeight: 700, color: '#dc2626', textDecoration: 'none' }}
          >
            View Auction &rarr;
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default NounDetailPopover;

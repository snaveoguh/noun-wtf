import { FC, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

interface LilSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

interface LilImageData {
  bgcolors: string[];
  palette: string[];
  images: {
    bodies: { filename: string; data: string }[];
    accessories: { filename: string; data: string }[];
    heads: { filename: string; data: string }[];
    glasses?: { filename: string; data: string }[];
  };
}

interface ColorInfo {
  hex: string;
}

interface Props {
  lilId: number;
  seed: LilSeed;
  svgBase64: string;
  imageData: LilImageData;
  anchorRect: DOMRect;
  onClose: () => void;
}

function cleanTraitName(filename: string): string {
  return filename
    .replace(/^(body|accessory|head|glasses)-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Extract colors from lil noun RLE data */
function getLilColors(seed: LilSeed, imageData: LilImageData): ColorInfo[] {
  const palette = imageData.palette;
  const parts = [
    imageData.images.bodies[seed.body],
    imageData.images.accessories[seed.accessory],
    imageData.images.heads[seed.head],
  ];
  if (imageData.images.glasses?.length && seed.glasses >= 0) {
    parts.push(imageData.images.glasses[seed.glasses]);
  }

  const colorSet = new Set<number>();
  for (const part of parts) {
    if (!part?.data) continue;
    const hex = part.data.replace(/^0x/, '');
    const rects = hex.substring(10);
    const chunks = rects.match(/.{1,4}/g) ?? [];
    for (const chunk of chunks) {
      const colorIndex = parseInt(chunk.substring(2, 4), 16);
      if (colorIndex !== 0) colorSet.add(colorIndex);
    }
  }

  const colors: ColorInfo[] = [];
  // Background first
  colors.push({ hex: `#${imageData.bgcolors[seed.background] ?? 'd5d7e1'}` });
  for (const idx of colorSet) {
    if (palette[idx]) colors.push({ hex: `#${palette[idx]}` });
  }
  return colors;
}

const LilNounDetailPopover: FC<Props> = ({ lilId, seed, svgBase64, imageData, anchorRect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

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

  const colors = useMemo(() => getLilColors(seed, imageData), [seed, imageData]);

  const traits = useMemo(() => {
    const imgs = imageData.images;
    return [
      ['Head', imgs.heads[seed.head]?.filename ? cleanTraitName(imgs.heads[seed.head].filename) : '—'],
      ['Noggles', imgs.glasses?.[seed.glasses]?.filename ? cleanTraitName(imgs.glasses[seed.glasses].filename) : '—'],
      ['Body', imgs.bodies[seed.body]?.filename ? cleanTraitName(imgs.bodies[seed.body].filename) : '—'],
      ['Accessory', imgs.accessories[seed.accessory]?.filename ? cleanTraitName(imgs.accessories[seed.accessory].filename) : '—'],
      ['BG', seed.background === 0 ? 'Cool' : 'Warm'],
    ] as [string, string][];
  }, [seed, imageData]);

  const popW = 280;
  const popEstH = 420;
  let left = anchorRect.left + anchorRect.width / 2 - popW / 2;
  const top = Math.max(8, (window.innerHeight - popEstH) / 2);
  if (left < 8) left = 8;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;

  const bgColor = `#${imageData.bgcolors[seed.background] ?? 'd5d7e1'}`;

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
      {/* Image */}
      <div style={{ backgroundColor: bgColor, lineHeight: 0 }}>
        <img
          src={`data:image/svg+xml;base64,${svgBase64}`}
          alt={`Lil Noun ${lilId}`}
          style={{ width: '100%', imageRendering: 'pixelated', display: 'block' }}
        />
      </div>

      {/* Card body */}
      <div style={{ padding: '10px 12px 16px' }}>
        <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
          Lil Noun {lilId}
        </span>

        {/* Traits */}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {traits.map(([label, value]) => (
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

export default LilNounDetailPopover;

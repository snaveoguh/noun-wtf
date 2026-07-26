import { FC, useEffect, useMemo, useRef } from 'react';

import { createPortal } from 'react-dom';

import { Borg, BorgAttribute, BORGS_ADDRESS, isBlankAttribute, renderBorgImage } from '@/lib/borgs';

// Labels derived from each layer's on-chain pixel placement (24x24 grid):
// letter tats sit on the cheek, stitches on the chin, X/diamond on the
// forehead, zebra/pyramid on the neck, backpacks/jetpack on the back, etc.
export const BORG_LAYER_LABELS: Record<number, string> = {
  0: 'Body',
  1: 'Cheek Tat',
  2: 'Chin Tat',
  3: 'Head Tat',
  4: 'Neck Tat',
  5: 'Gear',
  6: 'Accessory',
  7: 'Mask',
  8: 'Eyes',
  9: 'Mouth',
  10: 'Headwear',
};

interface Props {
  borg: Borg;
  borgs: Map<number, Borg>;
  attributes: BorgAttribute[];
  /** total borgs ever created — used for rarity % */
  totalBorgs: number;
  anchorRect: DOMRect;
  onClose: () => void;
  onNavigate: (borgId: number) => void;
}

const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

const BorgDetailPopover: FC<Props> = ({
  borg,
  borgs,
  attributes,
  totalBorgs,
  anchorRect,
  onClose,
  onNavigate,
}) => {
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

  const image = renderBorgImage(borg.attrs, attributes);
  const isBurned = borg.owner === null;

  const traits = useMemo(
    () =>
      borg.attrs
        .map(idx => attributes[idx])
        .filter((a): a is BorgAttribute => !!a && !isBlankAttribute(a.n))
        .map(a => ({
          layer: BORG_LAYER_LABELS[a.l] ?? `Layer ${a.l}`,
          name: a.n,
          used: a.u,
          pct: totalBorgs > 0 ? Math.max(0.1, (a.u / totalBorgs) * 100) : 0,
        })),
    [borg, attributes, totalBorgs],
  );

  const parents = [borg.parent1, borg.parent2].filter(id => id > 0);
  const child = borg.child > 0 ? borg.child : null;

  const popW = 300;
  const popEstH = 480;
  let left = anchorRect.left + anchorRect.width / 2 - popW / 2;
  const top = Math.max(8, (window.innerHeight - popEstH) / 2);
  if (left < 8) left = 8;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;

  const renderMini = (id: number, label: string) => {
    const b = borgs.get(id);
    const uri = b ? renderBorgImage(b.attrs, attributes) : null;
    return (
      <button
        type="button"
        key={`${label}-${id}`}
        onClick={() => onNavigate(id)}
        className="flex flex-col items-center gap-0.5"
        title={`Borg ${id}`}
      >
        <span
          className="block overflow-clip rounded-lg border border-black/10 bg-gray-100"
          style={{ width: 56, height: 56 }}
        >
          {uri && (
            <img
              src={uri}
              alt={`Borg ${id}`}
              style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
            />
          )}
        </span>
        <span style={{ fontSize: '0.6rem', color: '#6b7280' }}>
          {label} #{id}
        </span>
      </button>
    );
  };

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
      }}
    >
      {/* Image */}
      <div
        style={{
          backgroundColor: isBurned ? '#e5e7eb' : '#f4f4f5',
          lineHeight: 0,
          position: 'relative',
        }}
      >
        {image && (
          <img
            src={image}
            alt={`Borg ${borg.id}`}
            style={{
              width: '100%',
              imageRendering: 'pixelated',
              display: 'block',
              filter: isBurned ? 'grayscale(0.9)' : undefined,
              opacity: isBurned ? 0.75 : 1,
            }}
          />
        )}
        {isBurned && (
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">
            ☠️ bred away
          </span>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '10px 12px 16px' }}>
        <div className="flex items-baseline justify-between">
          <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
            {borg.name ? `${borg.name}` : `Borg ${borg.id}`}
          </span>
          {borg.name && <span className="text-xs text-gray-400">#{borg.id}</span>}
        </div>
        {borg.born > 0 && (
          <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>
            Born{' '}
            {new Date(borg.born * 1000).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            {borg.parent1 > 0 ? ' · bred' : ' · generated'}
          </span>
        )}

        {/* Traits with rarity */}
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {traits.length === 0 && (
            <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>
              Naked borg — all layers blank
            </span>
          )}
          {traits.map(t => (
            <div
              key={`${t.layer}-${t.name}`}
              style={{ fontSize: '0.65rem', display: 'flex', gap: 6 }}
            >
              <span style={{ color: '#9ca3af', width: 62, flexShrink: 0 }}>{t.layer}</span>
              <span style={{ fontWeight: 600, color: '#374151', flexGrow: 1 }}>{t.name}</span>
              <span style={{ color: '#9ca3af' }} title={`${t.used} borgs have this`}>
                {t.pct < 1 ? t.pct.toFixed(1) : Math.round(t.pct)}%
              </span>
            </div>
          ))}
        </div>

        {/* Lineage */}
        {(parents.length > 0 || child) && (
          <div style={{ marginTop: 10 }}>
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 700,
                color: '#9ca3af',
                textTransform: 'uppercase',
              }}
            >
              Lineage
            </span>
            <div className="mt-1 flex gap-2">
              {parents.map(p => renderMini(p, 'Parent'))}
              {child && renderMini(child, 'Child')}
            </div>
          </div>
        )}

        {/* Owner + links */}
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontSize: '0.65rem',
          }}
        >
          {borg.owner ? (
            <span>
              <span style={{ color: '#9ca3af' }}>Owner </span>
              <a
                href={`https://polygonscan.com/address/${borg.owner}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold hover:underline"
              >
                {shortAddr(borg.owner)}
              </a>
            </span>
          ) : (
            <span style={{ color: '#9ca3af' }}>Burned in breeding — lives on in its child</span>
          )}
          <span className="flex gap-3">
            <a
              href={`https://opensea.io/assets/matic/${BORGS_ADDRESS}/${borg.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              OpenSea
            </a>
            <a
              href={`https://polygonscan.com/token/${BORGS_ADDRESS}?a=${borg.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              Polygonscan
            </a>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BorgDetailPopover;

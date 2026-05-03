import { FC, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import {
  CLIENT_REGISTRY,
  ClientInfo,
  getClientFaviconUrl,
  getClientInfo,
} from '@/utils/clientRegistry';

/**
 * Visual badge per client. Each entry is either:
 *   - A unicode emoji string (rendered as text)
 *   - An image asset path starting with `/` (rendered as <img> at the same
 *     box size as text emojis — used when no single unicode glyph fits the
 *     client's brand, e.g. animated GIFs)
 * Unknown clients fall through to a link-chain placeholder. Keep these in
 * sync with CLIENT_REGISTRY in `@/utils/clientRegistry`.
 */
const BADGE_VISUAL: Record<number, string> = {
  0: '\u2310\u25E8-\u25E8', // nouns.wtf — noggles
  1: '\uD83D\uDEE0\uFE0F', // Noundry — hammer & wrench (foundry vibe)
  2: '\uD83C\uDFE0', // House of Nouns — house (literal name)
  3: '\u26FA', // nouns.camp — tent
  4: '\uD83D\uDCBC', // Nouns.biz — briefcase
  5: '\uD83C\uDF05', // Nouns.com — sunrise/sunset
  6: '\uD83D\uDD79\uFE0F', // nouns.game — joystick
  7: '\uD83D\uDCBB', // Nouns Terminal (nouns.sh) — laptop
  8: '\uD83C\uDFAE', // Nouns GG — game controller
  9: '/clients/probe.gif', // Probe — custom ET gif
  10: '\uD83C\uDFDB\uFE0F', // Agora — classical building
  11: '\uD83E\uDED0', // Berry OS (berryos.wtf) — blueberries
  12: '\uD83D\uDE39', // Prop Launchpad — joycat
  18: '\uD83D\uDD75\uFE0F', // Anouns — detective (sus)
  22: '\uD83D\uDDF3\uFE0F', // Nouncil — ballot box
  37: '\uD83C\uDF46', // noun.wtf — eggplant
};

function isImagePath(v: string): boolean {
  return v.startsWith('/');
}

function getBadgeVisual(clientId: number | null | undefined): string {
  if (clientId == null) return '';
  return BADGE_VISUAL[clientId] ?? '\uD83D\uDD17';
}

interface ClientBadgeProps {
  clientId: number | null | undefined;
  size?: number;
}

/**
 * Inline badge showing which client app a bid was placed from.
 * Renders the client's emoji favicon with a hover tooltip.
 */
const ClientBadge: FC<ClientBadgeProps> = ({ clientId, size = 16 }) => {
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const client = getClientInfo(clientId);
  const visual = getBadgeVisual(clientId);
  const isImage = isImagePath(visual);

  if (!client) return null;

  const handleEnter = () => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setTooltipPos({ top: r.top + r.height / 2, left: r.right + 10 });
  };
  const handleLeave = () => setTooltipPos(null);

  return (
    <span
      ref={anchorRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {isImage ? (
        <img
          src={visual}
          alt={client.name}
          title={client.name}
          style={{
            width: size * 0.85,
            height: size * 0.85,
            objectFit: 'cover',
            borderRadius: 3,
            marginLeft: 4,
            display: 'inline-block',
            verticalAlign: 'middle',
            userSelect: 'none',
          }}
          draggable={false}
        />
      ) : (
        <span
          style={{
            fontSize: size * 0.75,
            lineHeight: 1,
            cursor: 'default',
            userSelect: 'none',
            marginLeft: 4,
          }}
          title={client.name}
        >
          {visual}
        </span>
      )}

      {/* Tooltip — portaled to body so any sticky header / overflow:hidden
          parent can't clip it, and it sits above all in-shell stacking
          contexts. Anchored to the right of the badge using viewport coords
          captured on hover. */}
      {tooltipPos && createPortal(
        <div
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translateY(-50%)',
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(20, 20, 31, 0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color: '#fff',
            fontSize: '0.7rem',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            zIndex: 99999,
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{ fontWeight: 700, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {isImage ? (
              <img
                src={visual}
                alt=""
                style={{ width: 14, height: 14, objectFit: 'cover', borderRadius: 2 }}
                draggable={false}
              />
            ) : (
              <span>{visual}</span>
            )}
            {client.name}
          </div>
          <div style={{ opacity: 0.7, fontSize: '0.6rem' }}>{client.description}</div>
          {client.url && (
            <div style={{ opacity: 0.5, fontSize: '0.55rem', marginTop: 2 }}>{client.url}</div>
          )}
          {/* Arrow — pointing left, toward the badge */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              right: '100%',
              transform: 'translateY(-50%)',
              width: 0,
              height: 0,
              borderTop: '5px solid transparent',
              borderBottom: '5px solid transparent',
              borderRight: '5px solid rgba(20, 20, 31, 0.92)',
            }}
          />
        </div>,
        document.body,
      )}
    </span>
  );
};

export default ClientBadge;
export { getClientInfo, CLIENT_REGISTRY, getClientFaviconUrl };
export type { ClientInfo };

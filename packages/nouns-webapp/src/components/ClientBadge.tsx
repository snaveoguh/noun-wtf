import { FC, useState } from 'react';

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
  1: '\u26FA', // nouns.camp — tent
  2: '\uD83C\uDFE0', // Prop House — house
  3: '\uD83C\uDFDB\uFE0F', // Agora — classical building
  4: '\uD83D\uDD04', // NounSwap — swap arrows
  5: '\uD83C\uDF05', // Nouns.com — sunrise/sunset
  6: '\uD83D\uDD79\uFE0F', // nouns.game — joystick
  7: '\uD83D\uDCBB', // Nouns Terminal (nouns.sh) — laptop
  9: '/clients/probe.gif', // Probe — custom ET gif
  11: '\uD83E\uDED0', // Berry OS (berryos.wtf) — blueberries
  12: '\uD83D\uDE39', // Prop Launchpad — joycat
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
  const [showTooltip, setShowTooltip] = useState(false);
  const client = getClientInfo(clientId);
  const visual = getBadgeVisual(clientId);
  const isImage = isImagePath(visual);

  if (!client) return null;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
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

      {/* Tooltip */}
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 6,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(20, 20, 31, 0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color: '#fff',
            fontSize: '0.7rem',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            zIndex: 50,
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
          {/* Arrow */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid rgba(20, 20, 31, 0.92)',
            }}
          />
        </div>
      )}
    </span>
  );
};

export default ClientBadge;
export { getClientInfo, CLIENT_REGISTRY, getClientFaviconUrl };
export type { ClientInfo };

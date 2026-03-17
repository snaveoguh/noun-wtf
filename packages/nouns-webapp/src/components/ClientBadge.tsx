import { FC, useState } from 'react';

/**
 * Registry of known Nouns auction client IDs.
 * Maps clientId → display info (emoji favicon, name, url, description).
 */
interface ClientInfo {
  emoji: string;
  name: string;
  url: string;
  description: string;
}

const CLIENT_REGISTRY: Record<number, ClientInfo> = {
  0: {
    emoji: '\u2310\u25E8-\u25E8',
    name: 'nouns.wtf',
    url: 'https://nouns.wtf',
    description: 'The official Nouns DAO frontend',
  },
  37: {
    emoji: '\uD83C\uDF46',
    name: 'noun.wtf',
    url: 'https://noun.wtf',
    description: 'Community Nouns client by pip',
  },
};

const UNKNOWN_CLIENT: ClientInfo = {
  emoji: '\uD83D\uDD17',
  name: 'Unknown client',
  url: '',
  description: 'Bid placed via an unrecognized client',
};

function getClientInfo(clientId: number | null | undefined): ClientInfo | null {
  if (clientId == null) return null;
  return CLIENT_REGISTRY[clientId] ?? { ...UNKNOWN_CLIENT, name: `Client #${clientId}` };
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

  if (!client) return null;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
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
        {client.emoji}
      </span>

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
          <div style={{ fontWeight: 700, marginBottom: 2 }}>
            {client.emoji} {client.name}
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
export { getClientInfo, CLIENT_REGISTRY };
export type { ClientInfo };

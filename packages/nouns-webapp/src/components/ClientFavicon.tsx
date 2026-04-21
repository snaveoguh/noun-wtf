import { FC, ReactNode, useState } from 'react';

import { ExternalLink } from 'lucide-react';

import { getClientFaviconUrl, getClientInfo } from '@/utils/clientRegistry';

interface ClientFaviconProps {
  clientId: number | null | undefined;
  /** Square px size of the favicon */
  size?: number;
  /** Optional extra margin on the left — most rows want a little gap from the amount */
  marginLeft?: number;
  /**
   * Optional fallback link used when no client icon is available (unknown /
   * missing clientId, or the client has no URL / the favicon failed to load).
   * When provided alongside `fallbackIcon`, we render a clickable generic icon
   * so every row has a useful link — typically the Etherscan tx page.
   */
  fallbackHref?: string;
  /** Tooltip / aria label for the fallback link */
  fallbackTitle?: string;
  /** Optional custom fallback icon. Defaults to lucide's ExternalLink. */
  fallbackIcon?: ReactNode;
}

/**
 * Clickable favicon for the client that submitted a bid.
 *
 * Decision tree:
 *  1. Known clientId with a usable favicon → wrapped in link to client URL
 *  2. Known clientId with no URL → static favicon only (no link)
 *  3. Unknown/missing clientId OR broken favicon → fallback icon linking to
 *     `fallbackHref` (e.g. the Etherscan tx page) so every row stays clickable
 *  4. No fallbackHref provided and nothing else renders → null
 */
const ClientFavicon: FC<ClientFaviconProps> = ({
  clientId,
  size = 26,
  marginLeft = 8,
  fallbackHref,
  fallbackTitle = 'View transaction on Etherscan',
  fallbackIcon,
}) => {
  const [broken, setBroken] = useState(false);

  const wrapperStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft,
    lineHeight: 0,
    flexShrink: 0,
  };

  const renderFallback = () => {
    if (!fallbackHref) return null;
    const icon = fallbackIcon ?? (
      <ExternalLink
        width={size}
        height={size}
        strokeWidth={2}
        aria-label={fallbackTitle}
        style={{
          width: size,
          height: size,
          padding: 4,
          borderRadius: 6,
          background: 'rgba(255, 255, 255, 0.8)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
          color: 'rgba(60, 60, 67, 0.85)',
          display: 'block',
          boxSizing: 'border-box',
        }}
      />
    );
    return (
      <a
        href={fallbackHref}
        target="_blank"
        rel="noopener noreferrer"
        title={fallbackTitle}
        aria-label={fallbackTitle}
        style={wrapperStyle}
        onClick={e => {
          // Don't let the click bubble to a parent row handler
          e.stopPropagation();
        }}
      >
        {icon}
      </a>
    );
  };

  // clientId === 0 is the contract's "no client" sentinel — treat like missing.
  if (clientId == null || clientId === 0) {
    return renderFallback();
  }

  const client = getClientInfo(clientId);
  if (!client) return renderFallback();

  const faviconUrl = getClientFaviconUrl(client, Math.max(64, size * 2));
  if (!faviconUrl || broken) return renderFallback();

  const commonImgStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 6,
    objectFit: 'contain',
    background: 'rgba(255, 255, 255, 0.8)',
    padding: 2,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.15)',
    display: 'block',
  };

  const img = (
    <img
      src={faviconUrl}
      alt={client.name}
      title={client.name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
      style={commonImgStyle}
    />
  );

  if (client.url) {
    return (
      <a
        href={client.url}
        target="_blank"
        rel="noopener noreferrer"
        title={client.name}
        aria-label={`Open ${client.name} in a new tab`}
        style={wrapperStyle}
        onClick={e => {
          // Don't let the click bubble to a parent row handler (e.g. tx link)
          e.stopPropagation();
        }}
      >
        {img}
      </a>
    );
  }

  return <span style={wrapperStyle}>{img}</span>;
};

export default ClientFavicon;

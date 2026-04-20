/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any */
/**
 * ParcelModal — Overlay popup showing the live Terraforms NFT + metadata
 * for a given tokenId, anchored on top of the current Hypercastle view.
 *
 * Reads token data directly from the Terraforms contract (tokenHTML +
 * tokenSupplementalData) on Ethereum mainnet, mirroring TerraformsPage.
 */
import { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// ─── Constants ───────────────────────────────────────────────────────────────

const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56' as const;

const TERRAFORMS_ABI = [
  {
    name: 'tokenHTML',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'tokenSupplementalData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'level', type: 'uint256' },
          { name: 'xCoordinate', type: 'uint256' },
          { name: 'yCoordinate', type: 'uint256' },
          { name: 'elevation', type: 'int256' },
          { name: 'structureSpaceX', type: 'uint256' },
          { name: 'structureSpaceY', type: 'uint256' },
          { name: 'structureSpaceZ', type: 'uint256' },
          { name: 'zoneName', type: 'string' },
          { name: 'zoneColors', type: 'string[10]' },
          { name: 'characterSet', type: 'string[9]' },
        ],
      },
    ],
  },
] as const;

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_JSONRPC || 'https://mainnet.rpc.buidlguidl.com'),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wrap raw tokenHTML fragment in a full HTML document (mirrors TerraformsPage). */
export function wrapTokenHTML(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}</style></head><body>${html}</body></html>`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TokenMeta {
  tokenId: number;
  level: number;
  x: number;
  y: number;
  elevation: number;
  zoneName: string;
  zoneColors: string[];
  characterSet: string[];
}

// ─── Modal ───────────────────────────────────────────────────────────────────

const ParcelModal: FC<{
  tokenId: number;
  onClose: () => void;
}> = ({ tokenId, onClose }) => {
  const navigate = useNavigate();
  const [html, setHtml] = useState<string | null>(null);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch token data on mount / when tokenId changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    setMeta(null);

    (async () => {
      try {
        const [htmlResult, metaResult] = await Promise.all([
          publicClient.readContract({
            address: TERRAFORMS_ADDRESS,
            abi: TERRAFORMS_ABI,
            functionName: 'tokenHTML',
            args: [BigInt(tokenId)],
          }),
          publicClient.readContract({
            address: TERRAFORMS_ADDRESS,
            abi: TERRAFORMS_ABI,
            functionName: 'tokenSupplementalData',
            args: [BigInt(tokenId)],
          }),
        ]);

        if (cancelled) return;

        setHtml(htmlResult as string);
        const m = metaResult as any;
        setMeta({
          tokenId: Number(m.tokenId),
          level: Number(m.level),
          x: Number(m.xCoordinate),
          y: Number(m.yCoordinate),
          elevation: Number(m.elevation),
          zoneName: m.zoneName,
          zoneColors: [...m.zoneColors].filter((c: string) => c.length > 0),
          characterSet: [...m.characterSet].filter((c: string) => c.length > 0),
        });
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message?.slice(0, 120) || 'Failed to fetch token data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const srcdoc = useMemo(() => (html ? wrapTokenHTML(html) : ''), [html]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const goDeepLink = useCallback(() => {
    navigate(`/terraforms/${tokenId}`);
  }, [navigate, tokenId]);

  return (
    <div
      onClick={onBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        animation: 'parcelModalFadeIn 0.16s ease-out',
      }}
    >
      <style>{`
        @keyframes parcelModalFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes parcelModalSlideIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 720,
          maxHeight: 'calc(100vh - 40px)',
          background: '#0a0a14',
          border: '1px solid #1e293b',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          animation: 'parcelModalSlideIn 0.2s ease-out',
          fontFamily: "'PT Root UI', sans-serif",
          color: '#e2e8f0',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 2,
            width: 32,
            height: 32,
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(0,0,0,0.55)',
            color: '#e2e8f0',
            fontSize: '1.1rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {/* Scrollable content */}
        <div
          style={{
            overflowY: 'auto',
            padding: '20px 22px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Title */}
          <div style={{ textAlign: 'center', paddingRight: 28 }}>
            <h2
              style={{
                fontFamily: "'Londrina Solid', 'Comic Sans MS', cursive",
                fontSize: '1.4rem',
                fontWeight: 400,
                margin: '0 0 4px',
                color: meta?.zoneColors[0] || '#e2e8f0',
              }}
            >
              Terraform #{tokenId}
            </h2>
            {meta && (
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Level {meta.level} · {meta.zoneName} · ({meta.x}, {meta.y}) · Elev {meta.elevation}
              </span>
            )}
          </div>

          {/* Iframe / loading */}
          <div
            style={{
              width: '100%',
              aspectRatio: '1',
              maxWidth: 520,
              margin: '0 auto',
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid #1e293b',
              background: '#000',
              position: 'relative',
            }}
          >
            {srcdoc ? (
              <iframe
                srcDoc={srcdoc}
                sandbox="allow-scripts allow-same-origin"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                title={`Terraform #${tokenId}`}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#475569',
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                }}
              >
                {error
                  ? `Error: ${error}`
                  : loading
                    ? `Reading onchain data for #${tokenId}...`
                    : 'Loading…'}
              </div>
            )}
          </div>

          {/* Metadata */}
          {meta && <MetaPanel meta={meta} />}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={goDeepLink} style={actionBtnStyle}>
              Open full page →
            </button>
            <a
              href={`https://opensea.io/assets/ethereum/${TERRAFORMS_ADDRESS}/${tokenId}`}
              target="_blank"
              rel="noreferrer"
              style={linkStyle}
            >
              OpenSea ↗
            </a>
            <a
              href={`https://etherscan.io/nft/${TERRAFORMS_ADDRESS}/${tokenId}`}
              target="_blank"
              rel="noreferrer"
              style={linkStyle}
            >
              Etherscan ↗
            </a>
            <a
              href={`https://tokens.mathcastles.xyz/terraforms/token-html/${tokenId}`}
              target="_blank"
              rel="noreferrer"
              style={linkStyle}
            >
              Mathcastles ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Metadata Panel (compact version mirroring TerraformsPage) ──────────────

const MetaPanel: FC<{ meta: TokenMeta }> = ({ meta }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
      fontSize: '0.75rem',
      color: '#c4c4c4',
    }}
  >
    <div style={cardStyle}>
      <div style={labelStyle}>Zone</div>
      <div style={{ ...valStyle, color: meta.zoneColors[0] || '#fff' }}>{meta.zoneName}</div>
    </div>
    <div style={cardStyle}>
      <div style={labelStyle}>Level</div>
      <div style={valStyle}>{meta.level}</div>
    </div>
    <div style={cardStyle}>
      <div style={labelStyle}>Coordinates</div>
      <div style={valStyle}>
        ({meta.x}, {meta.y})
      </div>
    </div>
    <div style={cardStyle}>
      <div style={labelStyle}>Elevation</div>
      <div style={{ ...valStyle, color: meta.elevation >= 0 ? '#22c55e' : '#ef4444' }}>
        {meta.elevation >= 0 ? '+' : ''}
        {meta.elevation}
      </div>
    </div>

    <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
      <div style={labelStyle}>Zone Colors</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {meta.zoneColors.map((c, i) => (
          <div
            key={i}
            style={{
              width: 24,
              height: 24,
              borderRadius: 5,
              background: c,
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.5rem',
              color: 'rgba(0,0,0,0.5)',
              fontWeight: 'bold',
            }}
          >
            {i}
          </div>
        ))}
      </div>
    </div>

    <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
      <div style={labelStyle}>Character Set</div>
      <div
        style={{
          display: 'flex',
          gap: 5,
          marginTop: 6,
          fontFamily: 'monospace',
          fontSize: '1rem',
          color: meta.zoneColors[0] || '#fff',
          flexWrap: 'wrap',
        }}
      >
        {meta.characterSet.map((c, i) => (
          <span
            key={i}
            style={{
              width: 28,
              height: 28,
              borderRadius: 5,
              background: '#0d0d1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  </div>
);

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: 8,
  padding: '10px 14px',
};
const labelStyle: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#64748b',
  marginBottom: 4,
};
const valStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 700,
  color: '#e2e8f0',
  fontFamily: "'Londrina Solid', 'Comic Sans MS', cursive",
};
const actionBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#e2e8f0',
  fontSize: '0.75rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'PT Root UI', sans-serif",
};
const linkStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid #1e293b',
  fontSize: '0.7rem',
  fontWeight: 600,
  color: '#94a3b8',
  textDecoration: 'none',
  fontFamily: "'PT Root UI', sans-serif",
};

export default ParcelModal;

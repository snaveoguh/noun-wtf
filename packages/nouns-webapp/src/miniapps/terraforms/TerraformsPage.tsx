/**
 * TerraformsPage — Onchain explorer for Mathcastles Terraforms NFTs.
 *
 * Reads token data directly from the Terraforms contract on Ethereum mainnet.
 * Renders the animated HTML version in a sandboxed iframe, plus metadata.
 * Also shows a 3D ASCII terrain view of the token's heightmap.
 *
 * Contract: 0x4E1f41613c9084FdB9E34E11fAE9412427480e56
 * All art data is fully onchain — no IPFS, no offchain storage.
 */
import { FC, lazy, Suspense as ReactSuspense, useCallback, useEffect, useMemo, useState } from 'react';

import { useNavigate, useParams } from 'react-router';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// Lazy-load the 3D Hypercastle view (heavy Three.js dependency)
const HypercastleView = lazy(() => import('./HypercastleView'));

// ─── Constants ───────────────────────────────────────────────────────────────

const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56' as const;
const TOTAL_SUPPLY = 9910;

// Minimal ABI for the functions we need
const TERRAFORMS_ABI = [
  {
    name: 'tokenHTML',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'tokenSVG',
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
    outputs: [{
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
    }],
  },
] as const;

// Public RPC client (mainnet, read-only)
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_JSONRPC || 'https://mainnet.rpc.buidlguidl.com'),
});

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

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useTerraformData(tokenId: number | null) {
  const [html, setHtml] = useState<string | null>(null);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenId || tokenId < 1 || tokenId > TOTAL_SUPPLY) {
      setHtml(null);
      setMeta(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch HTML and metadata in parallel
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

    return () => { cancelled = true; };
  }, [tokenId]);

  return { html, meta, loading, error };
}

// ─── Metadata Panel ──────────────────────────────────────────────────────────

const MetaPanel: FC<{ meta: TokenMeta }> = ({ meta }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
    fontSize: '0.75rem', color: '#c4c4c4',
  }}>
    <div style={{ background: '#1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
      <div style={labelStyle}>Zone</div>
      <div style={{ ...valStyle, color: meta.zoneColors[0] || '#fff' }}>{meta.zoneName}</div>
    </div>
    <div style={{ background: '#1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
      <div style={labelStyle}>Level</div>
      <div style={valStyle}>{meta.level}</div>
    </div>
    <div style={{ background: '#1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
      <div style={labelStyle}>Coordinates</div>
      <div style={valStyle}>({meta.x}, {meta.y})</div>
    </div>
    <div style={{ background: '#1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
      <div style={labelStyle}>Elevation</div>
      <div style={{ ...valStyle, color: meta.elevation >= 0 ? '#22c55e' : '#ef4444' }}>
        {meta.elevation >= 0 ? '+' : ''}{meta.elevation}
      </div>
    </div>

    {/* Zone Colors */}
    <div style={{ gridColumn: '1 / -1', background: '#1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
      <div style={labelStyle}>Zone Colors</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {meta.zoneColors.map((c, i) => (
          <div key={i} style={{
            width: 28, height: 28, borderRadius: 6, background: c,
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.5rem', color: 'rgba(0,0,0,0.5)', fontWeight: 'bold',
          }}>{i}</div>
        ))}
      </div>
    </div>

    {/* Character Set */}
    <div style={{ gridColumn: '1 / -1', background: '#1a1a2e', borderRadius: 10, padding: '12px 16px' }}>
      <div style={labelStyle}>Character Set</div>
      <div style={{
        display: 'flex', gap: 6, marginTop: 6, fontFamily: 'monospace',
        fontSize: '1.1rem', color: meta.zoneColors[0] || '#fff',
      }}>
        {meta.characterSet.map((c, i) => (
          <span key={i} style={{
            width: 32, height: 32, borderRadius: 6, background: '#0d0d1a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>{c}</span>
        ))}
      </div>
    </div>
  </div>
);

const labelStyle: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.1em', color: '#64748b', marginBottom: 4,
};
const valStyle: React.CSSProperties = {
  fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0',
  fontFamily: "'Londrina Solid', 'Comic Sans MS', cursive",
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const TerraformsPage: FC = () => {
  const { id } = useParams<{ id: string }>();

  // If no id, show the 3D Hypercastle world
  if (!id) {
    return (
      <ReactSuspense fallback={
        <div style={{
          width: '100%', height: '100vh', background: '#050510',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#475569', fontSize: '0.85rem',
        }}>
          Loading Hypercastle...
        </div>
      }>
        <HypercastleView />
      </ReactSuspense>
    );
  }

  return <TerraformDetailView id={id} />;
};

const TerraformDetailView: FC<{ id: string }> = ({ id }) => {
  const navigate = useNavigate();

  const [inputValue, setInputValue] = useState(id || '');
  const tokenId = useMemo(() => {
    const n = parseInt(id || inputValue, 10);
    return !isNaN(n) && n >= 1 && n <= TOTAL_SUPPLY ? n : null;
  }, [id, inputValue]);

  const { html, meta, loading, error } = useTerraformData(tokenId);

  // Wrap the HTML fragment in a full document for srcdoc
  const srcdoc = useMemo(() => {
    if (!html) return '';
    // tokenHTML returns a fragment — wrap it in a proper document
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}</style></head><body>${html}</body></html>`;
  }, [html]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(inputValue, 10);
    if (!isNaN(n) && n >= 1 && n <= TOTAL_SUPPLY) {
      navigate(`/terraforms/${n}`);
    }
  }, [inputValue, navigate]);

  const goRandom = useCallback(() => {
    const rand = Math.floor(Math.random() * TOTAL_SUPPLY) + 1;
    setInputValue(String(rand));
    navigate(`/terraforms/${rand}`);
  }, [navigate]);

  const goPrev = useCallback(() => {
    if (tokenId && tokenId > 1) {
      const next = tokenId - 1;
      setInputValue(String(next));
      navigate(`/terraforms/${next}`);
    }
  }, [tokenId, navigate]);

  const goNext = useCallback(() => {
    if (tokenId && tokenId < TOTAL_SUPPLY) {
      const next = tokenId + 1;
      setInputValue(String(next));
      navigate(`/terraforms/${next}`);
    }
  }, [tokenId, navigate]);

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a14',
      fontFamily: "'PT Root UI', sans-serif", color: '#e2e8f0',
      padding: '0 0 60px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 20px 16px', gap: 8,
      }}>
        <h1 style={{
          fontFamily: "'Londrina Solid', 'Comic Sans MS', cursive",
          fontSize: '2rem', fontWeight: 400, margin: 0, color: '#e2e8f0',
          letterSpacing: '0.02em',
        }}>
          <a href="/terraforms" style={{ color: '#64748b', textDecoration: 'none' }}>&#x25A8;</a> Terraforms Explorer
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.75rem', margin: 0 }}>
          Fully onchain ASCII art by Mathcastles · {TOTAL_SUPPLY.toLocaleString()} tokens ·{' '}
          <a href="/terraforms" style={{ color: '#64748b', textDecoration: 'underline' }}>← Hypercastle</a>
        </p>
      </div>

      {/* Search / Navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: '0 20px 24px', flexWrap: 'wrap',
      }}>
        <button onClick={goPrev} disabled={!tokenId || tokenId <= 1} style={navBtnStyle}>←</button>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            min={1}
            max={TOTAL_SUPPLY}
            placeholder="Token ID (1–9910)"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            style={{
              width: 160, padding: '8px 14px', borderRadius: 10,
              border: '1px solid #334155', background: '#0f172a',
              color: '#e2e8f0', fontSize: '0.85rem',
              fontFamily: "'PT Root UI', sans-serif", outline: 'none',
              textAlign: 'center',
            }}
          />
          <button type="submit" style={{ ...navBtnStyle, padding: '8px 16px', fontSize: '0.75rem' }}>
            Go
          </button>
        </form>
        <button onClick={goNext} disabled={!tokenId || tokenId >= TOTAL_SUPPLY} style={navBtnStyle}>→</button>
        <button onClick={goRandom} style={{ ...navBtnStyle, padding: '8px 14px', fontSize: '0.7rem' }}>
          Random
        </button>
      </div>

      {/* Content */}
      <div style={{
        maxWidth: 900, margin: '0 auto', padding: '0 20px',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        {/* Loading */}
        {loading && (
          <div style={{
            textAlign: 'center', padding: '60px 0', color: '#64748b',
            fontSize: '0.85rem',
          }}>
            <div style={{ animation: 'pulse 2s infinite', opacity: 0.6 }}>
              Reading onchain data for token #{tokenId}...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            textAlign: 'center', padding: '40px 0', color: '#ef4444',
            fontSize: '0.8rem',
          }}>
            Error: {error}
          </div>
        )}

        {/* No token selected */}
        {!tokenId && !loading && (
          <div style={{
            textAlign: 'center', padding: '80px 0', color: '#475569',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>&#x25A8;</div>
            <div style={{ fontSize: '0.85rem' }}>Enter a token ID or click Random to explore</div>
          </div>
        )}

        {/* Token display */}
        {html && tokenId && (
          <>
            {/* Title */}
            <div style={{ textAlign: 'center' }}>
              <h2 style={{
                fontFamily: "'Londrina Solid', 'Comic Sans MS', cursive",
                fontSize: '1.4rem', fontWeight: 400, margin: '0 0 4px',
                color: meta?.zoneColors[0] || '#e2e8f0',
              }}>
                Terraform #{tokenId}
              </h2>
              {meta && (
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  Level {meta.level} · {meta.zoneName} · ({meta.x}, {meta.y}) · Elev {meta.elevation}
                </span>
              )}
            </div>

            {/* Animated HTML iframe */}
            <div style={{
              width: '100%', aspectRatio: '1', maxWidth: 600,
              margin: '0 auto', borderRadius: 12, overflow: 'hidden',
              border: '1px solid #1e293b', background: '#000',
            }}>
              <iframe
                srcDoc={srcdoc}
                sandbox="allow-scripts allow-same-origin"
                style={{
                  width: '100%', height: '100%', border: 'none',
                  display: 'block',
                }}
                title={`Terraform #${tokenId}`}
              />
            </div>

            {/* Metadata */}
            {meta && <MetaPanel meta={meta} />}

            {/* Links */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href={`https://opensea.io/assets/ethereum/${TERRAFORMS_ADDRESS}/${tokenId}`}
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                OpenSea &#8599;
              </a>
              <a
                href={`https://etherscan.io/nft/${TERRAFORMS_ADDRESS}/${tokenId}`}
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                Etherscan &#8599;
              </a>
              <a
                href={`https://tokens.mathcastles.xyz/terraforms/token-html/${tokenId}`}
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                Mathcastles &#8599;
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const navBtnStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, border: '1px solid #334155',
  background: '#1e293b', color: '#e2e8f0', fontSize: '0.85rem',
  fontWeight: 700, cursor: 'pointer', fontFamily: "'PT Root UI', sans-serif",
  transition: 'all 0.1s',
};

const linkStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 10, border: '1px solid #1e293b',
  fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8',
  textDecoration: 'none', transition: 'background 0.1s',
  fontFamily: "'PT Root UI', sans-serif",
};

export default TerraformsPage;

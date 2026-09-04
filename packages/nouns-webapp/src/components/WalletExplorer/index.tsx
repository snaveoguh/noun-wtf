/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WalletExplorer — drop any ENS or address into the search field, get a 3D map
 * of the identity graph: verified wallets, controlled Safes, brand ENSes,
 * treasury flows, co-signers, CEX on/off-ramps.
 *
 * Reuses the TreasuryScene renderer from /nonsense so the look stays consistent.
 * Data comes from /api/wallet-map/:identity on the Ponder API.
 *
 * Gated to addresses with ≥ 4 Nouns voting weight (see useNounGate below).
 *
 * Hosted as the "Identity graph" tab of the wallet gamer profile
 * (`src/pages/WalletProfile`), which gives it a positioned, dark, fixed-height
 * container (`.wp-graph`) — the shell below is `position:absolute; inset:0`.
 */
import { useState, useEffect, FC } from 'react';

import { Canvas } from '@react-three/fiber';
import { useQuery } from '@tanstack/react-query';
import { SearchIcon, Loader2Icon, LockIcon } from 'lucide-react';
import { useParams, useNavigate } from 'react-router';
import { useAccount, useReadContract } from 'wagmi';

import TreasuryScene from '@/components/TreasuryFlow/Scene';
import { nounsTokenAbi } from '@/contracts';

const SUBGRAPH_URL =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const NOUNS_TOKEN_ADDRESS = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03' as const;
const REQUIRED_NOUNS = 4n;

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Checks the connected wallet's Nouns balance — returns true if >= 4. */
function useNounGate() {
  const { address, isConnected } = useAccount();
  const { data: balance, isLoading } = useReadContract({
    address: NOUNS_TOKEN_ADDRESS,
    abi: nounsTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const balanceBig = balance != null ? BigInt(balance as bigint | number | string) : 0n;
  return {
    isConnected,
    address,
    balance: balanceBig,
    isLoading,
    isAllowed: isConnected && balance != null && balanceBig >= REQUIRED_NOUNS,
  };
}

interface WalletMapResponse {
  identity: {
    input: string;
    primary: string;
    farcaster: {
      fid: number;
      username: string;
      displayName: string;
      verifiedAddresses: string[];
    } | null;
    brands: Array<{ name: string; address: string }>;
    verifiedSet: string[];
  };
  nodes: any[];
  links: any[];
  stats: {
    proposalsProposed: number;
    safesAsSigner: number;
    unilateralSafes: number;
    totalEthFromTreasury: number;
    verifiedWallets: number;
    brandsResolved: number;
    cexCounterparties: number;
    bridgeCounterparties: number;
    totalCexDeposited: number;
    totalCexWithdrawn: number;
  };
}

// ─── Main component ─────────────────────────────────────────────────────────

const WalletExplorer: FC = () => {
  const { identity: paramIdentity } = useParams<{ identity?: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState(paramIdentity ?? '');
  const [selectedNode, setSelectedNode] = useState<any>(null);

  const gate = useNounGate();

  useEffect(() => {
    if (paramIdentity) setQuery(paramIdentity);
  }, [paramIdentity]);

  const { data, isFetching, error } = useQuery<WalletMapResponse>({
    queryKey: ['wallet-map', paramIdentity],
    queryFn: async () => {
      const r = await fetch(`${SUBGRAPH_URL}/api/wallet-map/${paramIdentity}`);
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.json();
    },
    enabled: !!paramIdentity && gate.isAllowed,
    staleTime: 60_000,
  });

  const submit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // Stay on the gamer profile's Identity graph tab for the new identity.
    navigate(`/gamer/${encodeURIComponent(trimmed)}?tab=graph`);
  };

  // ─── Gate states ──────────────────────────────────────────────────────────
  if (!gate.isConnected) {
    return (
      <div style={shellStyle}>
        <div style={gateBoxStyle}>
          <LockIcon size={32} color="#888" />
          <h2 style={{ margin: '14px 0 6px' }}>Connect your wallet</h2>
          <p style={{ color: '#888', margin: 0 }}>The Wallet Explorer is gated to Noun holders.</p>
        </div>
      </div>
    );
  }

  if (!gate.isAllowed && !gate.isLoading) {
    return (
      <div style={shellStyle}>
        <div style={gateBoxStyle}>
          <LockIcon size={32} color="#888" />
          <h2 style={{ margin: '14px 0 6px' }}>Need ≥ 4 Nouns</h2>
          <p style={{ color: '#888', margin: 0 }}>
            Your wallet currently holds {gate.balance.toString()} Nouns. Acquire 4+ to unlock.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      {/* Search header */}
      <div style={headerStyle}>
        <SearchIcon size={16} color="#888" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="ENS or 0x address — e.g. vitalik.eth"
          style={inputStyle}
        />
        <button type="button" onClick={submit} style={btnStyle}>
          Explore
        </button>
      </div>

      {/* Body */}
      {!paramIdentity && (
        <div style={emptyStateStyle}>
          <p style={{ color: '#666', maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
            Drop an ENS or address. We&apos;ll resolve their Farcaster identity, find every wallet
            they&apos;ve verified, every Safe they co-sign, every brand ENS that maps to them, and
            every drop of ETH that&apos;s flowed between Nouns DAO and their orbit.
          </p>
        </div>
      )}

      {isFetching && (
        <div style={emptyStateStyle}>
          <Loader2Icon size={24} color="#888" className="animate-spin" />
          <span style={{ color: '#888', marginTop: 12 }}>Building identity graph…</span>
        </div>
      )}

      {error && (
        <div style={emptyStateStyle}>
          <span style={{ color: '#f87171' }}>Failed to load: {String(error)}</span>
        </div>
      )}

      {data && (
        <>
          <Canvas
            camera={{ position: [0, 0, 200], fov: 50 }}
            gl={{ antialias: true, alpha: false }}
            style={{ position: 'absolute', inset: 0, top: 64 }}
          >
            <TreasuryScene
              nodes={data.nodes}
              links={data.links}
              searchTerms={[]}
              paused={false}
              onNodeClick={setSelectedNode}
              onNodeHover={() => {}}
            />
          </Canvas>

          {/* Stats panel */}
          <div style={statsStyle}>
            <h3
              style={{
                margin: '0 0 8px 0',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.05,
              }}
            >
              {data.identity.farcaster?.displayName ?? data.identity.primary.slice(0, 10)}
            </h3>
            <div style={statRowStyle}>
              <span>Verified wallets:</span> <strong>{data.stats.verifiedWallets}</strong>
            </div>
            <div style={statRowStyle}>
              <span>Brand ENSes:</span> <strong>{data.stats.brandsResolved}</strong>
            </div>
            <div style={statRowStyle}>
              <span>Safes as signer:</span> <strong>{data.stats.safesAsSigner}</strong>
            </div>
            <div style={statRowStyle}>
              <span>⚠ Unilateral Safes:</span>{' '}
              <strong style={{ color: '#dc2626' }}>{data.stats.unilateralSafes}</strong>
            </div>
            <div style={statRowStyle}>
              <span>Proposals proposed:</span> <strong>{data.stats.proposalsProposed}</strong>
            </div>
            <div style={statRowStyle}>
              <span>ETH from Treasury:</span>{' '}
              <strong>{data.stats.totalEthFromTreasury.toFixed(2)} Ξ</strong>
            </div>
            <div style={statRowStyle}>
              <span>CEX counterparties:</span> <strong>{data.stats.cexCounterparties ?? 0}</strong>
            </div>
            <div style={statRowStyle}>
              <span>→ CEX deposited:</span>{' '}
              <strong>{(data.stats.totalCexDeposited ?? 0).toFixed(2)} Ξ</strong>
            </div>
            <div style={statRowStyle}>
              <span>← CEX withdrawn:</span>{' '}
              <strong>{(data.stats.totalCexWithdrawn ?? 0).toFixed(2)} Ξ</strong>
            </div>
            {(data.stats.bridgeCounterparties ?? 0) > 0 && (
              <div style={statRowStyle}>
                <span>Bridges used:</span> <strong>{data.stats.bridgeCounterparties}</strong>
              </div>
            )}
          </div>

          {/* Selected node panel */}
          {selectedNode != null && (
            <div style={nodeDetailStyle}>
              <h3 style={{ margin: '0 0 8px 0' }}>{selectedNode.name}</h3>
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11,
                  color: '#9be',
                  wordBreak: 'break-all',
                }}
              >
                {selectedNode.id}
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>{selectedNode.description}</div>
              <div style={{ marginTop: 10, fontSize: 11, color: '#888' }}>
                In: {selectedNode.totalIn?.toFixed(2) ?? 0} Ξ · Out:{' '}
                {selectedNode.totalOut?.toFixed(2) ?? 0} Ξ
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const shellStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: '#0a0a0f',
  color: '#e2e8f0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Helvetica, sans-serif',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  right: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(15,15,25,0.92)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: '10px 14px',
  zIndex: 10,
  backdropFilter: 'blur(8px)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  color: '#e2e8f0',
  outline: 'none',
  fontSize: 14,
  fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
};

const btnStyle: React.CSSProperties = {
  background: '#f59e0b',
  color: '#000',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyStateStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 40,
};

const gateBoxStyle: React.CSSProperties = {
  ...emptyStateStyle,
  textAlign: 'center',
};

const statsStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  background: 'rgba(15,15,25,0.92)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: '14px 18px',
  fontSize: 12,
  lineHeight: 1.7,
  zIndex: 5,
  backdropFilter: 'blur(8px)',
  minWidth: 240,
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
};

const nodeDetailStyle: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  right: 16,
  width: 320,
  background: 'rgba(15,15,25,0.92)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: '14px 18px',
  fontSize: 12,
  zIndex: 5,
  backdropFilter: 'blur(8px)',
};

export default WalletExplorer;

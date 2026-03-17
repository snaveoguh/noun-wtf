import { useEffect, useRef, useState, useCallback } from 'react';

interface ChainStatus {
  verified: boolean; // true = Helios-verified, false = RPC-only fallback
  blockNumber: number | null;
  error: string | null;
}

type HeliosProvider = {
  request: (req: { method: string; params?: unknown[] }) => Promise<unknown>;
  waitSynced: () => Promise<void>;
  shutdown: () => Promise<void>;
};

type CreateHeliosProvider = (
  config: {
    executionRpc?: string;
    consensusRpc?: string;
    network?: string;
  },
  kind: 'ethereum' | 'opstack',
) => Promise<HeliosProvider>;

const POLL_INTERVAL = 12_000;

async function fetchBlockFromRpc(rpcUrl: string): Promise<number | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const data = await res.json();
    return parseInt(data.result, 16);
  } catch {
    return null;
  }
}

async function bootWithRetry(
  create: CreateHeliosProvider,
  config: Parameters<CreateHeliosProvider>[0],
  kind: Parameters<CreateHeliosProvider>[1],
  maxRetries = 2,
): Promise<HeliosProvider> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const provider = await create(config, kind);
      await provider.waitSynced();
      return provider;
    } catch (e) {
      if (i === maxRetries) throw e;
      console.warn(`[helios] ${kind} attempt ${i + 1} failed, retrying...`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

function getRpcs() {
  const infuraKey = import.meta.env.VITE_INFURA_KEY;
  return {
    ethRpc: infuraKey
      ? `https://mainnet.infura.io/v3/${infuraKey}`
      : 'https://ethereum-rpc.publicnode.com',
    baseRpc: infuraKey
      ? `https://base-mainnet.infura.io/v3/${infuraKey}`
      : 'https://base-rpc.publicnode.com',
  };
}

export default function HeliosStatusBar() {
  const [eth, setEth] = useState<ChainStatus>({ verified: false, blockNumber: null, error: null });
  const [base, setBase] = useState<ChainStatus>({ verified: false, blockNumber: null, error: null });
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const ethRef = useRef<HeliosProvider | null>(null);
  const baseRef = useRef<HeliosProvider | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollBlock = useCallback(async (provider: HeliosProvider): Promise<number | null> => {
    try {
      const hex = (await provider.request({ method: 'eth_blockNumber' })) as string;
      return parseInt(hex, 16);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const { createHeliosProvider } = (await import('@a16z/helios')) as {
          createHeliosProvider: CreateHeliosProvider;
        };

        const { ethRpc, baseRpc } = getRpcs();

        setLoading(false);

        // Ethereum mainnet — try Helios, fall back to RPC polling
        bootWithRetry(
          createHeliosProvider,
          {
            executionRpc: ethRpc,
            consensusRpc: 'https://www.lightclientdata.org',
            network: 'mainnet',
          },
          'ethereum',
        ).then(async (provider) => {
          if (cancelled) { await provider.shutdown(); return; }
          ethRef.current = provider;
          const block = await pollBlock(provider);
          setEth({ verified: true, blockNumber: block, error: null });
        }).catch(async () => {
          if (cancelled) return;
          console.warn('[helios] ETH light client unavailable, falling back to RPC polling');
          const block = await fetchBlockFromRpc(ethRpc);
          setEth({ verified: false, blockNumber: block, error: null });
        });

        // Base (OP Stack)
        bootWithRetry(
          createHeliosProvider,
          {
            executionRpc: baseRpc,
            consensusRpc: 'https://www.lightclientdata.org',
            network: 'base',
          },
          'opstack',
        ).then(async (provider) => {
          if (cancelled) { await provider.shutdown(); return; }
          baseRef.current = provider;
          const block = await pollBlock(provider);
          setBase({ verified: true, blockNumber: block, error: null });
        }).catch(async () => {
          if (cancelled) return;
          console.warn('[helios] BASE light client unavailable, falling back to RPC polling');
          const block = await fetchBlockFromRpc(baseRpc);
          setBase({ verified: false, blockNumber: block, error: null });
        });

        // Poll block numbers
        intervalRef.current = setInterval(async () => {
          const { ethRpc: eRpc, baseRpc: bRpc } = getRpcs();
          if (ethRef.current) {
            const block = await pollBlock(ethRef.current);
            if (block) setEth(s => ({ ...s, blockNumber: block }));
          } else {
            const block = await fetchBlockFromRpc(eRpc);
            if (block) setEth(s => ({ ...s, blockNumber: block }));
          }
          if (baseRef.current) {
            const block = await pollBlock(baseRef.current);
            if (block) setBase(s => ({ ...s, blockNumber: block }));
          } else {
            const block = await fetchBlockFromRpc(bRpc);
            if (block) setBase(s => ({ ...s, blockNumber: block }));
          }
        }, POLL_INTERVAL);
      } catch (e) {
        if (!cancelled) {
          setLoading(false);
          const msg = e instanceof Error ? e.message : 'Failed to load';
          setEth(s => ({ ...s, error: msg }));
          setBase(s => ({ ...s, error: msg }));
        }
      }
    }

    const timeout = setTimeout(boot, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
      ethRef.current?.shutdown().catch(() => {});
      baseRef.current?.shutdown().catch(() => {});
    };
  }, [pollBlock]);

  const fmtBlock = (n: number | null) => (n ? `#${n.toLocaleString()}` : '...');

  const dotColor = (s: ChainStatus) =>
    s.error ? '#e74c3c' : s.verified ? '#27ae60' : s.blockNumber ? '#3498db' : '#f39c12';

  const label = (s: ChainStatus) =>
    s.error ? 'offline' : s.verified ? 'verified' : s.blockNumber ? 'tracking' : 'sync';

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Expand Helios node status"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          border: 'none',
          borderTop: '2px solid #e2e3e8',
          borderRight: '2px solid #e2e3e8',
          background: '#f4f4f8',
          fontSize: 10,
          color: '#68778d',
          cursor: 'pointer',
          textTransform: 'uppercase',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: eth.verified || base.verified ? '#27ae60' : eth.blockNumber || base.blockNumber ? '#3498db' : '#f39c12',
          }}
        />
        node
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '3px 12px',
        borderTop: '2px solid #e2e3e8',
        background: 'rgba(244, 244, 248, 0.95)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        fontSize: 10,
        color: '#68778d',
        textTransform: 'uppercase',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ color: '#14171a', fontWeight: 'bold', letterSpacing: '0.05em' }}>
          Helios Node
        </span>

        {/* Ethereum */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor(eth),
              animation: !eth.blockNumber && !eth.error ? 'heliosPulse 1.5s infinite' : 'none',
            }}
          />
          <span>ETH {label(eth)}</span>
          {eth.blockNumber && <span style={{ color: '#14171a' }}>{fmtBlock(eth.blockNumber)}</span>}
        </span>

        {/* Base */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor(base),
              animation: !base.blockNumber && !base.error ? 'heliosPulse 1.5s infinite' : 'none',
            }}
          />
          <span>BASE {label(base)}</span>
          {base.blockNumber && <span style={{ color: '#14171a' }}>{fmtBlock(base.blockNumber)}</span>}
        </span>

        {loading && (
          <span style={{ animation: 'heliosPulse 1.5s infinite' }}>booting wasm...</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ opacity: 0.6 }} className="d-none d-sm-inline">
          a16z/helios light client
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#68778d',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
          title="Collapse"
        >
          &times;
        </button>
      </div>

      <style>{`
        @keyframes heliosPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

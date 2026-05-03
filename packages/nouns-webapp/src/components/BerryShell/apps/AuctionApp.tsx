import { useMemo } from 'react';

import { formatEther } from 'viem';

import ShortAddress from '@/components/ShortAddress';
import { StandaloneNounImage } from '@/components/StandaloneNoun';
import useOnDisplayAuction from '@/wrappers/onDisplayAuction';

function formatTimeRemaining(
  endTime: bigint | string | number | boolean | undefined,
) {
  if (endTime === undefined || endTime === null) return '—';
  let end: number;
  try {
    end = Number(endTime);
  } catch {
    return '—';
  }
  if (!end) return '—';
  const now = Math.floor(Date.now() / 1000);
  const r = end - now;
  if (r <= 0) return 'ended';
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const s = r % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatEth(
  amount: bigint | string | number | boolean | undefined,
) {
  if (amount === undefined || amount === null) return '—';
  try {
    const v = typeof amount === 'bigint' ? amount : BigInt(amount.toString());
    const e = formatEther(v);
    return `${e.replace(/\.?0+$/, '') || '0'} Ξ`;
  } catch {
    return '—';
  }
}

// HIG: 11pt label, 22pt value (sub-headline)
const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
  fontSize: 11,
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontWeight: 600,
  color: 'var(--theme-text-muted)',
  marginBottom: 4,
};
const valueStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
  fontSize: 22,
  lineHeight: 1.3,
  fontWeight: 700,
  color: 'var(--theme-text-primary)',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * AuctionApp — current Noun image, current bid, time remaining, bidder.
 * Click "Open Full Auction" to navigate to the canonical /noun/:id page
 * (which in classic mode renders the full Auction component).
 */
export default function AuctionApp() {
  const auction = useOnDisplayAuction();

  const nounIdBig = useMemo<bigint | undefined>(() => {
    if (auction?.nounId === undefined || auction?.nounId === null) return undefined;
    try {
      return BigInt(auction.nounId.toString());
    } catch {
      return undefined;
    }
  }, [auction?.nounId]);

  return (
    // HIG 8pt grid: 16pt content padding, 16pt section gaps
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: 16 }}>
        <div
          style={{
            background: 'var(--theme-bg-tertiary)',
            border: '1px solid var(--theme-border)',
            boxShadow:
              'inset 1px 1px 0 var(--theme-bevel-light), inset -1px -1px 0 var(--theme-bevel-dark)',
            aspectRatio: '1 / 1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {nounIdBig !== undefined ? (
            <StandaloneNounImage nounId={nounIdBig} />
          ) : (
            <span style={{ color: 'var(--theme-text-muted)', fontSize: 13, lineHeight: 1.4 }}>loading…</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={labelStyle}>Noun</div>
            <div style={valueStyle}>
              {nounIdBig !== undefined ? `Noun ${nounIdBig.toString()}` : '—'}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Current Bid</div>
            <div style={valueStyle}>{formatEth(auction?.amount)}</div>
          </div>
          <div>
            <div style={labelStyle}>Time Remaining</div>
            <div style={valueStyle}>{formatTimeRemaining(auction?.endTime)}</div>
          </div>
          <div>
            <div style={labelStyle}>High Bidder</div>
            <div style={{ ...valueStyle, fontSize: 15, fontFamily: 'var(--ls-font-mono, monospace)' }}>
              {auction?.bidder ? (
                <ShortAddress address={auction.bidder} avatar={false} />
              ) : (
                <span style={{ color: 'var(--theme-text-muted)' }}>no bids yet</span>
              )}
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.4, color: 'var(--theme-text-muted)', fontFamily: 'var(--ls-font-sans, var(--theme-font-display))' }}>
            Berry desktop emulation — switch theme to view the full auction.
          </div>
        </div>
      </div>
    </div>
  );
}

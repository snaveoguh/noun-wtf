/**
 * DerivativeAuction — Inline auction panel for a minted derivative NFT.
 *
 * States:
 * - No bids (inactive): "Place first bid — Reserve: X ETH"
 * - Active: current bid, bidder, countdown, bid input
 * - Ended, unsettled: "Auction ended" + SETTLE button
 * - Settled: "SOLD for X ETH to 0x..."
 */
import { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { formatEther } from 'viem';
import { useAccount } from 'wagmi';

import {
  useDerivativeAuction,
  useCreateDerivativeBid,
  useSettleDerivativeAuction,
  minBidAmount,
  hasDerivativesContract,
} from '@/wrappers/nounDerivatives';

import BidCommentThread from './BidCommentThread';

interface Props {
  tokenId: number;
}

const fmt = (wei: bigint): string => {
  const n = parseFloat(formatEther(wei));
  return n < 0.001 ? n.toFixed(6) : n.toFixed(4);
};

const MAX_BID_REASON_LENGTH = 280;

const truncAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const useCountdown = (endTime: number) => {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!endTime) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [endTime]);

  const remaining = Math.max(0, endTime - now);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return { remaining, label: `${h}h ${m}m ${s}s` };
};

const DerivativeAuction: FC<Props> = ({ tokenId }) => {
  const { auction, isLoading, refetch } = useDerivativeAuction(tokenId);
  const { isConnected } = useAccount();
  const { bid, isPending: bidPending, isSuccess: bidSuccess } = useCreateDerivativeBid();
  const {
    settle,
    isPending: settlePending,
    isSuccess: settleSuccess,
  } = useSettleDerivativeAuction();

  const [bidInput, setBidInput] = useState('');
  const [bidReasonInput, setBidReasonInput] = useState('');

  const isWalletConnected = isConnected === true;
  const isActive = auction !== undefined && auction.startTime > 0 && !auction.settled;
  const isEnded = auction !== undefined && auction.startTime > 0 && !auction.settled;
  const { remaining, label: countdown } = useCountdown(auction?.endTime ?? 0);

  // Refetch auction after successful bid or settle
  useEffect(() => {
    if (bidSuccess || settleSuccess) {
      const t = setTimeout(() => refetch(), 2000);
      return () => clearTimeout(t);
    }
  }, [bidSuccess, settleSuccess, refetch]);

  useEffect(() => {
    if (!bidSuccess) return;
    const t = setTimeout(() => {
      setBidInput('');
      setBidReasonInput('');
    }, 0);
    return () => clearTimeout(t);
  }, [bidSuccess]);

  const minBid = useMemo(() => {
    if (!auction) return '0';
    if (auction.startTime === 0) return fmt(auction.reservePrice);
    return fmt(minBidAmount(auction.amount));
  }, [auction]);

  const handleBid = useCallback(() => {
    if (!bidInput.trim()) return;
    bid(tokenId, bidInput.trim(), {
      reason: bidReasonInput,
      supportsBidReason: auction?.supportsBidReason,
    });
  }, [tokenId, bid, bidInput, bidReasonInput, auction?.supportsBidReason]);

  const handleSettle = useCallback(() => {
    settle(tokenId);
  }, [tokenId, settle]);

  if (!hasDerivativesContract || isLoading || !auction) return null;

  const s: React.CSSProperties = {
    fontFamily: "'PT Root UI', sans-serif",
    fontSize: '0.6rem',
    color: 'rgba(255,255,255,0.9)',
  };

  // ── Settled ───────────────────────────────────────────────────────────
  if (auction.settled) {
    return (
      <div style={{ ...s, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, color: '#22c55e' }}>SOLD</span>
          <span>{fmt(auction.amount)} ETH</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>→ {truncAddr(auction.bidder)}</span>
        </div>
        {auction.supportsBidReason && (
          <BidCommentThread tokenId={tokenId} isSettled={true} winnerAddress={auction.bidder} />
        )}
      </div>
    );
  }

  // ── Ended, unsettled ──────────────────────────────────────────────────
  if (isEnded && auction.startTime > 0 && remaining === 0) {
    return (
      <div style={{ ...s, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 700 }}>ENDED · {fmt(auction.amount)} ETH</span>
        {isWalletConnected && (
          <button
            type="button"
            onClick={handleSettle}
            disabled={settlePending}
            style={{
              border: 'none',
              borderRadius: 4,
              padding: '3px 10px',
              background: '#22c55e',
              color: '#000',
              cursor: 'pointer',
              fontSize: '0.6rem',
              fontWeight: 700,
              fontFamily: "'PT Root UI', sans-serif",
              opacity: settlePending ? 0.5 : 1,
            }}
          >
            {settlePending ? '...' : 'SETTLE'}
          </button>
        )}
      </div>
    );
  }

  // ── Active (has bids, timer running) ──────────────────────────────────
  if (isActive && auction.startTime > 0) {
    return (
      <div style={{ ...s, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <span style={{ fontWeight: 700 }}>{fmt(auction.amount)} ETH</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>
              by {truncAddr(auction.bidder)}
            </span>
          </span>
          <span style={{ color: '#fbbf24', fontWeight: 600 }}>{countdown}</span>
        </div>
        {auction.supportsBidReason && (
          <BidCommentThread tokenId={tokenId} isSettled={false} winnerAddress={auction.bidder} />
        )}
        {isWalletConnected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="number"
              step="0.001"
              min={minBid}
              placeholder={`≥ ${minBid} ETH`}
              value={bidInput}
              onChange={e => setBidInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleBid();
              }}
              style={{
                flex: 1,
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 4,
                padding: '3px 6px',
                fontSize: '0.6rem',
                fontFamily: "'PT Root UI', sans-serif",
                background: 'rgba(0,0,0,0.4)',
                color: '#fff',
                outline: 'none',
              }}
            />
            {auction.supportsBidReason && (
              <textarea
                value={bidReasonInput}
                onChange={e => setBidReasonInput(e.target.value.slice(0, MAX_BID_REASON_LENGTH))}
                placeholder="Say something about this art..."
                rows={2}
                style={{
                  resize: 'vertical',
                  minHeight: 60,
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 8,
                  padding: '6px 8px',
                  fontSize: '0.6rem',
                  fontFamily: "'PT Root UI', sans-serif",
                  background: 'rgba(0,0,0,0.28)',
                  color: '#fff',
                  outline: 'none',
                }}
              />
            )}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleBid}
                disabled={bidPending || !bidInput.trim()}
                style={{
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 10px',
                  background: '#fff',
                  color: '#14141f',
                  cursor: 'pointer',
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  fontFamily: "'PT Root UI', sans-serif",
                  opacity: bidPending ? 0.5 : 1,
                }}
              >
                {bidPending ? '...' : 'BID'}
              </button>
              {auction.supportsBidReason && (
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.5rem' }}>
                  {bidReasonInput.length}/{MAX_BID_REASON_LENGTH}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── No bids (inactive) ────────────────────────────────────────────────
  return (
    <div style={{ ...s, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.6)' }}>
          Reserve: {fmt(auction.reservePrice)} ETH
        </span>
        <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.4)' }}>
          24h auction starts on first bid
        </span>
      </div>
      {isWalletConnected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            type="number"
            step="0.001"
            min={minBid}
            placeholder={`≥ ${minBid} ETH`}
            value={bidInput}
            onChange={e => setBidInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleBid();
            }}
            style={{
              flex: 1,
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4,
              padding: '3px 6px',
              fontSize: '0.6rem',
              fontFamily: "'PT Root UI', sans-serif",
              background: 'rgba(0,0,0,0.4)',
              color: '#fff',
              outline: 'none',
            }}
          />
          {auction.supportsBidReason && (
            <textarea
              value={bidReasonInput}
              onChange={e => setBidReasonInput(e.target.value.slice(0, MAX_BID_REASON_LENGTH))}
              placeholder="Say something about this art..."
              rows={2}
              style={{
                resize: 'vertical',
                minHeight: 60,
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: '0.6rem',
                fontFamily: "'PT Root UI', sans-serif",
                background: 'rgba(0,0,0,0.28)',
                color: '#fff',
                outline: 'none',
              }}
            />
          )}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleBid}
              disabled={bidPending || !bidInput.trim()}
              style={{
                border: 'none',
                borderRadius: 4,
                padding: '3px 10px',
                background: '#fff',
                color: '#14141f',
                cursor: 'pointer',
                fontSize: '0.6rem',
                fontWeight: 700,
                fontFamily: "'PT Root UI', sans-serif",
                opacity: bidPending ? 0.5 : 1,
              }}
            >
              {bidPending ? '...' : 'BID'}
            </button>
            {auction.supportsBidReason && (
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.5rem' }}>
                {bidReasonInput.length}/{MAX_BID_REASON_LENGTH}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DerivativeAuction;

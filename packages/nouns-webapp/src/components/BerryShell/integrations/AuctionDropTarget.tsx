/**
 * AuctionDropTarget — drop-zone wrapper around the existing `AuctionApp`.
 *
 * Lives in `integrations/` (not `apps/`) so it can be substituted into the
 * app registry independently of the underlying AuctionApp source. Dragging
 * a Noun file from Finder onto the Auction window:
 *  1. shows the blue inset highlight (via `useDropTarget`),
 *  2. on drop, surfaces a transient toast offering to bid,
 *  3. emits `auction:newBid` for telemetry parity with real bid wiring.
 *
 * The toast is local to this wrapper — no global notification dependency
 * required.
 */

import { useState, useRef, useEffect, type CSSProperties } from 'react';

import AuctionApp from '../apps/AuctionApp';
import { useDropTarget, type BerryDragPayload } from '../system/dnd';
import { berryBus } from '../system/eventBus';

interface NounDrop {
  id: string;
  nounId: string;
  shownAt: number;
}

function extractNounId(payload: BerryDragPayload): string | null {
  if (payload.type !== 'noun') return null;
  const data = payload.data;
  if (typeof data === 'string' || typeof data === 'number') return String(data);
  if (data && typeof data === 'object') {
    const ne = data as { nounId?: unknown; metadata?: { nounId?: unknown }; name?: unknown };
    if (ne.nounId !== undefined) return String(ne.nounId);
    if (ne.metadata?.nounId !== undefined) return String(ne.metadata.nounId);
    if (typeof ne.name === 'string') {
      const m = ne.name.match(/(\d+)/);
      if (m) return m[1];
    }
  }
  return null;
}

const toastStyle: CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  borderRadius: 8,
  background:
    'linear-gradient(180deg, rgba(40, 40, 40, 0.96) 0%, rgba(20, 20, 20, 0.96) 100%)',
  color: '#fff',
  fontFamily: 'var(--theme-font-display)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.4,
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  pointerEvents: 'auto',
  whiteSpace: 'nowrap',
  zIndex: 10,
};

export default function AuctionDropTarget() {
  const [toast, setToast] = useState<NounDrop | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const { ref, isOver, canAccept, highlightStyle } = useDropTarget<HTMLDivElement>(
    ['noun'],
    payload => {
      const nounId = extractNounId(payload);
      if (!nounId) return;
      const drop: NounDrop = {
        id: `${nounId}-${Date.now()}`,
        nounId,
        shownAt: Date.now(),
      };
      setToast(drop);
      // Re-emit on the bus so listeners (notifications, system monitor) see it.
      berryBus.emit('auction:newBid', {
        nounId,
        amount: '0',
        bidder: payload.sourceAppId ?? 'drag-drop',
      });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        setToast(t => (t && t.id === drop.id ? null : t));
      }, 4500);
    },
    { appId: 'auction' },
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-berry-drop-id="auction"
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        overflow: 'auto',
        ...highlightStyle,
      }}
    >
      <AuctionApp />
      {canAccept && !isOver && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            padding: '2px 8px',
            borderRadius: 12,
            background: 'rgba(60, 130, 220, 0.18)',
            color: 'rgba(20, 70, 160, 0.95)',
            fontFamily: 'var(--theme-font-display)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          drop a noun to bid
        </div>
      )}
      {toast && (
        <div style={toastStyle} role="status">
          🍆 Bid on Noun {toast.nounId}?
          <button
            type="button"
            onClick={() => setToast(null)}
            style={{
              marginLeft: 10,
              background: 'transparent',
              color: '#9cf',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

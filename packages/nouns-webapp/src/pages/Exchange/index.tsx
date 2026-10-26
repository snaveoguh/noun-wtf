// /exchange: Noun Trade's Grand Exchange. The default is the 3D trading floor
// (a lazy chunk: three.js only loads for it); the flat order book is one
// click away, as a side panel over the floor or as the whole page
// (`?view=flat`). `?offline=1` runs the exchange in this tab, for both.

import { lazy, Suspense, useCallback, useState, type CSSProperties } from 'react';

import ExchangeFloor from '@/miniapps/exchange/ui/ExchangeFloor';

const Exchange3D = lazy(() => import('@/miniapps/exchange3d/ui/Exchange3D'));

type View = '3d' | 'flat';

function setViewParam(v: View) {
  try {
    const u = new URL(window.location.href);
    if (v === 'flat') u.searchParams.set('view', 'flat');
    else u.searchParams.delete('view');
    window.history.replaceState(window.history.state, '', u.toString());
  } catch {
    // ignore
  }
}

const barBtn: CSSProperties = {
  font: '800 12px ui-monospace, monospace',
  border: '2px solid #111',
  background: '#ffd400',
  color: '#111',
  padding: '5px 10px',
  borderRadius: 6,
  boxShadow: '3px 3px 0 #111',
  cursor: 'pointer',
};

export default function ExchangePage() {
  const [view, setViewState] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'flat' ? 'flat' : '3d',
  );
  const [book, setBook] = useState(false);
  const setView = useCallback((v: View) => {
    setViewState(v);
    setViewParam(v);
  }, []);

  if (view === 'flat')
    return (
      <div style={{ position: 'relative', minHeight: '100%', background: '#0b0f0c' }}>
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 3,
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '6px 10px',
            background: '#0b0f0c',
          }}
        >
          <button type="button" style={barBtn} onClick={() => setView('3d')}>
            ⌐◨-◨ 3D TRADING FLOOR
          </button>
        </div>
        <ExchangeFloor />
      </div>
    );

  return (
    <Suspense
      fallback={
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: '#9cc9f0',
            color: '#111',
            font: '800 13px ui-monospace, monospace',
            letterSpacing: '.15em',
          }}
        >
          OPENING THE FLOOR…
        </div>
      }
    >
      <Exchange3D onFlat={() => setView('flat')} bookOpen={book} onBook={setBook}>
        {book && (
          <div className="gx3d-book">
            <div className="gx3d-book-close">
              <span>ORDER BOOK · same exchange as the floor</span>
              <button type="button" style={barBtn} onClick={() => setBook(false)}>
                CLOSE ×
              </button>
            </div>
            <ExchangeFloor />
          </div>
        )}
      </Exchange3D>
    </Suspense>
  );
}

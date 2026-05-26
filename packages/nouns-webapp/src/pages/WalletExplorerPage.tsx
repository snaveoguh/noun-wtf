/**
 * /explore/wallet — wraps WalletExplorer in the dark "nonsense" shell.
 * Reuses the same dark-mode body class + layout pattern as NonsensePage.
 */
import React, { Suspense, useEffect } from 'react';

const WalletExplorer = React.lazy(() => import('@/components/WalletExplorer'));

export default function WalletExplorerPage() {
  useEffect(() => {
    document.body.classList.add('nonsense-dark');
    return () => document.body.classList.remove('nonsense-dark');
  }, []);

  return (
    <>
      <style>{`
        .nonsense-dark { background: #0a0a0f !important; }
        .nonsense-dark nav,
        .nonsense-dark .navbar { background: #0a0a0f !important; border-bottom: 1px solid rgba(255,255,255,0.06) !important; }
        .nonsense-dark nav *,
        .nonsense-dark .navbar * { color: #e2e8f0 !important; }
        .nonsense-dark nav svg path { fill: #e2e8f0 !important; }
      `}</style>
      <div
        style={{ position: 'fixed', inset: 0, top: 110, background: '#0a0a0f', overflow: 'hidden' }}
      >
        <Suspense
          fallback={<div style={{ color: '#444', textAlign: 'center', padding: 60 }}>Loading…</div>}
        >
          <WalletExplorer />
        </Suspense>
      </div>
    </>
  );
}

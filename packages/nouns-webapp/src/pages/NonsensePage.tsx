import React, { Suspense } from 'react';

const TreasuryFlowSection = React.lazy(() => import('@/components/TreasuryFlow'));

export default function NonsensePage() {
  return (
    <div style={{ minHeight: '100vh', background: '#000' }}>
      <div
        style={{
          padding: '24px 32px',
          fontFamily: "'Londrina Solid', cursive",
          color: '#fff',
        }}
      >
        <h1 style={{ fontSize: '2.5rem', margin: 0 }}>Nonsense</h1>
        <p style={{ color: '#888', fontSize: '0.9rem', fontFamily: "'PT Root UI', sans-serif", margin: '8px 0 0' }}>
          3D treasury flow visualization. Where the ETH goes.
        </p>
      </div>
      <Suspense
        fallback={
          <div style={{ color: '#444', textAlign: 'center', padding: '60px', fontFamily: 'monospace' }}>
            Loading 3D scene...
          </div>
        }
      >
        <TreasuryFlowSection />
      </Suspense>
    </div>
  );
}

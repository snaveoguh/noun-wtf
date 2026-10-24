import React, { Suspense } from 'react';

const TreasuryFlowSection = React.lazy(() => import('@/components/TreasuryFlow'));

// Renders inside the NounOS navigator window (.nos-page), so it's a normal
// scrolling page: no fixed positioning and no global navbar overrides.
export default function NonsensePage() {
  return (
    <Suspense
      fallback={
        <div style={{ background: '#050506', minHeight: '100%', padding: 24, color: '#8d8c84' }}>
          loading…
        </div>
      }
    >
      <TreasuryFlowSection />
    </Suspense>
  );
}

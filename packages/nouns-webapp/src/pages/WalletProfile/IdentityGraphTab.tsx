/**
 * Identity graph tab — hosts the existing R3F WalletExplorer (≥4-noun gate
 * intact). The explorer paints its own dark chrome; `.wp-graph` scopes that
 * to this container instead of the old body-class hack.
 */
import React, { Suspense } from 'react';

const WalletExplorer = React.lazy(() => import('@/components/WalletExplorer'));

const IdentityGraphTab: React.FC = () => (
  <div className="wp-graph">
    <Suspense
      fallback={<div style={{ color: '#444', textAlign: 'center', padding: 60 }}>Loading…</div>}
    >
      <WalletExplorer />
    </Suspense>
  </div>
);

export default IdentityGraphTab;

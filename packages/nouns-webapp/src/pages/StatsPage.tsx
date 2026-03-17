/**
 * StatsPage — Wrapper for the 3D Treasury Corridor.
 * Lazy-loads the 3D scene to keep the bundle small.
 */
import React, { Suspense } from 'react';

const TreasuryCorridor = React.lazy(() => import('@/components/TreasuryCorridor'));

const StatsPage: React.FC = () => {
  return (
    <div style={{ width: '100%', minHeight: '100vh', background: '#050510' }}>
      <Suspense
        fallback={
          <div
            style={{
              width: '100%',
              height: '100vh',
              background: '#050510',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'PT Root UI', sans-serif",
              color: '#64748b',
              fontSize: '0.8rem',
            }}
          >
            Loading Stats...
          </div>
        }
      >
        <TreasuryCorridor />
      </Suspense>
    </div>
  );
};

export default StatsPage;

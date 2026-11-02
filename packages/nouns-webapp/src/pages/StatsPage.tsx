/**
 * StatsPage — Wrapper for the 3D Treasury Corridor.
 * Lazy-loads the 3D scene to keep the bundle small.
 */
import React, { Suspense } from 'react';

const TreasuryCorridor = React.lazy(() => import('@/components/TreasuryCorridor'));

const StatsPage: React.FC = () => {
  return (
    // data-page-fill: the window's exact height, the corridor fills it below its HUD bar.
    <div
      data-page-fill
      style={{ width: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }}
    >
      <Suspense
        fallback={
          <div
            style={{
              width: '100%',
              flex: '1 1 auto',
              minHeight: 360,
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'PT Root UI', sans-serif",
              color: 'var(--theme-text-muted)',
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

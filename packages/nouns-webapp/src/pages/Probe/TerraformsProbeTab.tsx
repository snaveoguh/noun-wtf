/**
 * TerraformsProbeTab — Embeds the 3D Hypercastle view inside the probe page.
 * Reuses the existing miniapp component; clicking a parcel navigates to /terraforms/:id.
 */
import { lazy, Suspense } from 'react';

const HypercastleView = lazy(() => import('@/miniapps/terraforms/HypercastleView'));

const TerraformsProbeTab: React.FC = () => (
  <div
    style={{
      margin: '0 -0.5rem',
      borderRadius: 12,
      overflow: 'hidden',
      height: 'calc(100vh - 120px)',
    }}
  >
    <Suspense
      fallback={
        <div
          style={{
            width: '100%',
            height: '100%',
            background: '#050510',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#475569',
            fontSize: '0.85rem',
          }}
        >
          Loading Hypercastle...
        </div>
      }
    >
      <HypercastleView />
    </Suspense>
  </div>
);

export default TerraformsProbeTab;
